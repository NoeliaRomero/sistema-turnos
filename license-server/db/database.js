/**
 * Base de datos del servidor de licencias — v2
 * Modelo: cupos de activación por empresa con historial completo.
 */

const Database = require('better-sqlite3');
const path     = require('path');
const crypto   = require('crypto');
const bcrypt   = require('bcryptjs');
const fs       = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/licenses.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Tablas ────────────────────────────────────────────────────────────────────
db.exec(`
  -- Licencias por empresa
  CREATE TABLE IF NOT EXISTS licenses (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    license_key      TEXT    UNIQUE NOT NULL,
    client_name      TEXT    NOT NULL,
    client_email     TEXT,
    max_activations  INTEGER NOT NULL DEFAULT 1,   -- cupo total comprado
    activations_used INTEGER NOT NULL DEFAULT 0,   -- nuevas PCs activadas
    reinstalls       INTEGER NOT NULL DEFAULT 0,   -- reinstalaciones detectadas
    features         TEXT    NOT NULL DEFAULT '{}',
    expires_at       TEXT,
    active           INTEGER NOT NULL DEFAULT 1,
    notes            TEXT,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Registro de cada PC activada
  CREATE TABLE IF NOT EXISTS activations (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    license_id            INTEGER NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
    -- Huellas de hardware
    hardware_fingerprint  TEXT    NOT NULL,  -- SHA-256 primario (motherboard+disco) — estable
    secondary_fingerprint TEXT,              -- SHA-256 secundario (MAC+hostname)
    full_fingerprint      TEXT,              -- SHA-256 completo
    -- Info del equipo
    hostname              TEXT,
    windows_user          TEXT,
    mac_address           TEXT,
    disk_serial           TEXT,
    motherboard_id        TEXT,
    os_version            TEXT,
    -- Red
    public_ip             TEXT,
    -- Contadores
    reinstall_count       INTEGER NOT NULL DEFAULT 0,
    -- Timestamps
    first_activated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    last_seen             TEXT    NOT NULL DEFAULT (datetime('now')),
    -- Estado
    active                INTEGER NOT NULL DEFAULT 1,
    UNIQUE(license_id, hardware_fingerprint)
  );

  -- Historial completo de eventos (nunca se borra)
  CREATE TABLE IF NOT EXISTS activation_events (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    license_id           INTEGER NOT NULL REFERENCES licenses(id),
    activation_id        INTEGER REFERENCES activations(id),
    event_type           TEXT    NOT NULL, -- 'new', 'reinstall', 'reactivation', 'rejected', 'deactivated'
    hardware_fingerprint TEXT,
    hostname             TEXT,
    windows_user         TEXT,
    public_ip            TEXT,
    metadata             TEXT,             -- JSON con info completa del hardware
    created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Admins del panel de licencias
  CREATE TABLE IF NOT EXISTS superadmins (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    nombre        TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_licenses_key         ON licenses(license_key);
  CREATE INDEX IF NOT EXISTS idx_activations_fp       ON activations(hardware_fingerprint);
  CREATE INDEX IF NOT EXISTS idx_activations_license  ON activations(license_id);
  CREATE INDEX IF NOT EXISTS idx_events_license       ON activation_events(license_id);
  CREATE INDEX IF NOT EXISTS idx_events_created       ON activation_events(created_at);
`);

// ── Migraciones (para instancias existentes) ──────────────────────────────────
const migrations = [
  "ALTER TABLE licenses ADD COLUMN max_activations  INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE licenses ADD COLUMN activations_used INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE licenses ADD COLUMN reinstalls       INTEGER NOT NULL DEFAULT 0",
  // Migrar max_machines → max_activations en registros viejos
  "UPDATE licenses SET max_activations = max_machines WHERE max_activations = 1 AND max_machines > 1",
];
migrations.forEach(sql => { try { db.exec(sql); } catch (_) {} });

// ── Seed superadmin ───────────────────────────────────────────────────────────
if (db.prepare("SELECT COUNT(*) AS c FROM superadmins").get().c === 0) {
  const hash = bcrypt.hashSync(process.env.LICENSE_ADMIN_PASS || 'admin123', 12);
  db.prepare("INSERT INTO superadmins (username, password_hash, nombre) VALUES (?,?,?)")
    .run('devadmin', hash, 'Desarrollador');
  console.log('[DB] SuperAdmin creado: devadmin');
}

// ── Generador de claves ───────────────────────────────────────────────────────
function generateLicenseKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let key = '';
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) key += '-';
    key += chars[crypto.randomInt(chars.length)];
  }
  return key;
}

module.exports = { db, generateLicenseKey };
