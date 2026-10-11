// ── soloLocal ─────────────────────────────────────────────────────────────────
// Restringe el acceso a rutas de backup/restauración a la sesión local que
// corre en la misma máquina que el proceso Electron (loopback), sin importar
// el rol del usuario autenticado.
//
// Detección: la app Electron carga http://127.0.0.1:<puerto> y cualquier
// cliente LAN golpea el MISMO servidor Express, distinguiéndose únicamente
// por la IP de origen (server.js nunca habilita "trust proxy", por lo que
// req.socket.remoteAddress es la IP real del peer, no spoofeable desde la LAN).
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function esLoopback(req) {
  const ip = req.socket?.remoteAddress || '';
  return LOOPBACK.has(ip);
}

function soloLocal(req, res, next) {
  if (esLoopback(req)) return next();
  return res.status(403).json({
    error: 'Esta función solo está disponible desde la aplicación local, no desde la red.',
    solo_local: true,
  });
}

// ── esPcPrincipal ─────────────────────────────────────────────────────────────
// La sesión de administrador solo puede usarse desde la app Electron de la PC
// principal. Además de exigir loopback, main.js genera un token aleatorio por
// arranque (DESKTOP_TOKEN) y lo inyecta como header en cada request de su
// ventana: así un navegador abierto en la misma PC (http://localhost:...)
// tampoco puede abrir la sesión admin. Sin Electron (node server.js, tests)
// no hay token y alcanza con loopback.
const crypto = require('crypto');

function esPcPrincipal(req) {
  if (!esLoopback(req)) return false;
  const esperado = process.env.DESKTOP_TOKEN;
  if (!esperado) return true;
  const recibido = String(req.headers['x-desktop-token'] || '');
  if (recibido.length !== esperado.length) return false;
  return crypto.timingSafeEqual(Buffer.from(recibido), Buffer.from(esperado));
}

const MSG_ADMIN_SOLO_PC_PRINCIPAL =
  'La sesión de administrador solo puede abrirse desde la aplicación de la PC principal.';

// Corta cualquier request /api de una sesión admin que no venga de la PC principal.
function adminSoloPcPrincipal(req, res, next) {
  if (req.session?.usuario?.rol !== 'admin' || esPcPrincipal(req)) return next();
  req.session.destroy(() => {
    res.status(403).json({ error: MSG_ADMIN_SOLO_PC_PRINCIPAL, redirect: '/login.html' });
  });
}

module.exports = { soloLocal, esLoopback, esPcPrincipal, adminSoloPcPrincipal, MSG_ADMIN_SOLO_PC_PRINCIPAL };
