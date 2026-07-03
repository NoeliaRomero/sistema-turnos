const express = require('express');
const db = require('../db/database');
const { requireAuth, requirePermission } = require('../middleware/auth');
const serialService = require('../server/services/serialService');

const SELECT_TURNO = `
  SELECT t.*, a.nombre AS atraccion_nombre, a.duracion_minutos,
         ul.nombre AS llamado_por_nombre,
         uf.nombre AS finalizado_por_nombre
  FROM turnos t
  JOIN atracciones a ON t.atraccion_id = a.id
  LEFT JOIN usuarios ul ON t.llamado_por    = ul.id
  LEFT JOIN usuarios uf ON t.finalizado_por = uf.id
  WHERE t.id = ?
`;

module.exports = (io) => {
  const router = express.Router();

  // ── Cola completa con tiempos estimados ─────────────────────────────────────
  router.get('/cola', requireAuth('admin','operador','recepcion'), (req, res) => {
    const atracciones = db.prepare(
      'SELECT * FROM atracciones WHERE activa = 1 ORDER BY nombre'
    ).all();
    const ahora = Date.now();

    const juegos = atracciones.map(a => {
      // Grupos jugando ahora
      const jugando = db.prepare(`
        SELECT t.*, ul.nombre AS llamado_por_nombre
        FROM turnos t
        LEFT JOIN usuarios ul ON t.llamado_por = ul.id
        WHERE t.atraccion_id = ? AND t.estado = 'llamado'
        ORDER BY t.called_at ASC
      `).all(a.id).map(t => {
        const elapsed   = t.called_at ? Math.floor((ahora - new Date(t.called_at).getTime()) / 60000) : 0;
        const restante  = Math.max(0, a.duracion_minutos - elapsed);
        return { ...t, tiempo_transcurrido: elapsed, tiempo_restante: restante };
      });

      // Cola en espera
      const esperando = db.prepare(`
        SELECT t.*
        FROM turnos t
        WHERE t.atraccion_id = ? AND t.estado = 'esperando'
        ORDER BY t.created_at ASC
      `).all(a.id);

      // Calcular tiempo estimado acumulado
      let acumulado = jugando.reduce((s, t) => s + t.tiempo_restante, 0);
      const cola = esperando.map((t, i) => {
        const espera = Math.ceil(acumulado);
        acumulado += a.duracion_minutos;
        return { ...t, posicion: i + 1, tiempo_espera_estimado: espera };
      });

      return { ...a, jugando, cola };
    });

    res.json({ juegos });
  });

  // ── Próximo biper disponible ─────────────────────────────────────────────────
  router.get('/proximo-biper', requireAuth('admin','recepcion'), (req, res) => {
    const usados = db
      .prepare("SELECT biper_numero FROM turnos WHERE estado IN ('esperando','llamado')")
      .all().map(r => parseInt(r.biper_numero, 10)).filter(n => !isNaN(n));
    let sig = 1;
    while (usados.includes(sig)) sig++;
    res.json({ biper_numero: String(sig) });
  });

  // ── Listar turnos ────────────────────────────────────────────────────────────
  router.get('/', requireAuth('admin','operador','recepcion'), (req, res) => {
    const { atraccion_id, estado } = req.query;
    let q = `
      SELECT t.*, a.nombre AS atraccion_nombre, a.duracion_minutos,
             ul.nombre AS llamado_por_nombre,
             uf.nombre AS finalizado_por_nombre
      FROM turnos t
      JOIN atracciones a ON t.atraccion_id = a.id
      LEFT JOIN usuarios ul ON t.llamado_por    = ul.id
      LEFT JOIN usuarios uf ON t.finalizado_por = uf.id
      WHERE 1=1
    `;
    const params = [];
    if (atraccion_id) { q += ' AND t.atraccion_id = ?'; params.push(atraccion_id); }
    if (estado)       { q += ' AND t.estado = ?';       params.push(estado); }
    q += ' ORDER BY t.created_at ASC';
    res.json(db.prepare(q).all(...params));
  });

  // ── Registrar turno (recepcion) ─────────────────────────────────────────────
  router.post('/', requireAuth('admin','recepcion'), (req, res) => {
    const { atraccion_id, biper_numero, nombre_cliente, cantidad_miembros, viper_id } = req.body;
    if (!atraccion_id || !biper_numero) {
      return res.status(400).json({ error: 'atraccion_id y biper_numero son requeridos' });
    }

    // Si se asocia un VIPER, solamente puede usarse uno validado y ACTIVO
    if (viper_id) {
      const viper = db.prepare("SELECT id FROM vipers WHERE id = ? AND estado = 'ACTIVO'").get(viper_id);
      if (!viper) return res.status(400).json({ error: 'El VIPER seleccionado no está activo' });
    }

    const enUso = db
      .prepare("SELECT id FROM turnos WHERE biper_numero=? AND estado IN ('esperando','llamado')")
      .get(String(biper_numero));
    if (enUso) return res.status(409).json({ error: `El biper ${biper_numero} ya está en uso` });

    const result = db.prepare(
      'INSERT INTO turnos (atraccion_id, biper_numero, nombre_cliente, cantidad_miembros, viper_id) VALUES (?,?,?,?,?)'
    ).run(atraccion_id, String(biper_numero), nombre_cliente || null, cantidad_miembros || 1, viper_id || null);

    const turno = db.prepare(SELECT_TURNO).get(Number(result.lastInsertRowid));
    io.emit('turno:nuevo', turno);
    res.status(201).json(turno);
  });

  // ── Llamar turno (activa biper) ──────────────────────────────────────────────
  router.put('/:id/llamar', requirePermission('permiso_llamar_turno'), (req, res) => {
    const { id } = req.params;
    const force = req.body?.force === true;

    // Verificar que el turno existe y está esperando
    const turnoActual = db.prepare(
      "SELECT * FROM turnos WHERE id=? AND estado='esperando'"
    ).get(Number(id));
    if (!turnoActual) {
      return res.status(400).json({ error: 'El turno no existe o ya fue llamado' });
    }

    // Verificar que es el primero en la cola de su juego
    const primero = db.prepare(`
      SELECT id FROM turnos
      WHERE atraccion_id = ? AND estado = 'esperando'
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `).get(turnoActual.atraccion_id);

    if (primero && primero.id !== turnoActual.id) {
      return res.status(400).json({
        error: 'Debe llamarse primero al grupo que llegó antes en la cola'
      });
    }

    // Validación de capacidad (omitible con force=true)
    if (!force) {
      const atraccion = db.prepare('SELECT max_miembros FROM atracciones WHERE id = ?').get(turnoActual.atraccion_id);
      const { personasJugando } = db.prepare(`
        SELECT COALESCE(SUM(cantidad_miembros), 0) AS personasJugando
        FROM turnos WHERE atraccion_id = ? AND estado = 'llamado'
      `).get(turnoActual.atraccion_id);
      const personasGrupo   = turnoActual.cantidad_miembros || 1;
      const totalPersonas   = personasJugando + personasGrupo;
      const maximoPermitido = atraccion?.max_miembros || 20;

      if (totalPersonas > maximoPermitido) {
        return res.status(200).json({
          advertencia: 'capacidad_excedida',
          personasJugando,
          personasGrupo,
          totalPersonas,
          maximoPermitido,
        });
      }
    }

    db.prepare(`
      UPDATE turnos
      SET estado='llamado', called_at=datetime('now','localtime'), llamado_por=?
      WHERE id=?
    `).run(req.session.usuario.id, id);

    const turno = db.prepare(SELECT_TURNO).get(Number(id));

    // Emitir evento para activar biper físico (UI / pantallas)
    io.emit('turno:llamado', turno);
    io.emit('biper:activar', { numero: turno.biper_numero, turno });

    // Si el turno tiene un VIPER asociado, transmitir su código RAW por
    // serial al Arduino. El número del VIPER nunca se envía al dispositivo.
    if (turno.viper_id) {
      const viper = db.prepare("SELECT codigo_raw FROM vipers WHERE id = ? AND estado = 'ACTIVO'").get(turno.viper_id);
      if (viper?.codigo_raw) {
        serialService.enviarRaw(viper.codigo_raw, io).catch(err => {
          console.error('[SERIAL] Error al transmitir RAW del turno', id, err.message);
        });
      }
    }

    res.json(turno);
  });

  // ── Finalizar turno ──────────────────────────────────────────────────────────
  router.put('/:id/finalizar', requirePermission('permiso_llamar_turno'), (req, res) => {
    const { id } = req.params;
    db.prepare(`
      UPDATE turnos
      SET estado='finalizado', finished_at=datetime('now','localtime'), finalizado_por=?
      WHERE id=?
    `).run(req.session.usuario.id, id);
    const turno = db.prepare(SELECT_TURNO).get(Number(id));
    io.emit('turno:finalizado', turno);

    // Solo notificar a recepción si quien finalizó es un operador
    // (si lo finalizó la propia recepcionista, ella ya lo sabe)
    if (req.session.usuario.rol === 'operador') {
      const siguiente = db.prepare(`
        SELECT t.*, a.nombre AS atraccion_nombre
        FROM turnos t
        JOIN atracciones a ON t.atraccion_id = a.id
        WHERE t.atraccion_id = ? AND t.estado = 'esperando'
        ORDER BY t.created_at ASC
        LIMIT 1
      `).get(turno.atraccion_id);

      io.emit('recepcion:notificacion', {
        operador:          req.session.usuario.nombre,
        familiaFinalizada: turno.nombre_cliente || `Biper ${turno.biper_numero}`,
        biper_finalizado:  turno.biper_numero,
        atraccion:         turno.atraccion_nombre,
        siguiente: siguiente ? {
          id:               siguiente.id,
          nombre_cliente:   siguiente.nombre_cliente || `Biper ${siguiente.biper_numero}`,
          biper_numero:     siguiente.biper_numero,
          cantidad_miembros: siguiente.cantidad_miembros,
        } : null,
      });
    }

    res.json(turno);
  });

  // ── Cancelar biper ───────────────────────────────────────────────────────────
  router.put('/:id/cancelar', requirePermission('permiso_cancelar_turno'), (req, res) => {
    const { id } = req.params;
    db.prepare(`
      UPDATE turnos
      SET estado='cancelado', finished_at=datetime('now','localtime'), finalizado_por=?
      WHERE id=? AND estado IN ('esperando','llamado')
    `).run(req.session.usuario.id, id);
    const turno = db.prepare(SELECT_TURNO).get(Number(id));
    io.emit('turno:finalizado', turno);
    res.json(turno);
  });

  return router;
};
