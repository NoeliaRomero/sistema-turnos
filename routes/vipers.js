const express = require('express');
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const serialService = require('../server/services/serialService');

module.exports = (io) => {
  const router = express.Router();

  // Listar todos los VIPERs (sin exponer el RAW completo)
  router.get('/', requireAuth('admin'), (req, res) => {
    const vipers = db.prepare(`
      SELECT id, codigo_viper, activo, estado, baudrate, fecha_validacion, ultimo_test, ultimo_error,
             CASE WHEN codigo_raw IS NOT NULL AND codigo_raw != '' THEN 1 ELSE 0 END AS tiene_codigo
      FROM vipers ORDER BY id
    `).all();
    res.json(vipers);
  });

  // VIPERs disponibles para asociar a un turno: únicamente los ACTIVOS
  router.get('/activos', requireAuth('admin', 'recepcion', 'operador'), (req, res) => {
    res.json(db.prepare("SELECT id, codigo_viper FROM vipers WHERE estado = 'ACTIVO' ORDER BY codigo_viper").all());
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

    const result = db.prepare(
      "INSERT INTO vipers (codigo_viper, activo, estado, fecha_creacion) VALUES (?, 0, 'PENDIENTE', datetime('now','localtime'))"
    ).run(codigo);
    serialService.registrarEvento({ viperId: Number(result.lastInsertRowid), usuario: req.session.usuario, accion: 'CREAR_VIPER', resultado: 'OK' });
    res.status(201).json({ id: Number(result.lastInsertRowid), codigo_viper: codigo, activo: 0, estado: 'PENDIENTE' });
  });

  // Compatibilidad: activar manualmente sin pasar por validación física
  router.put('/:id/activar', requireAuth('admin'), (req, res) => {
    const viper = db.prepare('SELECT * FROM vipers WHERE id = ?').get(req.params.id);
    if (!viper) return res.status(404).json({ error: 'Beeper no encontrado' });

    db.prepare("UPDATE vipers SET activo = 1, estado = 'ACTIVO', ultima_activacion = datetime('now','localtime') WHERE id = ?").run(req.params.id);
    serialService.registrarEvento({ viperId: viper.id, usuario: req.session.usuario, accion: 'ACTIVAR_VIPER', resultado: 'OK' });
    res.json({ ok: true });
  });

  // Enviar señal de prueba/activación al Arduino (inicia validación física)
  router.post('/:id/enviar-senal', requireAuth('admin'), async (req, res) => {
    const mensaje = req.body.mensaje?.trim() || 'READY_PARA_TEST_DE_CABLE';
    try {
      await serialService.enviarSenal(Number(req.params.id), mensaje, io);
      serialService.registrarEvento({ viperId: Number(req.params.id), usuario: req.session.usuario, accion: 'ENVIAR_SENAL', resultado: 'ENTREGADO', ackEstado: 'ENTREGADO', detalle: mensaje });
      res.json({ ok: true });
    } catch (err) {
      serialService.registrarEvento({ viperId: Number(req.params.id), usuario: req.session.usuario, accion: 'ENVIAR_SENAL', resultado: 'ERROR', ackEstado: 'ERROR', detalle: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  // Editar VIPER (código, código RF, canal, estado)
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

    const codigoRf = req.body.codigo_rf?.trim() || null;
    const canal = parseInt(req.body.canal) || viper.canal || 1;

    db.prepare(`
      UPDATE vipers
      SET codigo_viper = ?, codigo_rf = ?, canal = ?, estado = ?, activo = ?
      WHERE id = ?
    `).run(codigo, codigoRf, canal, estado, estado === 'ACTIVO' ? 1 : 0, viper.id);

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
  // El estado se determina con una prueba real PING/PONG contra el Arduino,
  // nunca sólo a partir de la configuración guardada o del puerto abierto.
  router.get('/estado-arduino', requireAuth('admin'), async (req, res) => {
    res.json(await serialService.getEstadoArduino(io));
  });

  router.post('/ping', requireAuth('admin'), async (req, res) => {
    try {
      await serialService.ping(io);
      serialService.registrarEvento({ usuario: req.session.usuario, accion: 'PROBAR_CONEXION', resultado: 'OK' });
      res.json({ ok: true, mensaje: 'Conexión correcta' });
    } catch (err) {
      serialService.registrarEvento({ usuario: req.session.usuario, accion: 'PROBAR_CONEXION', resultado: 'ERROR', detalle: err.message });
      res.status(400).json({ error: 'Error de comunicación', detalle: err.message });
    }
  });

  router.post('/reiniciar-arduino', requireAuth('admin'), async (req, res) => {
    try {
      await serialService.reiniciarArduino(io);
      serialService.registrarEvento({ usuario: req.session.usuario, accion: 'REINICIAR_ARDUINO', resultado: 'OK' });
      res.json({ ok: true });
    } catch (err) {
      serialService.registrarEvento({ usuario: req.session.usuario, accion: 'REINICIAR_ARDUINO', resultado: 'ERROR', detalle: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/leer-configuracion', requireAuth('admin'), async (req, res) => {
    try {
      const configuracion = await serialService.leerConfiguracionActual(io);
      serialService.registrarEvento({ usuario: req.session.usuario, accion: 'LEER_CONFIGURACION', resultado: 'OK' });
      res.json({ configuracion });
    } catch (err) {
      serialService.registrarEvento({ usuario: req.session.usuario, accion: 'LEER_CONFIGURACION', resultado: 'ERROR', detalle: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  // ── Aprendizaje de códigos VIPER ──────────────────────────────────────────
  router.post('/aprender', requireAuth('admin'), async (req, res) => {
    try {
      const codigo = await serialService.aprenderCodigo(io);
      serialService.registrarEvento({ usuario: req.session.usuario, accion: 'APRENDER_CODIGO', resultado: 'OK', detalle: codigo });
      res.json({ ok: true, codigo });
    } catch (err) {
      serialService.registrarEvento({ usuario: req.session.usuario, accion: 'APRENDER_CODIGO', resultado: 'ERROR', detalle: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  // Asocia un código RF aprendido a un VIPER existente
  router.put('/:id/codigo-rf', requireAuth('admin'), (req, res) => {
    const viper = db.prepare('SELECT * FROM vipers WHERE id = ?').get(req.params.id);
    if (!viper) return res.status(404).json({ error: 'Beeper no encontrado' });

    const codigoRf = req.body.codigo_rf?.trim();
    if (!codigoRf) return res.status(400).json({ error: 'El código RF es requerido' });

    db.prepare("UPDATE vipers SET codigo_rf = ?, canal = ? WHERE id = ?")
      .run(codigoRf, parseInt(req.body.canal) || viper.canal || 1, viper.id);

    serialService.registrarEvento({ viperId: viper.id, usuario: req.session.usuario, accion: 'ASOCIAR_CODIGO_RF', resultado: 'OK', detalle: codigoRf });
    res.json({ ok: true });
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
             v.codigo_viper
      FROM viper_eventos e
      LEFT JOIN vipers v ON v.id = e.viper_id
      ${where}
      ORDER BY e.id DESC
      LIMIT 200
    `).all(...params);
    res.json(eventos);
  });

  // ── Métricas del sistema ─────────────────────────────────────────────────
  router.get('/metricas', requireAuth('admin'), (req, res) => {
    const registrados = db.prepare('SELECT COUNT(*) AS c FROM vipers').get().c;
    const activos      = db.prepare("SELECT COUNT(*) AS c FROM vipers WHERE estado = 'ACTIVO'").get().c;
    const llamadasHoy   = db.prepare(`
      SELECT COUNT(*) AS c FROM turnos
      WHERE viper_id IS NOT NULL AND date(called_at) = date('now','localtime')
    `).get().c;
    const llamadasMes   = db.prepare(`
      SELECT COUNT(*) AS c FROM turnos
      WHERE viper_id IS NOT NULL AND strftime('%Y-%m', called_at) = strftime('%Y-%m', 'now','localtime')
    `).get().c;
    const ultimoActivado = db.prepare(`
      SELECT codigo_viper, ultima_activacion FROM vipers
      WHERE ultima_activacion IS NOT NULL ORDER BY ultima_activacion DESC LIMIT 1
    `).get();
    const totalEventos = db.prepare("SELECT COUNT(*) AS c FROM viper_eventos WHERE accion IN ('ENVIAR_SENAL','PROBAR_CONEXION')").get().c;
    const eventosOk     = db.prepare("SELECT COUNT(*) AS c FROM viper_eventos WHERE accion IN ('ENVIAR_SENAL','PROBAR_CONEXION') AND resultado IN ('OK','ENTREGADO')").get().c;
    const tasaExito = totalEventos > 0 ? Math.round((eventosOk / totalEventos) * 1000) / 10 : null;

    res.json({
      vipers_registrados: registrados,
      vipers_activos: activos,
      llamadas_hoy: llamadasHoy,
      llamadas_mes: llamadasMes,
      ultimo_viper_activado: ultimoActivado?.codigo_viper || null,
      ultima_activacion: ultimoActivado?.ultima_activacion || null,
      tasa_exito: tasaExito,
    });
  });

  return router;
};
