'use strict';

const express = require('express');
const db      = require('../db/database');
const bcrypt  = require('bcryptjs');
const { seedDemoData } = require('../db/demo-seed');
const { requireAuth }  = require('../middleware/auth');

module.exports = (io) => {
  const router = express.Router();

  // ── Estado demo (público) ─────────────────────────────────────────────────
  router.get('/status', (req, res) => {
    res.json({ demo: true, version: '1.0' });
  });

  // ── Reset completo ────────────────────────────────────────────────────────
  router.post('/reset', requireAuth('admin', 'superadmin'), (req, res) => {
    try {
      seedDemoData();
      // Notificar a todos los clientes conectados
      io.emit('demo:reset');
      res.json({ ok: true, mensaje: 'Demo restaurada exitosamente' });
    } catch (err) {
      console.error('[DEMO] Error en reset:', err);
      res.status(500).json({ error: 'Error al restaurar la demo: ' + err.message });
    }
  });

  // ── Vaciar colas (solo esperando) ─────────────────────────────────────────
  router.post('/vaciar-colas', requireAuth('admin', 'superadmin'), (req, res) => {
    db.exec("DELETE FROM turno_etapas_historial WHERE turno_id IN (SELECT id FROM turnos WHERE estado = 'esperando')");
    db.exec("DELETE FROM turnos WHERE estado = 'esperando'");
    io.emit('turno:finalizado', { _demo: true });
    res.json({ ok: true });
  });

  // ── Agregar turnos aleatorios ─────────────────────────────────────────────
  router.post('/nuevos-turnos', requireAuth('admin', 'superadmin'), (req, res) => {
    const juegos = db.prepare("SELECT * FROM atracciones WHERE activa = 1").all();
    if (!juegos.length) return res.json({ ok: true, agregados: 0 });

    const familias = [
      'Familia Aguilar', 'Los Jiménez', 'Grupo Empresarial', 'Los Paredes',
      'Familia Montes', 'Los Delgado', 'Equipo Estrella', 'Los Fuentes',
      'Familia Reyes', 'Team Omega', 'Los Castillo', 'Grupo Aurora',
      'Los Pedroza', 'Familia Navarro', 'Team Galaxy', 'Los Ibáñez',
    ];

    let agregados = 0;

    juegos.forEach(j => {
      const cantidad = 2 + Math.floor(Math.random() * 2); // 2–3 por juego
      for (let k = 0; k < cantidad; k++) {
        // Biper libre para este juego
        const usados = db.prepare(
          "SELECT biper_numero FROM turnos WHERE atraccion_id = ? AND estado IN ('esperando','llamado')"
        ).all(j.id).map(r => parseInt(r.biper_numero));

        let biper = 1;
        while (usados.includes(biper)) biper++;

        const nombre = familias[Math.floor(Math.random() * familias.length)];
        const cant   = j.min_miembros + Math.floor(Math.random() * Math.max(1, j.max_miembros - j.min_miembros));

        const { maxOrden } = db.prepare(
          "SELECT COALESCE(MAX(orden_cola), 0) AS maxOrden FROM turnos WHERE atraccion_id = ? AND estado = 'esperando'"
        ).get(j.id);

        // Primera etapa si el juego usa etapas
        let primeraEtapa = null;
        if (j.usa_etapas) {
          primeraEtapa = db.prepare(
            "SELECT id FROM juego_etapas WHERE juego_id = ? AND activa = 1 ORDER BY orden ASC LIMIT 1"
          ).get(j.id);
        }

        const r = db.prepare(`
          INSERT INTO turnos
            (atraccion_id, biper_numero, nombre_cliente, cantidad_miembros,
             estado, etapa_actual_id, orden_cola)
          VALUES (?,?,?,?,'esperando',?,?)
        `).run(j.id, String(biper), nombre, cant, primeraEtapa?.id ?? null, maxOrden + 1);

        if (primeraEtapa) {
          db.prepare(`
            INSERT INTO turno_etapas_historial (turno_id, etapa_id, etapa_nombre, etapa_orden)
            SELECT ?, id, nombre, orden FROM juego_etapas WHERE id = ?
          `).run(Number(r.lastInsertRowid), primeraEtapa.id);
        }

        agregados++;
      }
    });

    io.emit('turno:nuevo', { _demo: true });
    res.json({ ok: true, agregados });
  });

  // ── Simular parque lleno ──────────────────────────────────────────────────
  router.post('/simular/lleno', requireAuth('admin', 'superadmin'), (req, res) => {
    // Vaciar esperando y agregar mucha gente
    db.exec("DELETE FROM turno_etapas_historial WHERE turno_id IN (SELECT id FROM turnos WHERE estado = 'esperando')");
    db.exec("DELETE FROM turnos WHERE estado = 'esperando'");

    const juegos = db.prepare("SELECT * FROM atracciones WHERE activa = 1").all();
    const familias = [
      'Familia Torres', 'Los Vargas', 'Team Pro', 'Los Aguirre', 'Familia Silva',
      'Los Romero', 'Grupo Elite', 'Los Cabrera', 'Team Alpha', 'Los Soto',
      'Familia Luna', 'Los Pinto', 'Equipo Tigre', 'Los Ríos', 'Familia Blanco',
      'Los Ortega', 'Team Rocket', 'Los Ibarra', 'Familia Cruz', 'Los Vera',
      'Grupo Neon', 'Los Moya', 'Team Xtreme', 'Los Cano', 'Familia Tapia',
    ];

    let fi = 0;
    juegos.forEach(j => {
      const enCola = 4 + Math.floor(Math.random() * 4); // 4–7 por juego
      let primeraEtapa = null;
      if (j.usa_etapas) {
        primeraEtapa = db.prepare(
          "SELECT id FROM juego_etapas WHERE juego_id = ? AND activa = 1 ORDER BY orden ASC LIMIT 1"
        ).get(j.id);
      }

      const usados = db.prepare(
        "SELECT biper_numero FROM turnos WHERE atraccion_id = ? AND estado IN ('esperando','llamado')"
      ).all(j.id).map(r => parseInt(r.biper_numero));

      let biperStart = 1;
      for (let k = 0; k < enCola; k++) {
        while (usados.includes(biperStart)) biperStart++;
        usados.push(biperStart);

        const nombre = familias[(fi++) % familias.length];
        const cant   = j.min_miembros + Math.floor(Math.random() * Math.max(1, j.max_miembros - j.min_miembros));

        const r = db.prepare(`
          INSERT INTO turnos
            (atraccion_id, biper_numero, nombre_cliente, cantidad_miembros,
             estado, etapa_actual_id, orden_cola)
          VALUES (?,?,?,?,'esperando',?,?)
        `).run(j.id, String(biperStart), nombre, cant, primeraEtapa?.id ?? null, k + 1);

        if (primeraEtapa) {
          db.prepare(`
            INSERT INTO turno_etapas_historial (turno_id, etapa_id, etapa_nombre, etapa_orden)
            SELECT ?, id, nombre, orden FROM juego_etapas WHERE id = ?
          `).run(Number(r.lastInsertRowid), primeraEtapa.id);
        }

        biperStart++;
      }
    });

    io.emit('turno:nuevo', { _demo: true });
    res.json({ ok: true });
  });

  // ── Simular parque tranquilo ──────────────────────────────────────────────
  router.post('/simular/tranquilo', requireAuth('admin', 'superadmin'), (req, res) => {
    db.exec("DELETE FROM turno_etapas_historial WHERE turno_id IN (SELECT id FROM turnos WHERE estado = 'esperando')");
    db.exec("DELETE FROM turnos WHERE estado = 'esperando'");

    const juegos = db.prepare("SELECT * FROM atracciones WHERE activa = 1").all();
    const familias = ['Familia Benítez', 'Los Herrera', 'Pareja Rojas', 'Los Medina'];

    juegos.forEach((j, idx) => {
      if (idx % 2 !== 0) return; // Solo algunos juegos tienen cola

      let primeraEtapa = null;
      if (j.usa_etapas) {
        primeraEtapa = db.prepare(
          "SELECT id FROM juego_etapas WHERE juego_id = ? AND activa = 1 ORDER BY orden ASC LIMIT 1"
        ).get(j.id);
      }

      const usados = db.prepare(
        "SELECT biper_numero FROM turnos WHERE atraccion_id = ? AND estado IN ('esperando','llamado')"
      ).all(j.id).map(r => parseInt(r.biper_numero));

      let biper = 1;
      while (usados.includes(biper)) biper++;

      const r = db.prepare(`
        INSERT INTO turnos
          (atraccion_id, biper_numero, nombre_cliente, cantidad_miembros,
           estado, etapa_actual_id, orden_cola)
        VALUES (?,?,?,?,'esperando',?,1)
      `).run(j.id, String(biper), familias[idx % familias.length], j.min_miembros, primeraEtapa?.id ?? null);

      if (primeraEtapa) {
        db.prepare(`
          INSERT INTO turno_etapas_historial (turno_id, etapa_id, etapa_nombre, etapa_orden)
          SELECT ?, id, nombre, orden FROM juego_etapas WHERE id = ?
        `).run(Number(r.lastInsertRowid), primeraEtapa.id);
      }
    });

    io.emit('turno:nuevo', { _demo: true });
    res.json({ ok: true });
  });

  return router;
};
