const express = require('express');
const db = require('../db/database');
const { requireAuth, requirePermission } = require('../middleware/auth');

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

function contarEtapasActivas(juegoId) {
  return db.prepare(
    'SELECT COUNT(*) AS c FROM juego_etapas WHERE juego_id = ? AND activa = 1'
  ).get(juegoId).c;
}

function conEtapaSig(turno) {
  if (!turno || !turno.etapa_actual_id) return turno;
  const sig = etapaSiguiente(turno.atraccion_id, turno.etapa_actual_orden);
  return { ...turno, etapa_siguiente_nombre: sig ? sig.nombre : null };
}

module.exports = (io) => {
  const router = express.Router();

  // Timers de transición llamado → jugando (Bug 4)
  const timerLlamado = new Map();

  // ── Auto-llamado interno (Bugs 3, 6, 13) ──────────────────────────────────────
  function autoLlamarSiguiente(atraccionId) {
    const activo = db.prepare(
      "SELECT id FROM turnos WHERE atraccion_id=? AND estado IN ('llamado','jugando')"
    ).get(atraccionId);
    if (activo) return;

    const primero = db.prepare(
      "SELECT * FROM turnos WHERE atraccion_id=? AND estado='esperando' ORDER BY created_at ASC, id ASC LIMIT 1"
    ).get(atraccionId);
    if (!primero) return;

    _ejecutarLlamado(primero);
  }

  function _ejecutarLlamado(turnoRow) {
    db.prepare(
      "UPDATE turnos SET estado='llamado', called_at=datetime('now','localtime') WHERE id=?"
    ).run(turnoRow.id);

    if (turnoRow.etapa_actual_id) {
      db.prepare(`
        UPDATE turno_etapas_historial
        SET iniciada_at=datetime('now','localtime')
        WHERE turno_id=? AND etapa_id=? AND iniciada_at IS NULL
      `).run(turnoRow.id, turnoRow.etapa_actual_id);
    }

    const turno = conEtapaSig(db.prepare(SELECT_TURNO).get(turnoRow.id));
    io.emit('turno:llamado', turno);
    io.emit('biper:activar', { numero: turno.biper_numero, turno });

    _iniciarTimerJugando(turno.id);
  }

  // Timer 5 min: llamado → jugando (Bug 4)
  function _iniciarTimerJugando(turnoId) {
    if (timerLlamado.has(turnoId)) clearTimeout(timerLlamado.get(turnoId));

    const handle = setTimeout(() => {
      timerLlamado.delete(turnoId);
      const rows = db.prepare(
        "SELECT id FROM turnos WHERE id=? AND estado='llamado'"
      ).get(turnoId);
      if (!rows) return;

      db.prepare(
        "UPDATE turnos SET estado='jugando', jugando_desde=datetime('now','localtime') WHERE id=? AND estado='llamado'"
      ).run(turnoId);

      const turno = conEtapaSig(db.prepare(SELECT_TURNO).get(turnoId));
      if (turno) io.emit('turno:jugando', turno);
    }, 5 * 60 * 1000);

    timerLlamado.set(turnoId, handle);
  }

  // Restaurar timers al reiniciar el servidor
  {
    const llamados = db.prepare(
      "SELECT id, called_at FROM turnos WHERE estado='llamado'"
    ).all();
    llamados.forEach(t => {
      const elapsed    = t.called_at ? (Date.now() - new Date(t.called_at).getTime()) : 0;
      const remaining  = Math.max(1000, 5 * 60 * 1000 - elapsed);
      const handle = setTimeout(() => {
        timerLlamado.delete(t.id);
        db.prepare(
          "UPDATE turnos SET estado='jugando', jugando_desde=datetime('now','localtime') WHERE id=? AND estado='llamado'"
        ).run(t.id);
        const turno = conEtapaSig(db.prepare(SELECT_TURNO).get(t.id));
        if (turno) io.emit('turno:jugando', turno);
      }, remaining);
      timerLlamado.set(t.id, handle);
    });
  }

  // ── Cola completa ─────────────────────────────────────────────────────────────
  router.get('/cola', requireAuth('admin','operador','recepcion'), (req, res) => {
    const usuario = req.session.usuario;
    const ahora   = Date.now();

    // Bug 5: Operadores solo ven su propio juego
    const whereAtraccion = usuario.rol === 'operador' && usuario.atraccion_id
      ? 'WHERE activa = 1 AND id = ?' : 'WHERE activa = 1 ORDER BY nombre';
    const atraccionParams = usuario.rol === 'operador' && usuario.atraccion_id
      ? [usuario.atraccion_id] : [];
    const atracciones = db.prepare(
      `SELECT * FROM atracciones ${whereAtraccion}`
    ).all(...atraccionParams);

    const juegos = atracciones.map(a => {
      const activos = db.prepare(`
        SELECT t.*, ul.nombre AS llamado_por_nombre,
               ea.nombre  AS etapa_actual_nombre,
               ea.orden   AS etapa_actual_orden
        FROM turnos t
        LEFT JOIN usuarios ul     ON t.llamado_por    = ul.id
        LEFT JOIN juego_etapas ea ON t.etapa_actual_id = ea.id
        WHERE t.atraccion_id = ? AND t.estado IN ('llamado','jugando')
        ORDER BY t.called_at ASC
      `).all(a.id).map(t => {
        const baseTime  = t.jugando_desde || t.called_at;
        const elapsed   = baseTime ? Math.floor((ahora - new Date(baseTime).getTime()) / 60000) : 0;
        const restante  = Math.max(0, a.duracion_minutos - elapsed);
        const sig       = t.etapa_actual_orden != null ? etapaSiguiente(a.id, t.etapa_actual_orden) : null;
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
        ORDER BY t.created_at ASC
      `).all(a.id);

      let acumulado = activos.reduce((s, t) => s + t.tiempo_restante, 0);
      const cola = esperando.map((t, i) => {
        const espera = Math.ceil(acumulado);
        acumulado += a.duracion_minutos;
        return { ...t, posicion: i + 1, tiempo_espera_estimado: espera };
      });

      return { ...a, jugando: activos, cola };
    });

    res.json({ juegos });
  });

  // ── Cola pública (sin auth) — para pantalla TV ───────────────────────────────
  router.get('/cola-publica', (req, res) => {
    const ahora      = Date.now();
    const atracciones = db.prepare('SELECT * FROM atracciones WHERE activa = 1 ORDER BY nombre').all();

    const juegos = atracciones.map(a => {
      const activos = db.prepare(`
        SELECT t.biper_numero, t.nombre_cliente, t.cantidad_miembros, t.estado,
               t.called_at, t.jugando_desde,
               ea.nombre AS etapa_actual_nombre
        FROM turnos t
        LEFT JOIN juego_etapas ea ON t.etapa_actual_id = ea.id
        WHERE t.atraccion_id = ? AND t.estado IN ('llamado','jugando')
        ORDER BY t.called_at ASC
      `).all(a.id).map(t => {
        const baseTime = t.jugando_desde || t.called_at;
        const elapsed  = baseTime ? Math.floor((ahora - new Date(baseTime).getTime()) / 60000) : 0;
        const restante = Math.max(0, a.duracion_minutos - elapsed);
        return { ...t, tiempo_transcurrido: elapsed, tiempo_restante: restante };
      });

      const esperando = db.prepare(`
        SELECT t.biper_numero, t.nombre_cliente, t.cantidad_miembros, t.created_at
        FROM turnos t
        WHERE t.atraccion_id = ? AND t.estado = 'esperando'
        ORDER BY t.created_at ASC
      `).all(a.id);

      let acumulado = activos.reduce((s, t) => s + t.tiempo_restante, 0);
      const cola = esperando.map((t, i) => {
        const espera = Math.ceil(acumulado);
        acumulado += a.duracion_minutos;
        return { ...t, posicion: i + 1, tiempo_espera_estimado: espera };
      });

      return { id: a.id, nombre: a.nombre, duracion_minutos: a.duracion_minutos, activos, cola };
    });

    res.json({ juegos });
  });

  // ── Próximo biper disponible ──────────────────────────────────────────────────
  router.get('/proximo-biper', requireAuth('admin','recepcion'), (req, res) => {
    const usados = db
      .prepare("SELECT biper_numero FROM turnos WHERE estado IN ('esperando','llamado','jugando')")
      .all().map(r => parseInt(r.biper_numero, 10)).filter(n => !isNaN(n));
    let sig = 1;
    while (usados.includes(sig)) sig++;
    res.json({ biper_numero: String(sig) });
  });

  // ── Listar turnos ─────────────────────────────────────────────────────────────
  router.get('/', requireAuth('admin','operador','recepcion'), (req, res) => {
    const { atraccion_id, estado } = req.query;
    const usuario = req.session.usuario;

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

    // Bug 5: operadores solo ven su propio juego
    if (usuario.rol === 'operador' && usuario.atraccion_id) {
      q += ' AND t.atraccion_id = ?';
      params.push(usuario.atraccion_id);
    } else if (atraccion_id) {
      q += ' AND t.atraccion_id = ?';
      params.push(atraccion_id);
    }

    if (estado) { q += ' AND t.estado = ?'; params.push(estado); }
    q += ' ORDER BY t.created_at ASC';

    const turnos = db.prepare(q).all(...params).map(t => {
      if (!t.etapa_actual_id) return t;
      const sig = etapaSiguiente(t.atraccion_id, t.etapa_actual_orden);
      return { ...t, etapa_siguiente_nombre: sig ? sig.nombre : null };
    });
    res.json(turnos);
  });

  // ── Historial de etapas ───────────────────────────────────────────────────────
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

  // ── Registrar turno (recepcion) ───────────────────────────────────────────────
  router.post('/', requireAuth('admin','recepcion'), (req, res) => {
    const { atraccion_id, biper_numero, nombre_cliente, cantidad_miembros } = req.body;
    if (!atraccion_id || !biper_numero) {
      return res.status(400).json({ error: 'atraccion_id y biper_numero son requeridos' });
    }
    const enUso = db
      .prepare("SELECT id FROM turnos WHERE biper_numero=? AND estado IN ('esperando','llamado','jugando')")
      .get(String(biper_numero));
    if (enUso) return res.status(409).json({ error: `El biper ${biper_numero} ya está en uso` });

    const juego = db.prepare('SELECT * FROM atracciones WHERE id = ?').get(atraccion_id);

    let primeraEtapa = null;
    if (juego && juego.usa_etapas) {
      primeraEtapa = db.prepare(`
        SELECT * FROM juego_etapas
        WHERE juego_id = ? AND activa = 1
        ORDER BY orden ASC LIMIT 1
      `).get(atraccion_id);
    }

    const result = db.prepare(
      'INSERT INTO turnos (atraccion_id, biper_numero, nombre_cliente, cantidad_miembros, etapa_actual_id, creado_por) VALUES (?,?,?,?,?,?)'
    ).run(atraccion_id, String(biper_numero), nombre_cliente || null, cantidad_miembros || 1, primeraEtapa?.id ?? null, req.session.usuario.id);

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

    // Bug 13: Llamado automático si no hay turno activo en ese juego
    setImmediate(() => autoLlamarSiguiente(atraccion_id));
  });

  // ── Llamar turno: solo el sistema (Bug 12) ────────────────────────────────────
  router.put('/:id/llamar', requireAuth('admin','operador','recepcion'), (req, res) => {
    return res.status(403).json({
      error: 'El sistema llama los turnos automáticamente en orden de llegada. No se permite llamado manual.'
    });
  });

  // ── Avanzar / finalizar etapa (solo sobre estado jugando) ─────────────────────
  router.put('/:id/finalizar', requirePermission('permiso_llamar_turno'), (req, res) => {
    const { id } = req.params;

    // Bug 5: Operador solo puede finalizar turnos de su juego
    const usuario = req.session.usuario;

    const turnoActual = db.prepare(`
      SELECT t.*, ea.orden AS etapa_actual_orden
      FROM turnos t
      LEFT JOIN juego_etapas ea ON t.etapa_actual_id = ea.id
      WHERE t.id = ? AND t.estado = 'jugando'
    `).get(Number(id));

    if (!turnoActual) return res.status(400).json({ error: 'El turno no existe o no está en estado Jugando' });

    if (usuario.rol === 'operador' && usuario.atraccion_id &&
        usuario.atraccion_id !== turnoActual.atraccion_id) {
      return res.status(403).json({ error: 'Solo podés finalizar turnos de tu juego asignado' });
    }

    if (!turnoActual.etapa_actual_id) {
      db.prepare(`
        UPDATE turnos
        SET estado='finalizado', finished_at=datetime('now','localtime'), finalizado_por=?
        WHERE id=?
      `).run(usuario.id, id);

      const turno = db.prepare(SELECT_TURNO).get(Number(id));
      io.emit('turno:finalizado', turno);
      _notificarRecepcion(io, usuario, turno);

      // Bug 13: auto-llamar siguiente
      setImmediate(() => autoLlamarSiguiente(turnoActual.atraccion_id));
      return res.json(turno);
    }

    db.prepare(`
      UPDATE turno_etapas_historial
      SET finalizada_at = datetime('now','localtime'), finalizada_por = ?
      WHERE turno_id = ? AND etapa_id = ? AND finalizada_at IS NULL
    `).run(usuario.id, id, turnoActual.etapa_actual_id);

    const sig = etapaSiguiente(turnoActual.atraccion_id, turnoActual.etapa_actual_orden);

    if (sig) {
      db.prepare(`UPDATE turnos SET etapa_actual_id = ? WHERE id = ?`).run(sig.id, id);

      db.prepare(`
        INSERT INTO turno_etapas_historial (turno_id, etapa_id, etapa_nombre, etapa_orden, iniciada_at, iniciada_por)
        VALUES (?,?,?,?,datetime('now','localtime'),?)
      `).run(id, sig.id, sig.nombre, sig.orden, usuario.id);

      const turno = conEtapaSig(db.prepare(SELECT_TURNO).get(Number(id)));
      io.emit('turno:etapa_avanzada', turno);
      return res.json(turno);
    }

    db.prepare(`
      UPDATE turnos
      SET estado='finalizado', finished_at=datetime('now','localtime'),
          finalizado_por=?, etapa_actual_id=NULL
      WHERE id=?
    `).run(usuario.id, id);

    const turno = db.prepare(SELECT_TURNO).get(Number(id));
    io.emit('turno:finalizado', turno);
    _notificarRecepcion(io, usuario, turno);

    // Bug 13: auto-llamar siguiente
    setImmediate(() => autoLlamarSiguiente(turnoActual.atraccion_id));
    res.json(turno);
  });

  // ── No Llegó ──────────────────────────────────────────────────────────────────
  // Solo válido en estado 'llamado' (ventana de 5 min), solo el operador asignado
  router.put('/:id/cancelar', requirePermission('permiso_cancelar_turno'), (req, res) => {
    const { id } = req.params;
    const usuario = req.session.usuario;

    const turnoActual = db.prepare(
      "SELECT * FROM turnos WHERE id=? AND estado='llamado'"
    ).get(Number(id));

    if (!turnoActual) {
      return res.status(400).json({
        error: 'Solo se puede marcar "No llegó" durante los primeros 5 minutos del llamado'
      });
    }

    if (usuario.rol === 'operador' && usuario.atraccion_id &&
        usuario.atraccion_id !== turnoActual.atraccion_id) {
      return res.status(403).json({ error: 'Solo el operador asignado puede marcar "No llegó"' });
    }

    // Cancelar el timer de llamado→jugando
    if (timerLlamado.has(Number(id))) {
      clearTimeout(timerLlamado.get(Number(id)));
      timerLlamado.delete(Number(id));
    }

    // Cerrar etapa activa y todas las pendientes si el juego usa etapas
    if (turnoActual.etapa_actual_id) {
      db.prepare(`
        UPDATE turno_etapas_historial
        SET finalizada_at = datetime('now','localtime'), finalizada_por = ?
        WHERE turno_id = ? AND finalizada_at IS NULL
      `).run(usuario.id, id);
    }

    // Estado específico 'no_llego' diferente de 'cancelado'
    db.prepare(`
      UPDATE turnos
      SET estado='no_llego', finished_at=datetime('now','localtime'),
          finalizado_por=?, etapa_actual_id=NULL
      WHERE id=?
    `).run(usuario.id, id);

    const turno = db.prepare(SELECT_TURNO).get(Number(id));
    io.emit('turno:finalizado', turno);

    // Liberar el juego y llamar al siguiente automáticamente (Bug 13)
    setImmediate(() => autoLlamarSiguiente(turnoActual.atraccion_id));
    res.json(turno);
  });

  return router;
};

// ── Helper: notificación a recepción cuando finaliza un operador ──────────────
function _notificarRecepcion(io, usuario, turno) {
  if (usuario.rol !== 'operador') return;
  const siguiente = db.prepare(`
    SELECT t.*, a.nombre AS atraccion_nombre
    FROM turnos t
    JOIN atracciones a ON t.atraccion_id = a.id
    WHERE t.atraccion_id = ? AND t.estado = 'esperando'
    ORDER BY t.created_at ASC LIMIT 1
  `).get(turno.atraccion_id);

  io.emit('recepcion:notificacion', {
    operador:          usuario.nombre,
    familiaFinalizada: turno.nombre_cliente || `Biper ${turno.biper_numero}`,
    biper_finalizado:  turno.biper_numero,
    atraccion:         turno.atraccion_nombre,
    siguiente: siguiente ? {
      id:                siguiente.id,
      nombre_cliente:    siguiente.nombre_cliente || `Biper ${siguiente.biper_numero}`,
      biper_numero:      siguiente.biper_numero,
      cantidad_miembros: siguiente.cantidad_miembros,
    } : null,
  });
}
