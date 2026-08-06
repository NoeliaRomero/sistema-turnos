const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const path    = require('path');

const db = require('./db/database');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(session({
  secret:            process.env.SESSION_SECRET || 'turno-biper-secret-2024',
  resave:            false,
  saveUninitialized: false,
  cookie:            { secure: false, maxAge: 10 * 60 * 60 * 1000 } // 10 h
}));

app.use(express.static(path.join(__dirname, 'public')));

// ── Rutas API ─────────────────────────────────────────────────────────────────
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/atracciones', require('./routes/atracciones'));
app.use('/api/turnos',      require('./routes/turnos')(io));
app.use('/api/usuarios',    require('./routes/usuarios'));
app.use('/api/stats',       require('./routes/stats'));
app.use('/api/superadmin',  require('./routes/superadmin'));
app.use('/api/vipers',      require('./routes/vipers')(io));
app.use('/api/serial',         require('./routes/serial'));
app.use('/api/config-general', require('./routes/config-general'));

// ── WebSocket ─────────────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log('Cliente conectado:', socket.id);
  socket.on('disconnect', () => console.log('Cliente desconectado:', socket.id));
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
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n✅ Sistema de Turnos iniciado`);
  console.log(`🌐 http://localhost:${PORT}\n`);
});
