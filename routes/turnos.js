const express = require('express');
const db = require('../db/database');
const { requireAuth, requirePermission } = require('../middleware/auth');
const serialService = require('../server/services/serialService');

// Incluye etapa_actual en el turno
const SELECT_TURNO = `
  SELECT t.*,
         a.nombre AS atraccion_nombre, a.duracion_minutos, a.usa_etapas,
         ul.nombre AS llamado_por_nombre,
         uf.nombre AS finalizado_por_nombre,
         ea.nombre  AS etapa_actual_nombre,
         ea.orden   AS etapa_actual_orden,
         ea.duracion_minutos AS etapa_actual_duracion
  FROM turnos t
  JOIN atracciones a ON t.atraccion_id = a.id
  LEFT JOIN usuarios ul    ON t.llamado_por    = ul.id
  LEFT JOIN usuarios uf    ON t.finalizado_por = uf.id
  LEFT JOIN juego_etapas ea ON t.etapa_actual_id = ea.id
  WHERE t.id = ?
`;

function etapaSiguiente(juegoId, ordenActual) {
  return db.prepare(`
    SELECT * FROM juego_etapas
    WHERE juego_id = ? AND orden > ? AND activa = 1
    ORDER BY orden ASC LIMIT 1
  `).get(juegoId, ordenActual);
}

function conEtapaSig(turno) {
  if (!turno || !turno.etapa_actual_id) return turno;
  const sig = etapaSiguiente(turno.atraccion_id, turno.etapa_actual_orden);
  return { ...turno, etapa_siguiente_nombre: sig ? sig.nombre : null };
}

