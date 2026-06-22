const express = require('express');
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const serialService = require('../server/services/serialService');

module.exports = (io) => {
  const router = express.Router();

  // Listar todos los VIPERs (sin exponer el RAW completo)
  router.get('/', requireAuth('admin'), (req, res) => {
    const vipers = db.prepare(`
      SELECT id, codigo_viper, activo, estado, baudrate, fecha_validacion, ultimo_test, ultimo_error,
             CASE WHEN codigo_raw IS NOT NULL AND codigo_raw != '' THEN 1 ELSE 0 END AS tiene_codigo
      FROM vipers ORDER BY id
    `).all();
    res.json(vipers);
  });

  // VIPERs disponibles para asociar a un turno: únicamente los ACTIVOS
  router.get('/activos', requireAuth('admin', 'recepcion', 'operador'), (req, res) => {
    res.json(db.prepare("SELECT id, codigo_viper FROM vipers WHERE estado = 'ACTIVO' ORDER BY codigo_viper").all());
  });

  // Ver el código RAW completo de un VIPER
  router.get('/:id/codigo', requireAuth('admin'), (req, res) => {
    const viper = db.prepare('SELECT codigo_raw FROM vipers WHERE id = ?').get(req.params.id);
    if (!viper) return res.status(404).json({ error: 'VIPER no encontrado' });
    res.json({ codigo_raw: viper.codigo_raw || null });
  });

  // Crear VIPER (estado inicial: PENDIENTE)
  router.post('/', requireAuth('admin'), (req, res) => {
    const codigo = req.body.codigo_viper?.trim();
    if (!codigo) return res.status(400).json({ error: 'El código VIPER es requerido' });

    const dup = db.prepare('SELECT id FROM vipers WHERE codigo_viper = ? COLLATE NOCASE').get(codigo);
    if (dup) return res.status(409).json({ error: 'Ya existe un VIPER con ese código' });

    const result = db.prepare(
      "INSERT INTO vipers (codigo_viper, activo, estado) VALUES (?, 0, 'PENDIENTE')"
    ).run(codigo);
    res.status(201).json({ id: Number(result.lastInsertRowid), codigo_viper: codigo, activo: 0, estado: 'PENDIENTE' });
  });

  // Compatibilidad: activar manualmente sin pasar por validación física
  router.put('/:id/activar', requireAuth('admin'), (req, res) => {
    const viper = db.prepare('SELECT * FROM vipers WHERE id = ?').get(req.params.id);
    if (!viper) return res.status(404).json({ error: 'VIPER no encontrado' });

    db.prepare("UPDATE vipers SET activo = 1, estado = 'ACTIVO' WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // Enviar señal de prueba/activación al Arduino (inicia validación física)
  router.post('/:id/enviar-senal', requireAuth('admin'), async (req, res) => {
    const mensaje = req.body.mensaje?.trim() || 'READY_PARA_TEST_DE_CABLE';
    try {
      await serialService.enviarSenal(Number(req.params.id), mensaje, io);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
};
