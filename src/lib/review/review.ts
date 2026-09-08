/**
 * Revision privada de una propiedad.
 *
 * El reviewer no tiene cuenta: recibe un enlace con un token y con eso ve el
 * borrador y decide. Aqui vive todo lo que decide si ese enlace sirve y que
 * pasa cuando se usa.
 *
 * El modelo ya existia desde la Fase 0 y no se toca: `property_reviews` con
 * su estado y su comentario, y `property_review_tokens` con el hash, la
 * caducidad, el uso y la revocacion.
 *
 * Dos cosas que conviene tener claras leyendo esto:
 *
 * - APROBAR NO PUBLICA. Deja la propiedad en `approved`, que es un estado
 *   editorial mas; publicar es una decision del admin y es otra fase;
 * - una decision final invalida su enlace. El token queda usado y no vuelve a
 *   servir, asi que nadie puede aprobar dos veces ni cambiar de opinion por la
 *   puerta de atras.
 */

import { and, desc, eq, isNull } from 'drizzle-orm';

import { properties, propertyReviews, propertyReviewTokens } from '../../db/schema';
import { updatePropertyStatus } from '../admin/properties/update-property-status';
import { fail, ok, type AdminDatabase, type AdminResult } from '../admin/types';
import type { PublicationStatus, ReviewStatus } from '../domain/vocabularies';
import { generateReviewToken, hashReviewToken, looksLikeToken, tokenExpiry } from './tokens';

/* -------------------------------------------------------------------------- */
/* Forma                                                                      */
/* -------------------------------------------------------------------------- */

export interface ReviewView {
  id: number;
  status: ReviewStatus;
  reviewerEmail: string | null;
  reviewerComment: string | null;
  requestedAt: Date;
  reviewedAt: Date | null;
  /** Estado de su enlace, sin el token. */
  link: ReviewLinkView | null;
}

export interface ReviewLinkView {
  id: number;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  /** Derivado: si hoy serviria para entrar. */
  isActive: boolean;
}

export interface ReviewStateView {
  propertyId: number;
  publicationStatus: PublicationStatus;
  /** La revision abierta, si la hay. */
  current: ReviewView | null;
  /** Historial completo, la mas reciente primero. */
  history: ReviewView[];
}

/** Lo que se devuelve al crear: la UNICA vez que el token viaja en claro. */
export interface ReviewInvite {
  review: ReviewView;
  token: string;
  expiresAt: Date;
}

export const REVIEW_DECISIONS = ['approved', 'changes_requested'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const MAX_COMMENT_LENGTH = 2000;

/* -------------------------------------------------------------------------- */
/* Lectura                                                                    */
/* -------------------------------------------------------------------------- */

function linkView(
  row: typeof propertyReviewTokens.$inferSelect | undefined,
  now: Date,
): ReviewLinkView | null {
  if (row === undefined) return null;

  return {
    id: row.id,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    revokedAt: row.revokedAt,
    isActive: row.usedAt === null && row.revokedAt === null && row.expiresAt > now,
  };
}

export async function getReviewState(
  db: AdminDatabase,
  propertyId: number,
  now: Date = new Date(),
): Promise<AdminResult<ReviewStateView>> {
  const found = await db
    .select({ id: properties.id, publicationStatus: properties.publicationStatus })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);

  const property = found[0];
  if (property === undefined) {
    return fail({ code: 'not_found', message: 'La propiedad no existe.', field: 'propertyId' });
  }

  const reviews = await db
    .select()
    .from(propertyReviews)
    .where(eq(propertyReviews.propertyId, propertyId))
    .orderBy(desc(propertyReviews.createdAt), desc(propertyReviews.id));

  const tokens = await db.select().from(propertyReviewTokens);

  const history: ReviewView[] = reviews.map((review) => {
    /*
     * El enlace vigente de cada revision: el mas reciente. Los anteriores
     * quedan revocados y no aportan nada al panel.
     */
    const link = tokens
      .filter((token) => token.propertyReviewId === review.id)
      .sort((a, b) => b.id - a.id)[0];

    return {
      id: review.id,
      status: review.status,
      reviewerEmail: review.reviewerEmail,
      reviewerComment: review.reviewerComment,
      requestedAt: review.requestedAt,
      reviewedAt: review.reviewedAt,
      link: linkView(link, now),
    };
  });

  return ok({
    propertyId,
    publicationStatus: property.publicationStatus,
    // Abierta = todavia pendiente. Solo puede haber una a la vez.
    current: history.find((review) => review.status === 'pending') ?? null,
    history,
  });
}

