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

let port       = null;
let parser     = null;
let ioRef      = null;
let pendiente  = null; // { viperId, timer }

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
      resolve();
    });

    parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
    parser.on('data', manejarLinea);

    port.on('close', () => log('Puerto cerrado'));
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
    resolverPendiente(raw);
    return;
  }

  // Otros mensajes informativos del Arduino (ej. READY_PARA_TEST_DE_CABLE)
  log(`Recibido: ${linea}`);
}

function resolverPendiente(raw) {
  if (!pendiente) return;
  const { viperId, timer } = pendiente;
  clearTimeout(timer);
  pendiente = null;

  const ahora = new Date().toISOString();
  db.prepare(`
    UPDATE vipers
    SET estado = 'ACTIVO', codigo_raw = ?, fecha_validacion = ?, ultimo_error = NULL
    WHERE id = ?
  `).run(raw, ahora, viperId);

  log('VIPER validado');
  log('Código guardado');
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
  if (!viper) throw new Error('VIPER no encontrado');

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

module.exports = {
  listarPuertos,
  getConfig,
  setConfig,
  estaConectado,
  conectar,
  desconectar,
  enviarSenal,
  enviarRaw,
};
