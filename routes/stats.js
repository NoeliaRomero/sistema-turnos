const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth('admin', 'superadmin'));
router.use((req, res, next) => {
  if (req.session.usuario.rol === 'admin' && !req.session.usuario.feature_graficos) {
    return res.status(403).json({ error: 'Tu plan no incluye acceso a estadísticas' });
  }
  next();
});

function whereClause(periodo, alias = '') {
  const col = alias ? `${alias}.created_at` : 'created_at';
  switch (periodo) {
    case 'hoy':    return `DATE(${col}) = DATE('now','localtime')`;
    case 'semana': return `${col} >= datetime('now','localtime','-7 days')`;
    case 'mes':    return `${col} >= datetime('now','localtime','-30 days')`;
    default:       return '1=1';
  }
}

router.get('/', (req, res) => {
  const periodo = ['hoy','semana','mes','todo'].includes(req.query.periodo)
    ? req.query.periodo : 'hoy';
  const wSimple = whereClause(periodo);
  const wT      = whereClause(periodo, 't');

  const resumen = db.prepare(`
    SELECT
      COUNT(*)                                                    AS total,
      SUM(CASE WHEN estado='finalizado' THEN 1 ELSE 0 END)       AS finalizados,
      SUM(CASE WHEN estado='esperando'  THEN 1 ELSE 0 END)       AS en_espera,
      SUM(CASE WHEN estado IN ('llamado','jugando') THEN 1 ELSE 0 END) AS llamados,
      SUM(CASE WHEN estado IN ('cancelado','no_llego') THEN 1 ELSE 0 END) AS cancelados
    FROM turnos WHERE ${wSimple}
  `).get();

  const tiempos = db.prepare(`
    SELECT
      ROUND(AVG(CASE WHEN called_at IS NOT NULL
        THEN (julianday(called_at) - julianday(created_at)) * 1440 END), 1) AS prom_espera,
      ROUND(AVG(CASE WHEN finished_at IS NOT NULL AND estado='finalizado'
        THEN (julianday(finished_at) - julianday(called_at)) * 1440 END), 1) AS prom_servicio
    FROM turnos WHERE ${wSimple}
  `).get();

  const porAtraccion = db.prepare(`
    SELECT a.nombre, COUNT(*) AS total
    FROM turnos t
    JOIN atracciones a ON t.atraccion_id = a.id
    WHERE ${wT} AND t.estado != 'cancelado'
    GROUP BY a.id ORDER BY total DESC
  `).all();

  const porDia = db.prepare(`
    SELECT DATE(created_at) AS dia, COUNT(*) AS total
    FROM turnos
    GROUP BY dia ORDER BY dia DESC LIMIT 30
  `).all().reverse();

  const porHora = db.prepare(`
    SELECT strftime('%H', created_at) AS hora, COUNT(*) AS total
    FROM turnos WHERE ${wSimple}
    GROUP BY hora ORDER BY hora
  `).all();

  // Turnos creados por usuario (mide productividad de Recepción)
  const creadosPorOp = db.prepare(`
    SELECT u.nombre, COUNT(*) AS total
    FROM turnos t
    JOIN usuarios u ON t.creado_por = u.id
    WHERE t.creado_por IS NOT NULL AND ${wT}
    GROUP BY u.id ORDER BY total DESC
  `).all();

  const finalizadosPorOp = db.prepare(`
    SELECT u.nombre, COUNT(*) AS total
    FROM turnos t
    JOIN usuarios u ON t.finalizado_por = u.id
    WHERE t.finalizado_por IS NOT NULL AND ${wT}
    GROUP BY u.id ORDER BY total DESC
  `).all();

  // Bug 10: incluir operadores Y recepcionistas, excluir admin/superadmin
  // Agregar: tiempo_total, cantidad_movimientos
  const tablaOperadores = db.prepare(`
    SELECT
      u.id,
      u.nombre,
      u.rol,
      a.nombre AS atraccion,
      COALESCE(cr.total, 0)      AS creados,
      COALESCE(ll.total, 0)      AS llamados,
      COALESCE(fi.total, 0)      AS finalizados,
      COALESCE(tp.promedio, 0)   AS tiempo_promedio,
      COALESCE(tt.total_min, 0)  AS tiempo_total,
      (COALESCE(cr.total, 0) + COALESCE(fi.total, 0)) AS movimientos
    FROM usuarios u
    LEFT JOIN atracciones a ON u.atraccion_id = a.id
    LEFT JOIN (
      SELECT creado_por, COUNT(*) AS total
      FROM turnos WHERE creado_por IS NOT NULL AND ${wSimple}
      GROUP BY creado_por
    ) cr ON cr.creado_por = u.id
    LEFT JOIN (
      -- Llamados manuales (el llamado automático queda con llamado_por NULL).
      -- Un grupo combinado se llama de una vez: cuenta como un llamado.
      SELECT llamado_por,
             COUNT(DISTINCT COALESCE('c' || combinacion_id, 't' || id)) AS total
      FROM turnos WHERE llamado_por IS NOT NULL AND ${wSimple}
      GROUP BY llamado_por
    ) ll ON ll.llamado_por = u.id
    LEFT JOIN (
      SELECT finalizado_por, COUNT(*) AS total
      FROM turnos WHERE finalizado_por IS NOT NULL AND ${wSimple}
      GROUP BY finalizado_por
    ) fi ON fi.finalizado_por = u.id
    LEFT JOIN (
      SELECT finalizado_por,
             ROUND(AVG((julianday(finished_at)-julianday(called_at))*1440),1) AS promedio
      FROM turnos
      WHERE finished_at IS NOT NULL AND finalizado_por IS NOT NULL AND ${wSimple}
      GROUP BY finalizado_por
    ) tp ON tp.finalizado_por = u.id
    LEFT JOIN (
      SELECT finalizado_por,
             ROUND(SUM((julianday(finished_at)-julianday(called_at))*1440),1) AS total_min
      FROM turnos
      WHERE finished_at IS NOT NULL AND finalizado_por IS NOT NULL AND ${wSimple}
      GROUP BY finalizado_por
    ) tt ON tt.finalizado_por = u.id
    WHERE u.rol IN ('operador', 'recepcion') AND u.activo = 1
    ORDER BY u.rol, u.nombre
  `).all();

  // Demora acumulada por operador: minutos que cada turno (o cada etapa, en
  // juegos con etapas) siguió corriendo después de su duración configurada,
  // cargados a quien lo finalizó. Se calcula sobre los datos existentes, así
  // que también cubre el historial previo. Los turnos de un grupo combinado se
  // cierran juntos: se cuenta una sola vez por grupo (y etapa), no por turno.
  // Cancelaciones y la limpieza diaria (finalizado_por NULL) no suman demora.
  //
  // En juegos con etapas un grupo no puede avanzar si la etapa siguiente está
  // ocupada por otro grupo: ese tiempo de espera se descuenta, porque no es
  // culpa de quien atiende la etapa actual (la demora del grupo que ocupa la
  // etapa siguiente ya se le carga a su propio operador).
  const demoras = db.prepare(`
    WITH etapas AS (
      SELECT h.id AS hid, h.turno_id, h.etapa_id, h.finalizada_por,
             t.combinacion_id,
             COALESCE('c' || t.combinacion_id, 't' || t.id) AS grupo,
             julianday(COALESCE(h.iniciada_at, t.jugando_desde, t.called_at))
               + e.duracion_minutos / 1440.0 AS limite,
             julianday(h.finalizada_at) AS fin,
             (SELECT h2.etapa_id FROM turno_etapas_historial h2
              WHERE h2.turno_id = h.turno_id AND h2.etapa_orden > h.etapa_orden
              ORDER BY h2.etapa_orden LIMIT 1) AS etapa_sig_id
      FROM turno_etapas_historial h
      JOIN turnos t       ON t.id = h.turno_id
      JOIN juego_etapas e ON e.id = h.etapa_id
      WHERE h.finalizada_por IS NOT NULL AND h.finalizada_at IS NOT NULL
        AND COALESCE(h.iniciada_at, t.jugando_desde, t.called_at) IS NOT NULL
        -- La etapa que se cerró al cancelar el turno no es una finalización
        AND NOT (t.estado != 'finalizado' AND h.finalizada_at = t.finished_at)
        AND ${wT}
    ),
    -- Otros grupos que ocuparon la etapa siguiente mientras esta etapa estaba
    -- demorada. Los turnos de un mismo grupo combinado se unen en un intervalo.
    ocupaciones AS (
      SELECT et.hid, et.limite, et.fin,
             MIN(julianday(h2.iniciada_at)) AS desde,
             MAX(julianday(COALESCE(h2.finalizada_at, datetime('now','localtime')))) AS hasta
      FROM etapas et
      JOIN turno_etapas_historial h2 ON h2.etapa_id = et.etapa_sig_id AND h2.turno_id != et.turno_id
      JOIN turnos t2 ON t2.id = h2.turno_id
      WHERE et.fin > et.limite
        AND h2.iniciada_at IS NOT NULL
        AND (et.combinacion_id IS NULL OR t2.combinacion_id IS NOT et.combinacion_id)
        AND julianday(h2.iniciada_at) < et.fin
        AND julianday(COALESCE(h2.finalizada_at, datetime('now','localtime'))) > et.limite
      GROUP BY et.hid, COALESCE('c' || t2.combinacion_id, 't' || t2.id)
    ),
    bloqueos AS (
      SELECT hid, SUM(MAX(0, MIN(hasta, fin) - MAX(desde, limite))) * 1440 AS bloqueado
      FROM ocupaciones GROUP BY hid
    ),
    excesos AS (
      SELECT t.finalizado_por AS usuario_id,
             COALESCE('c' || t.combinacion_id, 't' || t.id) AS grupo,
             0 AS etapa_id,
             (julianday(t.finished_at) - julianday(COALESCE(t.jugando_desde, t.called_at))) * 1440
               - a.duracion_minutos AS exceso
      FROM turnos t
      JOIN atracciones a ON a.id = t.atraccion_id
      WHERE t.estado = 'finalizado' AND t.finalizado_por IS NOT NULL
        AND t.finished_at IS NOT NULL AND COALESCE(t.jugando_desde, t.called_at) IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM turno_etapas_historial h WHERE h.turno_id = t.id)
        AND ${wT}
      UNION ALL
      SELECT et.finalizada_por, et.grupo, et.etapa_id,
             (et.fin - et.limite) * 1440 - COALESCE(b.bloqueado, 0)
      FROM etapas et
      LEFT JOIN bloqueos b ON b.hid = et.hid
    )
    SELECT usuario_id,
           ROUND(SUM(exceso), 1) AS demora_total,
           COUNT(*)              AS turnos_demorados
    FROM (
      SELECT usuario_id, grupo, etapa_id, MAX(exceso) AS exceso
      FROM excesos GROUP BY usuario_id, grupo, etapa_id
    )
    WHERE exceso > 0
    GROUP BY usuario_id
  `).all();
  const demoraPorUsuario = new Map(demoras.map(d => [d.usuario_id, d]));
  tablaOperadores.forEach(op => {
    const d = demoraPorUsuario.get(op.id);
    op.demora_total     = d ? d.demora_total : 0;
    op.turnos_demorados = d ? d.turnos_demorados : 0;
  });

  res.json({
    resumen:    { ...resumen, ...tiempos },
    porAtraccion,
    porDia,
    porHora,
    creadosPorOp,
    finalizadosPorOp,
    tablaOperadores
  });
});

module.exports = router;