/* -------------------------------------------------------------------------- */
/* Envio a revision                                                           */
/* -------------------------------------------------------------------------- */

export interface RequestReviewInput {
  reviewerEmail?: string | null;
}

/**
 * Envia una propiedad a revision y devuelve el enlace.
 *
 * Pasa por la maquina de estados existente, que es la que decide si desde el
 * estado actual se puede ir a `in_review`: una propiedad archivada o ya
 * publicada no entra en revision, y esa regla no se reescribe aqui.
 *
 * Si ya habia una revision pendiente, se reutiliza y se le genera un enlace
 * nuevo: pedir revision dos veces es querer otro enlace, no abrir dos
 * revisiones en paralelo. Los enlaces anteriores se revocan en el acto.
 */
export async function requestReview(
  db: AdminDatabase,
  propertyId: number,
  input: RequestReviewInput = {},
  now: Date = new Date(),
): Promise<AdminResult<ReviewInvite>> {
  const state = await getReviewState(db, propertyId, now);
  if (!state.ok) return state;

  if (state.data.publicationStatus !== 'in_review') {
    const moved = await updatePropertyStatus(db, propertyId, 'in_review');
    if (!moved.ok) return moved;
  }

  const email = input.reviewerEmail?.trim();
  const reviewerEmail = email === undefined || email.length === 0 ? null : email;

  let reviewId = state.data.current?.id ?? null;

  if (reviewId === null) {
    const inserted = await db
      .insert(propertyReviews)
      .values({ propertyId, status: 'pending', reviewerEmail, requestedAt: now })
      .returning({ id: propertyReviews.id });

    reviewId = inserted[0]?.id ?? null;
    if (reviewId === null) {
      return fail({ code: 'review_failed', message: 'No se pudo abrir la revision.' });
    }
  } else if (reviewerEmail !== null) {
    await db
      .update(propertyReviews)
      .set({ reviewerEmail, updatedAt: now })
      .where(eq(propertyReviews.id, reviewId));
  }

  // Un enlace nuevo deja sin valor a los anteriores, en el mismo momento.
  await revokeLinksOf(db, reviewId, now);

  const token = generateReviewToken();
  const expiresAt = tokenExpiry(now);

  await db.insert(propertyReviewTokens).values({
    propertyReviewId: reviewId,
    tokenHash: await hashReviewToken(token),
    expiresAt,
  });

  const after = await getReviewState(db, propertyId, now);
  if (!after.ok) return after;

  const review = after.data.current;
  if (review === null) {
    return fail({ code: 'review_failed', message: 'No se pudo abrir la revision.' });
  }

  // La unica vez que el token sale de aqui en claro.
  return ok({ review, token, expiresAt });
}

/** Inutiliza los enlaces vivos de una revision. */
async function revokeLinksOf(db: AdminDatabase, reviewId: number, now: Date): Promise<number> {
  const live = await db
    .select({ id: propertyReviewTokens.id })
    .from(propertyReviewTokens)
    .where(
      and(
        eq(propertyReviewTokens.propertyReviewId, reviewId),
        isNull(propertyReviewTokens.revokedAt),
        isNull(propertyReviewTokens.usedAt),
      ),
    );

  for (const row of live) {
    await db
      .update(propertyReviewTokens)
      .set({ revokedAt: now })
      .where(eq(propertyReviewTokens.id, row.id));
  }

  return live.length;
}

/**
 * Revoca el enlace vigente de una propiedad.
 *
 * La revision sigue abierta: revocar es "este enlace ya no vale", no "olvida
 * la revision". Para volver a compartirla se pide otro enlace.
 */
export async function revokeReviewLinks(
  db: AdminDatabase,
  propertyId: number,
  now: Date = new Date(),
): Promise<AdminResult<ReviewStateView>> {
  const state = await getReviewState(db, propertyId, now);
  if (!state.ok) return state;

  const review = state.data.current;
  if (review === null) {
    return fail({
      code: 'review_not_found',
      message: 'Esta propiedad no tiene una revision abierta.',
      field: 'propertyId',
    });
  }

  await revokeLinksOf(db, review.id, now);

  return getReviewState(db, propertyId, now);
}

/* -------------------------------------------------------------------------- */
/* Uso del token                                                              */
/* -------------------------------------------------------------------------- */

