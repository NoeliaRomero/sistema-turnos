const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { requireAuth, requirePermission } = require('../middleware/auth');

// Listar activas (todos los roles autenticados)
router.get('/', requireAuth('admin', 'operador', 'recepcion'), (req, res) => {
  res.json(db.prepare('SELECT * FROM atracciones WHERE activa = 1 ORDER BY nombre').all());
});

// Listar todas incluidas inactivas (solo con permiso)
router.get('/todas', requirePermission('permiso_gestionar_juegos'), (req, res) => {
  res.json(db.prepare('SELECT * FROM atracciones ORDER BY nombre').all());
});

// Crear juego
router.post('/', requirePermission('permiso_gestionar_juegos'), (req, res) => {
  const { nombre, duracion_minutos, min_miembros, max_miembros } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es requerido' });

  const dup = db.prepare("SELECT id FROM atracciones WHERE nombre = ? COLLATE NOCASE").get(nombre.trim());
  if (dup) return res.status(409).json({ error: 'Ya existe un juego con ese nombre' });

  const minM = parseInt(min_miembros) || 1;
  const maxM = parseInt(max_miembros) || 20;

  const result = db.prepare(
    'INSERT INTO atracciones (nombre, duracion_minutos, min_miembros, max_miembros) VALUES (?,?,?,?)'
  ).run(nombre.trim(), duracion_minutos || 30, minM, maxM);

  res.status(201).json({
    id: Number(result.lastInsertRowid),
    nombre: nombre.trim(),
    duracion_minutos: duracion_minutos || 30,
    min_miembros: minM,
    max_miembros: maxM,
    activa: 1,
  });
});

// Editar juego
router.put('/:id', requirePermission('permiso_gestionar_juegos'), (req, res) => {
  const { nombre, duracion_minutos, activa, min_miembros, max_miembros } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es requerido' });

  const dup = db.prepare("SELECT id FROM atracciones WHERE nombre = ? COLLATE NOCASE AND id != ?").get(nombre.trim(), req.params.id);
  if (dup) return res.status(409).json({ error: 'Ya existe un juego con ese nombre' });

  const minM = parseInt(min_miembros) || 1;
  const maxM = parseInt(max_miembros) || 20;

  db.prepare("UPDATE atracciones SET nombre=?, duracion_minutos=?, activa=?, min_miembros=?, max_miembros=? WHERE id=?")
    .run(nombre.trim(), duracion_minutos || 30, activa ?? 1, minM, maxM, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
