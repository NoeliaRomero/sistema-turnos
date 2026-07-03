const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { requireAuth, requirePermission } = require('../middleware/auth');

function recalcularDuracion(juegoId) {
  const { total } = db.prepare(
    'SELECT COALESCE(SUM(duracion_minutos), 0) AS total FROM juego_etapas WHERE juego_id = ?'
  ).get(juegoId);
  db.prepare('UPDATE atracciones SET duracion_minutos = ? WHERE id = ?').run(total, juegoId);
  return total;
}

function etapasDeJuego(juegoId) {
  return db.prepare(
    'SELECT id, nombre, duracion_minutos, orden FROM juego_etapas WHERE juego_id = ? ORDER BY orden'
  ).all(juegoId);
}

// Listar activas (todos los roles autenticados)
router.get('/', requireAuth('admin', 'operador', 'recepcion'), (req, res) => {
  res.json(db.prepare('SELECT * FROM atracciones WHERE activa = 1 ORDER BY nombre').all());
});

// Listar todas incluidas inactivas (solo con permiso)
router.get('/todas', requirePermission('permiso_gestionar_juegos'), (req, res) => {
  const juegos = db.prepare('SELECT * FROM atracciones ORDER BY nombre').all();
  const result = juegos.map(j => ({
    ...j,
    etapas: j.usa_etapas ? etapasDeJuego(j.id) : [],
  }));
  res.json(result);
});

// Crear juego
router.post('/', requirePermission('permiso_gestionar_juegos'), (req, res) => {
  const { nombre, duracion_minutos, min_miembros, max_miembros, usa_etapas, etapas } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es requerido' });

  const dup = db.prepare("SELECT id FROM atracciones WHERE nombre = ? COLLATE NOCASE").get(nombre.trim());
  if (dup) return res.status(409).json({ error: 'Ya existe un juego con ese nombre' });

  const usaEtapas = usa_etapas ? 1 : 0;
  const etapasArr = Array.isArray(etapas) ? etapas : [];

  if (usaEtapas && etapasArr.length === 0) {
    return res.status(400).json({ error: 'Debe agregar al menos una etapa' });
  }

  const minM = parseInt(min_miembros) || 1;
  const maxM = parseInt(max_miembros) || 20;
  const duracion = usaEtapas ? 0 : (parseInt(duracion_minutos) || 30);

  const result = db.prepare(
    'INSERT INTO atracciones (nombre, duracion_minutos, min_miembros, max_miembros, usa_etapas) VALUES (?,?,?,?,?)'
  ).run(nombre.trim(), duracion, minM, maxM, usaEtapas);

  const juegoId = Number(result.lastInsertRowid);

  if (usaEtapas) {
    const insertEtapa = db.prepare(
      'INSERT INTO juego_etapas (juego_id, nombre, duracion_minutos, orden, activa) VALUES (?,?,?,?,?)'
    );
    etapasArr.forEach((e, i) => insertEtapa.run(juegoId, e.nombre.trim(), parseInt(e.duracion_minutos) || 1, i + 1, e.activa ?? 1));
    recalcularDuracion(juegoId);
  }

  const juego = db.prepare('SELECT * FROM atracciones WHERE id = ?').get(juegoId);
  res.status(201).json({ ...juego, etapas: usaEtapas ? etapasDeJuego(juegoId) : [] });
});

// Editar juego
router.put('/:id', requirePermission('permiso_gestionar_juegos'), (req, res) => {
  const { nombre, duracion_minutos, activa, min_miembros, max_miembros, usa_etapas, etapas } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es requerido' });

  const dup = db.prepare("SELECT id FROM atracciones WHERE nombre = ? COLLATE NOCASE AND id != ?")
    .get(nombre.trim(), req.params.id);
  if (dup) return res.status(409).json({ error: 'Ya existe un juego con ese nombre' });

  const usaEtapas = usa_etapas ? 1 : 0;
  const etapasArr = Array.isArray(etapas) ? etapas : [];

  if (usaEtapas && etapasArr.length === 0) {
    return res.status(400).json({ error: 'Debe agregar al menos una etapa' });
  }

  const minM = parseInt(min_miembros) || 1;
  const maxM = parseInt(max_miembros) || 20;
  const duracion = usaEtapas ? 0 : (parseInt(duracion_minutos) || 30);

  db.prepare("UPDATE atracciones SET nombre=?, duracion_minutos=?, activa=?, min_miembros=?, max_miembros=?, usa_etapas=? WHERE id=?")
    .run(nombre.trim(), duracion, activa ?? 1, minM, maxM, usaEtapas, req.params.id);

  db.prepare('DELETE FROM juego_etapas WHERE juego_id = ?').run(req.params.id);
  if (usaEtapas) {
    const insertEtapa = db.prepare(
      'INSERT INTO juego_etapas (juego_id, nombre, duracion_minutos, orden, activa) VALUES (?,?,?,?,?)'
    );
    etapasArr.forEach((e, i) => insertEtapa.run(req.params.id, e.nombre.trim(), parseInt(e.duracion_minutos) || 1, i + 1, e.activa ?? 1));
    recalcularDuracion(req.params.id);
  }

  res.json({ ok: true });
});

module.exports = router;
