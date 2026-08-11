'use strict';

/**
 * main.js — Entry point de Electron para Sistema Universal
 *
 * Responsabilidades:
 *  1. Determinar el directorio de datos de usuario (userData de Electron).
 *  2. Migrar datos existentes del dir de desarrollo a userData en el primer arranque.
 *  3. Exponer rutas de datos via variables de entorno antes de cargar el servidor.
 *  4. Iniciar el servidor Express existente (server.js) en el mismo proceso.
 *  5. Esperar a que Express esté escuchando (polling de puerto).
 *  6. Abrir la ventana principal apuntando a localhost:PUERTO.
 *  7. Cerrar el proceso limpiamente al cerrar la ventana.
 */

const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const net  = require('net');

// ── Directorios de datos ──────────────────────────────────────────────────────
// En Electron el asar es de solo lectura; todo lo que el sistema escribe
// (DB, licencia, configuración, backups) va a userData, que persiste entre
// actualizaciones y reinstalaciones.
//
// Windows: C:\Users\<usuario>\AppData\Roaming\SistemaUniversal
// Linux  : ~/.config/SistemaUniversal  (para desarrollo/testing)

const userData  = app.getPath('userData');
const DB_DIR    = path.join(userData, 'db');
const BACKUP_DIR = path.join(userData, 'backups');

// Crear directorios si no existen
[DB_DIR, BACKUP_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ── Migración de primer arranque ──────────────────────────────────────────────
// Si la DB en userData no existe pero hay una en el directorio de la app
// (caso: primera instalación con datos pre-existentes de desarrollo),
// se copian los archivos persistentes al nuevo destino.
// En instalaciones limpias la DB se creará sola en userData via database.js.
function migrateDataIfNeeded() {
  const appDbDir  = path.join(__dirname, 'db');
  const targetDb  = path.join(DB_DIR, 'turnos.db');

  if (fs.existsSync(targetDb)) return; // ya migrado o ya existe

  const MIGRATE_FILES = ['turnos.db', 'session.key', 'install.id', 'license.lic', 'server.port'];
  for (const file of MIGRATE_FILES) {
    const src = path.join(appDbDir, file);
    const dst = path.join(DB_DIR, file);
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      try { fs.copyFileSync(src, dst); } catch (_) {}
    }
  }
}

migrateDataIfNeeded();

// ── Variables de entorno para el servidor ─────────────────────────────────────
// Deben setearse ANTES de require('./server') para que todos los módulos
// (database.js, backup.js, licencia.js, config-servidor.js) lean los paths correctos.
process.env.SISTEMA_DB_DIR     = DB_DIR;
process.env.SISTEMA_BACKUP_DIR = BACKUP_DIR;

// ── Lectura del puerto configurado ────────────────────────────────────────────
function leerPuerto() {
  const portFile = path.join(DB_DIR, 'server.port');
  try {
    if (fs.existsSync(portFile)) {
      const n = parseInt(fs.readFileSync(portFile, 'utf8').trim(), 10);
      if (Number.isInteger(n) && n >= 1 && n <= 65535) return n;
    }
  } catch (_) {}
  return parseInt(process.env.PORT, 10) || 3000;
}

// ── Esperar a que el servidor esté listo ──────────────────────────────────────
function waitForServer(port, maxMs = 20000) {
  const inicio = Date.now();
  return new Promise((resolve, reject) => {
    const intento = () => {
      const sock = net.createConnection({ port, host: '127.0.0.1' });
      sock.setTimeout(500);
      sock.once('connect', () => { sock.destroy(); resolve(port); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() - inicio > maxMs) {
          return reject(new Error(`El servidor no respondió en el puerto ${port} después de ${maxMs / 1000}s`));
        }
        setTimeout(intento, 300);
      });
      sock.once('timeout', () => { sock.destroy(); setTimeout(intento, 300); });
    };
    intento();
  });
}

// ── Ventana principal ─────────────────────────────────────────────────────────
let mainWindow = null;

async function crearVentana() {
  const puerto = leerPuerto();

  // Iniciar servidor Express (corre en este mismo proceso)
  try {
    require('./server');
  } catch (err) {
    dialog.showErrorBox(
      'Error al iniciar el servidor',
      `No se pudo iniciar el servidor Express:\n\n${err.message}\n\nRevisá los logs para más información.`,
    );
    app.quit();
    return;
  }

  // Esperar a que Express esté escuchando
  try {
    await waitForServer(puerto);
  } catch (err) {
    dialog.showErrorBox(
      `Puerto ${puerto} no disponible`,
      `No se pudo iniciar el servidor en el puerto ${puerto}.\n\n` +
      `El puerto puede estar ocupado por otro proceso.\n\n` +
      `Podés cambiar el puerto desde:\nConfiguraciones → Puerto del Servidor LAN\n\n` +
      `Luego reiniciá Sistema Universal.`,
    );
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width:  1280,
    height: 800,
    minWidth:  900,
    minHeight: 600,
    title: 'Sistema Universal',
    webPreferences: {
      nodeIntegration:  false,  // El renderer NO tiene acceso a Node
      contextIsolation: true,   // Contexto aislado (buena práctica de seguridad)
      sandbox:          true,   // Renderer sandboxeado
    },
    show: false, // No mostrar hasta que cargue para evitar flash blanco
  });

  // Mostrar una vez que el contenido esté listo
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Cargar la app
  mainWindow.loadURL(`http://127.0.0.1:${puerto}`);

  // Links externos: abrirlos en el browser del sistema, no en Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1:${puerto}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Ciclo de vida de la app ───────────────────────────────────────────────────
app.whenReady().then(crearVentana);

// En Windows/Linux: cerrar la app cuando se cierran todas las ventanas
app.on('window-all-closed', () => {
  app.quit();
});

// En macOS: recrear la ventana al hacer clic en el dock
app.on('activate', () => {
  if (mainWindow === null) crearVentana();
});
