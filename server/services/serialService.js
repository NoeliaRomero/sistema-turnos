// ── Servicio de comunicación serial con el Arduino (sistema VIPER) ────────────
//
// Responsabilidades: detectar puertos, abrir/cerrar la conexión, enviar
// mensajes y códigos RAW, interpretar las respuestas del Arduino y persistir
// el resultado de la validación física de cada VIPER.

const db = require('../../db/database');

const TIMEOUT_MS = 10000;
const PREFIJO_RAW = 'RAW_CAPTURADO_POR_CABLE:';

let SerialPort, ReadlineParser;
try {
  ({ SerialPort } = require('serialport'));
  ({ ReadlineParser } = require('@serialport/parser-readline'));
} catch (_) {
  // El módulo nativo no está disponible en este entorno (ej. sandbox sin
  // hardware). El servicio queda en modo degradado: informa el error en vez
  // de tirar abajo el servidor.
}

let port         = null;
let parser       = null;
let ioRef        = null;
let pendiente    = null; // { viperId, timer }
let aprendizaje  = null; // { timer, resolve, reject }
let conectadoEn  = null; // Date - cuándo se abrió la conexión actual
let firmwareVer  = null; // versión informada por el Arduino (FIRMWARE:x.y.z)
let ultimaConexion = null; // Date - última vez que se estableció conexión
let ultimaPruebaResultado = null;    // 'Exitosa' | 'Fallida' | null
let ultimaComunicacionExitosa = null; // Date - último PONG/RAW recibido realmente del dispositivo

const PING_STATUS_TIMEOUT_MS = 3000; // timeout corto, sólo para el chequeo de estado (no bloquea la UI)
const PREFIJO_FIRMWARE = 'FIRMWARE:';
const PREFIJO_CONFIG   = 'CONFIG:';
const TIMEOUT_APRENDIZAJE_MS = 15000;

function log(mensaje) {
  console.log(`[SERIAL] ${mensaje}`);
  if (ioRef) ioRef.emit('serial:log', { mensaje: `[SERIAL] ${mensaje}`, ts: Date.now() });
}

// Quita el timestamp que antepone el Monitor Serial de Arduino IDE,
// ej: "20:14:47.200 -> LISTENING"  →  "LISTENING"
function limpiarLinea(linea) {
  return linea.replace(/^\d{1,2}:\d{2}:\d{2}\.\d+\s*->\s*/, '').trim();
}

function getConfig() {
  return db.prepare('SELECT * FROM configuracion_serial WHERE id = 1').get();
}

function setConfig(puerto, baudios) {
  db.prepare('UPDATE configuracion_serial SET puerto = ?, baudios = ? WHERE id = 1')
    .run(puerto, baudios || 115200);
  // Forzar reconexión con la nueva configuración
  desconectar();
}

async function listarPuertos() {
  if (!SerialPort) return [];
  const puertos = await SerialPort.list();
  return puertos.map(p => ({ path: p.path, manufacturer: p.manufacturer || null }));
}

function estaConectado() {
  return !!(port && port.isOpen);
}

function desconectar() {
  if (port && port.isOpen) {
    try { port.close(); } catch (_) {}
  }
  port = null;
  parser = null;
}

function conectar(io) {
  ioRef = io || ioRef;

  if (!SerialPort) {
    throw new Error('El módulo serialport no está disponible en este servidor.');
  }
  if (estaConectado()) return Promise.resolve();

  const cfg = getConfig();
  if (!cfg?.puerto) {
    throw new Error('No hay un puerto COM configurado. Configurelo en Configuraciones del Sistema.');
  }

  return new Promise((resolve, reject) => {
    port = new SerialPort({ path: cfg.puerto, baudRate: cfg.baudios || 115200 }, err => {
      if (err) {
        port = null;
        log(`Error al conectar ${cfg.puerto}: ${err.message}`);
        return reject(err);
      }
      log(`Conectado ${cfg.puerto}`);
      conectadoEn = new Date();
      ultimaConexion = conectadoEn;
      resolve();
    });

    parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
    parser.on('data', manejarLinea);

    port.on('close', () => { log('Puerto cerrado'); conectadoEn = null; });
    port.on('error', e => log(`Error de puerto: ${e.message}`));
  });
}

async function asegurarConexion(io) {
  if (estaConectado()) { ioRef = io || ioRef; return; }
  await conectar(io);
}

