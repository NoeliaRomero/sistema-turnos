// ── Servicio de comunicación serial con el Arduino (sistema VIPER) ────────────
//
// Responsabilidades: detectar puertos, abrir/cerrar la conexión, enviar
// mensajes y códigos RAW, interpretar las respuestas del Arduino y persistir
// el resultado de la validación física de cada VIPER.

const db = require('../../db/database');


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
let conectando   = null; // Promise - apertura del puerto en curso (evita aperturas simultáneas)
let conectadoEn  = null; // Date - cuándo se abrió la conexión actual
let ultimaConexion = null; // Date - última vez que se estableció conexión
let ultimaPruebaResultado = null;    // 'Exitosa' | 'Fallida' | null
let ultimaComunicacionExitosa = null; // Date - última apertura/escritura exitosa del puerto
let ultimoErrorConexion = null;       // string - motivo de la última falla al abrir el puerto

// El estado del Arduino se determina por la presencia del puerto y por poder
// abrirlo (no responde a PING). Al transmitir un código sí informa el
// resultado: "[TX] Transmitiendo..." y luego "[TX] Finalizado.", que se usa
// como confirmación real del envío de una señal de prueba.
const TX_FINALIZADO = /^\[TX\]\s*Finalizado/i;
const TX_ERROR      = /^\[TX\].*(error|fall)/i;
const TIMEOUT_CONFIRMACION_TX_MS = 5000;

let confirmacionTx = null; // { resolve, reject, timer } - envío de prueba esperando "[TX] Finalizado."

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
  // Si ya hay una apertura en curso (ej. el chequeo periódico de estado),
  // se reutiliza en lugar de abrir el mismo puerto dos veces.
  if (!conectando) {
    conectando = (async () => conectar(io))().finally(() => { conectando = null; });
  }
  await conectando;
}

// Escribe en el puerto y espera a que los datos se vacíen al dispositivo.
function escribir(datos) {
  return new Promise((resolve, reject) => {
    if (!estaConectado()) return reject(new Error('El puerto serial no está abierto.'));
    port.write(datos, err => {
      if (err) return reject(err);
      port.drain(errDrain => (errDrain ? reject(errDrain) : resolve()));
    });
  });
}

function manejarLinea(lineaCruda) {
  const linea = limpiarLinea(lineaCruda);
  if (!linea) return;

  if (linea === 'LISTENING') {
    log('LISTENING recibido');
    return;
  }

  if (confirmacionTx && TX_FINALIZADO.test(linea)) {
    log(`Recibido: ${linea}`);
    confirmacionTx.resolve();
    return;
  }

  if (confirmacionTx && TX_ERROR.test(linea)) {
    log(`Recibido: ${linea}`);
    confirmacionTx.reject(new Error(`El Arduino informó un error al transmitir: ${linea}`));
    return;
  }

  // Otros mensajes informativos del Arduino (ej. READY_PARA_TEST_DE_CABLE)
  log(`Recibido: ${linea}`);
}

function emitirActualizacion(viperId) {
  if (!ioRef) return;
  const viper = db.prepare('SELECT id, codigo_viper, apodo, estado, baudrate, fecha_validacion, ultimo_test, ultimo_error FROM vipers WHERE id = ?').get(viperId);
  ioRef.emit('viper:actualizado', viper);
}

// Espera la línea "[TX] Finalizado." del Arduino tras escribir un código.
function esperarConfirmacionTx() {
  return new Promise((resolve, reject) => {
    const terminar = fn => arg => {
      clearTimeout(confirmacionTx?.timer);
      confirmacionTx = null;
      fn(arg);
    };
    confirmacionTx = {
      resolve: terminar(resolve),
      reject:  terminar(reject),
      timer:   setTimeout(() => {
        confirmacionTx = null;
        reject(new Error('El Arduino no confirmó la transmisión ("[TX] Finalizado.") dentro del tiempo de espera.'));
      }, TIMEOUT_CONFIRMACION_TX_MS),
    };
  });
}

