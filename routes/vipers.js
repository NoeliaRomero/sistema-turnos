const express = require('express');
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const serialService = require('../server/services/serialService');

module.exports = (io) => {
  const router = express.Router();

  // Apodo opcional del beeper: recortado, máx. 30 caracteres, vacío → NULL
  const normalizarApodo = valor => {
    const apodo = typeof valor === 'string' ? valor.trim().slice(0, 30) : '';
    return apodo || null;
  };

  // Listar todos los VIPERs (sin exponer el RAW completo)
  router.get('/', requireAuth('admin'), (req, res) => {
    const vipers = db.prepare(`
      SELECT id, codigo_viper, apodo, codigo_rf, canal, activo, estado, baudrate, fecha_validacion, ultimo_test, ultimo_error,
             CASE WHEN codigo_raw IS NOT NULL AND codigo_raw != '' THEN 1 ELSE 0 END AS tiene_codigo
      FROM vipers ORDER BY id
    `).all();
    res.json(vipers);
  });

  // VIPERs disponibles para asociar a un turno: únicamente los ACTIVOS
  router.get('/activos', requireAuth('admin', 'recepcion', 'operador'), (req, res) => {
    res.json(db.prepare("SELECT id, codigo_viper, apodo FROM vipers WHERE estado = 'ACTIVO' ORDER BY COALESCE(apodo, codigo_viper)").all());
  });

  // Ver el código RAW completo de un VIPER
  router.get('/:id/codigo', requireAuth('admin'), (req, res) => {
    const viper = db.prepare('SELECT codigo_raw FROM vipers WHERE id = ?').get(req.params.id);
    if (!viper) return res.status(404).json({ error: 'Beeper no encontrado' });
    res.json({ codigo_raw: viper.codigo_raw || null });
  });

  // Crear VIPER (estado inicial: PENDIENTE)
  router.post('/', requireAuth('admin'), (req, res) => {
    const codigo = req.body.codigo_viper?.trim();
    if (!codigo) return res.status(400).json({ error: 'El código del beeper es requerido' });

    const dup = db.prepare('SELECT id FROM vipers WHERE codigo_viper = ? COLLATE NOCASE').get(codigo);
    if (dup) return res.status(409).json({ error: 'Ya existe un beeper con ese código' });

    const apodo = normalizarApodo(req.body.apodo);
    const result = db.prepare(
      "INSERT INTO vipers (codigo_viper, apodo, activo, estado, fecha_creacion) VALUES (?, ?, 0, 'PENDIENTE', datetime('now','localtime'))"
    ).run(codigo, apodo);
    serialService.registrarEvento({ viperId: Number(result.lastInsertRowid), usuario: req.session.usuario, accion: 'CREAR_VIPER', resultado: 'OK' });
    res.status(201).json({ id: Number(result.lastInsertRowid), codigo_viper: codigo, apodo, activo: 0, estado: 'PENDIENTE' });
  });

  // Compatibilidad: activar manualmente sin pasar por validación física
  router.put('/:id/activar', requireAuth('admin'), (req, res) => {
    const viper = db.prepare('SELECT * FROM vipers WHERE id = ?').get(req.params.id);
    if (!viper) return res.status(404).json({ error: 'Beeper no encontrado' });

    db.prepare("UPDATE vipers SET activo = 1, estado = 'ACTIVO', ultima_activacion = datetime('now','localtime') WHERE id = ?").run(req.params.id);
    serialService.registrarEvento({ viperId: viper.id, usuario: req.session.usuario, accion: 'ACTIVAR_VIPER', resultado: 'OK' });
    res.json({ ok: true });
  });

  // Enviar el código del beeper al Arduino. El Arduino no responde: si el
  // puerto abre y la escritura se completa, el beeper queda ACTIVO.
  router.post('/:id/enviar-senal', requireAuth('admin'), async (req, res) => {
    const viper = db.prepare('SELECT id, codigo_viper FROM vipers WHERE id = ?').get(req.params.id);
    if (!viper) return res.status(404).json({ error: 'Beeper no encontrado' });

    const mensaje = req.body.mensaje?.trim() || viper.codigo_viper;
    try {
      await serialService.enviarSenal(viper.id, mensaje, io);
      serialService.registrarEvento({ viperId: viper.id, usuario: req.session.usuario, accion: 'ENVIAR_SENAL', resultado: 'OK', ackEstado: 'ENTREGADO' });
      res.json({ ok: true });
    } catch (err) {
      serialService.registrarEvento({ viperId: viper.id, usuario: req.session.usuario, accion: 'ENVIAR_SENAL', resultado: 'ERROR', ackEstado: 'ERROR', detalle: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  // Editar VIPER (código, apodo, código RF, canal, estado)
  router.put('/:id', requireAuth('admin'), (req, res) => {
    const viper = db.prepare('SELECT * FROM vipers WHERE id = ?').get(req.params.id);
    if (!viper) return res.status(404).json({ error: 'Beeper no encontrado' });

    const codigo = req.body.codigo_viper?.trim();
    if (!codigo) return res.status(400).json({ error: 'El código del beeper es requerido' });

    const estadosValidos = ['PENDIENTE', 'VALIDANDO', 'ACTIVO', 'ERROR'];
    const estado = req.body.estado?.trim() || viper.estado;
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    const dup = db.prepare('SELECT id FROM vipers WHERE codigo_viper = ? COLLATE NOCASE AND id != ?')
      .get(codigo, viper.id);
    if (dup) return res.status(409).json({ error: 'Ya existe un beeper con ese código' });

    // Si el formulario no envía código RF, se conserva el que ya tenía.
    const codigoRf = req.body.codigo_rf !== undefined ? (req.body.codigo_rf?.trim() || null) : viper.codigo_rf;
    const canal = parseInt(req.body.canal) || viper.canal || 1;

    db.prepare(`
      UPDATE vipers
      SET codigo_viper = ?, apodo = ?, codigo_rf = ?, canal = ?, estado = ?, activo = ?
      WHERE id = ?
    `).run(codigo, normalizarApodo(req.body.apodo), codigoRf, canal, estado, estado === 'ACTIVO' ? 1 : 0, viper.id);

    serialService.registrarEvento({ viperId: viper.id, usuario: req.session.usuario, accion: 'EDITAR_VIPER', resultado: 'OK' });
    res.json({ ok: true });
  });

  // Eliminar VIPER
  router.delete('/:id', requireAuth('admin'), (req, res) => {
    const viper = db.prepare('SELECT * FROM vipers WHERE id = ?').get(req.params.id);
    if (!viper) return res.status(404).json({ error: 'Beeper no encontrado' });

    serialService.registrarEvento({ viperId: null, usuario: req.session.usuario, accion: 'ELIMINAR_VIPER', resultado: 'OK', detalle: viper.codigo_viper });
    db.prepare('UPDATE turnos SET viper_id = NULL WHERE viper_id = ?').run(viper.id);
    db.prepare('UPDATE viper_eventos SET viper_id = NULL WHERE viper_id = ?').run(viper.id);
    db.prepare('DELETE FROM vipers WHERE id = ?').run(viper.id);
    res.json({ ok: true });
  });

  // ── Configuración RF ─────────────────────────────────────────────────────
  router.get('/rf-config', requireAuth('admin'), (req, res) => {
    res.json(db.prepare('SELECT * FROM configuracion_rf WHERE id = 1').get());
  });

  router.post('/rf-config', requireAuth('admin'), (req, res) => {
    const { frecuencia, canal, retransmisiones, intervalo_ms } = req.body;
    if (!frecuencia?.trim()) return res.status(400).json({ error: 'La frecuencia RF es requerida' });

    db.prepare(`
      UPDATE configuracion_rf
      SET frecuencia = ?, canal = ?, retransmisiones = ?, intervalo_ms = ?
      WHERE id = 1
    `).run(frecuencia.trim(), parseInt(canal) || 1, parseInt(retransmisiones) || 3, parseInt(intervalo_ms) || 100);

    serialService.registrarEvento({ usuario: req.session.usuario, accion: 'GUARDAR_CONFIG_RF', resultado: 'OK' });
    res.json({ ok: true });
  });

  // ── Diagnóstico / herramientas ───────────────────────────────────────────
  // El Arduino no responde a comandos: el estado se determina por la presencia
  // del puerto configurado y por poder abrirlo, nunca esperando una respuesta.
  router.get('/estado-arduino', requireAuth('admin'), async (req, res) => {
    res.json(await serialService.getEstadoArduino(io));
  });

  router.post('/ping', requireAuth('admin'), async (req, res) => {
    try {
      const resultado = await serialService.probarConexion(io);
      serialService.registrarEvento({ usuario: req.session.usuario, accion: 'PROBAR_CONEXION', resultado: 'OK', detalle: resultado.mensaje });
      res.json({ ok: true, ...resultado });
    } catch (err) {
      serialService.registrarEvento({ usuario: req.session.usuario, accion: 'PROBAR_CONEXION', resultado: 'ERROR', detalle: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  // ── Historial de eventos ─────────────────────────────────────────────────
  router.get('/eventos', requireAuth('admin'), (req, res) => {
    const { fecha, usuario, viper_id, estado } = req.query;
    const condiciones = [];
    const params = [];

    if (fecha)    { condiciones.push("date(e.created_at) = ?"); params.push(fecha); }
    if (usuario)  { condiciones.push("e.usuario_nombre LIKE ?"); params.push(`%${usuario}%`); }
    if (viper_id) { condiciones.push("e.viper_id = ?"); params.push(viper_id); }
    if (estado)   { condiciones.push("e.resultado = ?"); params.push(estado); }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    const eventos = db.prepare(`
      SELECT e.id, e.created_at, e.usuario_nombre, e.accion, e.resultado, e.ack_estado, e.detalle,
             v.codigo_viper, v.apodo
      FROM viper_eventos e
      LEFT JOIN vipers v ON v.id = e.viper_id
      ${where}
      ORDER BY e.id DESC
      LIMIT 200
    `).all(...params);
    res.json(eventos);
  });

  return router;
};
