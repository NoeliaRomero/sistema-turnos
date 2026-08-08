const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const db      = require('../db/database');

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  const user = db.prepare(
    "SELECT * FROM usuarios WHERE username = ? AND activo = 1"
  ).get(username.trim());

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }

  const esAdmin      = user.rol === 'admin';
  const esOperador   = user.rol === 'operador';
  const esSuperadmin = user.rol === 'superadmin';

  req.session.usuario = {
    id:                      user.id,
    nombre:                  user.nombre,
    username:                user.username,
    rol:                     user.rol,
    atraccion_id:            user.atraccion_id,
    permiso_gestionar_juegos: esAdmin || esSuperadmin ? 1 : (user.permiso_gestionar_juegos || 0),
    permiso_cancelar_turno:   esAdmin || esSuperadmin ? 1 : (user.permiso_cancelar_turno   || 0),
    permiso_llamar_turno:     esAdmin || esOperador || esSuperadmin ? 1 : (user.permiso_llamar_turno || 0),
    // Features controladas por superadmin (solo aplican a rol admin)
    feature_graficos:        esAdmin ? (user.feature_graficos        ?? 1) : 1,
    feature_juegos:          esAdmin ? (user.feature_juegos          ?? 1) : 1,
    feature_cancelar_turno:  esAdmin ? (user.feature_cancelar_turno  ?? 1) : 1,
    feature_llamar_turno:    esAdmin ? (user.feature_llamar_turno    ?? 1) : 1,
  };

  const redirects = {
    superadmin: '/superadmin.html',
    admin:      '/admin.html',
    operador:   '/operador.html',
    recepcion:  '/recepcion.html',
    caja:       '/caja.html',
  };
  res.json({ ok: true, usuario: req.session.usuario, redirect: redirects[user.rol] || '/' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (!req.session?.usuario) return res.status(401).json({ error: 'No autenticado' });
  res.json(req.session.usuario);
});

module.exports = router;
