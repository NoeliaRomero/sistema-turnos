const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth('superadmin'));

// ── Listar admins con sus features ────────────────────────────────────────────
router.get('/admins', (req, res) => {
  const admins = db.prepare(`
    SELECT id, nombre, username, activo,
           feature_graficos, feature_juegos, feature_cancelar_turno, feature_llamar_turno
    FROM usuarios
    WHERE rol = 'admin'
    ORDER BY nombre ASC
  `).all();
  res.json(admins);
});

// ── Actualizar features de un admin ──────────────────────────────────────────
router.put('/admins/:id/features', (req, res) => {
  const { feature_graficos, feature_juegos, feature_cancelar_turno, feature_llamar_turno } = req.body;
  const result = db.prepare(`
    UPDATE usuarios
    SET feature_graficos       = ?,
        feature_juegos         = ?,
        feature_cancelar_turno = ?,
        feature_llamar_turno   = ?
    WHERE id = ? AND rol = 'admin'
  `).run(
    feature_graficos       ? 1 : 0,
    feature_juegos         ? 1 : 0,
    feature_cancelar_turno ? 1 : 0,
    feature_llamar_turno   ? 1 : 0,
    req.params.id
  );

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Admin no encontrado' });
  }
  res.json({ ok: true });
});

module.exports = router;