module.exports = (io) => {
  const router = express.Router();

  // ── Cola completa con tiempos estimados ─────────────────────────────────────
  router.get('/cola', requireAuth('admin','operador','recepcion'), (req, res) => {
    const atracciones = db.prepare(
      'SELECT * FROM atracciones WHERE activa = 1 ORDER BY nombre'
    ).all();
    const ahora = Date.now();

    const juegos = atracciones.map(a => {
      const jugando = db.prepare(`
        SELECT t.*, ul.nombre AS llamado_por_nombre,
               ea.nombre  AS etapa_actual_nombre,
               ea.orden   AS etapa_actual_orden
        FROM turnos t
        LEFT JOIN usuarios ul      ON t.llamado_por    = ul.id
        LEFT JOIN juego_etapas ea  ON t.etapa_actual_id = ea.id
        WHERE t.atraccion_id = ? AND t.estado = 'llamado'
        ORDER BY t.called_at ASC
      `).all(a.id).map(t => {
        const elapsed  = t.called_at ? Math.floor((ahora - new Date(t.called_at).getTime()) / 60000) : 0;
        const restante = Math.max(0, a.duracion_minutos - elapsed);
        const sig = t.etapa_actual_orden != null ? etapaSiguiente(a.id, t.etapa_actual_orden) : null;
        return {
          ...t,
          tiempo_transcurrido: elapsed,
          tiempo_restante: restante,
          etapa_siguiente_nombre: sig ? sig.nombre : null,
        };
      });

      const esperando = db.prepare(`
        SELECT t.*, ea.nombre AS etapa_actual_nombre
        FROM turnos t
        LEFT JOIN juego_etapas ea ON t.etapa_actual_id = ea.id
        WHERE t.atraccion_id = ? AND t.estado = 'esperando'
        ORDER BY t.orden_cola ASC, t.id ASC
      `).all(a.id);

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
      SELECT t.*, a.nombre AS atraccion_nombre, a.duracion_minutos, a.usa_etapas,
             ul.nombre AS llamado_por_nombre,
             uf.nombre AS finalizado_por_nombre,
             ea.nombre  AS etapa_actual_nombre,
             ea.orden   AS etapa_actual_orden
      FROM turnos t
      JOIN atracciones a ON t.atraccion_id = a.id
      LEFT JOIN usuarios ul    ON t.llamado_por    = ul.id
      LEFT JOIN usuarios uf    ON t.finalizado_por = uf.id
      LEFT JOIN juego_etapas ea ON t.etapa_actual_id = ea.id
      WHERE 1=1
    `;
    const params = [];
    if (atraccion_id) { q += ' AND t.atraccion_id = ?'; params.push(atraccion_id); }
    if (estado)       { q += ' AND t.estado = ?';       params.push(estado); }
    q += ' ORDER BY t.created_at ASC';
    const turnos = db.prepare(q).all(...params).map(t => {
      if (!t.etapa_actual_id) return t;
      const sig = etapaSiguiente(t.atraccion_id, t.etapa_actual_orden);
      return { ...t, etapa_siguiente_nombre: sig ? sig.nombre : null };
    });
    res.json(turnos);
  });

  // ── Historial de etapas de un turno ─────────────────────────────────────────
  router.get('/:id/historial-etapas', requireAuth('admin','operador','recepcion'), (req, res) => {
    const historial = db.prepare(`
      SELECT h.*, ui.nombre AS iniciada_por_nombre, uf.nombre AS finalizada_por_nombre
      FROM turno_etapas_historial h
      LEFT JOIN usuarios ui ON h.iniciada_por  = ui.id
      LEFT JOIN usuarios uf ON h.finalizada_por = uf.id
      WHERE h.turno_id = ?
      ORDER BY h.etapa_orden ASC
    `).all(req.params.id);
    res.json(historial);
  });

  // ── Registrar turno (recepcion) ─────────────────────────────────────────────
  router.post('/', requireAuth('admin','recepcion'), (req, res) => {
    const { atraccion_id, biper_numero, nombre_cliente, cantidad_miembros, viper_id } = req.body;
    if (!atraccion_id || !biper_numero) {
      return res.status(400).json({ error: 'atraccion_id y biper_numero son requeridos' });
    }

    if (viper_id) {
      const viper = db.prepare("SELECT id FROM vipers WHERE id = ? AND estado = 'ACTIVO'").get(viper_id);
      if (!viper) return res.status(400).json({ error: 'El VIPER seleccionado no está activo' });
    }

    const enUso = db
      .prepare("SELECT id FROM turnos WHERE biper_numero=? AND atraccion_id=? AND estado IN ('esperando','llamado')")
      .get(String(biper_numero), atraccion_id);
    if (enUso) return res.status(409).json({ error: `El biper ${biper_numero} ya está en uso en este juego` });

    const juego = db.prepare('SELECT * FROM atracciones WHERE id = ?').get(atraccion_id);

    let primeraEtapa = null;
    if (juego && juego.usa_etapas) {
      primeraEtapa = db.prepare(`
        SELECT * FROM juego_etapas
        WHERE juego_id = ? AND activa = 1
        ORDER BY orden ASC LIMIT 1
      `).get(atraccion_id);
    }

    const { maxOrden } = db.prepare(
      "SELECT COALESCE(MAX(orden_cola), 0) AS maxOrden FROM turnos WHERE atraccion_id = ? AND estado = 'esperando'"
    ).get(atraccion_id);
    const nuevoOrden = maxOrden + 1;

    const result = db.prepare(
      'INSERT INTO turnos (atraccion_id, biper_numero, nombre_cliente, cantidad_miembros, viper_id, etapa_actual_id, orden_cola) VALUES (?,?,?,?,?,?,?)'
    ).run(atraccion_id, String(biper_numero), nombre_cliente || null, cantidad_miembros || 1, viper_id || null, primeraEtapa?.id ?? null, nuevoOrden);

    const turnoId = Number(result.lastInsertRowid);

    if (primeraEtapa) {
      db.prepare(`
        INSERT INTO turno_etapas_historial (turno_id, etapa_id, etapa_nombre, etapa_orden)
        VALUES (?,?,?,?)
      `).run(turnoId, primeraEtapa.id, primeraEtapa.nombre, primeraEtapa.orden);
    }

    const turno = conEtapaSig(db.prepare(SELECT_TURNO).get(turnoId));
    io.emit('turno:nuevo', turno);
    res.status(201).json(turno);
  });

  // ── Llamar turno (activa biper) ──────────────────────────────────────────────
  router.put('/:id/llamar', requirePermission('permiso_llamar_turno'), (req, res) => {
    const { id } = req.params;
    const force = req.body?.force === true;

    const turnoActual = db.prepare(
      "SELECT * FROM turnos WHERE id=? AND estado='esperando'"
    ).get(Number(id));
    if (!turnoActual) {
      return res.status(400).json({ error: 'El turno no existe o ya fue llamado' });
    }

    const primero = db.prepare(`
      SELECT id FROM turnos
      WHERE atraccion_id = ? AND estado = 'esperando'
      ORDER BY orden_cola ASC, id ASC LIMIT 1
    `).get(turnoActual.atraccion_id);

    if (primero && primero.id !== turnoActual.id) {
      return res.status(400).json({
        error: 'Debe llamarse primero al grupo que llegó antes en la cola'
      });
    }

    // Validación de biper en otro juego (omitible con force=true)
    if (!force) {
      const conflictoViper = db.prepare(`
        SELECT t.id, t.nombre_cliente, t.biper_numero, t.called_at,
               a.nombre AS atraccion_nombre, a.duracion_minutos
        FROM turnos t
        JOIN atracciones a ON t.atraccion_id = a.id
        WHERE t.biper_numero = ?
          AND t.atraccion_id != ?
          AND t.estado = 'llamado'
      `).get(turnoActual.biper_numero, turnoActual.atraccion_id);

      if (conflictoViper) {
        const elapsed   = conflictoViper.called_at
          ? Math.floor((Date.now() - new Date(conflictoViper.called_at).getTime()) / 60000) : 0;
        const restante  = Math.max(0, conflictoViper.duracion_minutos - elapsed);
        return res.status(200).json({
          advertencia:    'biper_en_otro_juego',
          biper_numero:   turnoActual.biper_numero,
          juego_origen:   conflictoViper.atraccion_nombre,
          nombre_cliente: conflictoViper.nombre_cliente,
          tiempo_restante: restante,
        });
      }
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

    // Registrar inicio de etapa en historial si corresponde
    if (turnoActual.etapa_actual_id) {
      db.prepare(`
        UPDATE turno_etapas_historial
        SET iniciada_at = datetime('now','localtime'), iniciada_por = ?
        WHERE turno_id = ? AND etapa_id = ? AND iniciada_at IS NULL
      `).run(req.session.usuario.id, id, turnoActual.etapa_actual_id);
    }

    const turno = conEtapaSig(db.prepare(SELECT_TURNO).get(Number(id)));

    io.emit('turno:llamado', turno);
    io.emit('biper:activar', { numero: turno.biper_numero, turno });

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

  // ── Avanzar / finalizar etapa ────────────────────────────────────────────────
  router.put('/:id/finalizar', requirePermission('permiso_llamar_turno'), (req, res) => {
    const { id } = req.params;
    const turnoActual = db.prepare(`
      SELECT t.*, ea.orden AS etapa_actual_orden
      FROM turnos t
      LEFT JOIN juego_etapas ea ON t.etapa_actual_id = ea.id
      WHERE t.id = ?
    `).get(Number(id));

    if (!turnoActual) return res.status(404).json({ error: 'Turno no encontrado' });

    // Sin etapas → finalizar directamente (comportamiento original)
    if (!turnoActual.etapa_actual_id) {
      db.prepare(`
        UPDATE turnos
        SET estado='finalizado', finished_at=datetime('now','localtime'), finalizado_por=?
        WHERE id=?
      `).run(req.session.usuario.id, id);

      const turno = db.prepare(SELECT_TURNO).get(Number(id));
      io.emit('turno:finalizado', turno);
      _notificarRecepcion(io, req, turno);
      return res.json(turno);
    }

    // Con etapas → cerrar etapa actual en historial
    db.prepare(`
      UPDATE turno_etapas_historial
      SET finalizada_at = datetime('now','localtime'), finalizada_por = ?
      WHERE turno_id = ? AND etapa_id = ? AND finalizada_at IS NULL
    `).run(req.session.usuario.id, id, turnoActual.etapa_actual_id);

    const sig = etapaSiguiente(turnoActual.atraccion_id, turnoActual.etapa_actual_orden);

    if (sig) {
      // Avanzar a la siguiente etapa — el turno sigue en 'llamado'
      db.prepare(`UPDATE turnos SET etapa_actual_id = ? WHERE id = ?`).run(sig.id, id);

      db.prepare(`
        INSERT INTO turno_etapas_historial (turno_id, etapa_id, etapa_nombre, etapa_orden, iniciada_at, iniciada_por)
        VALUES (?,?,?,?,datetime('now','localtime'),?)
      `).run(id, sig.id, sig.nombre, sig.orden, req.session.usuario.id);

      const turno = conEtapaSig(db.prepare(SELECT_TURNO).get(Number(id)));
      io.emit('turno:etapa_avanzada', turno);
      return res.json(turno);
    }

    // Era la última etapa → finalizar el turno
    db.prepare(`
      UPDATE turnos
      SET estado='finalizado', finished_at=datetime('now','localtime'),
          finalizado_por=?, etapa_actual_id=NULL
      WHERE id=?
    `).run(req.session.usuario.id, id);

    const turno = db.prepare(SELECT_TURNO).get(Number(id));
    io.emit('turno:finalizado', turno);
    _notificarRecepcion(io, req, turno);
    res.json(turno);
  });

  // ── Mover turno en la cola (subir / bajar) ──────────────────────────────────
  router.put('/:id/mover', requireAuth('admin', 'recepcion'), (req, res) => {
    const { id } = req.params;
    const { direccion } = req.body; // 'subir' | 'bajar'

    if (!['subir', 'bajar'].includes(direccion)) {
      return res.status(400).json({ error: 'direccion debe ser "subir" o "bajar"' });
    }

    const turnoA = db.prepare(
      "SELECT id, atraccion_id, orden_cola FROM turnos WHERE id = ? AND estado = 'esperando'"
    ).get(Number(id));

    if (!turnoA) {
      return res.status(400).json({ error: 'El turno no existe o ya no está en espera' });
    }

    const op     = direccion === 'subir' ? '<' : '>';
    const order  = direccion === 'subir' ? 'DESC' : 'ASC';
    const turnoB = db.prepare(`
      SELECT id, orden_cola FROM turnos
      WHERE atraccion_id = ? AND estado = 'esperando' AND orden_cola ${op} ?
      ORDER BY orden_cola ${order} LIMIT 1
    `).get(turnoA.atraccion_id, turnoA.orden_cola);

    if (!turnoB) {
      return res.status(400).json({ error: 'No se puede mover en esa dirección' });
    }

    // Swap atómico de orden_cola
    db.prepare('UPDATE turnos SET orden_cola = ? WHERE id = ?').run(turnoB.orden_cola, turnoA.id);
    db.prepare('UPDATE turnos SET orden_cola = ? WHERE id = ?').run(turnoA.orden_cola, turnoB.id);

    io.emit('turno:reordenado', { atraccion_id: turnoA.atraccion_id });
    res.json({ ok: true });
  });

  // ── Cancelar turno ───────────────────────────────────────────────────────────
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

// ── Helper: notificación a recepción cuando finaliza un operador ──────────────
function _notificarRecepcion(io, req, turno) {
  if (req.session.usuario.rol !== 'operador') return;
  const siguiente = db.prepare(`
    SELECT t.*, a.nombre AS atraccion_nombre
    FROM turnos t
    JOIN atracciones a ON t.atraccion_id = a.id
    WHERE t.atraccion_id = ? AND t.estado = 'esperando'
    ORDER BY t.orden_cola ASC, t.id ASC LIMIT 1
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
