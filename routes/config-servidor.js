'use strict';

const net     = require('net');
const fs      = require('fs');
const path    = require('path');
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
  res.json({
    puerto_configurado: configurado,
    puerto_activo:      activo,
    servidor_activo:    activo !== null,
  });
});

// GET /api/config-servidor/puertos-disponibles
// Devuelve la lista de puertos TCP disponibles en este momento.
router.get('/puertos-disponibles', requireAuth('admin'), async (req, res) => {
  try {
    const disponibles = await escanearPuertos(CANDIDATOS);
    res.json({ puertos: disponibles });
  } catch (e) {
    res.status(500).json({ error: 'Error al escanear puertos.' });
  }
});

// PUT /api/config-servidor/puerto
// Guarda el nuevo puerto. El servidor debe reiniciarse para aplicarlo.
router.put('/puerto', requireAuth('admin'), async (req, res) => {
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

// ── Exportar helper para server.js ────────────────────────────────────────────
module.exports = { router, leerPuertoGuardado };
