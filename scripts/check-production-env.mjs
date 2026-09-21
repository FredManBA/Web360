/*
 * Comprobacion previa a un build de produccion.
 *
 * `npm run build` funciona sin token de Mapbox a proposito: el mapa se degrada
 * a texto. Eso es util en desarrollo, pero un deploy hecho con ese build deja
 * produccion sin mapas y sin ningun aviso. `npm run build:production` pasa
 * antes por aqui y se para si el token falta o no es publico.
 *
 * Nunca se imprime el valor del token.
 */
const token = (process.env.PUBLIC_MAPBOX_TOKEN ?? '').trim();

if (token === '') {
  console.error(
    'PUBLIC_MAPBOX_TOKEN no esta definido. Ponlo en .env o en el entorno antes de construir para produccion.',
  );
  process.exit(1);
}

if (!token.startsWith('pk.')) {
  console.error('PUBLIC_MAPBOX_TOKEN no es un token publico de Mapbox (debe empezar por "pk.").');
  process.exit(1);
}

console.log('PUBLIC_MAPBOX_TOKEN presente (pk.). Build de produccion con mapas.');
