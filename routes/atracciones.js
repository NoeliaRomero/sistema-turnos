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

function subcategoriasDeJuego(juegoId) {
  return db.prepare(
    'SELECT id, nombre, orden FROM juego_subcategorias WHERE juego_id = ? ORDER BY orden'
  ).all(juegoId);
}

function guardarSubcategorias(juegoId, subcategoriasArr) {
  const existentes   = subcategoriasDeJuego(juegoId);
  const idsEnviados  = subcategoriasArr.filter(s => s.id).map(s => Number(s.id));

  existentes.forEach(s => {
    if (!idsEnviados.includes(s.id)) {
      db.prepare("UPDATE turnos SET subcategoria_id = NULL WHERE subcategoria_id = ?").run(s.id);
      db.prepare("DELETE FROM juego_subcategorias WHERE id = ?").run(s.id);
    }
  });

  subcategoriasArr.forEach((s, i) => {
    if (s.id) {
      db.prepare("UPDATE juego_subcategorias SET nombre = ?, orden = ? WHERE id = ? AND juego_id = ?")
        .run(s.nombre.trim(), i + 1, Number(s.id), juegoId);
    } else {
      db.prepare("INSERT INTO juego_subcategorias (juego_id, nombre, orden) VALUES (?,?,?)")
        .run(juegoId, s.nombre.trim(), i + 1);
    }
  });
}

// Listar activas
router.get('/', requireAuth('admin', 'operador', 'recepcion'), (req, res) => {
  res.json(db.prepare('SELECT * FROM atracciones WHERE activa = 1 ORDER BY nombre').all());
});

// Listar todas incluidas inactivas
router.get('/todas', requirePermission('permiso_gestionar_juegos'), (req, res) => {
  const juegos = db.prepare('SELECT * FROM atracciones ORDER BY nombre').all();
  const result = juegos.map(j => ({
    ...j,
    etapas:        j.usa_etapas        ? etapasDeJuego(j.id)        : [],
    subcategorias: j.usa_subcategorias ? subcategoriasDeJuego(j.id) : [],
  }));
  res.json(result);
});

// Listar subcategorias de un juego
router.get('/:id/subcategorias', requireAuth('admin', 'operador', 'recepcion'), (req, res) => {
  res.json(subcategoriasDeJuego(Number(req.params.id)));
});

// Crear juego
router.post('/', requirePermission('permiso_gestionar_juegos'), (req, res) => {
  const { nombre, duracion_minutos, min_miembros, max_miembros,
          usa_etapas, etapas, usa_subcategorias, subcategorias } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es requerido' });

  const dup = db.prepare("SELECT id FROM atracciones WHERE nombre = ? COLLATE NOCASE").get(nombre.trim());
  if (dup) return res.status(409).json({ error: 'Ya existe un juego con ese nombre' });

  const usaEtapas = usa_etapas ? 1 : 0;
  const etapasArr = Array.isArray(etapas) ? etapas : [];
  const usaSubs   = usa_subcategorias ? 1 : 0;
  const subsArr   = Array.isArray(subcategorias) ? subcategorias : [];

  if (usaEtapas && etapasArr.length === 0) {
    return res.status(400).json({ error: 'Debe agregar al menos una etapa' });
  }
  if (usaSubs && subsArr.length === 0) {
    return res.status(400).json({ error: 'Debe agregar al menos una subcategoría' });
  }

  const minM     = parseInt(min_miembros) || 1;
  const maxM     = parseInt(max_miembros) || 20;
  const duracion = usaEtapas ? 0 : (parseInt(duracion_minutos) || 30);

  const result = db.prepare(
    'INSERT INTO atracciones (nombre, duracion_minutos, min_miembros, max_miembros, usa_etapas, usa_subcategorias) VALUES (?,?,?,?,?,?)'
  ).run(nombre.trim(), duracion, minM, maxM, usaEtapas, usaSubs);

  const juegoId = Number(result.lastInsertRowid);

  if (usaEtapas) {
    const insertEtapa = db.prepare(
      'INSERT INTO juego_etapas (juego_id, nombre, duracion_minutos, orden, activa) VALUES (?,?,?,?,?)'
    );
    etapasArr.forEach((e, i) => insertEtapa.run(juegoId, e.nombre.trim(), parseInt(e.duracion_minutos) || 1, i + 1, e.activa == null ? 1 : (Number(e.activa) ? 1 : 0)));
    recalcularDuracion(juegoId);
  }

  if (usaSubs) {
    const insertSub = db.prepare('INSERT INTO juego_subcategorias (juego_id, nombre, orden) VALUES (?,?,?)');
    subsArr.forEach((s, i) => insertSub.run(juegoId, s.nombre.trim(), i + 1));
  }

  const juego = db.prepare('SELECT * FROM atracciones WHERE id = ?').get(juegoId);
  res.status(201).json({
    ...juego,
    etapas:        usaEtapas ? etapasDeJuego(juegoId)        : [],
    subcategorias: usaSubs   ? subcategoriasDeJuego(juegoId) : [],
  });
});

