const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth('admin'), (req, res) => {
  const cfg = db.prepare('SELECT * FROM configuracion_general WHERE id = 1').get();
  res.json(cfg || { sincronizar_grupos_combinados: 0 });
});

router.put('/', requireAuth('admin'), (req, res) => {
  const { sincronizar_grupos_combinados } = req.body;
  db.prepare(
    'UPDATE configuracion_general SET sincronizar_grupos_combinados = ? WHERE id = 1'
  ).run(sincronizar_grupos_combinados ? 1 : 0);
  res.json({ ok: true });
});

module.exports = router;
