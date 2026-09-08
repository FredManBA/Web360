/**
 * Endpoint de maquina: lo que el runner de Actions le cuenta a la aplicacion.
 *
 * Existe porque el token de un solo uso de 5C-1 no puede viajar a GitHub. Los
 * inputs de un `workflow_dispatch` los ve cualquiera que pueda leer los runs
 * del repositorio, asi que mandar ahi el token seria publicarlo. En su lugar
 * el runner se autentica con un secreto compartido que vive en dos sitios y en
 * ninguno mas: los secretos del Worker y los de Actions.
 *
 * Lo importante de esta puerta no es la credencial, sino lo poco que puede
 * hacer con ella:
 *
 * - para cerrar como EXITO no basta con autenticarse. Tiene que coincidir el
 *   manifiesto que lleva dentro el artefacto que atiende la llamada. Es decir:
 *   la prueba de que el despliegue ocurrio es el propio codigo desplegado, no
 *   lo que diga quien llama. Un secreto robado no puede publicar una propiedad
 *   cualquiera: solo puede cerrar la operacion que el sitio ya esta sirviendo;
 * - para cerrar como FALLO si se acepta su palabra, porque un fallo no publica
 *   nada, no mueve la propiedad y se arregla volviendo a pedir la operacion;
 * - el cuerpo no dice nunca que propiedad ni a que estado ir. Eso lo decidio
 *   el admin al pedirla y se lee de la base.
 *
 * Sin cabeceras CORS: esto no es para un navegador. Sin autenticacion no se
 * consulta la base siquiera, asi que la respuesta no revela si una peticion
 * existe. Y el secreto no se registra en ningun log.
 */

import { secretsMatch } from '../security/secret-token';
import type { AdminDatabase } from '../admin/types';
import { confirmDeployedRelease, reportPublicationFailure } from './publication';
import type { ReleaseManifest } from './release';

/** Cabecera con la que se autentica el runner. */
export const MACHINE_SECRET_HEADER = 'x-publication-machine-secret';

/** Variable del Worker que guarda el secreto compartido. */
export const MACHINE_SECRET_ENV_KEY = 'PUBLICATION_MACHINE_SECRET';

/** Un parte de resultado no necesita mas que esto. */
export const MAX_BODY_BYTES = 4 * 1024;

/** Motivo de fallo que se acepta del runner. Se recorta antes de guardarlo. */
export const MAX_REASON_LENGTH = 500;

export interface MachineContext {
  request: Request;
  db: AdminDatabase;
  /** Secreto configurado en el Worker. Sin el, esto no abre nada. */
  secret: string | undefined;
  /** Manifiesto que lleva dentro el artefacto que responde. */
  deployedRelease: ReleaseManifest | null;
  now?: Date;
}

export type MachineCode = 'unauthorized' | 'invalid_request' | 'not_applicable' | 'server_error';

const HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function success(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: HEADERS });
}

function failure(code: MachineCode, status: number): Response {
  return new Response(JSON.stringify({ ok: false, error: { code } }), { status, headers: HEADERS });
}

interface MachineReport {
  requestId: number;
  ok: boolean;
  error?: string;
}

/** Lee el parte del runner: identidad de la operacion, resultado y motivo. */
function readReport(body: unknown): MachineReport | null {
  if (typeof body !== 'object' || body === null) return null;

  const payload = body as Record<string, unknown>;

  /*
   * Estricto: cualquier campo de mas es senal de que quien llama cree poder
   * decidir algo que no le corresponde —una propiedad, un estado— y se
   * rechaza en vez de ignorarlo en silencio.
   */
  const allowed = new Set(['requestId', 'ok', 'error']);
  if (Object.keys(payload).some((key) => !allowed.has(key))) return null;

  const { requestId, ok: outcome, error } = payload;

  if (typeof requestId !== 'number' || !Number.isSafeInteger(requestId) || requestId <= 0) {
    return null;
  }

  if (typeof outcome !== 'boolean') return null;

  if (outcome) return { requestId, ok: true };

  if (error === undefined || error === null) return { requestId, ok: false };
  if (typeof error !== 'string') return null;

  return { requestId, ok: false, error: error.slice(0, MAX_REASON_LENGTH) };
}

export async function handleMachineReport(ctx: MachineContext): Promise<Response> {
  const { request } = ctx;

  if (request.method !== 'POST') return failure('invalid_request', 405);

  /*
   * Autenticar ANTES de mirar nada. Sin secreto configurado no se abre por
   * mucho que llegue una cabecera: en produccion esto es fail-closed.
   */
  const provided = request.headers.get(MACHINE_SECRET_HEADER) ?? '';
  const expected = ctx.secret ?? '';

  if (provided.length === 0 || expected.length === 0) return failure('unauthorized', 401);
  if (!(await secretsMatch(provided, expected))) return failure('unauthorized', 401);

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return failure('invalid_request', 415);
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return failure('invalid_request', 400);
  }

  if (raw.length > MAX_BODY_BYTES) return failure('invalid_request', 413);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return failure('invalid_request', 400);
  }

  const report = readReport(body);
  if (report === null) return failure('invalid_request', 422);

  try {
    if (!report.ok) {
      const failed = await reportPublicationFailure(
        ctx.db,
        report.requestId,
        report.error ?? null,
        ctx.now,
      );

      // Una peticion ya terminada no se vuelve a tocar: repetir es inofensivo.
      if (!failed.ok) return failure('not_applicable', 409);

      return success({
        requestId: failed.data.request.id,
        status: failed.data.request.status,
        publicationStatus: failed.data.publicationStatus,
      });
    }

    const confirmed = await confirmDeployedRelease(
      ctx.db,
      report.requestId,
      ctx.deployedRelease,
      ctx.now,
    );

    if (!confirmed.ok) return failure('server_error', 500);

    /*
     * Cuando la release desplegada no es esa, se contesta 409 y NO se toca
     * nada. El runner puede reintentar; el admin puede reconciliar mas tarde.
     */
    if (!confirmed.data.reconciled) {
      return failure('not_applicable', 409);
    }

    return success({
      requestId: report.requestId,
      status: confirmed.data.request?.status ?? 'done',
      publicationStatus: confirmed.data.publicationStatus,
      releaseId: confirmed.data.deployedReleaseId,
    });
  } catch (error) {
    // Nunca se filtra el detalle, y el secreto no aparece en el log.
    console.error('[publicacion] no se pudo registrar el parte de la maquina:', error);
    return failure('server_error', 500);
  }
}
