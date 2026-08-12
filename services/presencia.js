// ── Registro de presencia "en vivo" ───────────────────────────────────────────
// Mantiene, en memoria, qué usuarios tienen al menos un socket conectado.
// Soporta múltiples sockets por usuario (multi-pestaña/multi-sesión) mediante
// conteo por referencia: solo se emite 'presencia:cambio' cuando el conjunto
// de sockets de un usuario pasa de vacío a no-vacío (0→1) o viceversa (1→0).
//
// El registro es puramente en memoria: se reinicia (todos offline) en cada
// reinicio del proceso, y los clientes se re-registran al reconectar su socket.

/** @type {Map<number, Set<string>>} usuarioId -> Set<socketId> */
const conexiones = new Map();

/** @type {Map<string, number>} socketId -> usuarioId (para desregistrar por socket) */
const socketAUsuario = new Map();

let _io = null;

function init(io) {
  _io = io;
}

function _emitirCambio(usuarioId, enVivo) {
  if (_io) {
    _io.to('admins').emit('presencia:cambio', { usuarioId, enVivo });
  }
}

function registrar(socket, usuarioId) {
  let set = conexiones.get(usuarioId);
  const eraOffline = !set || set.size === 0;
  if (!set) {
    set = new Set();
    conexiones.set(usuarioId, set);
  }
  set.add(socket.id);
  socketAUsuario.set(socket.id, usuarioId);

  if (eraOffline) {
    _emitirCambio(usuarioId, true);
  }
}

function desregistrar(socket) {
  const usuarioId = socketAUsuario.get(socket.id);
  if (usuarioId == null) return;
  socketAUsuario.delete(socket.id);

  const set = conexiones.get(usuarioId);
  if (!set) return;
  set.delete(socket.id);

  if (set.size === 0) {
    conexiones.delete(usuarioId);
    _emitirCambio(usuarioId, false);
  }
}

function forzarOffline(usuarioId) {
  const teniaConexiones = conexiones.has(usuarioId);
  const set = conexiones.get(usuarioId);
  if (set) {
    for (const socketId of set) {
      socketAUsuario.delete(socketId);
    }
  }
  conexiones.delete(usuarioId);

  if (teniaConexiones) {
    _emitirCambio(usuarioId, false);
  }

  // Desconecta cualquier socket que le quede a ese usuario (fuerza logout
  // inmediato en todas sus pestañas/sesiones); el 'disconnect' natural que
  // siga a esto encontrará el registro ya vacío y no emitirá nada más.
  if (_io) {
    _io.in(`usuario:${usuarioId}`).disconnectSockets(true);
  }
}

function estaEnVivo(usuarioId) {
  const set = conexiones.get(usuarioId);
  return !!set && set.size > 0;
}

function idsEnVivo() {
  return [...conexiones.keys()];
}

module.exports = {
  init,
  registrar,
  desregistrar,
  forzarOffline,
  estaEnVivo,
  idsEnVivo,
};
