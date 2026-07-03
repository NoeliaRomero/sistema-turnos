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

// ── Tabla vipers ─────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS vipers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo_viper TEXT    UNIQUE NOT NULL,
    activo       INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS configuracion_serial (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    puerto  TEXT,
    baudios INTEGER DEFAULT 115200
  );

  CREATE TABLE IF NOT EXISTS configuracion_rf (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    frecuencia      TEXT    DEFAULT '433.92 MHz',
    canal           INTEGER DEFAULT 1,
    retransmisiones INTEGER DEFAULT 3,
    intervalo_ms    INTEGER DEFAULT 100
  );

  CREATE TABLE IF NOT EXISTS viper_eventos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    viper_id     INTEGER REFERENCES vipers(id),
    usuario_id   INTEGER REFERENCES usuarios(id),
    usuario_nombre TEXT,
    accion       TEXT    NOT NULL,
    resultado    TEXT,
    ack_estado   TEXT,
    detalle      TEXT,
    created_at   DATETIME DEFAULT (datetime('now','localtime'))
  );
`);

// ── Migraciones ───────────────────────────────────────────────────────────────
[
  "ALTER TABLE turnos      ADD COLUMN llamado_por              INTEGER REFERENCES usuarios(id)",
  "ALTER TABLE turnos      ADD COLUMN finalizado_por           INTEGER REFERENCES usuarios(id)",
  "ALTER TABLE turnos      ADD COLUMN cantidad_miembros        INTEGER DEFAULT 1",
  "ALTER TABLE turnos      ADD COLUMN viper_id                 INTEGER REFERENCES vipers(id)",
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
  "ALTER TABLE turnos      ADD COLUMN etapa_actual_id         INTEGER REFERENCES juego_etapas(id)",
  "ALTER TABLE vipers      ADD COLUMN estado                   TEXT DEFAULT 'PENDIENTE'",
  "ALTER TABLE vipers      ADD COLUMN codigo_raw                TEXT",
  "ALTER TABLE vipers      ADD COLUMN baudrate                  INTEGER DEFAULT 115200",
  "ALTER TABLE vipers      ADD COLUMN fecha_validacion          DATETIME",
  "ALTER TABLE vipers      ADD COLUMN ultimo_test               DATETIME",
  "ALTER TABLE vipers      ADD COLUMN ultimo_error              TEXT",
  "ALTER TABLE vipers      ADD COLUMN codigo_rf                 TEXT",
  "ALTER TABLE vipers      ADD COLUMN canal                     INTEGER DEFAULT 1",
  "ALTER TABLE vipers      ADD COLUMN fecha_creacion             DATETIME",
  "ALTER TABLE vipers      ADD COLUMN ultima_activacion          DATETIME",
  "ALTER TABLE turnos      ADD COLUMN orden_cola                INTEGER",
].forEach(sql => { try { db.exec(sql); } catch (_) {} });

// Inicializar orden_cola para turnos existentes sin valor
db.exec(`
  UPDATE turnos SET orden_cola = id
  WHERE orden_cola IS NULL AND estado = 'esperando'
`);

// ── Tabla juego_etapas ────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS juego_etapas (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    juego_id         INTEGER NOT NULL REFERENCES atracciones(id) ON DELETE CASCADE,
    nombre           TEXT    NOT NULL,
    duracion_minutos INTEGER NOT NULL DEFAULT 1,
    orden            INTEGER NOT NULL DEFAULT 1,
    activa           INTEGER NOT NULL DEFAULT 1,
    created_at       DATETIME DEFAULT (datetime('now','localtime')),
    updated_at       DATETIME DEFAULT (datetime('now','localtime'))
  );
`);

// ── Tabla turno_etapas_historial ──────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS turno_etapas_historial (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    turno_id        INTEGER NOT NULL REFERENCES turnos(id),
    etapa_id        INTEGER NOT NULL REFERENCES juego_etapas(id),
    etapa_nombre    TEXT    NOT NULL,
    etapa_orden     INTEGER NOT NULL,
    iniciada_at     DATETIME DEFAULT NULL,
    finalizada_at   DATETIME DEFAULT NULL,
    iniciada_por    INTEGER REFERENCES usuarios(id),
    finalizada_por  INTEGER REFERENCES usuarios(id)
  );
`);

// Completar fecha_creacion de VIPERs creados antes de esta migración
db.exec(`UPDATE vipers SET fecha_creacion = datetime('now','localtime') WHERE fecha_creacion IS NULL`);

if (db.prepare('SELECT COUNT(*) AS c FROM configuracion_rf').get().c === 0) {
  db.prepare('INSERT INTO configuracion_rf (id, frecuencia, canal, retransmisiones, intervalo_ms) VALUES (1, ?, ?, ?, ?)')
    .run('433.92 MHz', 1, 3, 100);
}

// Normalizar estado de VIPERs creados antes de esta migración (basados en "activo")
db.exec(`
  UPDATE vipers SET estado = 'ACTIVO'    WHERE activo = 1 AND (estado IS NULL OR estado = 'PENDIENTE');
  UPDATE vipers SET estado = 'PENDIENTE' WHERE estado IS NULL;
`);

if (db.prepare('SELECT COUNT(*) AS c FROM configuracion_serial').get().c === 0) {
  db.prepare('INSERT INTO configuracion_serial (id, puerto, baudios) VALUES (1, NULL, 115200)').run();
}

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
