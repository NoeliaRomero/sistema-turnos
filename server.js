const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const session      = require('express-session');
const path         = require('path');
const fs           = require('fs');
const crypto       = require('crypto');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');

// ── Restauración pendiente (aplica ANTES de cargar la DB) ─────────────────────
// Si el admin solicitó restaurar un backup, la DB de reemplazo queda en
// db/pending_restore.db con el flag db/.restore_pending. Se aplica aquí,
// antes de que el módulo db/ abra la conexión.
// En Electron, SISTEMA_DB_DIR apunta a userData/db (escribible y persistente).
// En modo desarrollo (node server.js) se usa el directorio db/ del proyecto.
const DB_DIR           = process.env.SISTEMA_DB_DIR || path.join(__dirname, 'db');
const PENDING_DB       = path.join(DB_DIR, 'pending_restore.db');
const PENDING_FLAG     = path.join(DB_DIR, '.restore_pending');
const MAIN_DB          = path.join(DB_DIR, 'turnos.db');

if (fs.existsSync(PENDING_FLAG) && fs.existsSync(PENDING_DB)) {
  try {
    fs.copyFileSync(PENDING_DB, MAIN_DB);
    fs.unlinkSync(PENDING_FLAG);
    fs.unlinkSync(PENDING_DB);
    console.log('✅ Base de datos restaurada exitosamente desde backup pendiente.');
  } catch (err) {
    console.error('❌ Error al aplicar restauración pendiente:', err.message);
  }
}

const db = require('./db/database');

// ── Secreto de sesión único por instalación ───────────────────────────────────
// Se genera la primera vez y se persiste en db/session.key (fuera del repo git).
const SESSION_KEY_PATH = path.join(DB_DIR, 'session.key');
let SESSION_SECRET;
if (fs.existsSync(SESSION_KEY_PATH)) {
  SESSION_SECRET = fs.readFileSync(SESSION_KEY_PATH, 'utf8').trim();
} else {
  SESSION_SECRET = crypto.randomBytes(64).toString('hex');
  fs.writeFileSync(SESSION_KEY_PATH, SESSION_SECRET, { mode: 0o600 });
  console.log('✅ Secreto de sesión generado y guardado en db/session.key');
}

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// ── Cabeceras de seguridad HTTP ───────────────────────────────────────────────
// CSP permite: recursos propios, jsDelivr (Bootstrap/Icons/Chart.js),
// inline styles (Bootstrap los requiere) y WebSocket para Socket.io.
// 'unsafe-inline' en script-src es necesario porque el frontend usa
// atributos onclick generados dinámicamente; las correcciones XSS (4.7/4.8)
// previenen inyección de datos no confiables en esos atributos.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc:      ["'self'"],
      baseUri:         ["'self'"],
      formAction:      ["'self'"],
      frameAncestors:  ["'self'"],
      scriptSrc:       ["'self'", 'https://cdn.jsdelivr.net', "'unsafe-inline'"],
      styleSrc:        ["'self'", 'https://cdn.jsdelivr.net', "'unsafe-inline'"],
      fontSrc:         ["'self'", 'https://cdn.jsdelivr.net', 'data:'],
      imgSrc:          ["'self'", 'data:'],
      connectSrc:      ["'self'", 'ws:', 'wss:'], // Socket.io WebSocket
      frameSrc:        ["'none'"],
      objectSrc:       ["'none'"],
      // No incluir upgrade-insecure-requests: el sistema opera sobre HTTP en LAN
    },
  },
  // El sistema opera en HTTP en LAN; no forzar HTTPS
  strictTransportSecurity: false,
}));

// ── Rate limiting en autenticación ────────────────────────────────────────────
// Máx. 20 intentos de login por IP en 15 minutos.
// Suficiente para errores normales de contraseña en LAN,
// pero bloquea ataques de fuerza bruta automatizados.
const loginLimiter = rateLimit({
  windowMs:          15 * 60 * 1000, // ventana de 15 minutos
  max:               20,             // máx. intentos por ventana por IP
  standardHeaders:   true,
  legacyHeaders:     false,
  message:           { error: 'Demasiados intentos. Esperá 15 minutos antes de intentar de nuevo.' },
  skipSuccessfulRequests: true,      // los logins exitosos no cuentan
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());

// Instancia única de sesión, compartida entre Express y Socket.IO
// (io.engine.use más abajo) para que ambos lean/escriban la misma sesión.
const sessionMiddleware = session({
  secret:            process.env.SESSION_SECRET || SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,   // JS del cliente no puede leer la cookie
    sameSite: 'lax',  // protección CSRF básica compatible con navegación normal
    secure:   false,  // false: el sistema opera sobre HTTP en LAN (sin TLS)
    maxAge:   10 * 60 * 60 * 1000, // 10 h
  },
});
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

