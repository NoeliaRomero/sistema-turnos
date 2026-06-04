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

  const llamadosPorOp = db.prepare(`
    SELECT u.nombre, COUNT(*) AS total
    FROM turnos t
    JOIN usuarios u ON t.llamado_por = u.id
    WHERE t.llamado_por IS NOT NULL AND ${wT}
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
      u.nombre,
      u.rol,
      a.nombre AS atraccion,
      COALESCE(ll.total, 0)      AS llamados,
      COALESCE(fi.total, 0)      AS finalizados,
      COALESCE(tp.promedio, 0)   AS tiempo_promedio,
      COALESCE(tt.total_min, 0)  AS tiempo_total,
      (COALESCE(ll.total, 0) + COALESCE(fi.total, 0)) AS movimientos
    FROM usuarios u
    LEFT JOIN atracciones a ON u.atraccion_id = a.id
    LEFT JOIN (
      SELECT llamado_por, COUNT(*) AS total
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

  res.json({
    resumen:    { ...resumen, ...tiempos },
    porAtraccion,
    porDia,
    porHora,
    llamadosPorOp,
    finalizadosPorOp,
    tablaOperadores
  });
});

module.exports = router;
