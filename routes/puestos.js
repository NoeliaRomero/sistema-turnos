'use strict';
const express = require('express');
const cron    = require('node-cron');
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const puestos = require('../services/puestos');

// Etapas activas del juego, o [] si el juego no usa etapas.
function etapasDelJuego(atraccion) {
  if (!atraccion.usa_etapas) return [];
  return db.prepare(`
    SELECT id, nombre, orden FROM juego_etapas
    WHERE juego_id = ? AND activa = 1 ORDER BY orden
  `).all(atraccion.id);
}

module.exports = (io) => {
  const router = express.Router();

  function avisarPuestoCerrado(usuarioId, motivo, extra = {}) {
    io.to(`usuario:${usuarioId}`).emit('puesto:cerrado', { motivo, ...extra });
  }

  // Al arrancar el servidor no queda ninguna sesión viva (las sesiones viven
  // en memoria): ningún puesto puede seguir abierto.
  puestos.cerrarPuestosAnterioresA("datetime('now','localtime')");

  // Cada día se empieza de cero: los puestos del día anterior se cierran y el
  // operador vuelve a elegir su etapa.
  cron.schedule('1 0 * * *', () => {
    puestos.cerrarPuestosAnterioresA("date('now','localtime')")
      .forEach(id => avisarPuestoCerrado(id, 'nuevo_dia'));
  });

  router.use(requireAuth('operador'));

  // Estado del puesto del operador y opciones para elegir.
  router.get('/mio', (req, res) => {
    const usuario = req.session.usuario;
    if (!usuario.atraccion_id) return res.json({ atraccion: null, etapas: [], mias: [], asignado: false });

    const atraccion = db.prepare('SELECT id, nombre, usa_etapas FROM atracciones WHERE id = ?')
      .get(usuario.atraccion_id);
    if (!atraccion) return res.json({ atraccion: null, etapas: [], mias: [], asignado: false });

    const etapas       = etapasDelJuego(atraccion);
    const responsables = puestos.responsablesDeEtapas(atraccion.id);
    const mios         = puestos.puestosDeUsuario(usuario.id)
      .filter(p => p.atraccion_id === atraccion.id);

    res.json({
      atraccion: { id: atraccion.id, nombre: atraccion.nombre },
      etapas: etapas.map(e => {
        const r = responsables.get(e.id);
        return { id: e.id, nombre: e.nombre, responsable: r && r.id !== usuario.id ? r : null };
      }),
      mias:     mios.filter(p => p.etapa_id != null).map(p => p.etapa_id),
      asignado: mios.length > 0,
    });
  });

  // Elegir las etapas a cargo. Una etapa que ya tiene encargado no se puede
  // tomar: se libera cuando ese operador cierra sesión o cambia de etapa.
  router.post('/', (req, res) => {
    const usuario = req.session.usuario;
    if (!usuario.atraccion_id) return res.status(400).json({ error: 'No tenés un juego asignado' });

    const atraccion = db.prepare('SELECT id, nombre, usa_etapas FROM atracciones WHERE id = ?')
      .get(usuario.atraccion_id);
    if (!atraccion) return res.status(400).json({ error: 'El juego asignado no existe' });

    const etapas = etapasDelJuego(atraccion);
    let elegidas = [];
    if (etapas.length) {
      const pedidas = Array.isArray(req.body?.etapas) ? req.body.etapas.map(Number) : [];
      const validas = new Set(etapas.map(e => e.id));
      elegidas = [...new Set(pedidas)].filter(id => validas.has(id));
      if (!elegidas.length) return res.status(400).json({ error: 'Elegí al menos una etapa' });
    }

    const { conflictos } = puestos.asignarPuesto(usuario.id, atraccion.id, elegidas);
    if (conflictos.length) {
      return res.status(409).json({
        error: conflictos.map(c =>
          `${etapas.find(e => e.id === c.etapa_id).nombre} ya está a cargo de ${c.responsable}`
        ).join('. '),
      });
    }

    res.json({ ok: true, etapas: etapas.filter(e => elegidas.includes(e.id)).map(e => e.nombre) });
  });

  return router;
};