function manejarLinea(lineaCruda) {
  const linea = limpiarLinea(lineaCruda);
  if (!linea) return;

  if (linea === 'LISTENING') {
    log('LISTENING recibido');
    return;
  }

  if (linea.startsWith(PREFIJO_RAW)) {
    log('RAW recibido');
    const raw = linea.slice(PREFIJO_RAW.length).trim();
    if (aprendizaje) {
      resolverAprendizaje(raw);
    } else {
      resolverPendiente(raw);
    }
    return;
  }

  if (linea === 'PONG') {
    log('PONG recibido');
    if (pendientePing) { pendientePing.resolve(); pendientePing = null; }
    return;
  }

  if (linea.startsWith(PREFIJO_FIRMWARE)) {
    firmwareVer = linea.slice(PREFIJO_FIRMWARE.length).trim();
    log(`Firmware informado: ${firmwareVer}`);
    return;
  }

  if (linea.startsWith(PREFIJO_CONFIG)) {
    log(`Configuración del dispositivo: ${linea.slice(PREFIJO_CONFIG.length).trim()}`);
    if (pendienteConfig) { pendienteConfig.resolve(linea.slice(PREFIJO_CONFIG.length).trim()); pendienteConfig = null; }
    return;
  }

  // Otros mensajes informativos del Arduino (ej. READY_PARA_TEST_DE_CABLE)
  log(`Recibido: ${linea}`);
}

let pendientePing  = null; // { resolve }
let pendienteConfig = null; // { resolve }

function resolverAprendizaje(raw) {
  if (!aprendizaje) return;
  const { timer, resolve } = aprendizaje;
  clearTimeout(timer);
  aprendizaje = null;
  log('Código RF aprendido');
  resolve(raw);
}

function resolverPendiente(raw) {
  if (!pendiente) return;
  const { viperId, timer } = pendiente;
  clearTimeout(timer);
  pendiente = null;

  const ahora = new Date().toISOString();
  db.prepare(`
    UPDATE vipers
    SET estado = 'ACTIVO', codigo_raw = ?, fecha_validacion = ?, ultimo_error = NULL, ultima_activacion = ?
    WHERE id = ?
  `).run(raw, ahora, ahora, viperId);

  log('Beeper validado');
  log('Código guardado');
  registrarEvento({ viperId, accion: 'VALIDAR_VIPER', resultado: 'OK', ackEstado: 'ENTREGADO' });
  emitirActualizacion(viperId);
}

function emitirActualizacion(viperId) {
  if (!ioRef) return;
  const viper = db.prepare('SELECT id, codigo_viper, estado, baudrate, fecha_validacion, ultimo_test, ultimo_error FROM vipers WHERE id = ?').get(viperId);
  ioRef.emit('viper:actualizado', viper);
}

// Envía un mensaje de prueba al Arduino y espera la captura RAW del VIPER indicado.
async function enviarSenal(viperId, mensaje, io) {
  ioRef = io || ioRef;

  const viper = db.prepare('SELECT * FROM vipers WHERE id = ?').get(viperId);
  if (!viper) throw new Error('Beeper no encontrado');

  if (pendiente) {
    throw new Error('Ya hay una validación en curso. Esperá a que finalice antes de iniciar otra.');
  }

  const ahora = new Date().toISOString();
  db.prepare("UPDATE vipers SET estado = 'VALIDANDO', ultimo_test = ?, ultimo_error = NULL WHERE id = ?")
    .run(ahora, viperId);
  emitirActualizacion(viperId);

  try {
    await asegurarConexion(io);
  } catch (err) {
    marcarError(viperId, err.message);
    throw err;
  }

  pendiente = {
    viperId,
    timer: setTimeout(() => marcarTimeout(viperId), TIMEOUT_MS),
  };

  port.write(mensaje + '\n', err => {
    if (err) {
      marcarError(viperId, err.message);
      return;
    }
    log('Mensaje enviado');
  });
}

function marcarTimeout(viperId) {
  if (pendiente?.viperId !== viperId) return;
  pendiente = null;
  marcarError(viperId, 'No se recibió respuesta del dispositivo.');
}

function marcarError(viperId, mensaje) {
  db.prepare("UPDATE vipers SET estado = 'ERROR', ultimo_error = ? WHERE id = ?").run(mensaje, viperId);
  log(`Error: ${mensaje}`);
  registrarEvento({ viperId, accion: 'VALIDAR_VIPER', resultado: 'ERROR', ackEstado: 'ERROR', detalle: mensaje });
  emitirActualizacion(viperId);
}

// Transmite el código RAW de un VIPER ya activo (usado al llamar un turno).
async function enviarRaw(codigoRaw, io) {
  ioRef = io || ioRef;
  await asegurarConexion(io);
  return new Promise((resolve, reject) => {
    port.write(codigoRaw + '\n', err => {
      if (err) {
        log(`Error al transmitir RAW: ${err.message}`);
        return reject(err);
      }
      log('RAW transmitido');
      log('Transmisión exitosa');
      resolve();
    });
  });
}

// Envía PING y espera PONG del Arduino (prueba de conexión real, no sólo
// estado del puerto). Registra el resultado para el diagnóstico.
async function ping(io, timeoutMs = TIMEOUT_MS) {
  ioRef = io || ioRef;
  try {
    await asegurarConexion(io);
  } catch (err) {
    ultimaPruebaResultado = 'Fallida';
    throw err;
  }
  if (pendientePing) throw new Error('Ya hay una prueba de conexión en curso.');

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendientePing = null;
      ultimaPruebaResultado = 'Fallida';
      reject(new Error('Error de comunicación: no se recibió respuesta del Arduino.'));
    }, timeoutMs);

    pendientePing = {
      resolve: () => {
        clearTimeout(timer);
        ultimaPruebaResultado = 'Exitosa';
        ultimaComunicacionExitosa = new Date();
        resolve(true);
      },
    };

    port.write('PING\n', err => {
      if (err) {
        clearTimeout(timer);
        pendientePing = null;
        ultimaPruebaResultado = 'Fallida';
        return reject(err);
      }
      log('PING enviado');
    });
  });
}

