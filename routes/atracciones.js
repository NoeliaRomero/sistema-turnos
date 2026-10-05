const express = require('express');
const db      = require('../db/database');
const { requireAuth, requirePermission } = require('../middleware/auth');

module.exports = (io) => {
const router  = express.Router();

function recalcularDuracion(juegoId) {
  const { total } = db.prepare(
    'SELECT COALESCE(SUM(duracion_minutos), 0) AS total FROM juego_etapas WHERE juego_id = ?'
  ).get(juegoId);
  db.prepare('UPDATE atracciones SET duracion_minutos = ? WHERE id = ?').run(total, juegoId);
  return total;
}

function etapasDeJuego(juegoId) {
  return db.prepare(
    'SELECT id, nombre, duracion_minutos, orden, activa FROM juego_etapas WHERE juego_id = ? ORDER BY orden'
  ).all(juegoId);
}

// Turnos en curso ('llamado'/'jugando') parados en alguna etapa del juego.
// Devuelve [{ etapa_id, etapa_nombre, c }] agrupado por etapa.
function etapasOcupadas(juegoId) {
  return db.prepare(`
    SELECT t.etapa_actual_id AS etapa_id, e.nombre AS etapa_nombre, COUNT(*) AS c
    FROM turnos t
    LEFT JOIN juego_etapas e ON e.id = t.etapa_actual_id
    WHERE t.atraccion_id = ? AND t.estado IN ('llamado','jugando') AND t.etapa_actual_id IS NOT NULL
    GROUP BY t.etapa_actual_id
  `).all(juegoId);
}

// Valida (sin escribir nada) que la nueva lista de etapas no deje grupos en
// curso sin su etapa. Devuelve un mensaje de error o null.
function validarEtapas(juegoId, usaEtapas, etapasArr) {
  const ocupadas = etapasOcupadas(juegoId);
  if (ocupadas.length === 0) return null;

  if (!usaEtapas) {
    return 'No se pueden desactivar las etapas: hay grupos en curso en una etapa de este juego. Finalizalos primero.';
  }

  const existentes  = new Set(etapasDeJuego(juegoId).map(e => e.id));
  const idsEnviados = new Set(
    etapasArr.map(e => Number(e.id)).filter(id => id && existentes.has(id))
  );
  const quitada = ocupadas.find(o => !idsEnviados.has(o.etapa_id));
  if (quitada) {
    return `No se puede quitar la etapa "${quitada.etapa_nombre || quitada.etapa_id}": hay grupos en ella. Finalizalos o esperá a que avancen.`;
  }
  return null;
}

// Igual que guardarSubcategorias/guardarVueltas: actualiza por id (editar el
// juego conserva los ids de las etapas, así los turnos en curso no pierden su
// etapa_actual_id), inserta las nuevas y borra las que ya no vinieron.
// Asume que validarEtapas() ya pasó (ninguna etapa borrada tiene grupos en curso).
function guardarEtapas(juegoId, usaEtapas, etapasArr) {
  const existentes = etapasDeJuego(juegoId);
  const idsExist   = new Set(existentes.map(e => e.id));
  const lista      = usaEtapas ? etapasArr : [];

  // Un id que no pertenece a este juego se trata como etapa nueva
  const idsEnviados = new Set(
    lista.map(e => Number(e.id)).filter(id => id && idsExist.has(id))
  );
  const borradas = existentes.filter(e => !idsEnviados.has(e.id)).map(e => e.id);

  borradas.forEach(id => db.prepare('DELETE FROM juego_etapas WHERE id = ?').run(id));

  lista.forEach((e, i) => {
    const id       = Number(e.id);
    const nombre   = e.nombre.trim();
    const duracion = parseInt(e.duracion_minutos) || 1;
    const activa   = e.activa == null ? 1 : (Number(e.activa) ? 1 : 0);
    if (id && idsExist.has(id)) {
      db.prepare('UPDATE juego_etapas SET nombre = ?, duracion_minutos = ?, orden = ?, activa = ? WHERE id = ? AND juego_id = ?')
        .run(nombre, duracion, i + 1, activa, id, juegoId);
      // Las filas pendientes (aún no iniciadas) del historial reflejan el nombre/orden nuevo
      db.prepare('UPDATE turno_etapas_historial SET etapa_nombre = ?, etapa_orden = ? WHERE etapa_id = ? AND iniciada_at IS NULL')
        .run(nombre, i + 1, id);
    } else {
      db.prepare('INSERT INTO juego_etapas (juego_id, nombre, duracion_minutos, orden, activa) VALUES (?,?,?,?,?)')
        .run(juegoId, nombre, duracion, i + 1, activa);
    }
  });

  if (borradas.length === 0) return;

  // Turnos en espera parados en una etapa borrada: se reasignan a la primera
  // etapa activa del juego (igual que al crear el turno) o quedan sin etapa.
  const primeraEtapa = usaEtapas ? db.prepare(`
    SELECT * FROM juego_etapas
    WHERE juego_id = ? AND activa = 1
    ORDER BY orden ASC LIMIT 1
  `).get(juegoId) : null;

  const marcadores = borradas.map(() => '?').join(',');
  const huerfanos = db.prepare(
    `SELECT id FROM turnos WHERE atraccion_id = ? AND estado = 'esperando' AND etapa_actual_id IN (${marcadores})`
  ).all(juegoId, ...borradas);

  huerfanos.forEach(t => {
    db.prepare('DELETE FROM turno_etapas_historial WHERE turno_id = ? AND iniciada_at IS NULL').run(t.id);
    db.prepare('UPDATE turnos SET etapa_actual_id = ? WHERE id = ?').run(primeraEtapa?.id ?? null, t.id);
    if (primeraEtapa) {
      db.prepare(`
        INSERT INTO turno_etapas_historial (turno_id, etapa_id, etapa_nombre, etapa_orden)
        VALUES (?,?,?,?)
      `).run(t.id, primeraEtapa.id, primeraEtapa.nombre, primeraEtapa.orden);
    }
  });
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

function vueltasDeJuego(juegoId) {
  return db.prepare(
    'SELECT id, cantidad, orden FROM juego_vueltas WHERE juego_id = ? ORDER BY orden'
  ).all(juegoId);
}

// Normaliza y valida la lista de vueltas enviada por el editor.
// Acepta objetos { id?, cantidad } (o números sueltos). Devuelve { lista } o { error }.
function normalizarVueltas(vueltasArr) {
  const lista = [];
  for (const v of vueltasArr) {
    const esObj = v && typeof v === 'object';
    const n     = Number(esObj ? v.cantidad : v);
    if (!Number.isInteger(n) || n <= 0) {
      return { error: 'Las vueltas deben ser números enteros mayores a cero' };
    }
    if (lista.some(x => x.cantidad === n)) {
      return { error: `La cantidad de vueltas ${n} está repetida` };
    }
    lista.push({ id: esObj && v.id ? Number(v.id) : null, cantidad: n });
  }
  return { lista };
}

// Igual que guardarSubcategorias: actualiza por id (editar una opción conserva
// su id), inserta las nuevas y borra las que ya no vinieron. Los turnos guardan
// el VALOR de vueltas (no una FK), así que borrar opciones no afecta el historial.
function guardarVueltas(juegoId, lista) {
  const existentes  = vueltasDeJuego(juegoId);
  const idsEnviados = lista.filter(v => v.id).map(v => v.id);

  existentes.forEach(v => {
    if (!idsEnviados.includes(v.id)) {
      db.prepare('DELETE FROM juego_vueltas WHERE id = ?').run(v.id);
    }
  });

  lista.forEach((v, i) => {
    if (v.id) {
      db.prepare('UPDATE juego_vueltas SET cantidad = ?, orden = ? WHERE id = ? AND juego_id = ?')
        .run(v.cantidad, i + 1, v.id, juegoId);
    } else {
      db.prepare('INSERT INTO juego_vueltas (juego_id, cantidad, orden) VALUES (?,?,?)')
        .run(juegoId, v.cantidad, i + 1);
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
    vueltas:       j.usa_vueltas       ? vueltasDeJuego(j.id)       : [],
  }));
  res.json(result);
});

// Listar subcategorias de un juego
router.get('/:id/subcategorias', requireAuth('admin', 'operador', 'recepcion'), (req, res) => {
  res.json(subcategoriasDeJuego(Number(req.params.id)));
});

// Listar opciones de vueltas de un juego
router.get('/:id/vueltas', requireAuth('admin', 'operador', 'recepcion'), (req, res) => {
  res.json(vueltasDeJuego(Number(req.params.id)));
});

// Crear juego
router.post('/', requirePermission('permiso_gestionar_juegos'), (req, res) => {
  const { nombre, duracion_minutos, min_miembros, max_miembros,
          usa_etapas, etapas, usa_subcategorias, subcategorias,
          usa_vueltas, vueltas,
          llamado_automatico, tiempo_entre_llamados_segundos } = req.body;
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

  const usaVueltas = usa_vueltas ? 1 : 0;
  let vueltasLista = [];
  if (usaVueltas) {
    const norm = normalizarVueltas(Array.isArray(vueltas) ? vueltas : []);
    if (norm.error) return res.status(400).json({ error: norm.error });
    if (norm.lista.length === 0) {
      return res.status(400).json({ error: 'Debe agregar al menos una opción de vueltas' });
    }
    vueltasLista = norm.lista;
  }

  const minM     = parseInt(min_miembros) || 1;
  const maxM     = parseInt(max_miembros) || 20;
  const duracion = usaEtapas ? 0 : (parseInt(duracion_minutos) || 30);

  // Llamado automático: apagado por defecto; si se activa, requiere un tiempo
  // entre llamados entero y mayor a cero (misma validación que otros campos numéricos).
  const llamadoAutomatico = llamado_automatico ? 1 : 0;
  let tiempoEntreLlamados = null;
  if (llamadoAutomatico) {
    tiempoEntreLlamados = parseInt(tiempo_entre_llamados_segundos, 10);
    if (!Number.isInteger(tiempoEntreLlamados) || tiempoEntreLlamados <= 0) {
      return res.status(400).json({ error: 'El tiempo entre llamados debe ser un número entero mayor a cero.' });
    }
  }

  const result = db.prepare(
    'INSERT INTO atracciones (nombre, duracion_minutos, min_miembros, max_miembros, usa_etapas, usa_subcategorias, usa_vueltas, llamado_automatico, tiempo_entre_llamados_segundos) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(nombre.trim(), duracion, minM, maxM, usaEtapas, usaSubs, usaVueltas, llamadoAutomatico, tiempoEntreLlamados);

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

  if (usaVueltas) guardarVueltas(juegoId, vueltasLista);

  const juego = db.prepare('SELECT * FROM atracciones WHERE id = ?').get(juegoId);
  io.emit('juego:actualizado', { accion: 'creado', id: juegoId });
  res.status(201).json({
    ...juego,
    etapas:        usaEtapas ? etapasDeJuego(juegoId)        : [],
    subcategorias: usaSubs   ? subcategoriasDeJuego(juegoId) : [],
    vueltas:       usaVueltas ? vueltasDeJuego(juegoId)      : [],
  });
});

// Editar juego
router.put('/:id', requirePermission('permiso_gestionar_juegos'), (req, res) => {
  const { nombre, duracion_minutos, activa, min_miembros, max_miembros,
          usa_etapas, etapas, usa_subcategorias, subcategorias,
          usa_vueltas, vueltas,
          llamado_automatico, tiempo_entre_llamados_segundos } = req.body;
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

  const usaVueltas = usa_vueltas ? 1 : 0;
  let vueltasLista = [];
  if (usaVueltas) {
    const norm = normalizarVueltas(Array.isArray(vueltas) ? vueltas : []);
    if (norm.error) return res.status(400).json({ error: norm.error });
    if (norm.lista.length === 0) {
      return res.status(400).json({ error: 'Debe agregar al menos una opción de vueltas' });
    }
    vueltasLista = norm.lista;
  }

  const minM     = parseInt(min_miembros) || 1;
  const maxM     = parseInt(max_miembros) || 20;
  const duracion = usaEtapas ? 0 : (parseInt(duracion_minutos) || 30);

  // Llamado automático: apagado por defecto; si se activa, requiere un tiempo
  // entre llamados entero y mayor a cero (misma validación que otros campos numéricos).
  const llamadoAutomatico = llamado_automatico ? 1 : 0;
  let tiempoEntreLlamados = null;
  if (llamadoAutomatico) {
    tiempoEntreLlamados = parseInt(tiempo_entre_llamados_segundos, 10);
    if (!Number.isInteger(tiempoEntreLlamados) || tiempoEntreLlamados <= 0) {
      return res.status(400).json({ error: 'El tiempo entre llamados debe ser un número entero mayor a cero.' });
    }
  }

  const juegoId = Number(req.params.id);

  if (usaEtapas && etapasArr.some(e => typeof e?.nombre !== 'string' || !e.nombre.trim())) {
    return res.status(400).json({ error: 'Todas las etapas deben tener nombre' });
  }

  // Se valida ANTES de escribir: el guardado es todo o nada
  const errorEtapas = validarEtapas(juegoId, usaEtapas, etapasArr);
  if (errorEtapas) return res.status(400).json({ error: errorEtapas });

  db.exec('BEGIN');
  try {
    db.prepare("UPDATE atracciones SET nombre=?, duracion_minutos=?, activa=?, min_miembros=?, max_miembros=?, usa_etapas=?, usa_subcategorias=?, usa_vueltas=?, llamado_automatico=?, tiempo_entre_llamados_segundos=? WHERE id=?")
      .run(nombre.trim(), duracion, activa == null ? 1 : (Number(activa) ? 1 : 0), minM, maxM, usaEtapas, usaSubs, usaVueltas, llamadoAutomatico, tiempoEntreLlamados, juegoId);

    guardarEtapas(juegoId, usaEtapas, etapasArr);
    if (usaEtapas) recalcularDuracion(juegoId);

    if (usaSubs) {
      guardarSubcategorias(juegoId, subsArr);
    } else {
      db.prepare("UPDATE turnos SET subcategoria_id = NULL WHERE atraccion_id = ? AND subcategoria_id IS NOT NULL").run(juegoId);
      db.prepare("DELETE FROM juego_subcategorias WHERE juego_id = ?").run(juegoId);
    }

    // Los turnos conservan su valor de vueltas aunque cambien/desaparezcan las opciones
    if (usaVueltas) {
      guardarVueltas(juegoId, vueltasLista);
    } else {
      db.prepare("DELETE FROM juego_vueltas WHERE juego_id = ?").run(juegoId);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('[JUEGOS] Error al guardar juego:', e);
    return res.status(500).json({ error: 'No se pudo guardar el juego' });
  }

  io.emit('juego:actualizado', { accion: 'editado', id: Number(req.params.id) });
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
  db.prepare('DELETE FROM juego_vueltas WHERE juego_id = ?').run(id);
  db.prepare('DELETE FROM atracciones WHERE id = ?').run(id);

  io.emit('juego:actualizado', { accion: 'eliminado', id });
  res.json({ ok: true });
});

return router;
};
