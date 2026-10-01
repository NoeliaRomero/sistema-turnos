const express = require('express');
const db = require('../db/database');
const { requireAuth, requirePermission } = require('../middleware/auth');
const serialService = require('../server/services/serialService');
const { getCodigoBeeper, existeBeeper } = require('../server/config/beeperCodes');

// Incluye etapa_actual, subcategoria y campos de estado jugando
const SELECT_TURNO = `
  SELECT t.*,
         a.nombre AS atraccion_nombre, a.duracion_minutos, a.usa_etapas, a.usa_subcategorias,
         ul.nombre AS llamado_por_nombre,
         uf.nombre AS finalizado_por_nombre,
         ea.nombre  AS etapa_actual_nombre,
         ea.orden   AS etapa_actual_orden,
         ea.duracion_minutos AS etapa_actual_duracion,
         sc.nombre  AS subcategoria_nombre
  FROM turnos t
  JOIN atracciones a ON t.atraccion_id = a.id
  LEFT JOIN usuarios ul    ON t.llamado_por    = ul.id
  LEFT JOIN usuarios uf    ON t.finalizado_por = uf.id
  LEFT JOIN juego_etapas ea ON t.etapa_actual_id = ea.id
  LEFT JOIN juego_subcategorias sc ON t.subcategoria_id = sc.id
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

// Los turnos activos (llamado/jugando) de una misma subcategoría (o sin
// subcategoría, si el juego no las usa) juegan TODOS al mismo tiempo — están
// combinados. La validación de /llamar impide que convivan simultáneamente
// dos subcategorías distintas, así que agrupar por subcategoria_id y tomar el
// máximo tiempo_restante de cada grupo (no la suma) da el momento real en que
// esa sesión combinada termina.
function acumuladoBaseDesdeActivos(activos) {
  const maxPorGrupo = {};
  activos.forEach(t => {
    const key = t.subcategoria_id ?? '__null__';
    maxPorGrupo[key] = Math.max(maxPorGrupo[key] || 0, t.tiempo_restante);
  });
  return Object.values(maxPorGrupo).reduce((s, v) => s + v, 0);
}

// Calcula el tiempo de espera estimado agrupando turnos combinables (misma
// subcategoría y que entran juntos en la capacidad máxima) en un solo bloque:
// esos grupos juegan al mismo tiempo, así que comparten la misma espera en
// lugar de sumar la duración del juego una vez por cada turno.
function calcularEsperasCombinadas(esperando, atraccion, acumuladoInicial) {
  const esperas = new Array(esperando.length);
  let acumulado = acumuladoInicial;
  let i = 0;
  while (i < esperando.length) {
    let miembros = esperando[i].cantidad_miembros || 0;
    const subcat = esperando[i].subcategoria_id;
    let j = i + 1;
    while (j < esperando.length) {
      const cand = esperando[j];
      const mismaSubcat = atraccion.usa_subcategorias ? cand.subcategoria_id === subcat : true;
      if (!mismaSubcat) break;
      const nuevaCantidad = miembros + (cand.cantidad_miembros || 0);
      if (nuevaCantidad > atraccion.max_miembros) break;
      miembros = nuevaCantidad;
      j++;
    }
    const espera = Math.ceil(acumulado);
    for (let k = i; k < j; k++) esperas[k] = espera;
    acumulado += atraccion.duracion_minutos;
    i = j;
  }
  return esperas;
}

// ── Sincronización de grupos combinados ───────────────────────────────────────
function getSincronizar() {
  try {
    const cfg = db.prepare('SELECT sincronizar_grupos_combinados FROM configuracion_general WHERE id=1').get();
    return cfg?.sincronizar_grupos_combinados === 1;
  } catch { return false; }
}

function _hermanosCombinados(turno) {
  if (turno.subcategoria_id) {
    return db.prepare(
      "SELECT t.*, ea.orden AS etapa_actual_orden FROM turnos t LEFT JOIN juego_etapas ea ON t.etapa_actual_id = ea.id WHERE t.atraccion_id=? AND t.subcategoria_id=? AND t.estado IN ('llamado','jugando') AND t.id!=?"
    ).all(turno.atraccion_id, turno.subcategoria_id, turno.id);
  }
  return db.prepare(
    "SELECT t.*, ea.orden AS etapa_actual_orden FROM turnos t LEFT JOIN juego_etapas ea ON t.etapa_actual_id = ea.id WHERE t.atraccion_id=? AND t.subcategoria_id IS NULL AND t.estado IN ('llamado','jugando') AND t.id!=?"
  ).all(turno.atraccion_id, turno.id);
}

// ── Cierre de turno (finalizado / no_llego / cancelado) ──────────────────────
// Cierra TODAS las filas abiertas de turno_etapas_historial para el turno dado
// y deja el turno en el estado final indicado. No decide por sí mismo si hay
// que replicar la acción a los hermanos combinados: eso queda a cargo del
// llamador (que ya sabe, según getSincronizar()/_hermanosCombinados, si debe
// invocar este helper también para cada hermano), preservando exactamente el
// comportamiento previo de cada endpoint.
function _cerrarTurno(turnoId, estadoFinal, usuarioId) {
  db.prepare(`
    UPDATE turno_etapas_historial
    SET finalizada_at = datetime('now','localtime'), finalizada_por = ?
    WHERE turno_id = ? AND finalizada_at IS NULL
  `).run(usuarioId, turnoId);

  db.prepare(`
    UPDATE turnos
    SET estado = ?, finished_at = datetime('now','localtime'),
        finalizado_por = ?, etapa_actual_id = NULL
    WHERE id = ?
  `).run(estadoFinal, usuarioId, turnoId);

  return db.prepare(SELECT_TURNO).get(turnoId);
}

module.exports = (io) => {
  const router = express.Router();

  // Timers de transición llamado → jugando
  const timerLlamado = new Map();

  // Timer 5 min: llamado → jugando
  function _iniciarTimerJugando(turnoId) {
    if (timerLlamado.has(turnoId)) clearTimeout(timerLlamado.get(turnoId));

    const handle = setTimeout(() => {
      timerLlamado.delete(turnoId);
      const row = db.prepare("SELECT id FROM turnos WHERE id=? AND estado='llamado'").get(turnoId);
      if (!row) return;

      db.prepare(
        "UPDATE turnos SET estado='jugando', jugando_desde=datetime('now','localtime') WHERE id=? AND estado='llamado'"
      ).run(turnoId);

      const turno = conEtapaSig(db.prepare(SELECT_TURNO).get(turnoId));
      if (turno) {
        io.emit('turno:jugando', turno);

        if (getSincronizar()) {
          _hermanosCombinados(turno).filter(h => h.estado === 'llamado').forEach(h => {
            if (timerLlamado.has(h.id)) { clearTimeout(timerLlamado.get(h.id)); timerLlamado.delete(h.id); }
            db.prepare("UPDATE turnos SET estado='jugando', jugando_desde=datetime('now','localtime') WHERE id=? AND estado='llamado'").run(h.id);
            const tH = conEtapaSig(db.prepare(SELECT_TURNO).get(h.id));
            if (tH) io.emit('turno:jugando', tH);
          });
        }
      }
    }, 5 * 60 * 1000);

    timerLlamado.set(turnoId, handle);
  }

  // Restaurar timers al reiniciar el servidor para turnos que ya estaban en 'llamado'
  {
    const llamados = db.prepare("SELECT id, called_at FROM turnos WHERE estado='llamado'").all();
    llamados.forEach(t => {
      const elapsed   = t.called_at ? (Date.now() - new Date(t.called_at).getTime()) : 0;
      const remaining = Math.max(1000, 5 * 60 * 1000 - elapsed);
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

    // Operadores solo ven su propio juego
    const whereAtraccion = usuario.rol === 'operador' && usuario.atraccion_id
      ? 'WHERE activa = 1 AND id = ?' : 'WHERE activa = 1 ORDER BY nombre';
    const atraccionParams = usuario.rol === 'operador' && usuario.atraccion_id
      ? [usuario.atraccion_id] : [];
    const atracciones = db.prepare(
      `SELECT * FROM atracciones ${whereAtraccion}`
    ).all(...atraccionParams);

    const juegos = atracciones.map(a => {
      // Activos = llamado + jugando
      const activos = db.prepare(`
        SELECT t.*, ul.nombre AS llamado_por_nombre,
               ea.nombre  AS etapa_actual_nombre,
               ea.orden   AS etapa_actual_orden,
               sc.nombre  AS subcategoria_nombre
        FROM turnos t
        LEFT JOIN usuarios ul      ON t.llamado_por    = ul.id
        LEFT JOIN juego_etapas ea  ON t.etapa_actual_id = ea.id
        LEFT JOIN juego_subcategorias sc ON t.subcategoria_id = sc.id
        WHERE t.atraccion_id = ? AND t.estado IN ('llamado','jugando')
        ORDER BY t.called_at ASC
      `).all(a.id).map(t => {
        const baseTime  = t.jugando_desde || t.called_at;
        const elapsed   = baseTime ? Math.floor((ahora - new Date(baseTime).getTime()) / 60000) : 0;
        const restante  = Math.max(0, a.duracion_minutos - elapsed);
        const sig = t.etapa_actual_orden != null ? etapaSiguiente(a.id, t.etapa_actual_orden) : null;
        return {
          ...t,
          tiempo_transcurrido: elapsed,
          tiempo_restante: restante,
          etapa_siguiente_nombre: sig ? sig.nombre : null,
        };
      });

      const esperando = db.prepare(`
        SELECT t.*, ea.nombre AS etapa_actual_nombre,
               sc.nombre AS subcategoria_nombre
        FROM turnos t
        LEFT JOIN juego_etapas ea ON t.etapa_actual_id = ea.id
        LEFT JOIN juego_subcategorias sc ON t.subcategoria_id = sc.id
        WHERE t.atraccion_id = ? AND t.estado = 'esperando'
        ORDER BY t.orden_cola ASC, t.id ASC
      `).all(a.id);

      const acumuladoBase = acumuladoBaseDesdeActivos(activos);
      const esperas = calcularEsperasCombinadas(esperando, a, acumuladoBase);
      const cola = esperando.map((t, i) => ({ ...t, posicion: i + 1, tiempo_espera_estimado: esperas[i] }));

      return { ...a, jugando: activos, cola };
    });

    res.json({ juegos });
  });

  // ── Cola pública (sin auth) — para pantalla TV ────────────────────────────────
  router.get('/cola-publica', (req, res) => {
    const ahora      = Date.now();
    const atracciones = db.prepare('SELECT * FROM atracciones WHERE activa = 1 ORDER BY nombre').all();

    const juegos = atracciones.map(a => {
      const activos = db.prepare(`
        SELECT t.biper_numero, t.nombre_cliente, t.cantidad_miembros, t.estado,
               t.called_at, t.jugando_desde, t.subcategoria_id,
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
        SELECT t.biper_numero, t.nombre_cliente, t.cantidad_miembros, t.created_at, t.subcategoria_id
        FROM turnos t
        WHERE t.atraccion_id = ? AND t.estado = 'esperando'
        ORDER BY t.orden_cola ASC, t.id ASC
      `).all(a.id);

      const acumuladoBase = acumuladoBaseDesdeActivos(activos);
      const esperas = calcularEsperasCombinadas(esperando, a, acumuladoBase);
      const cola = esperando.map((t, i) => ({ ...t, posicion: i + 1, tiempo_espera_estimado: esperas[i] }));

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
    while (usados.includes(sig) || !existeBeeper(sig)) sig++;
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
             ea.orden   AS etapa_actual_orden,
             sc.nombre  AS subcategoria_nombre,
             v.codigo_viper AS viper_codigo
      FROM turnos t
      JOIN atracciones a ON t.atraccion_id = a.id
      LEFT JOIN usuarios ul    ON t.llamado_por    = ul.id
      LEFT JOIN usuarios uf    ON t.finalizado_por = uf.id
      LEFT JOIN juego_etapas ea ON t.etapa_actual_id = ea.id
      LEFT JOIN juego_subcategorias sc ON t.subcategoria_id = sc.id
      LEFT JOIN vipers v ON t.viper_id = v.id
      WHERE 1=1
    `;
    const params = [];

    // Operadores solo ven su propio juego
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
    const { atraccion_id, biper_numero, nombre_cliente, cantidad_miembros, viper_id, subcategoria_id } = req.body;

    // ── Validar atraccion_id: debe ser un entero positivo ─────────────────────
    const atraccionId = Number(atraccion_id);
    if (!Number.isInteger(atraccionId) || atraccionId <= 0) {
      return res.status(400).json({ error: 'El identificador de atracción es inválido.' });
    }

    if (!biper_numero) {
      return res.status(400).json({ error: 'El juego y el número de beeper son requeridos' });
    }
    if (!existeBeeper(biper_numero)) {
      return res.status(400).json({ error: `El beeper ${biper_numero} no existe` });
    }

    // ── Validar cantidad_miembros: entero >= 1 ────────────────────────────────
    const miembros = parseInt(cantidad_miembros, 10);
    if (!Number.isInteger(miembros) || miembros < 1) {
      return res.status(400).json({ error: 'La cantidad de miembros debe ser un número entero mayor a cero.' });
    }

    // ── Verificar que la atracción existe en la base de datos ─────────────────
    const juego = db.prepare('SELECT * FROM atracciones WHERE id = ?').get(atraccionId);
    if (!juego) return res.status(400).json({ error: 'La atracción indicada no existe.' });

    // ── Validar min_miembros del juego ────────────────────────────────────────
    if (juego.min_miembros && miembros < juego.min_miembros) {
      return res.status(400).json({
        error: `Este juego requiere al menos ${juego.min_miembros} persona${juego.min_miembros !== 1 ? 's' : ''} por grupo.`,
      });
    }

    // ── Validar viper_id si fue enviado ───────────────────────────────────────
    let viperId = null;
    if (viper_id != null && viper_id !== '') {
      viperId = Number(viper_id);
      if (!Number.isInteger(viperId) || viperId <= 0) {
        return res.status(400).json({ error: 'El identificador del beeper es inválido.' });
      }
      const viper = db.prepare("SELECT id FROM vipers WHERE id = ? AND estado = 'ACTIVO'").get(viperId);
      if (!viper) return res.status(400).json({ error: 'El beeper seleccionado no está activo' });
    }

    const enUso = db
      .prepare("SELECT id FROM turnos WHERE biper_numero=? AND atraccion_id=? AND estado IN ('esperando','llamado','jugando')")
      .get(String(biper_numero), atraccionId);
    if (enUso) return res.status(409).json({ error: `El beeper ${biper_numero} ya está en uso en este juego` });

    // ── Validar subcategoria_id si el juego la usa ────────────────────────────
    let subcategoriaId = null;
    if (juego.usa_subcategorias) {
      if (!subcategoria_id) {
        return res.status(400).json({ error: 'Debe seleccionar una subcategoría para este juego' });
      }
      subcategoriaId = Number(subcategoria_id);
      if (!Number.isInteger(subcategoriaId) || subcategoriaId <= 0) {
        return res.status(400).json({ error: 'El identificador de subcategoría es inválido.' });
      }
      const sub = db.prepare('SELECT id FROM juego_subcategorias WHERE id = ? AND juego_id = ?').get(subcategoriaId, atraccionId);
      if (!sub) return res.status(400).json({ error: 'La subcategoría seleccionada no pertenece a este juego' });
    }

    let primeraEtapa = null;
    if (juego.usa_etapas) {
      primeraEtapa = db.prepare(`
        SELECT * FROM juego_etapas
        WHERE juego_id = ? AND activa = 1
        ORDER BY orden ASC LIMIT 1
      `).get(atraccionId);
    }

    const { maxOrden } = db.prepare(
      "SELECT COALESCE(MAX(orden_cola), 0) AS maxOrden FROM turnos WHERE atraccion_id = ? AND estado = 'esperando'"
    ).get(atraccionId);
    const nuevoOrden = maxOrden + 1;

    const result = db.prepare(
      'INSERT INTO turnos (atraccion_id, biper_numero, nombre_cliente, cantidad_miembros, viper_id, etapa_actual_id, orden_cola, subcategoria_id, creado_por) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(
      atraccionId, String(biper_numero), nombre_cliente || null,
      miembros, viperId, primeraEtapa?.id ?? null,
      nuevoOrden, subcategoriaId,
      req.session.usuario.id
    );

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

  // ── Llamar turno (manual, con subcategorías, Combinar y VIPER) ───────────────
  router.put('/:id/llamar', requireAuth('admin','recepcion'), requirePermission('permiso_llamar_turno'), (req, res) => {
    const { id } = req.params;
    const force = req.body?.force === true;

    const turnoActual = db.prepare(
      "SELECT * FROM turnos WHERE id=? AND estado='esperando'"
    ).get(Number(id));
    if (!turnoActual) {
      return res.status(400).json({ error: 'El turno no existe o ya fue llamado' });
    }

    // Detectar modo "combinar": ya hay grupos del mismo juego+subcategoría en llamado/jugando
    const modoCombinable = (() => {
      if (turnoActual.subcategoria_id) {
        return db.prepare(
          "SELECT COUNT(*) AS c FROM turnos WHERE atraccion_id = ? AND estado IN ('llamado','jugando') AND subcategoria_id = ?"
        ).get(turnoActual.atraccion_id, turnoActual.subcategoria_id).c > 0;
      }
      return db.prepare(
        "SELECT COUNT(*) AS c FROM turnos WHERE atraccion_id = ? AND estado IN ('llamado','jugando')"
      ).get(turnoActual.atraccion_id).c > 0;
    })();

    console.log(`[LLAMAR] turno=${turnoActual.id} atraccion=${turnoActual.atraccion_id} subcat=${turnoActual.subcategoria_id ?? 'ninguna'} modoCombinable=${modoCombinable}`);

    // Verificar que sea el primero en la cola solo cuando no hay nadie activo aún
    if (!modoCombinable) {
      let primero;
      if (turnoActual.subcategoria_id) {
        primero = db.prepare(`
          SELECT id FROM turnos
          WHERE atraccion_id = ? AND subcategoria_id = ? AND estado = 'esperando'
          ORDER BY orden_cola ASC, id ASC LIMIT 1
        `).get(turnoActual.atraccion_id, turnoActual.subcategoria_id);
      } else {
        primero = db.prepare(`
          SELECT id FROM turnos
          WHERE atraccion_id = ? AND subcategoria_id IS NULL AND estado = 'esperando'
          ORDER BY orden_cola ASC, id ASC LIMIT 1
        `).get(turnoActual.atraccion_id);
      }

      if (primero && primero.id !== turnoActual.id) {
        console.log(`[LLAMAR] RECHAZADO: no es primero en cola (primero=${primero.id})`);
        return res.status(400).json({
          error: 'Debe llamarse primero al grupo que llegó antes en la cola'
        });
      }
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
          AND t.estado IN ('llamado','jugando')
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

    const atraccionInfo = db.prepare(
      'SELECT max_miembros, usa_subcategorias, usa_etapas FROM atracciones WHERE id = ?'
    ).get(turnoActual.atraccion_id);

    // Validación de subcategoría: bloquear si hay grupos de distinta subcategoría activos
    if (atraccionInfo?.usa_subcategorias) {
      let conflictoSubcat;
      if (turnoActual.subcategoria_id) {
        conflictoSubcat = db.prepare(`
          SELECT COUNT(*) AS c FROM turnos
          WHERE atraccion_id = ? AND estado IN ('llamado','jugando')
            AND (subcategoria_id IS NULL OR subcategoria_id != ?)
        `).get(turnoActual.atraccion_id, turnoActual.subcategoria_id).c;
      } else {
        conflictoSubcat = db.prepare(`
          SELECT COUNT(*) AS c FROM turnos
          WHERE atraccion_id = ? AND estado IN ('llamado','jugando') AND subcategoria_id IS NOT NULL
        `).get(turnoActual.atraccion_id).c;
      }
      console.log(`[LLAMAR] conflictoSubcat=${conflictoSubcat} → ${conflictoSubcat > 0 ? 'RECHAZADO: subcategoría distinta activa' : 'OK'}`);
      if (conflictoSubcat > 0) {
        return res.status(400).json({
          error: 'No se pueden mezclar subcategorías: solo grupos de la misma subcategoría pueden jugar juntos'
        });
      }
    }

    // Validación de etapa: no llamar si los grupos activos ya avanzaron de etapa
    if (atraccionInfo?.usa_etapas) {
      let avanzados;
      if (atraccionInfo?.usa_subcategorias && turnoActual.subcategoria_id) {
        avanzados = db.prepare(`
          SELECT COUNT(*) AS c
          FROM turnos t
          LEFT JOIN juego_etapas e ON t.etapa_actual_id = e.id
          WHERE t.atraccion_id = ? AND t.estado IN ('llamado','jugando')
            AND t.subcategoria_id = ? AND COALESCE(e.orden, 1) > 1
        `).get(turnoActual.atraccion_id, turnoActual.subcategoria_id).c;
      } else if (!atraccionInfo?.usa_subcategorias) {
        avanzados = db.prepare(`
          SELECT COUNT(*) AS c
          FROM turnos t
          LEFT JOIN juego_etapas e ON t.etapa_actual_id = e.id
          WHERE t.atraccion_id = ? AND t.estado IN ('llamado','jugando')
            AND COALESCE(e.orden, 1) > 1
        `).get(turnoActual.atraccion_id).c;
      } else {
        avanzados = 0;
      }
      console.log(`[LLAMAR] avanzadosEtapa=${avanzados} → ${avanzados > 0 ? 'RECHAZADO: grupos en etapa > 1' : 'OK'}`);
      if (avanzados > 0) {
        return res.status(400).json({
          error: 'No se puede llamar: los grupos que están jugando ya avanzaron de etapa'
        });
      }
    }

    // Validación de capacidad (omitible con force=true)
    if (!force) {
      let personasJugando;
      if (atraccionInfo?.usa_subcategorias && turnoActual.subcategoria_id) {
        ({ personasJugando } = db.prepare(`
          SELECT COALESCE(SUM(cantidad_miembros), 0) AS personasJugando
          FROM turnos WHERE atraccion_id = ? AND estado IN ('llamado','jugando') AND subcategoria_id = ?
        `).get(turnoActual.atraccion_id, turnoActual.subcategoria_id));
      } else if (atraccionInfo?.usa_subcategorias) {
        ({ personasJugando } = db.prepare(`
          SELECT COALESCE(SUM(cantidad_miembros), 0) AS personasJugando
          FROM turnos WHERE atraccion_id = ? AND estado IN ('llamado','jugando') AND subcategoria_id IS NULL
        `).get(turnoActual.atraccion_id));
      } else {
        ({ personasJugando } = db.prepare(`
          SELECT COALESCE(SUM(cantidad_miembros), 0) AS personasJugando
          FROM turnos WHERE atraccion_id = ? AND estado IN ('llamado','jugando')
        `).get(turnoActual.atraccion_id));
      }
      const personasGrupo   = turnoActual.cantidad_miembros || 1;
      const totalPersonas   = personasJugando + personasGrupo;
      const maximoPermitido = atraccionInfo?.max_miembros || 20;

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

    // Backfill: si el juego usa etapas pero el turno nunca tuvo una asignada
    // (ej. se creó antes de que se configuraran las etapas del juego), se le
    // asigna la primera etapa recién ahora, al llamarlo.
    let etapaParaIniciar = turnoActual.etapa_actual_id;
    if (atraccionInfo?.usa_etapas && !etapaParaIniciar) {
      const primeraEtapa = db.prepare(`
        SELECT id FROM juego_etapas
        WHERE juego_id = ? AND activa = 1
        ORDER BY orden ASC LIMIT 1
      `).get(turnoActual.atraccion_id);
      if (primeraEtapa) {
        etapaParaIniciar = primeraEtapa.id;
        db.prepare('UPDATE turnos SET etapa_actual_id = ? WHERE id = ?').run(primeraEtapa.id, id);
        db.prepare(`
          INSERT INTO turno_etapas_historial (turno_id, etapa_id, etapa_nombre, etapa_orden)
          SELECT ?, id, nombre, orden FROM juego_etapas WHERE id = ?
        `).run(id, primeraEtapa.id);
      }
    }

    db.prepare(`
      UPDATE turnos
      SET estado='llamado', called_at=datetime('now','localtime'), llamado_por=?
      WHERE id=?
    `).run(req.session.usuario.id, id);

    if (etapaParaIniciar) {
      db.prepare(`
        UPDATE turno_etapas_historial
        SET iniciada_at = datetime('now','localtime'), iniciada_por = ?
        WHERE turno_id = ? AND etapa_id = ? AND iniciada_at IS NULL
      `).run(req.session.usuario.id, id, etapaParaIniciar);
    }

    const turno = conEtapaSig(db.prepare(SELECT_TURNO).get(Number(id)));
    io.emit('turno:llamado', turno);
    io.emit('biper:activar', { numero: turno.biper_numero, turno });

    // Activar el beeper físico: primero por número de beeper (códigos TX
    // cargados en server/config/beeperCodes.js); si no hay código, se
    // mantiene el flujo VIPER anterior.
    const codigoBeeper = getCodigoBeeper(turno.biper_numero);
    if (codigoBeeper) {
      serialService.enviarRaw(codigoBeeper, io).catch(err => {
        console.error('[SERIAL] Error al llamar beeper', turno.biper_numero, err.message);
      });
    } else if (turno.viper_id) {
      const viper = db.prepare("SELECT codigo_raw FROM vipers WHERE id = ? AND estado = 'ACTIVO'").get(turno.viper_id);
      if (viper?.codigo_raw) {
        serialService.enviarRaw(viper.codigo_raw, io).catch(err => {
          console.error('[SERIAL] Error al transmitir RAW del turno', id, err.message);
        });
      }
    }

    // Iniciar timer de transición llamado → jugando
    _iniciarTimerJugando(turno.id);

    res.json(turno);
  });

  // ── Avanzar / finalizar etapa (operador) ──────────────────────────────────────
  router.put('/:id/finalizar', requireAuth('admin','operador','recepcion'), (req, res) => {
    const { id } = req.params;
    const usuario = req.session.usuario;

    const turnoActual = db.prepare(`
      SELECT t.*, ea.orden AS etapa_actual_orden
      FROM turnos t
      LEFT JOIN juego_etapas ea ON t.etapa_actual_id = ea.id
      WHERE t.id = ? AND t.estado IN ('llamado','jugando')
    `).get(Number(id));

    if (!turnoActual) return res.status(400).json({ error: 'El turno no existe o no está activo (llamado o jugando)' });

    if (usuario.rol === 'operador' && usuario.atraccion_id &&
        usuario.atraccion_id !== turnoActual.atraccion_id) {
      return res.status(403).json({ error: 'Solo podés finalizar turnos de tu juego asignado' });
    }

    // Cancelar el timer de llamado→jugando al finalizar
    if (timerLlamado.has(Number(id))) {
      clearTimeout(timerLlamado.get(Number(id)));
      timerLlamado.delete(Number(id));
    }

    // Si el turno sigue en 'llamado' (el operador actuó antes del temporizador),
    // transicionar a 'jugando' primero para registrar el inicio real de la actividad.
    if (turnoActual.estado === 'llamado') {
      db.prepare(
        "UPDATE turnos SET estado='jugando', jugando_desde=datetime('now','localtime') WHERE id=? AND estado='llamado'"
      ).run(Number(id));
      const turnoJugando = conEtapaSig(db.prepare(SELECT_TURNO).get(Number(id)));
      if (turnoJugando) io.emit('turno:jugando', turnoJugando);
    }

    if (!turnoActual.etapa_actual_id) {
      const turno = _cerrarTurno(Number(id), 'finalizado', usuario.id);
      io.emit('turno:finalizado', turno);
      _notificarRecepcion(io, usuario, turno);

      if (getSincronizar()) {
        _hermanosCombinados(turnoActual).forEach(h => {
          if (timerLlamado.has(h.id)) { clearTimeout(timerLlamado.get(h.id)); timerLlamado.delete(h.id); }
          const tH = _cerrarTurno(h.id, 'finalizado', usuario.id);
          io.emit('turno:finalizado', tH);
          _notificarRecepcion(io, usuario, tH);
        });
      }

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

      if (getSincronizar()) {
        _hermanosCombinados(turnoActual).forEach(h => {
          if (h.etapa_actual_id) {
            db.prepare("UPDATE turno_etapas_historial SET finalizada_at=datetime('now','localtime'), finalizada_por=? WHERE turno_id=? AND etapa_id=? AND finalizada_at IS NULL").run(usuario.id, h.id, h.etapa_actual_id);
          }
          const sigH = etapaSiguiente(h.atraccion_id, h.etapa_actual_orden ?? 0);
          if (sigH) {
            db.prepare("UPDATE turnos SET etapa_actual_id=? WHERE id=?").run(sigH.id, h.id);
            db.prepare("INSERT INTO turno_etapas_historial (turno_id, etapa_id, etapa_nombre, etapa_orden, iniciada_at, iniciada_por) VALUES (?,?,?,?,datetime('now','localtime'),?)").run(h.id, sigH.id, sigH.nombre, sigH.orden, usuario.id);
            const tH = conEtapaSig(db.prepare(SELECT_TURNO).get(h.id));
            io.emit('turno:etapa_avanzada', tH);
          } else {
            db.prepare("UPDATE turnos SET estado='finalizado', finished_at=datetime('now','localtime'), finalizado_por=?, etapa_actual_id=NULL WHERE id=?").run(usuario.id, h.id);
            const tH = db.prepare(SELECT_TURNO).get(h.id);
            io.emit('turno:finalizado', tH);
            _notificarRecepcion(io, usuario, tH);
          }
        });
      }

      return res.json(turno);
    }

    const turno = _cerrarTurno(Number(id), 'finalizado', usuario.id);
    io.emit('turno:finalizado', turno);
    _notificarRecepcion(io, usuario, turno);

    if (getSincronizar()) {
      _hermanosCombinados(turnoActual).forEach(h => {
        if (timerLlamado.has(h.id)) { clearTimeout(timerLlamado.get(h.id)); timerLlamado.delete(h.id); }
        const tH = _cerrarTurno(h.id, 'finalizado', usuario.id);
        io.emit('turno:finalizado', tH);
        _notificarRecepcion(io, usuario, tH);
      });
    }

    res.json(turno);
  });

  // ── Llegó (operador confirma llegada, llamado → jugando) ─────────────────────
  router.put('/:id/llegar', requireAuth('admin','operador'), (req, res) => {
    const { id } = req.params;
    const usuario = req.session.usuario;

    const turnoActual = db.prepare(
      "SELECT * FROM turnos WHERE id=? AND estado='llamado'"
    ).get(Number(id));

    if (!turnoActual) {
      return res.status(409).json({ error: 'Solo se puede marcar "Llegó" a grupos en estado llamado' });
    }

    if (usuario.rol === 'operador' && usuario.atraccion_id &&
        usuario.atraccion_id !== turnoActual.atraccion_id) {
      return res.status(403).json({ error: 'Solo el operador asignado puede marcar "Llegó"' });
    }

    // Cancelar el timer de llamado→jugando: la transición ocurre ahora manualmente
    if (timerLlamado.has(Number(id))) {
      clearTimeout(timerLlamado.get(Number(id)));
      timerLlamado.delete(Number(id));
    }

    db.prepare(
      "UPDATE turnos SET estado='jugando', jugando_desde=datetime('now','localtime') WHERE id=? AND estado='llamado'"
    ).run(Number(id));

    const turno = conEtapaSig(db.prepare(SELECT_TURNO).get(Number(id)));
    io.emit('turno:jugando', turno);

    if (getSincronizar()) {
      _hermanosCombinados(turnoActual).filter(h => h.estado === 'llamado').forEach(h => {
        if (timerLlamado.has(h.id)) { clearTimeout(timerLlamado.get(h.id)); timerLlamado.delete(h.id); }
        db.prepare(
          "UPDATE turnos SET estado='jugando', jugando_desde=datetime('now','localtime') WHERE id=? AND estado='llamado'"
        ).run(h.id);
        const tH = conEtapaSig(db.prepare(SELECT_TURNO).get(h.id));
        if (tH) io.emit('turno:jugando', tH);
      });
    }

    res.json(turno);
  });

  // ── Cancelar turno completo (recepción, desde llamado o jugando) ─────────────
  router.put('/:id/cancelar-turno', requireAuth('admin','recepcion'), requirePermission('permiso_cancelar_turno'), (req, res) => {
    const { id } = req.params;
    const usuario = req.session.usuario;

    const turnoActual = db.prepare(
      "SELECT * FROM turnos WHERE id=? AND estado IN ('llamado','jugando')"
    ).get(Number(id));

    if (!turnoActual) {
      return res.status(409).json({
        error: 'Solo se puede cancelar un turno en estado llamado o jugando'
      });
    }

    if (timerLlamado.has(Number(id))) {
      clearTimeout(timerLlamado.get(Number(id)));
      timerLlamado.delete(Number(id));
    }

    const turno = _cerrarTurno(Number(id), 'cancelado', usuario.id);
    io.emit('turno:finalizado', turno);

    if (getSincronizar()) {
      _hermanosCombinados(turnoActual).forEach(h => {
        if (timerLlamado.has(h.id)) { clearTimeout(timerLlamado.get(h.id)); timerLlamado.delete(h.id); }
        const tH = _cerrarTurno(h.id, 'cancelado', usuario.id);
        io.emit('turno:finalizado', tH);
      });
    }

    res.json(turno);
  });

  // ── Editar turno en espera (solo estado='esperando') ─────────────────────────
  // Permite modificar subcategoria_id y/o cantidad_miembros.
  // No permite cambiar el juego ni el biper (evita revalidación compleja).
  router.put('/:id', requireAuth('admin', 'recepcion'), (req, res) => {
    const turnoId = Number(req.params.id);
    if (!Number.isInteger(turnoId) || turnoId <= 0) {
      return res.status(400).json({ error: 'ID de turno inválido.' });
    }

    const turno = db.prepare(
      "SELECT t.*, a.min_miembros, a.max_miembros, a.usa_subcategorias FROM turnos t JOIN atracciones a ON t.atraccion_id = a.id WHERE t.id = ?"
    ).get(turnoId);

    if (!turno) return res.status(404).json({ error: 'Turno no encontrado.' });
    if (turno.estado !== 'esperando') {
      return res.status(409).json({ error: 'Solo se pueden editar turnos que están en espera.' });
    }

    const { cantidad_miembros, subcategoria_id } = req.body;

    // ── Validar cantidad_miembros ─────────────────────────────────────────────
    let nuevosMiembros = turno.cantidad_miembros;
    if (cantidad_miembros !== undefined) {
      nuevosMiembros = parseInt(cantidad_miembros, 10);
      if (!Number.isInteger(nuevosMiembros) || nuevosMiembros < 1) {
        return res.status(400).json({ error: 'La cantidad de miembros debe ser un número entero mayor a cero.' });
      }
      if (turno.min_miembros && nuevosMiembros < turno.min_miembros) {
        return res.status(400).json({
          error: `Este juego requiere al menos ${turno.min_miembros} persona${turno.min_miembros !== 1 ? 's' : ''} por grupo.`,
        });
      }
      if (turno.max_miembros && nuevosMiembros > turno.max_miembros) {
        return res.status(400).json({
          error: `Este juego permite como máximo ${turno.max_miembros} persona${turno.max_miembros !== 1 ? 's' : ''} por grupo.`,
        });
      }
    }

    // ── Validar subcategoria_id ───────────────────────────────────────────────
    let nuevaSubcategoriaId = turno.subcategoria_id;
    if (subcategoria_id !== undefined) {
      if (!turno.usa_subcategorias) {
        // Juego sin subcategorías: ignorar el campo silenciosamente
        nuevaSubcategoriaId = null;
      } else if (subcategoria_id === null || subcategoria_id === '') {
        return res.status(400).json({ error: 'Este juego requiere una subcategoría.' });
      } else {
        const subId = Number(subcategoria_id);
        if (!Number.isInteger(subId) || subId <= 0) {
          return res.status(400).json({ error: 'El identificador de subcategoría es inválido.' });
        }
        const sub = db.prepare(
          'SELECT id FROM juego_subcategorias WHERE id = ? AND juego_id = ?'
        ).get(subId, turno.atraccion_id);
        if (!sub) {
          return res.status(400).json({ error: 'La subcategoría seleccionada no pertenece a este juego.' });
        }
        nuevaSubcategoriaId = subId;
      }
    }

    db.prepare(
      'UPDATE turnos SET cantidad_miembros = ?, subcategoria_id = ? WHERE id = ? AND estado = \'esperando\''
    ).run(nuevosMiembros, nuevaSubcategoriaId, turnoId);

    const turnoActualizado = conEtapaSig(db.prepare(SELECT_TURNO).get(turnoId));
    if (!turnoActualizado) return res.status(409).json({ error: 'El turno cambió de estado durante la edición.' });

    io.emit('turno:editado', turnoActualizado);
    res.json(turnoActualizado);
  });

  // ── Eliminar turno en espera (solo estado='esperando') ────────────────────────
  router.delete('/:id', requireAuth('admin', 'recepcion'), (req, res) => {
    const turnoId = Number(req.params.id);
    if (!Number.isInteger(turnoId) || turnoId <= 0) {
      return res.status(400).json({ error: 'ID de turno inválido.' });
    }

    const turno = db.prepare("SELECT * FROM turnos WHERE id = ?").get(turnoId);
    if (!turno) return res.status(404).json({ error: 'Turno no encontrado.' });
    if (turno.estado !== 'esperando') {
      return res.status(409).json({ error: 'Solo se pueden eliminar turnos que están en espera.' });
    }

    // Limpiar historial de etapas pendientes (sin iniciada_at — nunca comenzaron)
    db.prepare(
      'DELETE FROM turno_etapas_historial WHERE turno_id = ? AND iniciada_at IS NULL'
    ).run(turnoId);

    db.prepare("DELETE FROM turnos WHERE id = ? AND estado = 'esperando'").run(turnoId);

    io.emit('turno:eliminado', { id: turnoId, atraccion_id: turno.atraccion_id });
    res.json({ ok: true });
  });

  // ── Mover turno en la cola (subir / bajar) ────────────────────────────────────
  router.put('/:id/mover', requireAuth('admin', 'recepcion'), (req, res) => {
    const { id } = req.params;
    const { direccion } = req.body;

    if (!['subir', 'bajar'].includes(direccion)) {
      return res.status(400).json({ error: 'direccion debe ser "subir" o "bajar"' });
    }

    let pasos = parseInt(req.body.pasos, 10);
    if (!Number.isFinite(pasos) || pasos < 1) pasos = 1;

    const turnoA = db.prepare(
      "SELECT id, atraccion_id, orden_cola, subcategoria_id FROM turnos WHERE id = ? AND estado = 'esperando'"
    ).get(Number(id));

    if (!turnoA) {
      return res.status(400).json({ error: 'El turno no existe o ya no está en espera' });
    }

    // Lista ordenada de TODOS los turnos en espera del mismo juego, sin importar
    // subcategoría: la recepción quiere poder reordenar la cola completa a mano.
    const lista = db.prepare(`
      SELECT id, orden_cola FROM turnos
      WHERE atraccion_id = ? AND estado = 'esperando'
      ORDER BY orden_cola ASC, id ASC
    `).all(turnoA.atraccion_id);

    const idx = lista.findIndex(t => t.id === turnoA.id);
    if (idx === -1) {
      return res.status(400).json({ error: 'No se pudo ubicar el turno en la cola' });
    }

    let nuevoIdx = direccion === 'subir' ? idx - pasos : idx + pasos;
    nuevoIdx = Math.max(0, Math.min(lista.length - 1, nuevoIdx));

    if (nuevoIdx === idx) {
      return res.status(400).json({ error: 'No se puede mover en esa dirección' });
    }

    // Se conserva el conjunto de valores de orden_cola; solo se reordena
    // qué turno ocupa cada posición dentro de ese conjunto.
    const ordenValores = lista.map(t => t.orden_cola);
    const [item] = lista.splice(idx, 1);
    lista.splice(nuevoIdx, 0, item);

    const update = db.prepare('UPDATE turnos SET orden_cola = ? WHERE id = ?');
    db.exec('BEGIN');
    try {
      lista.forEach((t, i) => update.run(ordenValores[i], t.id));
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      return res.status(500).json({ error: 'No se pudo reordenar la cola' });
    }

    io.emit('turno:reordenado', { atraccion_id: turnoA.atraccion_id });
    res.json({ ok: true });
  });

  // ── No Llegó (estado diferenciado de cancelado) ───────────────────────────────
  router.put('/:id/cancelar', requirePermission('permiso_cancelar_turno'), (req, res) => {
    const { id } = req.params;
    const usuario = req.session.usuario;

    const turnoActual = db.prepare(
      "SELECT * FROM turnos WHERE id=? AND estado IN ('llamado','jugando')"
    ).get(Number(id));

    if (!turnoActual) {
      return res.status(400).json({
        error: 'Solo se puede marcar "No llegó" a grupos en estado llamado o jugando'
      });
    }

    if (usuario.rol === 'operador' && usuario.atraccion_id &&
        usuario.atraccion_id !== turnoActual.atraccion_id) {
      return res.status(403).json({ error: 'Solo el operador asignado puede marcar "No llegó"' });
    }

    // Cancelar timer de transición si existe
    if (timerLlamado.has(Number(id))) {
      clearTimeout(timerLlamado.get(Number(id)));
      timerLlamado.delete(Number(id));
    }

    const turno = _cerrarTurno(Number(id), 'no_llego', usuario.id);
    io.emit('turno:finalizado', turno);
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
    ORDER BY t.orden_cola ASC, t.id ASC LIMIT 1
  `).get(turno.atraccion_id);

  io.emit('recepcion:notificacion', {
    operador:          usuario.nombre,
    familiaFinalizada: turno.nombre_cliente || `Beeper ${turno.biper_numero}`,
    biper_finalizado:  turno.biper_numero,
    atraccion:         turno.atraccion_nombre,
    siguiente: siguiente ? {
      id:                siguiente.id,
      nombre_cliente:    siguiente.nombre_cliente || `Beeper ${siguiente.biper_numero}`,
      biper_numero:      siguiente.biper_numero,
      cantidad_miembros: siguiente.cantidad_miembros,
    } : null,
  });
}
