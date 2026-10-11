'use strict';
// ── Puestos de operador ───────────────────────────────────────────────────────
// Qué etapa tiene a cargo cada operador (tabla operador_puestos). Cada etapa
// tiene un solo encargado a la vez: nadie puede tomar una etapa ocupada. En
// juegos sin etapas el puesto es el juego entero y puede compartirse (la
// demora se reparte entre quienes lo tenían). El historial (desde/hasta) es lo que usan las estadísticas para
// cargar la demora a quien era responsable en ese momento.
const db = require('../db/database');

// Cierra los puestos abiertos de un usuario (logout, cambio de puesto).
function cerrarPuestosDeUsuario(usuarioId) {
  return db.prepare(`
    UPDATE operador_puestos SET hasta = datetime('now','localtime')
    WHERE usuario_id = ? AND hasta IS NULL
  `).run(usuarioId).changes;
}

// Puestos abiertos de un usuario: [{ atraccion_id, etapa_id }]
function puestosDeUsuario(usuarioId) {
  return db.prepare(`
    SELECT atraccion_id, etapa_id FROM operador_puestos
    WHERE usuario_id = ? AND hasta IS NULL
  `).all(usuarioId);
}

// Responsable actual de cada etapa del juego: Map(etapa_id → { id, nombre })
function responsablesDeEtapas(atraccionId) {
  const filas = db.prepare(`
    SELECT p.etapa_id, u.id, u.nombre
    FROM operador_puestos p JOIN usuarios u ON u.id = p.usuario_id
    WHERE p.atraccion_id = ? AND p.etapa_id IS NOT NULL AND p.hasta IS NULL
  `).all(atraccionId);
  return new Map(filas.map(f => [f.etapa_id, { id: f.id, nombre: f.nombre }]));
}

// Asigna al usuario las etapas elegidas (reemplaza las que tenía). Cada etapa
// tiene un solo encargado: si alguna ya la tiene otro operador no se asigna
// nada y se devuelven los conflictos [{ etapa_id, responsable }]. El chequeo
// va dentro de la transacción para que dos operadores no tomen la misma etapa
// a la vez.
function asignarPuesto(usuarioId, atraccionId, etapaIds) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const ocupadas = responsablesDeEtapas(atraccionId);
    const conflictos = etapaIds
      .filter(id => ocupadas.has(id) && ocupadas.get(id).id !== usuarioId)
      .map(id => ({ etapa_id: id, responsable: ocupadas.get(id).nombre }));
    if (conflictos.length) {
      db.exec('ROLLBACK');
      return { conflictos };
    }

    cerrarPuestosDeUsuario(usuarioId);
    const insertar = db.prepare(
      'INSERT INTO operador_puestos (usuario_id, atraccion_id, etapa_id) VALUES (?, ?, ?)'
    );
    if (!etapaIds.length) insertar.run(usuarioId, atraccionId, null);
    etapaIds.forEach(etapaId => insertar.run(usuarioId, atraccionId, etapaId));
    db.exec('COMMIT');
    return { conflictos: [] };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Cierra los puestos abiertos antes de una fecha límite (SQL datetime).
// Devuelve los usuarios afectados.
function cerrarPuestosAnterioresA(limiteSql) {
  const usuarios = db.prepare(`
    SELECT DISTINCT usuario_id FROM operador_puestos
    WHERE hasta IS NULL AND desde < ${limiteSql}
  `).all().map(r => r.usuario_id);
  db.prepare(`
    UPDATE operador_puestos SET hasta = datetime('now','localtime')
    WHERE hasta IS NULL AND desde < ${limiteSql}
  `).run();
  return usuarios;
}

module.exports = {
  cerrarPuestosDeUsuario,
  puestosDeUsuario,
  responsablesDeEtapas,
  asignarPuesto,
  cerrarPuestosAnterioresA,
};
