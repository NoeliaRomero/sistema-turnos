'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth('admin'), (req, res) => {
  const cfg = db.prepare('SELECT * FROM configuracion_general WHERE id = 1').get();
  res.json(cfg || { admin_puede_configurar_red: 1 });
});

// Solo superadmin puede cambiar el permiso de red para admin
router.put('/permiso-red', requireAuth('superadmin'), (req, res) => {
  const { admin_puede_configurar_red } = req.body;
  db.prepare(
    'UPDATE configuracion_general SET admin_puede_configurar_red = ? WHERE id = 1'
  ).run(admin_puede_configurar_red ? 1 : 0);
  res.json({ ok: true });
});

module.exports = router;