app.use(express.static(path.join(__dirname, 'public')));

// ── Módulo de licencia (requiere estar antes del enforcement middleware) ───────
const licenciaModule = require('./routes/licencia');

// ── Enforcement de licencia ───────────────────────────────────────────────────
// Rutas que siempre están disponibles independientemente del estado de licencia:
//   - /api/auth      → login/logout/me
//   - /api/licencia  → activar/consultar licencia
//   - /api/superadmin→ panel superadmin (gestión de admins)
// Todo lo demás requiere licencia válida.
// Esto impide que un admin/operador/recepción use el sistema si no está activado,
// pero permite al superadmin activar la licencia sin restricciones.
const RUTAS_LIBRES = ['/api/auth', '/api/licencia', '/api/superadmin'];
app.use('/api', (req, res, next) => {
  if (RUTAS_LIBRES.some(r => req.path.startsWith(r.replace('/api', '')))) return next();
  const { valid, reason } = licenciaModule.getLicenseStatus();
  if (!valid) {
    const msg = reason === 'expired'
      ? 'La licencia del sistema está vencida. Contacte al administrador.'
      : 'Sistema no activado. Contacte al administrador del sistema.';
    return res.status(403).json({ error: msg, licencia_requerida: true });
  }
  next();
});

// ── Rutas API ─────────────────────────────────────────────────────────────────
app.use('/api/auth/login',  loginLimiter);
app.use('/api/auth',        require('./routes/auth'));
const backupModule = require('./routes/backup');
app.use('/api/backup',      backupModule.router);
app.use('/api/licencia',    licenciaModule.router);
app.use('/api/atracciones', require('./routes/atracciones')(io));
app.use('/api/turnos',      require('./routes/turnos')(io));
app.use('/api/usuarios',    require('./routes/usuarios'));
app.use('/api/stats',       require('./routes/stats'));
app.use('/api/superadmin',  require('./routes/superadmin'));
app.use('/api/vipers',      require('./routes/vipers')(io));
app.use('/api/serial',         require('./routes/serial'));
app.use('/api/config-general',   require('./routes/config-general'));

// ── Módulo de configuración del servidor (puerto LAN) ─────────────────────────
const configServidorModule = require('./routes/config-servidor');
app.use('/api/config-servidor', configServidorModule.router);

// ── WebSocket ─────────────────────────────────────────────────────────────────
// Presencia "en vivo": registra sockets autenticados (sesión compartida vía
// io.engine.use arriba) y notifica a admins solo en transiciones 0↔1.
// Sockets sin sesión (pantalla pública, login) quedan conectados sin registrar.
const presencia = require('./services/presencia');
presencia.init(io);

io.on('connection', socket => {
  const usuario = socket.request.session?.usuario;
  // Las pantallas públicas (TV) comparten la cookie de sesión de Electron, pero
  // no deben asociarse al usuario: si no, el logout las desconectaría junto con
  // los sockets de ese usuario y dejarían de recibir eventos.
  const esPantalla = socket.handshake.auth?.pantalla === true;
  if (usuario && !esPantalla) {
    socket.join(`usuario:${usuario.id}`);
    if (usuario.rol === 'admin' || usuario.rol === 'superadmin') {
      socket.join('admins');
    }
    presencia.registrar(socket, usuario.id);
  }

  socket.on('disconnect', () => {
    presencia.desregistrar(socket);
  });
});

// ── 404: rutas de API no encontradas ─────────────────────────────────────────
// Responde JSON en lugar del HTML por defecto de Express,
// para que cualquier cliente de la API reciba siempre JSON.
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: 'Recurso no encontrado.' });
});

// ── Middleware global de errores ──────────────────────────────────────────────
// Captura cualquier excepción no controlada lanzada por las rutas.
// El stack trace completo se registra solo en el servidor; el cliente recibe
// únicamente un JSON genérico para evitar exponer rutas o detalles internos.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.path}`, err);
  const status = typeof err.status === 'number' ? err.status : 500;
  res.status(status).json({ success: false, error: 'Error interno del servidor.' });
});

// ── Arranque ──────────────────────────────────────────────────────────────────
// Orden de prioridad: archivo db/server.port → variable de entorno → 3000
const PORT = configServidorModule.leerPuertoGuardado() || Number(process.env.PORT) || 3000;
global._PUERTO_ACTIVO = PORT;

server.listen(PORT, () => {
  console.log(`\n✅ Sistema de Turnos iniciado`);
  console.log(`🌐 http://localhost:${PORT}`);
  console.log(`💾 DB: ${path.join(process.env.SISTEMA_DB_DIR || path.join(__dirname, 'db'), 'turnos.db')}\n`);
  backupModule.configurarCron();
});

server.on('error', (err) => {
  // Propagar como excepción para que main.js pueda capturarla
  process.nextTick(() => { throw err; });
});
