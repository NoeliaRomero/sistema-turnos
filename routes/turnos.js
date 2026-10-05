const express = require('express');
const cron = require('node-cron');
const db = require('../db/database');
const { requireAuth, requirePermission } = require('../middleware/auth');
const serialService = require('../server/services/serialService');
const { getCodigoBeeper, existeBeeper } = require('../server/config/beeperCodes');

// Incluye etapa_actual, subcategoria y campos de estado jugando
const SELECT_TURNO = `
  SELECT t.*,
         a.nombre AS atraccion_nombre, a.duracion_minutos, a.usa_etapas, a.usa_subcategorias, a.usa_vueltas,
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
    // Distinta cantidad de vueltas tampoco juega junta (null si el juego no las usa)
    const key = `${t.subcategoria_id ?? '__null__'}|${t.vueltas ?? '__null__'}`;
    maxPorGrupo[key] = Math.max(maxPorGrupo[key] || 0, t.tiempo_restante);
  });
  return Object.values(maxPorGrupo).reduce((s, v) => s + v, 0);
}

// Calcula el tiempo de espera estimado agrupando turnos combinables (misma
// subcategoría, misma cantidad de vueltas si el juego las usa, y que entran
// juntos en la capacidad máxima) en un solo bloque:
// esos grupos juegan al mismo tiempo, así que comparten la misma espera en
// lugar de sumar la duración del juego una vez por cada turno.
function calcularEsperasCombinadas(esperando, atraccion, acumuladoInicial) {
  const esperas = new Array(esperando.length);
  let acumulado = acumuladoInicial;
  let i = 0;
  while (i < esperando.length) {
    let miembros = esperando[i].cantidad_miembros || 0;
    const subcat  = esperando[i].subcategoria_id;
    const vueltas = esperando[i].vueltas ?? null;
    let j = i + 1;
    while (j < esperando.length) {
      const cand = esperando[j];
      const mismaSubcat = atraccion.usa_subcategorias ? cand.subcategoria_id === subcat : true;
      if (!mismaSubcat) break;
      const mismasVueltas = atraccion.usa_vueltas ? (cand.vueltas ?? null) === vueltas : true;
      if (!mismasVueltas) break;
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

// Un "hermano combinado" es otro turno activo que juega EN LA MISMA ETAPA que
// éste (además de la misma atracción/subcategoría). Antes, al no filtrar por
// etapa, un turno que ya había avanzado a una etapa siguiente seguía
// "combinado" con uno nuevo que recién entraba a la primera etapa — por eso
// la etapa anterior nunca quedaba realmente libre. Si el juego no usa etapas
// (etapa_actual_id siempre null), el filtro no se aplica y el comportamiento
// queda exactamente igual que antes.
// La comparación de etapa es null-safe (`IS ?`): un turno sin etapa (ej. uno
// viejo, llamado antes de configurar las etapas del juego) solo arrastra a
// otros turnos sin etapa, nunca a los grupos que están en una etapa. En un
// juego sin etapas todos tienen null, así que se comporta igual que antes.
function _hermanosCombinados(turno) {
  if (turno.subcategoria_id) {
    return db.prepare(
      `SELECT t.*, ea.orden AS etapa_actual_orden FROM turnos t LEFT JOIN juego_etapas ea ON t.etapa_actual_id = ea.id WHERE t.atraccion_id=? AND t.subcategoria_id=? AND t.estado IN ('llamado','jugando') AND t.id!=? AND t.etapa_actual_id IS ? AND t.vueltas IS ?`
    ).all(turno.atraccion_id, turno.subcategoria_id, turno.id, turno.etapa_actual_id ?? null, turno.vueltas ?? null);
  }
  return db.prepare(
    `SELECT t.*, ea.orden AS etapa_actual_orden FROM turnos t LEFT JOIN juego_etapas ea ON t.etapa_actual_id = ea.id WHERE t.atraccion_id=? AND t.subcategoria_id IS NULL AND t.estado IN ('llamado','jugando') AND t.id!=? AND t.etapa_actual_id IS ? AND t.vueltas IS ?`
  ).all(turno.atraccion_id, turno.id, turno.etapa_actual_id ?? null, turno.vueltas ?? null);
}

// Turnos que acompañan a éste en cualquier acción (llegó, avanzar, finalizar,
// cancelar, no llegó, re-llamar): los hermanos combinados (si está activa la
// sincronización) y, siempre, los grupos que recepción combinó con él (mismo
// combinacion_id) y siguen activos — una combinación se maneja como un solo
// grupo. `mismaEtapa`: al avanzar de etapa solo acompañan los que están en la
// misma etapa; al cerrar el turno se cierran todos.
function _acompanantes(turno, { mismaEtapa = false } = {}) {
  const mapa = new Map();
  if (getSincronizar()) _hermanosCombinados(turno).forEach(h => mapa.set(h.id, h));
  if (turno.combinacion_id) {
    db.prepare(`
      SELECT t.*, ea.orden AS etapa_actual_orden FROM turnos t
      LEFT JOIN juego_etapas ea ON t.etapa_actual_id = ea.id
      WHERE t.combinacion_id = ? AND t.atraccion_id = ? AND t.estado IN ('llamado','jugando') AND t.id != ?
    `).all(turno.combinacion_id, turno.atraccion_id, turno.id)
      .filter(h => !mismaEtapa || h.etapa_actual_id === turno.etapa_actual_id)
      .forEach(h => mapa.set(h.id, h));
  }
  return [...mapa.values()];
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

  // Timers de llamado automático del siguiente turno, uno por atracción.
  const timerAutoLlamado = new Map();

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
        _pasarAJugando(_acompanantes(turno));
      }
    }, 5 * 60 * 1000);

    timerLlamado.set(turnoId, handle);
  }

  // Pasa a 'jugando' a los acompañantes que siguen en 'llamado' (misma
  // transición que el turno principal: una combinación juega toda junta).
  function _pasarAJugando(acompanantes) {
    acompanantes.filter(h => h.estado === 'llamado').forEach(h => {
      if (timerLlamado.has(h.id)) { clearTimeout(timerLlamado.get(h.id)); timerLlamado.delete(h.id); }
      db.prepare(
        "UPDATE turnos SET estado='jugando', jugando_desde=datetime('now','localtime') WHERE id=? AND estado='llamado'"
      ).run(h.id);
      const tH = conEtapaSig(db.prepare(SELECT_TURNO).get(h.id));
      if (tH) io.emit('turno:jugando', tH);
    });
  }

  // ── Limpieza al cambiar de día ────────────────────────────────────────────────
  // Los turnos de días anteriores que nadie cerró (en espera, llamados o
  // jugando) se cancelan solos: no tienen que bloquear etapas, capacidad ni
  // beepers del día nuevo. Corre al iniciar el servidor (por si estaba apagado
  // a la medianoche) y todos los días a las 00:01.
  function _limpiarTurnosDiasAnteriores() {
    const viejos = db.prepare(`
      SELECT id FROM turnos
      WHERE estado IN ('esperando','llamado','jugando')
        AND date(COALESCE(called_at, created_at)) < date('now','localtime')
    `).all();
    if (!viejos.length) return;

    viejos.forEach(({ id }) => {
      if (timerLlamado.has(id)) { clearTimeout(timerLlamado.get(id)); timerLlamado.delete(id); }
      const turno = _cerrarTurno(id, 'cancelado', null);
      io.emit('turno:finalizado', turno);
    });
    console.log(`[LIMPIEZA] ${viejos.length} turno(s) de días anteriores cancelados: ${viejos.map(v => v.id).join(',')}`);
  }

  _limpiarTurnosDiasAnteriores();
  cron.schedule('1 0 * * *', _limpiarTurnosDiasAnteriores);

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
        SELECT t.id, t.biper_numero, t.nombre_cliente, t.cantidad_miembros, t.estado,
               t.called_at, t.jugando_desde, t.subcategoria_id, t.vueltas,
               ea.nombre AS etapa_actual_nombre,
               ea.orden  AS etapa_actual_orden
        FROM turnos t
        LEFT JOIN juego_etapas ea ON t.etapa_actual_id = ea.id
        WHERE t.atraccion_id = ? AND t.estado IN ('llamado','jugando')
        ORDER BY t.called_at ASC
      `).all(a.id).map(t => {
        const baseTime = t.jugando_desde || t.called_at;
        const elapsed  = baseTime ? Math.floor((ahora - new Date(baseTime).getTime()) / 60000) : 0;
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
        SELECT t.id, t.biper_numero, t.nombre_cliente, t.cantidad_miembros, t.created_at, t.subcategoria_id, t.vueltas
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
             v.codigo_viper AS viper_codigo,
             v.apodo        AS viper_apodo
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
  // Valida la cantidad de vueltas elegida contra las opciones configuradas del
  // juego. Devuelve { vueltas } (null si el juego no usa vueltas) o { error }.
  function _validarVueltas(juego, valor) {
    if (!juego.usa_vueltas) return { vueltas: null };
    if (valor == null || valor === '') {
      return { error: 'Debe seleccionar la cantidad de vueltas para este juego' };
    }
    const n = Number(valor);
    if (!Number.isInteger(n) || n <= 0) {
      return { error: 'La cantidad de vueltas es inválida.' };
    }
    const opcion = db.prepare('SELECT id FROM juego_vueltas WHERE juego_id = ? AND cantidad = ?').get(juego.id, n);
    if (!opcion) return { error: 'La cantidad de vueltas elegida no está configurada para este juego' };
    return { vueltas: n };
  }

  router.post('/', requireAuth('admin','recepcion'), (req, res) => {
    const { atraccion_id, nombre_cliente, cantidad_miembros, viper_id, subcategoria_id, vueltas } = req.body;

    // ── Validar atraccion_id: debe ser un entero positivo ─────────────────────
    const atraccionId = Number(atraccion_id);
    if (!Number.isInteger(atraccionId) || atraccionId <= 0) {
      return res.status(400).json({ error: 'El identificador de atracción es inválido.' });
    }

    // El beeper tiene que ser solo dígitos: se guarda normalizado ("07" → "7")
    // y nunca texto arbitrario (antes "7<img ...>" pasaba porque parseInt
    // ignora lo que sigue al número, y se mostraba tal cual en el operador).
    const biperTexto = String(req.body.biper_numero ?? '').trim();
    if (!biperTexto) {
      return res.status(400).json({ error: 'El juego y el número de beeper son requeridos' });
    }
    if (!/^\d+$/.test(biperTexto)) {
      return res.status(400).json({ error: 'El número de beeper es inválido' });
    }
    const biper_numero = String(parseInt(biperTexto, 10));
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

    // Un mismo beeper puede estar en varios juegos (familia en varias filas),
    // pero la recepción debe confirmarlo para evitar errores de tipeo.
    if (req.body.confirmar_biper_otro_juego !== true) {
      const enOtroJuego = db.prepare(`
        SELECT t.nombre_cliente, a.nombre AS juego_origen
        FROM turnos t JOIN atracciones a ON t.atraccion_id = a.id
        WHERE t.biper_numero = ? AND t.atraccion_id <> ? AND t.estado IN ('esperando','llamado','jugando')
        ORDER BY t.id DESC LIMIT 1
      `).get(String(biper_numero), atraccionId);
      if (enOtroJuego) {
        return res.status(409).json({
          advertencia:    'biper_en_otro_juego_registro',
          biper_numero:   String(biper_numero),
          juego_origen:   enOtroJuego.juego_origen,
          nombre_cliente: enOtroJuego.nombre_cliente,
        });
      }
    }

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

    // ── Validar vueltas si el juego las usa ───────────────────────────────────
    const valVueltas = _validarVueltas(juego, vueltas);
    if (valVueltas.error) return res.status(400).json({ error: valVueltas.error });
    const vueltasTurno = valVueltas.vueltas;

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
      'INSERT INTO turnos (atraccion_id, biper_numero, nombre_cliente, cantidad_miembros, viper_id, etapa_actual_id, orden_cola, subcategoria_id, vueltas, creado_por) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).run(
      atraccionId, String(biper_numero), nombre_cliente || null,
      miembros, viperId, primeraEtapa?.id ?? null,
      nuevoOrden, subcategoriaId, vueltasTurno,
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

  // ── Núcleo de "llamar turno" ───────────────────────────────────────────────────
  // Compartido entre el llamado manual (HTTP) y el llamado automático del
  // siguiente turno: misma lógica, mismas validaciones, sin duplicar nada.
  // Devuelve { status, body } en vez de escribir en `res`, para que ambos
  // disparadores puedan usarlo por igual.
  // true si el beeper está llamado/jugando en un juego distinto al indicado.
  function _biperEnOtroJuego(biperNumero, atraccionId) {
    return !!db.prepare(`
      SELECT 1 FROM turnos
      WHERE biper_numero = ? AND atraccion_id != ? AND estado IN ('llamado','jugando')
      LIMIT 1
    `).get(biperNumero, atraccionId);
  }

  // Los otros turnos en espera combinados con éste (vacío si no está combinado).
  function _companerosEnEspera(turno) {
    if (!turno.combinacion_id) return [];
    return db.prepare(`
      SELECT * FROM turnos
      WHERE combinacion_id = ? AND atraccion_id = ? AND estado = 'esperando' AND id != ?
      ORDER BY orden_cola ASC, id ASC
    `).all(turno.combinacion_id, turno.atraccion_id, turno.id);
  }

  // Una combinación se llama entera: está "ocupada" si cualquiera de sus
  // beepers está en otro juego.
  function _turnoOcupadoEnOtroJuego(turno) {
    return [turno, ..._companerosEnEspera(turno)]
      .some(t => _biperEnOtroJuego(t.biper_numero, turno.atraccion_id));
  }

  // `saltarOcupados` (solo llamado automático): para el chequeo de orden de
  // cola, no cuentan los grupos en espera cuyo beeper está en otro juego, así
  // se puede llamar al siguiente disponible sin esperar a que vuelvan.
  // `combinar` (uso interno): al llamar a una combinación, sus integrantes
  // entran a la misma etapa que el primero aunque ya esté ocupada por él.
  // `esCompanero` (uso interno): el turno se llama como parte de la combinación
  // de otro, que ya hizo las validaciones por todo el grupo.
  function _ejecutarLlamado(turnoId, usuario, { force = false, saltarOcupados = false, combinar = false, esCompanero = false } = {}) {
    const id = Number(turnoId);

    const turnoActual = db.prepare(
      "SELECT * FROM turnos WHERE id=? AND estado IN ('esperando','llamado')"
    ).get(id);
    if (!turnoActual) {
      return { status: 400, body: { error: 'El turno no existe o ya no está disponible para llamar' } };
    }

    if (usuario.rol === 'operador' && usuario.atraccion_id &&
        usuario.atraccion_id !== turnoActual.atraccion_id) {
      return { status: 403, body: { error: 'Solo podés llamar turnos de tu juego asignado' } };
    }

    // Llamado repetido: el turno ya está en 'llamado' (todavía no se marcó
    // "Llegó"). Se reenvía la señal sin repetir las validaciones de cola,
    // subcategoría, etapa o capacidad — ya se cumplieron en el primer llamado,
    // y el turno sigue siendo el mismo (mismo VIPER/beeper, sin duplicar nada).
    const esReLlamado = turnoActual.estado === 'llamado';
    let atraccionInfo;

    // Grupos combinados en espera con éste: se validan y llaman todos juntos.
    // En un re-llamado, los acompañantes que siguen en 'llamado' se re-llaman
    // también (vuelve a sonar el beeper de todo el grupo).
    const companeros   = esCompanero ? []
      : esReLlamado ? _acompanantes(turnoActual).filter(h => h.estado === 'llamado')
      : _companerosEnEspera(turnoActual);
    const companerosId = new Set(companeros.map(c => c.id));

    if (!esReLlamado) {
      atraccionInfo = db.prepare(
        'SELECT max_miembros, usa_subcategorias, usa_etapas, usa_vueltas FROM atracciones WHERE id = ?'
      ).get(turnoActual.atraccion_id);

      // Etapa por la que entraría este turno (solo en juegos con etapas).
      const etapaDeEntrada = atraccionInfo?.usa_etapas
        ? (turnoActual.etapa_actual_id || db.prepare(`
            SELECT id FROM juego_etapas WHERE juego_id = ? AND activa = 1 ORDER BY orden ASC LIMIT 1
          `).get(turnoActual.atraccion_id)?.id)
        : null;

      // En juegos con etapas, un grupo que ya avanzó más allá de la etapa de
      // entrada (ej. pasó de "charla" a "en pista") ya está jugando: deja de
      // contar para la cola, las subcategorías y la capacidad del siguiente.
      // Un turno activo sin etapa asignada se considera en la entrada.
      const filtroEntrada = etapaDeEntrada ? ' AND (etapa_actual_id = ? OR etapa_actual_id IS NULL)' : '';
      const paramsEntrada = etapaDeEntrada ? [etapaDeEntrada] : [];

      // Detectar modo "combinar": ya hay grupos del mismo juego+subcategoría en llamado/jugando
      const modoCombinable = (() => {
        if (turnoActual.subcategoria_id) {
          return db.prepare(
            `SELECT COUNT(*) AS c FROM turnos WHERE atraccion_id = ? AND estado IN ('llamado','jugando') AND subcategoria_id = ?${filtroEntrada}`
          ).get(turnoActual.atraccion_id, turnoActual.subcategoria_id, ...paramsEntrada).c > 0;
        }
        return db.prepare(
          `SELECT COUNT(*) AS c FROM turnos WHERE atraccion_id = ? AND estado IN ('llamado','jugando')${filtroEntrada}`
        ).get(turnoActual.atraccion_id, ...paramsEntrada).c > 0;
      })();

      console.log(`[LLAMAR] turno=${turnoActual.id} atraccion=${turnoActual.atraccion_id} subcat=${turnoActual.subcategoria_id ?? 'ninguna'} modoCombinable=${modoCombinable}`);

      // Verificar que sea el primero en la cola solo cuando no hay nadie activo aún
      if (!modoCombinable) {
        let enCola;
        if (turnoActual.subcategoria_id) {
          enCola = db.prepare(`
            SELECT * FROM turnos
            WHERE atraccion_id = ? AND subcategoria_id = ? AND estado = 'esperando'
            ORDER BY orden_cola ASC, id ASC
          `).all(turnoActual.atraccion_id, turnoActual.subcategoria_id);
        } else {
          enCola = db.prepare(`
            SELECT * FROM turnos
            WHERE atraccion_id = ? AND subcategoria_id IS NULL AND estado = 'esperando'
            ORDER BY orden_cola ASC, id ASC
          `).all(turnoActual.atraccion_id);
        }
        const primero = saltarOcupados
          ? enCola.find(t => !_turnoOcupadoEnOtroJuego(t))
          : enCola[0];

        // Si el primero es de la misma combinación, el grupo entero es el primero.
        if (primero && primero.id !== turnoActual.id && !companerosId.has(primero.id)) {
          console.log(`[LLAMAR] RECHAZADO: no es primero en cola (primero=${primero.id})`);
          return { status: 400, body: {
            error: 'Debe llamarse primero al grupo que llegó antes en la cola'
          } };
        }
      }

      // Validación de biper en otro juego (omitible con force=true)
      if (!force) {
        const buscarConflicto = biper => db.prepare(`
          SELECT t.id, t.nombre_cliente, t.biper_numero, t.called_at,
                 a.nombre AS atraccion_nombre, a.duracion_minutos
          FROM turnos t
          JOIN atracciones a ON t.atraccion_id = a.id
          WHERE t.biper_numero = ?
            AND t.atraccion_id != ?
            AND t.estado IN ('llamado','jugando')
        `).get(biper, turnoActual.atraccion_id);
        // Se revisa cada beeper de la combinación, no solo el del primero
        let conflictoViper = null;
        for (const t of [turnoActual, ...companeros]) {
          conflictoViper = buscarConflicto(t.biper_numero);
          if (conflictoViper) break;
        }

        if (conflictoViper) {
          const elapsed   = conflictoViper.called_at
            ? Math.floor((Date.now() - new Date(conflictoViper.called_at).getTime()) / 60000) : 0;
          const restante  = Math.max(0, conflictoViper.duracion_minutos - elapsed);
          return { status: 200, body: {
            advertencia:    'biper_en_otro_juego',
            biper_numero:   conflictoViper.biper_numero,
            juego_origen:   conflictoViper.atraccion_nombre,
            nombre_cliente: conflictoViper.nombre_cliente,
            tiempo_restante: restante,
          } };
        }
      }

      // Validación de subcategoría: bloquear si hay grupos de distinta subcategoría activos
      if (atraccionInfo?.usa_subcategorias) {
        let conflictoSubcat;
        if (turnoActual.subcategoria_id) {
          conflictoSubcat = db.prepare(`
            SELECT COUNT(*) AS c FROM turnos
            WHERE atraccion_id = ? AND estado IN ('llamado','jugando')
              AND (subcategoria_id IS NULL OR subcategoria_id != ?)${filtroEntrada}
          `).get(turnoActual.atraccion_id, turnoActual.subcategoria_id, ...paramsEntrada).c;
        } else {
          conflictoSubcat = db.prepare(`
            SELECT COUNT(*) AS c FROM turnos
            WHERE atraccion_id = ? AND estado IN ('llamado','jugando') AND subcategoria_id IS NOT NULL${filtroEntrada}
          `).get(turnoActual.atraccion_id, ...paramsEntrada).c;
        }
        console.log(`[LLAMAR] conflictoSubcat=${conflictoSubcat} → ${conflictoSubcat > 0 ? 'RECHAZADO: subcategoría distinta activa' : 'OK'}`);
        if (conflictoSubcat > 0) {
          return { status: 400, body: {
            error: 'No se pueden mezclar subcategorías: solo grupos de la misma subcategoría pueden jugar juntos'
          } };
        }
      }

      // Validación de vueltas: grupos con distinta cantidad de vueltas nunca
      // corren juntos. Igual que las subcategorías, solo cuentan los grupos en
      // la etapa de entrada (los que ya avanzaron no bloquean). `IS NOT` es
      // null-safe: un turno sin vueltas tampoco se mezcla con uno que sí tiene.
      if (atraccionInfo?.usa_vueltas) {
        const conflictoVueltas = db.prepare(`
          SELECT COUNT(*) AS c FROM turnos
          WHERE atraccion_id = ? AND estado IN ('llamado','jugando')
            AND vueltas IS NOT ?${filtroEntrada}
        `).get(turnoActual.atraccion_id, turnoActual.vueltas ?? null, ...paramsEntrada).c;
        console.log(`[LLAMAR] conflictoVueltas=${conflictoVueltas} → ${conflictoVueltas > 0 ? 'RECHAZADO: otra cantidad de vueltas activa' : 'OK'}`);
        if (conflictoVueltas > 0) {
          return { status: 400, body: {
            error: 'No se pueden mezclar grupos con distinta cantidad de vueltas'
          } };
        }
      }

      // Validación de etapa: la ocupación es POR ETAPA, no por el juego/sesión
      // completa. Un turno activo que ya avanzó a la etapa siguiente libera la
      // etapa anterior — solo bloquea si hay otro turno activo ocupando
      // exactamente la misma etapa en la que entraría este turno.
      if (atraccionInfo?.usa_etapas) {
        let etapaOcupada = 0;
        if (etapaDeEntrada) {
          // Con subcategorías, un turno sin subcategoría también ocupa la etapa
          // (antes no se validaba y entraban varios grupos a la vez).
          if (atraccionInfo?.usa_subcategorias) {
            etapaOcupada = db.prepare(`
              SELECT COUNT(*) AS c FROM turnos
              WHERE atraccion_id = ? AND estado IN ('llamado','jugando')
                AND subcategoria_id IS ? AND etapa_actual_id = ?
            `).get(turnoActual.atraccion_id, turnoActual.subcategoria_id ?? null, etapaDeEntrada).c;
          } else {
            etapaOcupada = db.prepare(`
              SELECT COUNT(*) AS c FROM turnos
              WHERE atraccion_id = ? AND estado IN ('llamado','jugando') AND etapa_actual_id = ?
            `).get(turnoActual.atraccion_id, etapaDeEntrada).c;
          }
        }
        // Integrante de una combinación: entra a la etapa junto al primero del
        // grupo, que la acaba de ocupar. La subcategoría ya se validó arriba.
        const permiteCombinar = combinar && etapaOcupada > 0;
        console.log(`[LLAMAR] etapaDeEntrada=${etapaDeEntrada ?? 'ninguna'} etapaOcupada=${etapaOcupada} combinar=${combinar} → ${etapaOcupada > 0 && !permiteCombinar ? 'RECHAZADO: etapa ocupada' : 'OK'}`);
        if (etapaOcupada > 0 && !permiteCombinar) {
          return { status: 400, body: {
            error: 'No se puede llamar: ya hay un grupo en esa etapa'
          } };
        }
      }

      // Validación de capacidad (omitible con force=true)
      if (!force) {
        let personasJugando;
        if (atraccionInfo?.usa_subcategorias && turnoActual.subcategoria_id) {
          ({ personasJugando } = db.prepare(`
            SELECT COALESCE(SUM(cantidad_miembros), 0) AS personasJugando
            FROM turnos WHERE atraccion_id = ? AND estado IN ('llamado','jugando') AND subcategoria_id = ?${filtroEntrada}
          `).get(turnoActual.atraccion_id, turnoActual.subcategoria_id, ...paramsEntrada));
        } else if (atraccionInfo?.usa_subcategorias) {
          ({ personasJugando } = db.prepare(`
            SELECT COALESCE(SUM(cantidad_miembros), 0) AS personasJugando
            FROM turnos WHERE atraccion_id = ? AND estado IN ('llamado','jugando') AND subcategoria_id IS NULL${filtroEntrada}
          `).get(turnoActual.atraccion_id, ...paramsEntrada));
        } else {
          ({ personasJugando } = db.prepare(`
            SELECT COALESCE(SUM(cantidad_miembros), 0) AS personasJugando
            FROM turnos WHERE atraccion_id = ? AND estado IN ('llamado','jugando')${filtroEntrada}
          `).get(turnoActual.atraccion_id, ...paramsEntrada));
        }
        const personasGrupo   = [turnoActual, ...companeros]
          .reduce((s, t) => s + (t.cantidad_miembros || 1), 0);
        const totalPersonas   = personasJugando + personasGrupo;
        const maximoPermitido = atraccionInfo?.max_miembros || 20;

        if (totalPersonas > maximoPermitido) {
          return { status: 200, body: {
            advertencia: 'capacidad_excedida',
            personasJugando,
            personasGrupo,
            totalPersonas,
            maximoPermitido,
          } };
        }
      }
    }

    // Backfill: si el juego usa etapas pero el turno nunca tuvo una asignada
    // (ej. se creó antes de que se configuraran las etapas del juego), se le
    // asigna la primera etapa recién ahora, al llamarlo. En un re-llamado no
    // hace falta: si no tenía etapa antes, sigue sin tenerla ahora.
    let etapaParaIniciar = turnoActual.etapa_actual_id;
    if (!esReLlamado && atraccionInfo?.usa_etapas && !etapaParaIniciar) {
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

    // combinacion_id se conserva al llamar: los combinados juegan juntos y se
    // finalizan juntos (ver _acompanantes).
    db.prepare(`
      UPDATE turnos
      SET estado='llamado', called_at=datetime('now','localtime'), llamado_por=?
      WHERE id=?
    `).run(usuario.id, id);

    if (etapaParaIniciar) {
      db.prepare(`
        UPDATE turno_etapas_historial
        SET iniciada_at = datetime('now','localtime'), iniciada_por = ?
        WHERE turno_id = ? AND etapa_id = ? AND iniciada_at IS NULL
      `).run(usuario.id, id, etapaParaIniciar);
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

    // Llamar al resto de la combinación. Cola, beepers y capacidad ya se
    // validaron para todo el grupo arriba (force); `combinar` los deja entrar
    // a la misma etapa que el primero.
    const llamadosJuntos = [];
    for (const c of companeros) {
      const r = _ejecutarLlamado(c.id, usuario, { force: true, combinar: true, esCompanero: true });
      if (r.status === 200 && !r.body?.advertencia) llamadosJuntos.push(r.body);
      else console.log(`[LLAMAR] combinación: turno=${c.id} no llamado: ${r.body?.error || r.body?.advertencia}`);
    }

    // Si el juego tiene llamado automático habilitado, programar el intento
    // del siguiente turno (misma lógica de validación, reutilizada).
    _programarLlamadoAutomatico(turno.atraccion_id);

    return { status: 200, body: llamadosJuntos.length ? { ...turno, combinados: llamadosJuntos } : turno };
  }

  // Intenta llamar automáticamente al siguiente turno en espera de una
  // atracción, pasado el tiempo configurado — solo si esa atracción tiene
  // `llamado_automatico` habilitado. Usa el mismo `_ejecutarLlamado` que el
  // llamado manual, así que respeta exactamente las mismas validaciones
  // (cola, subcategorías, etapa, capacidad, VIPER). Si la atracción no tiene
  // la función activada, no hace nada — el comportamiento queda igual que hoy.
  function _programarLlamadoAutomatico(atraccionId) {
    const atraccion = db.prepare(
      'SELECT llamado_automatico, tiempo_entre_llamados_segundos FROM atracciones WHERE id = ?'
    ).get(atraccionId);
    if (!atraccion?.llamado_automatico || !atraccion.tiempo_entre_llamados_segundos) return;

    if (timerAutoLlamado.has(atraccionId)) clearTimeout(timerAutoLlamado.get(atraccionId));

    const handle = setTimeout(() => {
      timerAutoLlamado.delete(atraccionId);

      const enEspera = db.prepare(`
        SELECT * FROM turnos WHERE atraccion_id = ? AND estado = 'esperando'
        ORDER BY orden_cola ASC, id ASC
      `).all(atraccionId);
      if (!enEspera.length) return;

      // Se saltean los grupos cuyo beeper está en otro juego (en una
      // combinación, si cualquiera de sus beepers lo está): se llama al
      // primero que esté libre. Si todos están ocupados, se reintenta pasado
      // el mismo tiempo, hasta que alguno vuelva o la cola quede vacía.
      const siguiente = enEspera.find(t => !_turnoOcupadoEnOtroJuego(t));
      if (!siguiente) {
        console.log(`[AUTO-LLAMAR] atraccion=${atraccionId} → todos los grupos en espera están en otro juego, se reintenta`);
        _programarLlamadoAutomatico(atraccionId);
        return;
      }
      if (siguiente !== enEspera[0]) {
        const salteados = enEspera.slice(0, enEspera.indexOf(siguiente)).map(t => t.id).join(',');
        console.log(`[AUTO-LLAMAR] atraccion=${atraccionId} salteados por estar en otro juego: ${salteados}`);
      }

      // No hay una sesión humana detrás de un llamado automático: no aplica
      // el chequeo de atracción asignada del operador y no se registra
      // llamado_por (queda null, igual que cualquier columna sin asignar).
      const usuarioSistema = { id: null, rol: 'sistema', atraccion_id: null };
      const resultado = _ejecutarLlamado(siguiente.id, usuarioSistema, { saltarOcupados: true });
      const exito = resultado.status === 200 && !resultado.body?.advertencia;
      console.log(`[AUTO-LLAMAR] atraccion=${atraccionId} turno=${siguiente.id} → ${exito ? 'llamado' : 'no llamado: ' + (resultado.body?.advertencia || resultado.body?.error || 'rechazado')}`);
    }, atraccion.tiempo_entre_llamados_segundos * 1000);

    timerAutoLlamado.set(atraccionId, handle);
  }

  // ── Llamar turno (manual, con subcategorías, Combinar y VIPER) ───────────────
  // Admin siempre puede. Recepción y Operador necesitan permiso_llamar_turno
  // (el operador además solo sobre turnos de su propia atracción asignada).
  router.put('/:id/llamar', requireAuth('admin','recepcion','operador'), requirePermission('permiso_llamar_turno'), (req, res) => {
    const force     = req.body?.force === true;
    const resultado = _ejecutarLlamado(req.params.id, req.session.usuario, { force });
    res.status(resultado.status).json(resultado.body);
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

    // Solo puede haber un turno por etapa: no se avanza si la etapa siguiente
    // está ocupada, salvo que el ocupante sea parte de la misma combinación.
    // Como una etapa nunca tiene dos turnos salvo combinados, un ocupante que
    // compartió con este turno la etapa actual es su compañero de combinación
    // (avanzó primero): si este turno entró a la etapa actual estrictamente
    // ANTES de que el ocupante entrara a la siguiente, estuvieron juntos en la
    // etapa actual. Un empate en el mismo segundo se trata como no combinado
    // (lado seguro: se bloquea).
    if (turnoActual.etapa_actual_id) {
      const sigEtapa = etapaSiguiente(turnoActual.atraccion_id, turnoActual.etapa_actual_orden);
      if (sigEtapa) {
        const miInicio = db.prepare(`
          SELECT iniciada_at FROM turno_etapas_historial
          WHERE turno_id = ? AND etapa_id = ? AND finalizada_at IS NULL
          ORDER BY id DESC LIMIT 1
        `).get(Number(id), turnoActual.etapa_actual_id)?.iniciada_at;

        const ocupantes = db.prepare(`
          SELECT id FROM turnos
          WHERE atraccion_id = ? AND estado IN ('llamado','jugando')
            AND etapa_actual_id = ? AND id != ?
        `).all(turnoActual.atraccion_id, sigEtapa.id, Number(id));

        const esCompanero = (ocupanteId) => !!miInicio && !!db.prepare(`
          SELECT 1 FROM turno_etapas_historial
          WHERE turno_id = ? AND etapa_id = ? AND finalizada_at IS NULL AND iniciada_at > ?
          LIMIT 1
        `).get(ocupanteId, sigEtapa.id, miInicio);

        if (ocupantes.some(o => !esCompanero(o.id))) {
          console.log(`[FINALIZAR] turno=${id} RECHAZADO: etapa "${sigEtapa.nombre}" ocupada por turno(s) ${ocupantes.map(o => o.id).join(',')}`);
          return res.status(400).json({
            error: `No se puede pasar a "${sigEtapa.nombre}": ya hay un grupo en esa etapa`
          });
        }
      }
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

      {
        _acompanantes(turnoActual).forEach(h => {
          if (timerLlamado.has(h.id)) { clearTimeout(timerLlamado.get(h.id)); timerLlamado.delete(h.id); }
          const tH = _cerrarTurno(h.id, 'finalizado', usuario.id);
          io.emit('turno:finalizado', tH);
          _notificarRecepcion(io, usuario, tH);
        });
      }

      // El juego quedó libre: llamar al siguiente pasado el tiempo configurado.
      _programarLlamadoAutomatico(turnoActual.atraccion_id);

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

      {
        const acompEtapa = _acompanantes(turnoActual, { mismaEtapa: true });
        _pasarAJugando(acompEtapa);
        acompEtapa.forEach(h => {
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

      // Avanzar libera la etapa anterior: el siguiente en espera puede entrar.
      _programarLlamadoAutomatico(turnoActual.atraccion_id);

      return res.json(turno);
    }

    const turno = _cerrarTurno(Number(id), 'finalizado', usuario.id);
    io.emit('turno:finalizado', turno);
    _notificarRecepcion(io, usuario, turno);

    {
      _acompanantes(turnoActual).forEach(h => {
        if (timerLlamado.has(h.id)) { clearTimeout(timerLlamado.get(h.id)); timerLlamado.delete(h.id); }
        const tH = _cerrarTurno(h.id, 'finalizado', usuario.id);
        io.emit('turno:finalizado', tH);
        _notificarRecepcion(io, usuario, tH);
      });
    }

    _programarLlamadoAutomatico(turnoActual.atraccion_id);

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
    _pasarAJugando(_acompanantes(turnoActual));

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

    _acompanantes(turnoActual).forEach(h => {
      if (timerLlamado.has(h.id)) { clearTimeout(timerLlamado.get(h.id)); timerLlamado.delete(h.id); }
      const tH = _cerrarTurno(h.id, 'cancelado', usuario.id);
      io.emit('turno:finalizado', tH);
    });

    // El juego quedó libre: llamar al siguiente pasado el tiempo configurado.
    _programarLlamadoAutomatico(turnoActual.atraccion_id);

    res.json(turno);
  });

  // ── Editar turno en espera (solo estado='esperando') ─────────────────────────
  // Permite modificar subcategoria_id, vueltas y/o cantidad_miembros.
  // No permite cambiar el juego ni el biper (evita revalidación compleja).
  router.put('/:id', requireAuth('admin', 'recepcion'), (req, res) => {
    const turnoId = Number(req.params.id);
    if (!Number.isInteger(turnoId) || turnoId <= 0) {
      return res.status(400).json({ error: 'ID de turno inválido.' });
    }

    const turno = db.prepare(
      "SELECT t.*, a.min_miembros, a.max_miembros, a.usa_subcategorias, a.usa_vueltas FROM turnos t JOIN atracciones a ON t.atraccion_id = a.id WHERE t.id = ?"
    ).get(turnoId);

    if (!turno) return res.status(404).json({ error: 'Turno no encontrado.' });
    if (turno.estado !== 'esperando') {
      return res.status(409).json({ error: 'Solo se pueden editar turnos que están en espera.' });
    }

    const { cantidad_miembros, subcategoria_id, vueltas } = req.body;

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

    // ── Validar vueltas ───────────────────────────────────────────────────────
    let nuevasVueltas = turno.vueltas ?? null;
    if (vueltas !== undefined) {
      const valVueltas = _validarVueltas({ id: turno.atraccion_id, usa_vueltas: turno.usa_vueltas }, vueltas);
      if (valVueltas.error) return res.status(400).json({ error: valVueltas.error });
      nuevasVueltas = valVueltas.vueltas;
      // Un grupo combinado corre junto: no puede quedar con otra cantidad de vueltas
      if (nuevasVueltas !== (turno.vueltas ?? null) && _companerosEnEspera(turno).length) {
        return res.status(400).json({ error: 'El grupo está combinado: descombinalo antes de cambiar la cantidad de vueltas.' });
      }
    }

    db.prepare(
      'UPDATE turnos SET cantidad_miembros = ?, subcategoria_id = ?, vueltas = ? WHERE id = ? AND estado = \'esperando\''
    ).run(nuevosMiembros, nuevaSubcategoriaId, nuevasVueltas, turnoId);

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
  // ── Combinar grupos en espera ───────────────────────────────────────────────
  // Une al turno `turno_id` con los turnos `con` (todos en espera del mismo
  // juego y subcategoría) sin llamarlos: quedan juntos en la cola y se llaman
  // todos a la vez cuando le toque al primero. El total de personas no puede
  // superar el máximo del juego.
  router.post('/combinar', requireAuth('admin', 'recepcion'), requirePermission('permiso_llamar_turno'), (req, res) => {
    const baseId = Number(req.body?.turno_id);
    const conIds = Array.isArray(req.body?.con) ? [...new Set(req.body.con.map(Number))] : [];
    if (!Number.isInteger(baseId) || !conIds.length || conIds.some(i => !Number.isInteger(i) || i === baseId)) {
      return res.status(400).json({ error: 'Elegí al menos un grupo para combinar' });
    }

    const base = db.prepare("SELECT * FROM turnos WHERE id = ? AND estado = 'esperando'").get(baseId);
    if (!base) return res.status(400).json({ error: 'El turno ya no está en espera' });
    const juego = db.prepare('SELECT max_miembros, usa_subcategorias, usa_vueltas FROM atracciones WHERE id = ?').get(base.atraccion_id);

    const nuevos = conIds.map(i => db.prepare("SELECT * FROM turnos WHERE id = ? AND estado = 'esperando'").get(i));
    if (nuevos.some(t => !t || t.atraccion_id !== base.atraccion_id)) {
      return res.status(400).json({ error: 'Todos los grupos tienen que estar en espera en el mismo juego' });
    }
    if (juego?.usa_subcategorias && nuevos.some(t => t.subcategoria_id !== base.subcategoria_id)) {
      return res.status(400).json({ error: 'Solo se pueden combinar grupos de la misma subcategoría' });
    }
    // Grupos con distinta cantidad de vueltas nunca corren juntos
    if (juego?.usa_vueltas && nuevos.some(t => (t.vueltas ?? null) !== (base.vueltas ?? null))) {
      return res.status(400).json({ error: 'Solo se pueden combinar grupos con la misma cantidad de vueltas' });
    }
    if (nuevos.some(t => t.combinacion_id && t.combinacion_id !== base.combinacion_id && _companerosEnEspera(t).length)) {
      return res.status(400).json({ error: 'Uno de los grupos ya está combinado con otro' });
    }

    const miembros = [base, ..._companerosEnEspera(base), ...nuevos.filter(t => !t.combinacion_id || t.combinacion_id !== base.combinacion_id)];
    const unicos   = [...new Map(miembros.map(t => [t.id, t])).values()];
    const personas = unicos.reduce((s, t) => s + (t.cantidad_miembros || 1), 0);
    const maximo   = juego?.max_miembros || 20;
    if (personas > maximo) {
      return res.status(400).json({ error: `Combinados serían ${personas} personas y el juego admite ${maximo}` });
    }

    // Los combinados quedan seguidos en la cola, en el lugar del que estaba
    // más adelante (se conserva el conjunto de valores de orden_cola).
    // Si el turno base ya tiene una combinación en espera se suma a ella; si no,
    // se usa un id nuevo (no el del turno: combinaciones viejas siguen activas
    // en juego con su id, y no deben mezclarse con la nueva).
    const combinacionId = _companerosEnEspera(base).length
      ? base.combinacion_id
      : db.prepare('SELECT COALESCE(MAX(combinacion_id), 0) + 1 AS n FROM turnos').get().n;
    const idsGrupo = new Set(unicos.map(t => t.id));
    const lista = db.prepare(`
      SELECT id, orden_cola FROM turnos WHERE atraccion_id = ? AND estado = 'esperando'
      ORDER BY orden_cola ASC, id ASC
    `).all(base.atraccion_id);
    const ordenValores = lista.map(t => t.orden_cola);
    const primerIdx = lista.findIndex(t => idsGrupo.has(t.id));
    const grupo  = lista.filter(t => idsGrupo.has(t.id));
    const resto  = lista.filter(t => !idsGrupo.has(t.id));
    resto.splice(primerIdx, 0, ...grupo);

    db.exec('BEGIN');
    try {
      const setCombi = db.prepare('UPDATE turnos SET combinacion_id = ? WHERE id = ?');
      unicos.forEach(t => setCombi.run(combinacionId, t.id));
      const setOrden = db.prepare('UPDATE turnos SET orden_cola = ? WHERE id = ?');
      resto.forEach((t, i) => setOrden.run(ordenValores[i], t.id));
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      return res.status(500).json({ error: 'No se pudo combinar' });
    }

    console.log(`[COMBINAR] combinacion=${combinacionId} turnos=${[...idsGrupo].join(',')} personas=${personas}/${maximo}`);
    io.emit('turno:reordenado', { atraccion_id: base.atraccion_id });
    res.json({ ok: true, combinacion_id: combinacionId, personas });
  });

  // ── Separar una combinación (vuelven a ser grupos sueltos) ──────────────────
  router.put('/:id/descombinar', requireAuth('admin', 'recepcion'), requirePermission('permiso_llamar_turno'), (req, res) => {
    const turno = db.prepare("SELECT * FROM turnos WHERE id = ? AND estado = 'esperando'").get(Number(req.params.id));
    if (!turno?.combinacion_id) return res.status(400).json({ error: 'El grupo no está combinado' });

    db.prepare("UPDATE turnos SET combinacion_id = NULL WHERE combinacion_id = ? AND atraccion_id = ? AND estado = 'esperando'")
      .run(turno.combinacion_id, turno.atraccion_id);

    io.emit('turno:reordenado', { atraccion_id: turno.atraccion_id });
    res.json({ ok: true });
  });

  router.put('/:id/mover', requireAuth('admin', 'recepcion'), (req, res) => {
    const { id } = req.params;
    const { direccion } = req.body;

    if (!['subir', 'bajar'].includes(direccion)) {
      return res.status(400).json({ error: 'direccion debe ser "subir" o "bajar"' });
    }

    let pasos = parseInt(req.body.pasos, 10);
    if (!Number.isFinite(pasos) || pasos < 1) pasos = 1;

    const turnoA = db.prepare(
      "SELECT * FROM turnos WHERE id = ? AND estado = 'esperando'"
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

    // Una combinación se mueve entera, como un solo bloque.
    const idsBloque = new Set([turnoA.id, ..._companerosEnEspera(turnoA).map(c => c.id)]);
    const idx = lista.findIndex(t => idsBloque.has(t.id));
    if (idx === -1) {
      return res.status(400).json({ error: 'No se pudo ubicar el turno en la cola' });
    }

    // Se conserva el conjunto de valores de orden_cola; solo se reordena
    // qué turno ocupa cada posición dentro de ese conjunto.
    const ordenValores = lista.map(t => t.orden_cola);
    const bloque = lista.filter(t => idsBloque.has(t.id));
    const resto  = lista.filter(t => !idsBloque.has(t.id));

    let nuevoIdx = direccion === 'subir' ? idx - pasos : idx + pasos;
    nuevoIdx = Math.max(0, Math.min(resto.length, nuevoIdx));

    if (nuevoIdx === idx) {
      return res.status(400).json({ error: 'No se puede mover en esa dirección' });
    }

    resto.splice(nuevoIdx, 0, ...bloque);
    lista.splice(0, lista.length, ...resto);

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

  // ── No Llegó: el turno vuelve a "esperando", al final de la cola ─────────────
  // No se cierra ni desaparece — puede volver a ser llamado las veces que haga
  // falta. Conserva atracción, subcategoría, cantidad de miembros, biper y VIPER.
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

    const juego = db.prepare(
      'SELECT usa_etapas FROM atracciones WHERE id = ?'
    ).get(turnoActual.atraccion_id);

    let primeraEtapa = null;
    if (juego?.usa_etapas) {
      primeraEtapa = db.prepare(`
        SELECT * FROM juego_etapas
        WHERE juego_id = ? AND activa = 1
        ORDER BY orden ASC LIMIT 1
      `).get(turnoActual.atraccion_id);
    }

    // Va al final de la cola de espera de su atracción (misma regla que usa
    // /mover: toda la cola de la atracción, sin distinguir subcategoría).
    const { maxOrden } = db.prepare(
      "SELECT COALESCE(MAX(orden_cola), 0) AS maxOrden FROM turnos WHERE atraccion_id = ? AND estado = 'esperando'"
    ).get(turnoActual.atraccion_id);

    // La combinación vuelve entera a la cola, junta y todavía combinada: se
    // la vuelve a llamar como un solo grupo.
    [turnoActual, ..._acompanantes(turnoActual)].forEach((t, i) => {
      if (timerLlamado.has(t.id)) { clearTimeout(timerLlamado.get(t.id)); timerLlamado.delete(t.id); }

      // Descartar el progreso de etapa del intento abandonado (si lo hubo) —
      // el turno vuelve a arrancar desde la primera etapa, igual que al crearse.
      db.prepare(
        'DELETE FROM turno_etapas_historial WHERE turno_id = ? AND finalizada_at IS NULL'
      ).run(t.id);

      db.prepare(`
        UPDATE turnos
        SET estado = 'esperando', called_at = NULL, jugando_desde = NULL,
            llamado_por = NULL, etapa_actual_id = ?, orden_cola = ?
        WHERE id = ?
      `).run(primeraEtapa?.id ?? null, maxOrden + 1 + i, t.id);

      if (primeraEtapa) {
        db.prepare(`
          INSERT INTO turno_etapas_historial (turno_id, etapa_id, etapa_nombre, etapa_orden)
          VALUES (?,?,?,?)
        `).run(t.id, primeraEtapa.id, primeraEtapa.nombre, primeraEtapa.orden);
      }
    });

    // La etapa quedó libre: el siguiente en espera puede entrar.
    _programarLlamadoAutomatico(turnoActual.atraccion_id);

    const turno = conEtapaSig(db.prepare(SELECT_TURNO).get(Number(id)));
    io.emit('turno:reordenado', { atraccion_id: turnoActual.atraccion_id });
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
