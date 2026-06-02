/**
 * Base de datos del servidor de licencias.
 * Se ejecuta en la nube (Railway / Render / VPS).
 */

const Database = require('better-sqlite3');
const path     = require('path');
const crypto   = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/licenses.db');

// Asegurar que el directorio existe
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Tablas ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS licenses (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    license_key   TEXT    UNIQUE NOT NULL,
    client_name   TEXT    NOT NULL,
    client_email  TEXT,
    max_machines  INTEGER NOT NULL DEFAULT 1,
    features      TEXT    NOT NULL DEFAULT '{}',  -- JSON
    expires_at    TEXT,                            -- ISO date, NULL = sin vencimiento
    active        INTEGER NOT NULL DEFAULT 1,
    notes         TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS activations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    license_id   INTEGER NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
    machine_id   TEXT    NOT NULL,
    hostname     TEXT,
    activated_at TEXT    NOT NULL DEFAULT (datetime('now')),
    last_seen    TEXT    NOT NULL DEFAULT (datetime('now')),
    active       INTEGER NOT NULL DEFAULT 1,
    UNIQUE(license_id, machine_id)
  );

  CREATE TABLE IF NOT EXISTS superadmins (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    nombre        TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_licenses_key        ON licenses(license_key);
  CREATE INDEX IF NOT EXISTS idx_activations_machine ON activations(machine_id);
`);

// ── Seed: superadmin del servidor de licencias ────────────────────────────────
const bcrypt = require('bcryptjs');
if (db.prepare("SELECT COUNT(*) AS c FROM superadmins").get().c === 0) {
  const hash = bcrypt.hashSync(process.env.LICENSE_ADMIN_PASS || 'admin123', 12);
  db.prepare("INSERT INTO superadmins (username, password_hash, nombre) VALUES (?,?,?)")
    .run('devadmin', hash, 'Desarrollador');
  console.log('[DB] Superadmin del servidor de licencias creado: devadmin');
}

// ── Utilidad: generar clave de licencia ───────────────────────────────────────
function generateLicenseKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin O, 0, I, 1 (confusos)
  let key = '';
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) key += '-';
    key += chars[crypto.randomInt(chars.length)];
  }
  return key; // Formato: XXXX-XXXX-XXXX-XXXX
}

module.exports = { db, generateLicenseKey };
