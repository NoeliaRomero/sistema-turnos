const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const path    = require('path');

const db = require('./db/database');
const { initDemo } = require('./db/demo-seed');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(session({
  secret:            process.env.SESSION_SECRET || 'turno-biper-demo-2024',
  resave:            false,
  saveUninitialized: false,
  cookie:            { secure: false, maxAge: 10 * 60 * 60 * 1000 } // 10 h
}));

// Pantalla pública sin auth
app.use(express.static(path.join(__dirname, 'public')));

// ── Rutas API ─────────────────────────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/atracciones',require('./routes/atracciones'));
app.use('/api/turnos',     require('./routes/turnos')(io));
app.use('/api/usuarios',   require('./routes/usuarios'));
app.use('/api/stats',      require('./routes/stats'));
app.use('/api/superadmin', require('./routes/superadmin'));
app.use('/api/vipers',    require('./routes/vipers')(io));
app.use('/api/serial',    require('./routes/serial'));
app.use('/api/demo',      require('./routes/demo')(io));

// ── WebSocket ─────────────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log('Cliente conectado:', socket.id);
  socket.on('disconnect', () => console.log('Cliente desconectado:', socket.id));
});

// ── Arranque ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n✅ Sistema de Turnos — MODO DEMO`);
  console.log(`🌐 http://localhost:${PORT}`);
  console.log(`\n🔑 Credenciales de acceso:`);
  console.log(`   Admin Demo → demo / demo123`);
  console.log(`   Operador   → carlos_op / demo123`);
  console.log(`   Recepción  → maria_rec / demo123\n`);
  initDemo();
});
