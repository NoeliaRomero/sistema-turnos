const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const path   = require('path');

const db = new DatabaseSync(path.join(__dirname, 'turnos.db'));
db.exec('PRAGMA journal_mode = WAL');

// ── Tablas principales ────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS atracciones (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre           TEXT    NOT NULL,
    duracion_minutos INTEGER DEFAULT 30,
    min_miembros     INTEGER DEFAULT 1,
    max_miembros     INTEGER DEFAULT 20,
    activa           INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS usuarios (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre                   TEXT    NOT NULL,
    username                 TEXT    NOT NULL UNIQUE,
    password_hash            TEXT    NOT NULL,
    rol                      TEXT    NOT NULL DEFAULT 'operador',
    atraccion_id             INTEGER REFERENCES atracciones(id),
    activo                   INTEGER DEFAULT 1,
    permiso_gestionar_juegos INTEGER DEFAULT 0,
    permiso_cancelar_turno   INTEGER DEFAULT 0,
    created_at               DATETIME DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS turnos (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    atraccion_id      INTEGER NOT NULL REFERENCES atracciones(id),
    biper_numero      TEXT    NOT NULL,
    nombre_cliente    TEXT,
    cantidad_miembros INTEGER DEFAULT 1,
    estado            TEXT    DEFAULT 'esperando',
    llamado_por       INTEGER REFERENCES usuarios(id),
    finalizado_por    INTEGER REFERENCES usuarios(id),
    created_at        DATETIME DEFAULT (datetime('now','localtime')),
    called_at         DATETIME,
    finished_at       DATETIME
  );
`);

// ── Migraciones ───────────────────────────────────────────────────────────────
[
  "ALTER TABLE turnos      ADD COLUMN llamado_por              INTEGER REFERENCES usuarios(id)",
  "ALTER TABLE turnos      ADD COLUMN finalizado_por           INTEGER REFERENCES usuarios(id)",
  "ALTER TABLE turnos      ADD COLUMN cantidad_miembros        INTEGER DEFAULT 1",
  "ALTER TABLE atracciones ADD COLUMN duracion_minutos         INTEGER DEFAULT 30",
  "ALTER TABLE atracciones ADD COLUMN min_miembros             INTEGER DEFAULT 1",
  "ALTER TABLE atracciones ADD COLUMN max_miembros             INTEGER DEFAULT 20",
  "ALTER TABLE usuarios    ADD COLUMN permiso_gestionar_juegos INTEGER DEFAULT 0",
  "ALTER TABLE usuarios    ADD COLUMN permiso_cancelar_turno   INTEGER DEFAULT 0",
  "ALTER TABLE usuarios    ADD COLUMN permiso_llamar_turno     INTEGER DEFAULT 0",
  "ALTER TABLE usuarios    ADD COLUMN feature_juegos           INTEGER DEFAULT 1",
  "ALTER TABLE usuarios    ADD COLUMN feature_graficos         INTEGER DEFAULT 1",
  "ALTER TABLE usuarios    ADD COLUMN feature_cancelar_turno  INTEGER DEFAULT 1",
  "ALTER TABLE usuarios    ADD COLUMN feature_llamar_turno    INTEGER DEFAULT 1",
  "ALTER TABLE atracciones ADD COLUMN usa_etapas              INTEGER DEFAULT 0",
].forEach(sql => { try { db.exec(sql); } catch (_) {} });

// ── Tabla juego_etapas ────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS juego_etapas (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    juego_id         INTEGER NOT NULL REFERENCES atracciones(id) ON DELETE CASCADE,
    nombre           TEXT    NOT NULL,
    duracion_minutos INTEGER NOT NULL DEFAULT 1,
    orden            INTEGER NOT NULL DEFAULT 1,
    created_at       DATETIME DEFAULT (datetime('now','localtime')),
    updated_at       DATETIME DEFAULT (datetime('now','localtime'))
  );
`);

// ── Datos iniciales ───────────────────────────────────────────────────────────
if (db.prepare('SELECT COUNT(*) AS c FROM atracciones').get().c === 0) {
  [['Paintball', 45], ['Karting', 20], ['Tiro al Blanco', 15]].forEach(([n, d]) =>
    db.prepare('INSERT INTO atracciones (nombre, duracion_minutos) VALUES (?,?)').run(n, d)
  );
}

if (db.prepare("SELECT COUNT(*) AS c FROM usuarios WHERE rol='superadmin'").get().c === 0) {
  const hash = bcrypt.hashSync('super123', 10);
  db.prepare("INSERT INTO usuarios (nombre, username, password_hash, rol) VALUES (?,?,?,?)")
    .run('Desarrollador', 'superadmin', hash, 'superadmin');
  console.log('Superadmin creado  →  usuario: superadmin  |  contraseña: super123');
}

if (db.prepare("SELECT COUNT(*) AS c FROM usuarios WHERE rol='admin'").get().c === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare(
    "INSERT INTO usuarios (nombre, username, password_hash, rol) VALUES (?,?,?,?)"
  ).run('Administrador', 'admin', hash, 'admin');
  console.log('Usuario admin creado  →  usuario: admin  |  contraseña: admin123');
}

module.exports = db;
