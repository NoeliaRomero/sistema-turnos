'use strict';

const net     = require('net');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');

// En Electron usa userData/db; en desarrollo usa db/ del proyecto.
const DB_DIR_SRV = process.env.SISTEMA_DB_DIR || path.join(__dirname, '..', 'db');
const PORT_FILE  = path.join(DB_DIR_SRV, 'server.port');

// ── Helpers ───────────────────────────────────────────────────────────────────

function leerPuertoGuardado() {
  try {
    if (fs.existsSync(PORT_FILE)) {
      const n = parseInt(fs.readFileSync(PORT_FILE, 'utf8').trim(), 10);
      if (Number.isInteger(n) && n >= 1 && n <= 65535) return n;
    }
  } catch (_) {}
  return null;
}

function validarPuerto(valor) {
  const n = parseInt(valor, 10);
  if (!Number.isInteger(n) || String(valor).trim() !== String(n)) return null;
  if (n < 1 || n > 65535) return null;
  return n;
}

// Devuelve true si el puerto está libre en este momento.
function puertoDisponible(puerto) {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', () => resolve(false));
    srv.listen(puerto, '0.0.0.0', () => {
      srv.close(() => resolve(true));
    });
  });
}

// Escanea la lista candidata y devuelve los que están libres.
async function escanearPuertos(candidatos) {
  const resultados = await Promise.all(
    candidatos.map(async p => ({ puerto: p, disponible: await puertoDisponible(p) }))
  );
  return resultados.filter(r => r.disponible).map(r => r.puerto);
}

// Lista candidata de puertos a escanear (amplia pero razonable).
const CANDIDATOS = [
  3000, 3001, 3002, 3003, 3004, 3005,
  4000, 4001, 4002, 4003, 4004, 4005,
  5000, 5001, 5002, 5003,
  8000, 8080, 8081, 8082,
  9000, 9001,
];

// ── Endpoints ─────────────────────────────────────────────────────────────────

// GET /api/config-servidor/estado
// Devuelve el puerto configurado, el activo real y el estado del servidor.
router.get('/estado', requireAuth('admin'), (req, res) => {
  const configurado = leerPuertoGuardado();
  const activo      = global._PUERTO_ACTIVO || null;
  const ips         = obtenerIPsLocales();
  res.json({
    puerto_configurado: configurado,
    puerto_activo:      activo,
    servidor_activo:    activo !== null,
    ip:                 ips[0] || null,
  });
});

// GET /api/config-servidor/puertos-disponibles
// Devuelve la lista de puertos TCP disponibles en este momento.
router.get('/puertos-disponibles', requireConfigRed, async (req, res) => {
  try {
    const disponibles = await escanearPuertos(CANDIDATOS);
    res.json({ puertos: disponibles });
  } catch (e) {
    res.status(500).json({ error: 'Error al escanear puertos.' });
  }
});

// PUT /api/config-servidor/puerto
// Guarda el nuevo puerto. El servidor debe reiniciarse para aplicarlo.
router.put('/puerto', requireConfigRed, async (req, res) => {
  const { puerto } = req.body;

  if (puerto === undefined || puerto === null || puerto === '') {
    return res.status(400).json({ error: 'Se requiere el campo puerto.' });
  }

  const p = validarPuerto(puerto);
  if (p === null) {
    return res.status(400).json({ error: 'El puerto debe ser un número entero entre 1 y 65535.' });
  }

  // No bloquear el puerto activo actual del mismo servidor
  const actual = global._PUERTO_ACTIVO;
  if (p !== actual) {
    const libre = await puertoDisponible(p);
    if (!libre) {
      return res.status(409).json({
        error: `El puerto ${p} está actualmente ocupado por otro proceso. Seleccioná uno disponible.`,
      });
    }
  }

  try {
    fs.writeFileSync(PORT_FILE, String(p), 'utf8');
  } catch (e) {
    return res.status(500).json({ error: 'No se pudo guardar la configuración del puerto.' });
  }

  const reinicio = (p !== actual);
  res.json({
    ok:               true,
    puerto_guardado:  p,
    requiere_reinicio: reinicio,
    mensaje: reinicio
      ? `Puerto ${p} guardado. Reiniciá el servidor para aplicar el cambio.`
      : `Puerto ${p} guardado. Ya es el puerto activo.`,
  });
});

function obtenerIPsLocales() {
  const ips = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (!iface.internal && iface.family === 'IPv4') {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

// GET /api/config-servidor/red — IP local, hostname, puerto activo
router.get('/red', requireAuth('admin'), (req, res) => {
  const puerto   = global._PUERTO_ACTIVO || leerPuertoGuardado() || 3000;
  const ips      = obtenerIPsLocales();
  const hostname = os.hostname();
  res.json({
    ips,
    hostname,
    puerto,
    urls: ips.map(ip => `http://${ip}:${puerto}`),
    url_hostname: `http://${hostname}:${puerto}`,
  });
});

function requireConfigRed(req, res, next) {
  const user = req.session?.usuario;
  if (!user) return res.status(401).json({ error: 'No autenticado' });
  if (user.rol === 'superadmin') return next();
  if (user.rol === 'admin') {
    const db = require('../db/database');
    const cfg = db.prepare('SELECT admin_puede_configurar_red FROM configuracion_general WHERE id=1').get();
    if (cfg?.admin_puede_configurar_red) return next();
    return res.status(403).json({ error: 'No tenés permiso para modificar la configuración de red. Contactá al Superadmin.' });
  }
  return res.status(403).json({ error: 'No autorizado.' });
}

// POST /api/config-servidor/reiniciar
router.post('/reiniciar', requireAuth('admin'), (req, res) => {
  res.json({ ok: true, mensaje: 'Reiniciando servidor…' });
  setTimeout(() => {
    global._RELAUNCH_PENDIENTE = true;
    process.exit(0);
  }, 800);
});

// ── Exportar helper para server.js ────────────────────────────────────────────
module.exports = { router, leerPuertoGuardado };
