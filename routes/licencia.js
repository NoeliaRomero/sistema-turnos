'use strict';

/**
 * Sistema de licenciamiento — Solo SUPERADMIN.
 *
 * Flujo:
 *   1. Cliente obtiene su Installation ID desde este panel.
 *   2. Lo envía al desarrollador.
 *   3. Desarrollador corre tools/generar-licencia.js → produce cadena .lic
 *   4. Cliente pega la cadena en el panel → POST /api/licencia/activar
 *   5. Servidor verifica firma RSA + installation_id + vencimiento → guarda db/license.lic
 *   6. En cada arranque, servidor verifica la licencia y determina el estado del sistema.
 *
 * La clave privada NUNCA está aquí. Solo la clave pública para verificar firmas.
 */

const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');

// ── Clave pública (solo verifica; la privada está en tools/private.pem del dev) ──
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0VUbS3sE2DeOhwdatjqo
cR+O7jg+fLkB5LlnVvUdd6B+FK52DcWx6Gr8KXyrA259QYL2yGJw1gND2WXTgxni
6cPrbUqq/dbYrKabMX/nFogmaj7XKDYIxqZ19elqqye4hW+X0fJdsheetCT4tmFO
ooytYBTu8OUyi67OlRjnxsjl9QzVdZUd/b6r2cNfAtZ7m7ZBHAiELnzZhi+QenoU
5S5yciqiQizbP8MV6Dp+KQDCyY9YG77g2JS7PxR6Ti+BqgHDKHLBTRiEXJwgNMDb
Fzkkh83+BPryhJs6fOgziQ0sUy7RjteEtXTrC9HODZ+LImWNqO+AcRoXTs5ihA53
IwIDAQAB
-----END PUBLIC KEY-----`;

// ── Rutas de archivos ─────────────────────────────────────────────────────────
// En Electron usa userData/db; en desarrollo usa db/ del proyecto.
const DB_DIR          = process.env.SISTEMA_DB_DIR || path.join(__dirname, '..', 'db');
const LICENSE_FILE    = path.join(DB_DIR, 'license.lic');
const INSTALL_ID_FILE = path.join(DB_DIR, 'install.id');

// ── Installation ID ───────────────────────────────────────────────────────────
// Derivado del hostname + primera MAC no-interna de la máquina.
// Se calcula una sola vez y se persiste en db/install.id.
// Si el archivo existe, se usa directamente (permite que sobreviva reinicios sin cambios).
function getInstallationId() {
  if (fs.existsSync(INSTALL_ID_FILE)) {
    return fs.readFileSync(INSTALL_ID_FILE, 'utf8').trim();
  }

  const hostname = os.hostname();
  let mac = '';
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        mac = iface.mac;
        break;
      }
    }
    if (mac) break;
  }

  const raw  = `SU|${hostname}|${mac}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex').toUpperCase();
  const id   = [hash.slice(0,8), hash.slice(8,16), hash.slice(16,24), hash.slice(24,32)].join('-');

  try { fs.writeFileSync(INSTALL_ID_FILE, id, { encoding: 'utf8' }); } catch (_) {}
  return id;
}

// ── Parser y verificador de licencia ─────────────────────────────────────────
function parseLicense(licStr) {
  const parts = licStr.trim().split('.');
  if (parts.length !== 2) throw new Error('Formato inválido');

  const [payloadB64, sigB64] = parts;

  // Verificar firma antes de parsear payload
  const verify = crypto.createVerify('RSA-SHA256');
  verify.update(payloadB64);
  verify.end();
  const sigBuf = Buffer.from(sigB64, 'base64url');
  if (!verify.verify(PUBLIC_KEY, sigBuf)) {
    throw new Error('Firma inválida');
  }

  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  return payload;
}

// ── Estado de licencia ────────────────────────────────────────────────────────
let _cache     = null;
let _cacheTime = 0;

function computeLicenseStatus() {
  if (!fs.existsSync(LICENSE_FILE)) {
    return { valid: false, reason: 'no_license' };
  }
  try {
    const licStr  = fs.readFileSync(LICENSE_FILE, 'utf8');
    const payload = parseLicense(licStr);

    if (payload.installation_id !== getInstallationId()) {
      return { valid: false, reason: 'wrong_machine', payload };
    }
    if (payload.expires_at && new Date(payload.expires_at) < new Date()) {
      return { valid: false, reason: 'expired', payload };
    }
    return { valid: true, payload };
  } catch (e) {
    return { valid: false, reason: 'invalid', error: e.message };
  }
}

function getLicenseStatus() {
  const now = Date.now();
  if (!_cache || now - _cacheTime > 5 * 60 * 1000) {
    _cache     = computeLicenseStatus();
    _cacheTime = now;
  }
  return _cache;
}

function invalidateCache() {
  _cache     = null;
  _cacheTime = 0;
}

// ── Texto legible de razón ────────────────────────────────────────────────────
function razonLegible(reason) {
  return {
    no_license:    'Sin licencia — sistema no activado',
    wrong_machine: 'Licencia vinculada a otra instalación',
    expired:       'Licencia vencida',
    invalid:       'Licencia corrupta o inválida',
  }[reason] || reason;
}

// ── Endpoints (todos protegidos: solo superadmin) ─────────────────────────────
router.use(requireAuth('superadmin'));

// GET /api/licencia/info — estado actual + installation_id
router.get('/info', (req, res) => {
  const installId = getInstallationId();
  const status    = getLicenseStatus();

  res.json({
    installation_id: installId,
    estado:          status.valid ? 'activa' : 'inactiva',
    razon:           status.valid ? null : razonLegible(status.reason),
    licencia: status.valid ? {
      cliente:       status.payload.customer_name,
      emitida:       status.payload.issued_at,
      vence:         status.payload.expires_at,
      plan:          status.payload.plan,
      max_sesiones:  status.payload.max_sessions,
    } : null,
  });
});

// POST /api/licencia/activar — importar y validar licencia
router.post('/activar', (req, res) => {
  const { licencia } = req.body;
  if (!licencia || typeof licencia !== 'string') {
    return res.status(400).json({ error: 'Se requiere el campo licencia.' });
  }
  if (licencia.length > 8192) {
    return res.status(400).json({ error: 'Cadena de licencia demasiado larga.' });
  }

  let payload;
  try {
    payload = parseLicense(licencia);
  } catch (e) {
    return res.status(400).json({ error: 'Licencia inválida: firma incorrecta o formato incorrecto.' });
  }

  if (payload.installation_id !== getInstallationId()) {
    return res.status(400).json({ error: 'Esta licencia no corresponde a esta instalación.' });
  }
  if (payload.expires_at && new Date(payload.expires_at) < new Date()) {
    return res.status(400).json({ error: 'Esta licencia está vencida.' });
  }

  try {
    fs.writeFileSync(LICENSE_FILE, licencia.trim(), 'utf8');
  } catch (e) {
    return res.status(500).json({ error: 'No se pudo guardar la licencia.' });
  }

  invalidateCache();
  res.json({
    ok:      true,
    mensaje: 'Licencia activada correctamente.',
    cliente: payload.customer_name,
    vence:   payload.expires_at,
  });
});

// DELETE /api/licencia — revocar/eliminar licencia activa
router.delete('/', (req, res) => {
  try {
    if (fs.existsSync(LICENSE_FILE)) fs.unlinkSync(LICENSE_FILE);
    invalidateCache();
    res.json({ ok: true, mensaje: 'Licencia revocada.' });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo revocar la licencia.' });
  }
});

module.exports = { router, getLicenseStatus };
