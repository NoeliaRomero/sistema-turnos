const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth('admin'));

// Bug 1: excluir superadmin de la lista que ve el admin
router.get('/', (req, res) => {
  const usuarios = db.prepare(`
    SELECT u.id, u.nombre, u.username, u.rol, u.atraccion_id, u.activo,
           u.permiso_gestionar_juegos, u.permiso_cancelar_turno, u.permiso_llamar_turno, u.created_at,
           a.nombre AS atraccion_nombre
    FROM usuarios u
    LEFT JOIN atracciones a ON u.atraccion_id = a.id
    WHERE u.rol != 'superadmin'
    ORDER BY u.rol, u.nombre
  `).all();
  res.json(usuarios);
});

const ROLES_VALIDOS = ['admin','operador','recepcion'];

router.post('/', (req, res) => {
  const { nombre, username, password, rol, atraccion_id,
          permiso_gestionar_juegos, permiso_cancelar_turno, permiso_llamar_turno } = req.body;

  if (!nombre?.trim() || !username?.trim() || !password || !rol) {
    return res.status(400).json({ error: 'Todos los campos son requeridos' });
  }
  if (!ROLES_VALIDOS.includes(rol)) {
    return res.status(400).json({ error: 'Rol inválido' });
  }
  const dup = db.prepare("SELECT id FROM usuarios WHERE username = ?").get(username.trim());
  if (dup) return res.status(409).json({ error: 'El nombre de usuario ya existe' });

  const hash   = bcrypt.hashSync(password, 10);
  const result = db.prepare(`
    INSERT INTO usuarios
      (nombre, username, password_hash, rol, atraccion_id,
       permiso_gestionar_juegos, permiso_cancelar_turno, permiso_llamar_turno)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(
    nombre.trim(), username.trim(), hash, rol,
    atraccion_id || null,
    permiso_gestionar_juegos ? 1 : 0,
    permiso_cancelar_turno   ? 1 : 0,
    permiso_llamar_turno     ? 1 : 0
  );
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { nombre, username, password, rol, atraccion_id, activo,
          permiso_gestionar_juegos, permiso_cancelar_turno, permiso_llamar_turno } = req.body;

  if (!nombre?.trim() || !username?.trim() || !rol) {
    return res.status(400).json({ error: 'Nombre, usuario y rol son requeridos' });
  }

  // Bug 1: admin no puede editar al superadmin
  const target = db.prepare("SELECT rol FROM usuarios WHERE id=?").get(id);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (target.rol === 'superadmin') return res.status(403).json({ error: 'No autorizado' });

  const dup = db.prepare("SELECT id FROM usuarios WHERE username=? AND id!=?").get(username.trim(), id);
  if (dup) return res.status(409).json({ error: 'El nombre de usuario ya existe' });

  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(`UPDATE usuarios SET nombre=?,username=?,password_hash=?,rol=?,atraccion_id=?,
                activo=?,permiso_gestionar_juegos=?,permiso_cancelar_turno=?,permiso_llamar_turno=? WHERE id=?`)
      .run(nombre.trim(), username.trim(), hash, rol, atraccion_id||null,
           activo??1, permiso_gestionar_juegos?1:0, permiso_cancelar_turno?1:0, permiso_llamar_turno?1:0, id);
  } else {
    db.prepare(`UPDATE usuarios SET nombre=?,username=?,rol=?,atraccion_id=?,
                activo=?,permiso_gestionar_juegos=?,permiso_cancelar_turno=?,permiso_llamar_turno=? WHERE id=?`)
      .run(nombre.trim(), username.trim(), rol, atraccion_id||null,
           activo??1, permiso_gestionar_juegos?1:0, permiso_cancelar_turno?1:0, permiso_llamar_turno?1:0, id);
  }
  res.json({ ok: true });
});

// Bug 11: eliminación real si no hay historial, desactivación si tiene historial
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const user = db.prepare("SELECT rol, activo FROM usuarios WHERE id=?").get(id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  // Bug 1: admin no puede eliminar al superadmin
  if (user.rol === 'superadmin') return res.status(403).json({ error: 'No autorizado' });

  if (user.rol === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) AS c FROM usuarios WHERE rol='admin' AND activo=1").get();
    if (admins.c <= 1) return res.status(400).json({ error: 'No se puede eliminar el único administrador' });
  }

  // Verificar si el usuario tiene historial en turnos
  const historial = db.prepare(
    "SELECT COUNT(*) AS c FROM turnos WHERE llamado_por=? OR finalizado_por=?"
  ).get(id, id);

  if (historial.c > 0) {
    // Tiene historial: solo desactivar para preservar integridad referencial
    db.prepare("UPDATE usuarios SET activo=0 WHERE id=?").run(id);
    return res.json({ ok: true, accion: 'desactivado', razon: 'tiene_historial' });
  }

  // Sin historial: eliminar permanentemente
  db.prepare("DELETE FROM usuarios WHERE id=?").run(id);
  res.json({ ok: true, accion: 'eliminado' });
});

module.exports = router;