// Determina el estado real de conexión comunicándose efectivamente con el
// Arduino (abre el puerto si es necesario, envía PING y espera PONG). No se
// considera "Conectado" sólo porque exista configuración guardada o el
// puerto esté abierto: se exige una respuesta válida del dispositivo.
async function verificarEstadoReal(io) {
  if (!SerialPort) return 'Desconectado';
  const cfg = getConfig();
  if (!cfg?.puerto) return 'Desconectado';

  try {
    await ping(io, PING_STATUS_TIMEOUT_MS);
    return 'Conectado';
  } catch (err) {
    if (!estaConectado()) return 'Desconectado';
    return 'Error de comunicación';
  }
}

// Solicita al Arduino que se reinicie remotamente.
async function reiniciarArduino(io) {
  ioRef = io || ioRef;
  await asegurarConexion(io);
  return new Promise((resolve, reject) => {
    port.write('REINICIAR\n', err => {
      if (err) {
        log(`Error al reiniciar: ${err.message}`);
        return reject(err);
      }
      log('Comando de reinicio enviado');
      conectadoEn = null;
      resolve(true);
    });
  });
}

// Consulta la configuración almacenada actualmente en el Arduino.
async function leerConfiguracionActual(io) {
  ioRef = io || ioRef;
  await asegurarConexion(io);
  if (pendienteConfig) throw new Error('Ya hay una consulta de configuración en curso.');

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendienteConfig = null;
      reject(new Error('No se recibió la configuración del Arduino.'));
    }, TIMEOUT_MS);

    pendienteConfig = { resolve: cfg => { clearTimeout(timer); resolve(cfg); } };

    port.write('LEER_CONFIG\n', err => {
      if (err) {
        clearTimeout(timer);
        pendienteConfig = null;
        return reject(err);
      }
      log('Solicitud de configuración enviada');
    });
  });
}

// Pone al Arduino en modo escucha para aprender un nuevo código RF.
async function aprenderCodigo(io) {
  ioRef = io || ioRef;
  await asegurarConexion(io);
  if (aprendizaje) throw new Error('Ya hay un aprendizaje de código en curso.');
  if (pendiente) throw new Error('Hay una validación en curso. Esperá a que finalice.');

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      aprendizaje = null;
      reject(new Error('No se detectó ningún código RF dentro del tiempo de espera.'));
    }, TIMEOUT_APRENDIZAJE_MS);

    aprendizaje = { timer, resolve, reject };

    port.write('APRENDER\n', err => {
      if (err) {
        clearTimeout(timer);
        aprendizaje = null;
        return reject(err);
      }
      log('Modo aprendizaje iniciado, esperando código RF...');
    });
  });
}

// Estado informativo del Arduino para el panel de diagnóstico. El campo
// "estado" se determina con una comunicación real (PING/PONG), nunca a
// partir de la sola existencia de configuración guardada o del puerto abierto.
async function getEstadoArduino(io) {
  const cfg = getConfig();
  const estado = await verificarEstadoReal(io);
  const tiempoActivoMs = conectadoEn && estado === 'Conectado' ? Date.now() - conectadoEn.getTime() : 0;
  return {
    estado,
    firmware: firmwareVer,
    puerto: cfg?.puerto || null,
    puerto_conectado: estado === 'Conectado' ? cfg?.puerto || null : null,
    ultima_conexion: ultimaConexion ? ultimaConexion.toISOString() : null,
    tiempo_activo_ms: tiempoActivoMs,
    diagnostico: {
      puerto_configurado: cfg?.puerto || null,
      puerto_conectado: estado === 'Conectado' ? cfg?.puerto || null : null,
      ultima_prueba_resultado: ultimaPruebaResultado,
      ultima_comunicacion_exitosa: ultimaComunicacionExitosa ? ultimaComunicacionExitosa.toISOString() : null,
    },
  };
}

// Registra un evento del módulo VIPER en el historial (para auditoría/diagnóstico).
function registrarEvento({ viperId = null, usuario = null, accion, resultado = null, ackEstado = null, detalle = null }) {
  db.prepare(`
    INSERT INTO viper_eventos (viper_id, usuario_id, usuario_nombre, accion, resultado, ack_estado, detalle)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(viperId, usuario?.id || null, usuario?.nombre || null, accion, resultado, ackEstado, detalle);
}

module.exports = {
  listarPuertos,
  getConfig,
  setConfig,
  estaConectado,
  conectar,
  desconectar,
  enviarSenal,
  enviarRaw,
  ping,
  verificarEstadoReal,
  reiniciarArduino,
  leerConfiguracionActual,
  aprenderCodigo,
  getEstadoArduino,
  registrarEvento,
};
