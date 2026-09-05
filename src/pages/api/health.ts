import type { APIRoute } from 'astro';

// Endpoint on-demand: se ejecuta en el Worker, no se prerenderiza.
// Sirve para comprobar que el bundle del Worker se genera y responde.
export const prerender = false;

export const GET: APIRoute = () => {
  return new Response(JSON.stringify({ status: 'ok' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
