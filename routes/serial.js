const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');
const serialService = require('../server/services/serialService');

router.get('/puertos', requireAuth('admin'), async (req, res) => {
  try {
    res.json(await serialService.listarPuertos());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/config', requireAuth('admin'), (req, res) => {
  res.json(serialService.getConfig());
});

router.post('/config', requireAuth('admin'), (req, res) => {
  const { puerto, baudios } = req.body;
  if (!puerto?.trim()) return res.status(400).json({ error: 'El puerto COM es requerido' });

  serialService.setConfig(puerto.trim(), parseInt(baudios) || 115200);
  res.json({ ok: true });
});

module.exports = router;