// Envía el código del beeper al Arduino y espera su confirmación
// "[TX] Finalizado.". Sólo con esa confirmación el beeper queda ACTIVO; si
// falla la apertura, la escritura o no llega la confirmación, queda en ERROR
// con el motivo real. El registro en el historial lo hace la ruta HTTP.
async function enviarSenal(viperId, mensaje, io) {
  ioRef = io || ioRef;

  const viper = db.prepare('SELECT * FROM vipers WHERE id = ?').get(viperId);
  if (!viper) throw new Error('Beeper no encontrado');
  if (confirmacionTx) throw new Error('Ya hay un envío en curso. Esperá a que el Arduino termine de transmitir.');

  const inicio = new Date().toISOString();
  db.prepare("UPDATE vipers SET estado = 'VALIDANDO', ultimo_test = ?, ultimo_error = NULL WHERE id = ?")
    .run(inicio, viperId);
  emitirActualizacion(viperId);

  try {
    await asegurarConexion(io);
    const confirmado = esperarConfirmacionTx();
    try {
      await escribir(mensaje + '\n');
    } catch (errEscritura) {
      confirmado.catch(() => {});
      confirmacionTx?.reject(errEscritura);
      throw errEscritura;
    }
    log('Mensaje enviado, esperando confirmación del Arduino...');
    await confirmado;
  } catch (err) {
    marcarError(viperId, err.message);
    throw err;
  }

  const ahora = new Date().toISOString();
  db.prepare(`
    UPDATE vipers
    SET estado = 'ACTIVO', activo = 1, codigo_raw = ?, fecha_validacion = ?, ultima_activacion = ?, ultimo_error = NULL
    WHERE id = ?
  `).run(mensaje, ahora, ahora, viperId);

  ultimaComunicacionExitosa = new Date();
  log('Transmisión confirmada por el Arduino. Beeper activado');
  emitirActualizacion(viperId);
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

// Busca el puerto configurado entre los puertos presentes en el sistema.
async function buscarPuertoConfigurado() {
  const cfg = getConfig();
  if (!cfg?.puerto) return { cfg, info: null, disponibles: [] };
  const disponibles = await SerialPort.list();
  const info = disponibles.find(p => String(p.path).toUpperCase() === String(cfg.puerto).toUpperCase()) || null;
  return { cfg, info, disponibles };
}

// Prueba real de conexión sin depender de una respuesta del Arduino:
// verifica que el puerto exista, lo abre (o confirma que ya está abierto) y
// escribe un salto de línea inofensivo para comprobar que es escribible.
async function probarConexion(io) {
  ioRef = io || ioRef;
  try {
    if (!SerialPort) {
      throw new Error('El módulo serialport no está disponible en este servidor.');
    }
    const { cfg, info, disponibles } = await buscarPuertoConfigurado();
    if (!cfg?.puerto) {
      throw new Error('No hay un puerto COM configurado. Configurelo en Configuración Serial.');
    }
    if (!info) {
      const lista = disponibles.length ? disponibles.map(p => p.path).join(', ') : 'ninguno';
      desconectar();
      throw new Error(`El puerto ${cfg.puerto} no se encuentra conectado al equipo. Puertos disponibles: ${lista}.`);
    }

    try {
      await asegurarConexion(io);
    } catch (err) {
      throw new Error(`No se pudo abrir el puerto ${cfg.puerto}: ${err.message}. Verificá que no esté en uso por otro programa (ej. el Monitor Serial de Arduino IDE).`);
    }

    try {
      await escribir('\n');
    } catch (err) {
      throw new Error(`El puerto ${cfg.puerto} está abierto pero no se pudo escribir en él: ${err.message}`);
    }

    ultimaPruebaResultado = 'Exitosa';
    ultimaComunicacionExitosa = new Date();
    ultimoErrorConexion = null;
    const fabricante = info.manufacturer ? ` (${info.manufacturer})` : '';
    const mensaje = `Puerto ${cfg.puerto} detectado y abierto correctamente${fabricante}`;
    log(mensaje);
    return { puerto: cfg.puerto, fabricante: info.manufacturer || null, mensaje };
  } catch (err) {
    ultimaPruebaResultado = 'Fallida';
    ultimoErrorConexion = err.message;
    throw err;
  }
}

// Determina el estado del Arduino sin esperar respuestas: 'Desconectado' si
// no hay módulo serial, no hay puerto configurado, el puerto no está presente
// o no se puede abrir; 'Conectado' si el puerto se abre correctamente.
async function verificarEstadoReal(io) {
  if (!SerialPort) return { estado: 'Desconectado', detalle: 'El módulo serialport no está disponible en este servidor.' };

  let resultado;
  try {
    resultado = await buscarPuertoConfigurado();
  } catch (err) {
    return { estado: 'Desconectado', detalle: err.message };
  }
  const { cfg, info } = resultado;
  if (!cfg?.puerto) return { estado: 'Desconectado', detalle: 'No hay un puerto COM configurado.' };
  if (!info) {
    // El dispositivo se desconectó: liberar el handle viejo para poder reconectar luego.
    desconectar();
    return { estado: 'Desconectado', detalle: `El puerto ${cfg.puerto} no se encuentra conectado al equipo.` };
  }

  try {
    await asegurarConexion(io);
    ultimaPruebaResultado = 'Exitosa';
    ultimaComunicacionExitosa = new Date();
    ultimoErrorConexion = null;
    return { estado: 'Conectado', detalle: null };
  } catch (err) {
    ultimaPruebaResultado = 'Fallida';
    ultimoErrorConexion = err.message;
    return { estado: 'Desconectado', detalle: `No se pudo abrir ${cfg.puerto}: ${err.message}` };
  }
}

// Estado informativo del Arduino para el panel de diagnóstico. El campo
// "estado" depende de que el puerto configurado esté presente y se pueda
// abrir (el Arduino no responde a comandos, no se espera ninguna respuesta).
async function getEstadoArduino(io) {
  const cfg = getConfig();
  const { estado, detalle } = await verificarEstadoReal(io);
  const tiempoActivoMs = conectadoEn && estado === 'Conectado' ? Date.now() - conectadoEn.getTime() : 0;
  return {
    estado,
    detalle,
    puerto: cfg?.puerto || null,
    puerto_conectado: estado === 'Conectado' ? cfg?.puerto || null : null,
    ultima_conexion: ultimaConexion ? ultimaConexion.toISOString() : null,
    tiempo_activo_ms: tiempoActivoMs,
    diagnostico: {
      puerto_configurado: cfg?.puerto || null,
      puerto_conectado: estado === 'Conectado' ? cfg?.puerto || null : null,
      ultima_prueba_resultado: ultimaPruebaResultado,
      ultima_comunicacion_exitosa: ultimaComunicacionExitosa ? ultimaComunicacionExitosa.toISOString() : null,
      ultimo_error: ultimoErrorConexion,
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
  probarConexion,
  verificarEstadoReal,
  getEstadoArduino,
  registrarEvento,
};
