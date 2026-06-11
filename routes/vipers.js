const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');

// Listar todos los VIPERs
router.get('/', requireAuth('admin'), (req, res) => {
  res.json(db.prepare('SELECT * FROM vipers ORDER BY id').all());
});

// Crear VIPER
router.post('/', requireAuth('admin'), (req, res) => {
  const codigo = req.body.codigo_viper?.trim();
  if (!codigo) return res.status(400).json({ error: 'El código VIPER es requerido' });

  const dup = db.prepare('SELECT id FROM vipers WHERE codigo_viper = ? COLLATE NOCASE').get(codigo);
  if (dup) return res.status(409).json({ error: 'Ya existe un VIPER con ese código' });

  const result = db.prepare('INSERT INTO vipers (codigo_viper, activo) VALUES (?, 0)').run(codigo);
  res.status(201).json({ id: Number(result.lastInsertRowid), codigo_viper: codigo, activo: 0 });
});

// Enviar señal de activación
router.put('/:id/activar', requireAuth('admin'), (req, res) => {
  const viper = db.prepare('SELECT * FROM vipers WHERE id = ?').get(req.params.id);
  if (!viper) return res.status(404).json({ error: 'VIPER no encontrado' });

  db.prepare('UPDATE vipers SET activo = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
