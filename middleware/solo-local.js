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

module.exports = { soloLocal, esLoopback };
