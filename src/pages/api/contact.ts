import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';

import { getDb } from '../../db/client';
import { handleContact } from '../../lib/contacts/handler';

export const prerender = false;

/**
 * Formulario publico de contacto.
 *
 * Fuera de `/api/admin/*` a proposito: no exige sesion, responde con codigos
 * genericos y nunca comparte la guardia del panel.
 */
type ContactVars = Record<string, string | undefined>;

export const POST: APIRoute = (context) => {
  const vars = env as unknown as ContactVars;

  return handleContact({
    request: context.request,
    db: getDb(env),
    env: {
      RESEND_API_KEY: vars.RESEND_API_KEY,
      CONTACT_FROM_EMAIL: vars.CONTACT_FROM_EMAIL,
    },
  });
};