// Editar juego
router.put('/:id', requirePermission('permiso_gestionar_juegos'), (req, res) => {
  const { nombre, duracion_minutos, activa, min_miembros, max_miembros,
          usa_etapas, etapas, usa_subcategorias, subcategorias } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es requerido' });

  const dup = db.prepare("SELECT id FROM atracciones WHERE nombre = ? COLLATE NOCASE AND id != ?")
    .get(nombre.trim(), req.params.id);
  if (dup) return res.status(409).json({ error: 'Ya existe un juego con ese nombre' });

  const usaEtapas = usa_etapas ? 1 : 0;
  const etapasArr = Array.isArray(etapas) ? etapas : [];
  const usaSubs   = usa_subcategorias ? 1 : 0;
  const subsArr   = Array.isArray(subcategorias) ? subcategorias : [];

  if (usaEtapas && etapasArr.length === 0) {
    return res.status(400).json({ error: 'Debe agregar al menos una etapa' });
  }
  if (usaSubs && subsArr.length === 0) {
    return res.status(400).json({ error: 'Debe agregar al menos una subcategoría' });
  }

  const minM     = parseInt(min_miembros) || 1;
  const maxM     = parseInt(max_miembros) || 20;
  const duracion = usaEtapas ? 0 : (parseInt(duracion_minutos) || 30);

  db.prepare("UPDATE atracciones SET nombre=?, duracion_minutos=?, activa=?, min_miembros=?, max_miembros=?, usa_etapas=?, usa_subcategorias=? WHERE id=?")
    .run(nombre.trim(), duracion, activa == null ? 1 : (Number(activa) ? 1 : 0), minM, maxM, usaEtapas, usaSubs, req.params.id);

  db.prepare('DELETE FROM juego_etapas WHERE juego_id = ?').run(req.params.id);
  if (usaEtapas) {
    const insertEtapa = db.prepare(
      'INSERT INTO juego_etapas (juego_id, nombre, duracion_minutos, orden, activa) VALUES (?,?,?,?,?)'
    );
    etapasArr.forEach((e, i) => insertEtapa.run(req.params.id, e.nombre.trim(), parseInt(e.duracion_minutos) || 1, i + 1, e.activa == null ? 1 : (Number(e.activa) ? 1 : 0)));
    recalcularDuracion(req.params.id);
  }

  if (usaSubs) {
    guardarSubcategorias(Number(req.params.id), subsArr);
  } else {
    db.prepare("UPDATE turnos SET subcategoria_id = NULL WHERE atraccion_id = ? AND subcategoria_id IS NOT NULL").run(req.params.id);
    db.prepare("DELETE FROM juego_subcategorias WHERE juego_id = ?").run(req.params.id);
  }

  res.json({ ok: true });
});

// Eliminar juego (con validación de turnos activos)
router.delete('/:id', requirePermission('permiso_gestionar_juegos'), (req, res) => {
  const id = Number(req.params.id);

  const juego = db.prepare('SELECT id, nombre FROM atracciones WHERE id = ?').get(id);
  if (!juego) return res.status(404).json({ error: 'Juego no encontrado' });

  const activos = db.prepare(
    "SELECT COUNT(*) AS c FROM turnos WHERE atraccion_id = ? AND estado IN ('esperando','llamado','jugando')"
  ).get(id).c;
  if (activos > 0) {
    return res.status(409).json({
      error: `No se puede eliminar "${juego.nombre}" porque tiene ${activos} turno${activos > 1 ? 's' : ''} activo${activos > 1 ? 's' : ''} (en espera o en juego). Finalizalos primero.`,
    });
  }

  db.prepare(
    'DELETE FROM turno_etapas_historial WHERE turno_id IN (SELECT id FROM turnos WHERE atraccion_id = ?)'
  ).run(id);
  db.prepare('DELETE FROM turnos WHERE atraccion_id = ?').run(id);
  db.prepare('UPDATE usuarios SET atraccion_id = NULL WHERE atraccion_id = ?').run(id);
  db.prepare('DELETE FROM juego_etapas WHERE juego_id = ?').run(id);
  db.prepare('DELETE FROM juego_subcategorias WHERE juego_id = ?').run(id);
  db.prepare('DELETE FROM atracciones WHERE id = ?').run(id);

  res.json({ ok: true });
});

module.exports = router;
