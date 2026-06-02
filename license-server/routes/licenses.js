/**
 * routes/licenses.js — API del servidor de licencias v2
 *
 * Rutas públicas (cliente Electron):
 *   POST /api/licenses/validate    — activar / re-validar
 *   POST /api/licenses/deactivate  — liberar una máquina
 *
 * Rutas admin (desarrollador):
 *   POST   /api/licenses/admin/login
 *   GET    /api/licenses/admin/licenses
 *   POST   /api/licenses/admin/licenses
 *   GET    /api/licenses/admin/licenses/:id
 *   PUT    /api/licenses/admin/licenses/:id
 *   GET    /api/licenses/admin/activations          — todas las PCs activas
 *   GET    /api/licenses/admin/events               — historial reciente
 *   DELETE /api/licenses/admin/activations/:id      — revocar una PC
 */

const router  = require('express').Router();
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const { db, generateLicenseKey } = require('../db/database');

// ── Helpers ───────────────────────────────────────────────────────────────────
const PRIVATE_KEY = process.env.JWT_PRIVATE_KEY?.replace(/\\n/g, '\n')
  || (() => { throw new Error('JWT_PRIVATE_KEY no configurada'); })();

function signToken(payload) {
  return jwt.sign(payload, PRIVATE_KEY, { algorithm: 'RS256', expiresIn: '30d' });
}

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'No autorizado' });
  try {
    req.admin = jwt.verify(auth.slice(7), process.env.ADMIN_JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

// ── POST /api/licenses/validate ───────────────────────────────────────────────
router.post('/validate', (req, res) => {
  const { licenseKey, hardware } = req.body;
  const publicIp = getClientIp(req);

  if (!licenseKey || !hardware?.primaryFingerprint) {
    return res.status(400).json({ ok: false, error: 'MISSING_PARAMS' });
  }

  // 1. Buscar licencia activa
  const license = db.prepare(`
    SELECT * FROM licenses WHERE license_key = ? AND active = 1
  `).get(licenseKey.toUpperCase());

  if (!license) {
    logEvent(null, null, 'rejected', hardware, publicIp, { reason: 'INVALID_KEY', licenseKey });
    return res.json({ ok: false, error: 'INVALID_KEY' });
  }

  // 2. Verificar vencimiento
  if (license.expires_at && new Date(license.expires_at) < new Date()) {
    logEvent(license.id, null, 'rejected', hardware, publicIp, { reason: 'EXPIRED' });
    return res.json({ ok: false, error: 'EXPIRED' });
  }

  // 3. Buscar si este hardware ya fue registrado (por fingerprint primario)
  const existingActivation = db.prepare(`
    SELECT * FROM activations
    WHERE license_id = ? AND hardware_fingerprint = ?
  `).get(license.id, hardware.primaryFingerprint);

  let activation;

  if (existingActivation) {
    // ── REINSTALACIÓN / REACTIVACIÓN ─────────────────────────────────────────
    // La misma PC volvió a activar → no consume cupo, solo actualiza datos
    db.prepare(`
      UPDATE activations SET
        last_seen        = datetime('now'),
        reinstall_count  = reinstall_count + 1,
        hostname         = ?,
        windows_user     = ?,
        mac_address      = ?,
        os_version       = ?,
        public_ip        = ?,
        secondary_fingerprint = ?,
        full_fingerprint      = ?,
        active           = 1
      WHERE id = ?
    `).run(
      hardware.hostname || null,
      hardware.windowsUser || null,
      hardware.macAddresses?.[0] || null,
      hardware.osVersion || null,
      publicIp,
      hardware.secondaryFingerprint || null,
      hardware.fullFingerprint || null,
      existingActivation.id
    );

    // Incrementar contador de reinstalaciones en la licencia
    db.prepare(`UPDATE licenses SET reinstalls = reinstalls + 1 WHERE id = ?`)
      .run(license.id);

    activation = db.prepare('SELECT * FROM activations WHERE id = ?').get(existingActivation.id);

    const eventType = existingActivation.reinstall_count > 0 ? 'reinstall' : 'reactivation';
    logEvent(license.id, activation.id, eventType, hardware, publicIp, {
      reinstall_number: activation.reinstall_count,
      client_name:      license.client_name,
    });

    console.log(`[License] REINSTALACIÓN — ${license.client_name} | PC: ${hardware.hostname} | Total reinstalls: ${activation.reinstall_count}`);

  } else {
    // ── NUEVA ACTIVACIÓN ──────────────────────────────────────────────────────
    // Verificar cupo disponible
    if (license.activations_used >= license.max_activations) {
      logEvent(license.id, null, 'rejected', hardware, publicIp, {
        reason: 'MAX_ACTIVATIONS',
        used:   license.activations_used,
        max:    license.max_activations,
      });
      return res.json({
        ok: false,
        error: 'MAX_ACTIVATIONS',
        used: license.activations_used,
        max:  license.max_activations,
      });
    }

    // Registrar nueva activación
    const result = db.prepare(`
      INSERT INTO activations
        (license_id, hardware_fingerprint, secondary_fingerprint, full_fingerprint,
         hostname, windows_user, mac_address, disk_serial, motherboard_id, os_version, public_ip)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      license.id,
      hardware.primaryFingerprint,
      hardware.secondaryFingerprint || null,
      hardware.fullFingerprint      || null,
      hardware.hostname             || null,
      hardware.windowsUser          || null,
      hardware.macAddresses?.[0]    || null,
      hardware.diskSerial           || null,
      hardware.motherboardId        || null,
      hardware.osVersion            || null,
      publicIp
    );

    // Incrementar contador de activaciones usadas
    db.prepare(`UPDATE licenses SET activations_used = activations_used + 1 WHERE id = ?`)
      .run(license.id);

    activation = db.prepare('SELECT * FROM activations WHERE id = ?').get(Number(result.lastInsertRowid));

    logEvent(license.id, activation.id, 'new', hardware, publicIp, {
      client_name: license.client_name,
      activation_number: license.activations_used + 1,
    });

    console.log(`[License] NUEVA ACTIVACIÓN — ${license.client_name} | PC: ${hardware.hostname} | ${license.activations_used + 1}/${license.max_activations}`);
  }

  // 4. Generar JWT
  const features = JSON.parse(license.features || '{}');
  const token = signToken({
    licenseKey:          license.license_key,
    client:              license.client_name,
    machineId:           hardware.primaryFingerprint,
    hardwareFingerprint: hardware.primaryFingerprint,
    features,
    maxActivations:      license.max_activations,
  });

  const updatedLicense = db.prepare('SELECT * FROM licenses WHERE id = ?').get(license.id);

  res.json({
    ok: true,
    token,
    client:           license.client_name,
    features,
    activationsUsed:  updatedLicense.activations_used,
    maxActivations:   updatedLicense.max_activations,
    isReinstall:      !!existingActivation,
  });
});

// ── POST /api/licenses/deactivate ─────────────────────────────────────────────
router.post('/deactivate', (req, res) => {
  const { licenseKey, hardware } = req.body;
  if (!licenseKey || !hardware?.primaryFingerprint) {
    return res.status(400).json({ error: 'MISSING_PARAMS' });
  }

  const license = db.prepare('SELECT id FROM licenses WHERE license_key = ?')
    .get(licenseKey.toUpperCase());
  if (!license) return res.status(404).json({ error: 'NOT_FOUND' });

  const activation = db.prepare(`
    SELECT id FROM activations WHERE license_id = ? AND hardware_fingerprint = ?
  `).get(license.id, hardware.primaryFingerprint);

  if (activation) {
    db.prepare('UPDATE activations SET active = 0 WHERE id = ?').run(activation.id);
    logEvent(license.id, activation.id, 'deactivated', hardware, getClientIp(req), {});
  }

  res.json({ ok: true });
});

// ── Helper: registrar evento ──────────────────────────────────────────────────
function logEvent(licenseId, activationId, eventType, hardware, publicIp, extra) {
  try {
    db.prepare(`
      INSERT INTO activation_events
        (license_id, activation_id, event_type, hardware_fingerprint,
         hostname, windows_user, public_ip, metadata)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(
      licenseId    || null,
      activationId || null,
      eventType,
      hardware?.primaryFingerprint || null,
      hardware?.hostname           || null,
      hardware?.windowsUser        || null,
      publicIp,
      JSON.stringify({ hardware, ...extra })
    );
  } catch (_) {}
}

// ── POST /api/licenses/admin/login ────────────────────────────────────────────
router.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM superadmins WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }
  const token = jwt.sign(
    { id: admin.id, username: admin.username },
    process.env.ADMIN_JWT_SECRET,
    { expiresIn: '8h' }
  );
  res.json({ ok: true, token, nombre: admin.nombre });
});

// ── GET /api/licenses/admin/licenses ─────────────────────────────────────────
router.get('/admin/licenses', requireAdmin, (req, res) => {
  const licenses = db.prepare(`
    SELECT l.*,
      (SELECT COUNT(*) FROM activations a WHERE a.license_id = l.id AND a.active = 1) AS active_machines
    FROM licenses l ORDER BY l.created_at DESC
  `).all();
  res.json(licenses.map(l => ({ ...l, features: JSON.parse(l.features) })));
});

// ── POST /api/licenses/admin/licenses ────────────────────────────────────────
router.post('/admin/licenses', requireAdmin, (req, res) => {
  const { client_name, client_email, max_activations, features, expires_at, notes } = req.body;
  if (!client_name) return res.status(400).json({ error: 'client_name requerido' });

  const key = generateLicenseKey();
  db.prepare(`
    INSERT INTO licenses
      (license_key, client_name, client_email, max_activations, features, expires_at, notes)
    VALUES (?,?,?,?,?,?,?)
  `).run(
    key,
    client_name,
    client_email   || null,
    max_activations || 1,
    JSON.stringify(features || {}),
    expires_at     || null,
    notes          || null
  );

  res.json({ ok: true, license_key: key });
});

// ── GET /api/licenses/admin/licenses/:id ─────────────────────────────────────
router.get('/admin/licenses/:id', requireAdmin, (req, res) => {
  const license = db.prepare('SELECT * FROM licenses WHERE id = ?').get(req.params.id);
  if (!license) return res.status(404).json({ error: 'No encontrada' });

  const activations = db.prepare(`
    SELECT * FROM activations WHERE license_id = ? ORDER BY first_activated_at DESC
  `).all(license.id);

  const recentEvents = db.prepare(`
    SELECT * FROM activation_events WHERE license_id = ?
    ORDER BY created_at DESC LIMIT 50
  `).all(license.id);

  res.json({
    ...license,
    features:      JSON.parse(license.features),
    activations,
    recentEvents,
  });
});

// ── PUT /api/licenses/admin/licenses/:id ─────────────────────────────────────
router.put('/admin/licenses/:id', requireAdmin, (req, res) => {
  const { client_name, max_activations, features, expires_at, active, notes } = req.body;
  db.prepare(`
    UPDATE licenses SET
      client_name     = COALESCE(?, client_name),
      max_activations = COALESCE(?, max_activations),
      features        = COALESCE(?, features),
      expires_at      = ?,
      active          = COALESCE(?, active),
      notes           = ?
    WHERE id = ?
  `).run(
    client_name     || null,
    max_activations || null,
    features ? JSON.stringify(features) : null,
    expires_at !== undefined ? expires_at : undefined,
    active !== undefined ? active : null,
    notes  !== undefined ? notes  : null,
    req.params.id
  );
  res.json({ ok: true });
});

// ── GET /api/licenses/admin/activations — TODAS las PCs activas ───────────────
router.get('/admin/activations', requireAdmin, (req, res) => {
  const activations = db.prepare(`
    SELECT a.*,
           l.client_name, l.license_key, l.max_activations,
           l.activations_used, l.reinstalls
    FROM activations a
    JOIN licenses l ON l.id = a.license_id
    WHERE a.active = 1
    ORDER BY a.last_seen DESC
  `).all();
  res.json(activations);
});

// ── GET /api/licenses/admin/events — historial reciente ──────────────────────
router.get('/admin/events', requireAdmin, (req, res) => {
  const limit  = parseInt(req.query.limit  || '100');
  const offset = parseInt(req.query.offset || '0');

  const events = db.prepare(`
    SELECT e.*, l.client_name, l.license_key
    FROM activation_events e
    LEFT JOIN licenses l ON l.id = e.license_id
    ORDER BY e.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  res.json(events.map(e => ({
    ...e,
    metadata: e.metadata ? JSON.parse(e.metadata) : null,
  })));
});

// ── DELETE /api/licenses/admin/activations/:id — revocar una PC ──────────────
router.delete('/admin/activations/:id', requireAdmin, (req, res) => {
  const activation = db.prepare('SELECT * FROM activations WHERE id = ?').get(req.params.id);
  if (!activation) return res.status(404).json({ error: 'No encontrada' });

  db.prepare('UPDATE activations SET active = 0 WHERE id = ?').run(req.params.id);

  // Decrementar contador de activaciones usadas
  db.prepare('UPDATE licenses SET activations_used = MAX(0, activations_used - 1) WHERE id = ?')
    .run(activation.license_id);

  logEvent(activation.license_id, activation.id, 'deactivated', {
    primaryFingerprint: activation.hardware_fingerprint,
    hostname: activation.hostname,
  }, 'admin', { revoked_by: 'admin' });

  res.json({ ok: true });
});

module.exports = router;