export interface ResolvedReview {
  reviewId: number;
  tokenId: number;
  propertyId: number;
  propertyCode: string;
  publicationStatus: PublicationStatus;
  reviewStatus: ReviewStatus;
}

/**
 * Resuelve un token.
 *
 * Devuelve `null` en TODOS los casos en que no sirve: no existe, caducado,
 * revocado, ya usado, o su revision ya no esta pendiente. Quien pregunta no
 * puede distinguirlos, y esa indistinguibilidad es deliberada: decir
 * "caducado" en vez de "no existe" confirmaria que ese token existio.
 *
 * El token no se registra en ningun sitio, ni siquiera al fallar.
 */
export async function resolveReviewToken(
  db: AdminDatabase,
  rawToken: string,
  now: Date = new Date(),
): Promise<ResolvedReview | null> {
  if (!looksLikeToken(rawToken)) return null;

  const hash = await hashReviewToken(rawToken);

  /*
   * Se busca POR HASH sobre su indice unico: no se compara el secreto con
   * nada, se calcula su huella y se pregunta si existe.
   */
  const rows = await db
    .select({
      tokenId: propertyReviewTokens.id,
      expiresAt: propertyReviewTokens.expiresAt,
      usedAt: propertyReviewTokens.usedAt,
      revokedAt: propertyReviewTokens.revokedAt,

      reviewId: propertyReviews.id,
      reviewStatus: propertyReviews.status,

      propertyId: properties.id,
      propertyCode: properties.code,
      publicationStatus: properties.publicationStatus,
    })
    .from(propertyReviewTokens)
    .innerJoin(propertyReviews, eq(propertyReviewTokens.propertyReviewId, propertyReviews.id))
    .innerJoin(properties, eq(propertyReviews.propertyId, properties.id))
    .where(eq(propertyReviewTokens.tokenHash, hash))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  if (row.revokedAt !== null) return null;
  if (row.usedAt !== null) return null;
  if (row.expiresAt <= now) return null;

  // Una revision ya resuelta no se vuelve a abrir con un enlace viejo.
  if (row.reviewStatus !== 'pending') return null;

  return {
    reviewId: row.reviewId,
    tokenId: row.tokenId,
    propertyId: row.propertyId,
    propertyCode: row.propertyCode,
    publicationStatus: row.publicationStatus,
    reviewStatus: row.reviewStatus,
  };
}

/* -------------------------------------------------------------------------- */
/* Decision                                                                   */
/* -------------------------------------------------------------------------- */

export interface DecisionResult {
  decision: ReviewDecision;
  publicationStatus: PublicationStatus;
}

/**
 * Aplica la decision del reviewer.
 *
 * `approved` deja la propiedad en `approved`, que NO es publicada: publicar
 * sigue siendo cosa del admin. `changes_requested` la devuelve a `draft`,
 * que es lo que la maquina de estados permite desde `in_review`.
 *
 * El token se marca como usado en la misma operacion: una decision es final y
 * su enlace deja de servir, asi que no se puede aplicar dos veces.
 */
export async function decideReview(
  db: AdminDatabase,
  rawToken: string,
  decision: ReviewDecision,
  comment: string | null = null,
  now: Date = new Date(),
): Promise<AdminResult<DecisionResult>> {
  const resolved = await resolveReviewToken(db, rawToken, now);
  if (resolved === null) {
    return fail({ code: 'review_link_invalid', message: 'Este enlace ya no es valido.' });
  }

  if (!REVIEW_DECISIONS.includes(decision)) {
    return fail({ code: 'validation_failed', message: 'Decision invalida.', field: 'decision' });
  }

  const clean = comment?.trim();
  if (clean !== undefined && clean.length > MAX_COMMENT_LENGTH) {
    return fail({
      code: 'validation_failed',
      message: 'El comentario es demasiado largo.',
      field: 'comment',
    });
  }

  const nextStatus: PublicationStatus = decision === 'approved' ? 'approved' : 'draft';
  const moved = await updatePropertyStatus(db, resolved.propertyId, nextStatus);
  if (!moved.ok) return moved;

  await db
    .update(propertyReviews)
    .set({
      status: decision,
      reviewerComment: clean === undefined || clean.length === 0 ? null : clean,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(eq(propertyReviews.id, resolved.reviewId));

  // El enlace muere con la decision.
  await db
    .update(propertyReviewTokens)
    .set({ usedAt: now })
    .where(eq(propertyReviewTokens.id, resolved.tokenId));

  return ok({ decision, publicationStatus: nextStatus });
}
