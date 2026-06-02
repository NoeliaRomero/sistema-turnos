/**
 * routes/licenses.js — API del servidor de licencias
 *
 * Rutas públicas (cliente):
 *   POST /api/licenses/validate    — activar / re-validar licencia
 *   POST /api/licenses/deactivate  — liberar una máquina
 *
 * Rutas admin (tú como desarrollador):
 *   POST /api/admin/licenses        — crear nueva licencia
 *   GET  /api/admin/licenses        — listar todas
 *   GET  /api/admin/licenses/:id    — detalle
 *   PUT  /api/admin/licenses/:id    — actualizar
 *   DELETE /api/admin/licenses/:id/machines/:machineId — revocar máquina
 */

const router  = require('express').Router();
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const { db, generateLicenseKey } = require('../db/database');

// ── Helpers ───────────────────────────────────────────────────────────────────
const PRIVATE_KEY = process.env.JWT_PRIVATE_KEY?.replace(/\\n/g, '\n')
  || (() => { throw new Error('JWT_PRIVATE_KEY no configurada'); })();

function signLicenseToken(payload) {
  return jwt.sign(payload, PRIVATE_KEY, {
    algorithm: 'RS256',
    expiresIn: '30d', // el cliente re-valida antes de que venza
  });
}

function requireLicenseAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'No autorizado' });
  try {
    const payload = jwt.verify(auth.slice(7), process.env.ADMIN_JWT_SECRET);
    req.adminId   = payload.id;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

// ── POST /api/licenses/validate ───────────────────────────────────────────────
router.post('/validate', (req, res) => {
  const { licenseKey, machineId, hostname } = req.body;

  if (!licenseKey || !machineId) {
    return res.status(400).json({ ok: false, error: 'MISSING_PARAMS' });
  }

  // 1. Buscar licencia
  const license = db.prepare(`
    SELECT * FROM licenses WHERE license_key = ? AND active = 1
  `).get(licenseKey.toUpperCase());

  if (!license) return res.json({ ok: false, error: 'INVALID_KEY' });

  // 2. Verificar vencimiento
  if (license.expires_at && new Date(license.expires_at) < new Date()) {
    return res.json({ ok: false, error: 'EXPIRED' });
  }

  // 3. Verificar si esta máquina ya está activada
  const existingActivation = db.prepare(`
    SELECT * FROM activations WHERE license_id = ? AND machine_id = ?
  `).get(license.id, machineId);

  if (existingActivation) {
    // Actualizar last_seen y reactivar si fue desactivada
    db.prepare(`
      UPDATE activations SET last_seen = datetime('now'), active = 1, hostname = ?
      WHERE license_id = ? AND machine_id = ?
    `).run(hostname || null, license.id, machineId);
  } else {
    // Nueva máquina: verificar límite
    const activeCount = db.prepare(`
      SELECT COUNT(*) AS c FROM activations WHERE license_id = ? AND active = 1
    `).get(license.id).c;

    if (activeCount >= license.max_machines) {
      return res.json({ ok: false, error: 'MAX_MACHINES' });
    }

    // Registrar nueva activación
    db.prepare(`
      INSERT INTO activations (license_id, machine_id, hostname) VALUES (?,?,?)
    `).run(license.id, machineId, hostname || null);
  }

  // 4. Generar JWT para el cliente
  const features = JSON.parse(license.features || '{}');
  const token = signLicenseToken({
    licenseKey: license.license_key,
    client:     license.client_name,
    machineId,
    features,
    maxMachines: license.max_machines,
  });

  res.json({ ok: true, token, client: license.client_name, features });
});

// ── POST /api/licenses/deactivate ─────────────────────────────────────────────
router.post('/deactivate', (req, res) => {
  const { licenseKey, machineId } = req.body;
  if (!licenseKey || !machineId) return res.status(400).json({ error: 'MISSING_PARAMS' });

  const license = db.prepare('SELECT id FROM licenses WHERE license_key = ?')
    .get(licenseKey.toUpperCase());

  if (!license) return res.status(404).json({ error: 'NOT_FOUND' });

  db.prepare(`
    UPDATE activations SET active = 0 WHERE license_id = ? AND machine_id = ?
  `).run(license.id, machineId);

  res.json({ ok: true });
});

// ── POST /api/admin/login ─────────────────────────────────────────────────────
router.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM superadmins WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }
  const token = jwt.sign({ id: admin.id, username: admin.username },
    process.env.ADMIN_JWT_SECRET, { expiresIn: '8h' });
  res.json({ ok: true, token, nombre: admin.nombre });
});

// ── POST /api/admin/licenses — crear licencia ─────────────────────────────────
router.post('/admin/licenses', requireLicenseAdmin, (req, res) => {
  const { client_name, client_email, max_machines, features, expires_at, notes } = req.body;

  if (!client_name) return res.status(400).json({ error: 'client_name requerido' });

  const key = generateLicenseKey();
  db.prepare(`
    INSERT INTO licenses (license_key, client_name, client_email, max_machines, features, expires_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    key,
    client_name,
    client_email || null,
    max_machines || 1,
    JSON.stringify(features || {}),
    expires_at   || null,
    notes        || null
  );

  res.json({ ok: true, license_key: key });
});

// ── GET /api/admin/licenses — listar licencias ────────────────────────────────
router.get('/admin/licenses', requireLicenseAdmin, (req, res) => {
  const licenses = db.prepare(`
    SELECT l.*,
      (SELECT COUNT(*) FROM activations a WHERE a.license_id = l.id AND a.active = 1) AS machines_used
    FROM licenses l ORDER BY l.created_at DESC
  `).all();
  res.json(licenses.map(l => ({ ...l, features: JSON.parse(l.features) })));
});

// ── GET /api/admin/licenses/:id ───────────────────────────────────────────────
router.get('/admin/licenses/:id', requireLicenseAdmin, (req, res) => {
  const license = db.prepare('SELECT * FROM licenses WHERE id = ?').get(req.params.id);
  if (!license) return res.status(404).json({ error: 'No encontrada' });

  const activations = db.prepare(`
    SELECT * FROM activations WHERE license_id = ? ORDER BY last_seen DESC
  `).all(license.id);

  res.json({
    ...license,
    features:    JSON.parse(license.features),
    activations,
  });
});

// ── PUT /api/admin/licenses/:id ───────────────────────────────────────────────
router.put('/admin/licenses/:id', requireLicenseAdmin, (req, res) => {
  const { client_name, max_machines, features, expires_at, active, notes } = req.body;
  db.prepare(`
    UPDATE licenses
    SET client_name  = COALESCE(?, client_name),
        max_machines = COALESCE(?, max_machines),
        features     = COALESCE(?, features),
        expires_at   = ?,
        active       = COALESCE(?, active),
        notes        = ?
    WHERE id = ?
  `).run(
    client_name  || null,
    max_machines || null,
    features ? JSON.stringify(features) : null,
    expires_at !== undefined ? expires_at : undefined,
    active !== undefined ? active : null,
    notes  !== undefined ? notes  : null,
    req.params.id
  );
  res.json({ ok: true });
});

// ── DELETE /api/admin/licenses/:id/machines/:machineId ────────────────────────
router.delete('/admin/licenses/:id/machines/:machineId', requireLicenseAdmin, (req, res) => {
  db.prepare(`
    UPDATE activations SET active = 0 WHERE license_id = ? AND machine_id = ?
  `).run(req.params.id, req.params.machineId);
  res.json({ ok: true });
});

module.exports = router;
