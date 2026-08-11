const express  = require('express');
const router   = express.Router();
const db       = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const crypto   = require('crypto');
const archiver = require('archiver');
const AdmZip   = require('adm-zip');
const cron     = require('node-cron');
const ExcelJS  = require('exceljs');

// ── Constantes ────────────────────────────────────────────────────────────────
const SCHEMA_VERSION = 1;
const APP_ROOT       = path.join(__dirname, '..');
// En Electron: userData/db y userData/backups. En dev: db/ y backups/ del proyecto.
const DB_DIR_RUNTIME     = process.env.SISTEMA_DB_DIR     || path.join(APP_ROOT, 'db');
const DEFAULT_BACKUP_DIR = process.env.SISTEMA_BACKUP_DIR || path.join(APP_ROOT, 'backups');
const BACKUP_REGEX   = /^SistemaUniversal_Backup_\d{4}-\d{2}-\d{2}_\d{4}_(manual|auto)\.zip$/;

// ── Scheduler ─────────────────────────────────────────────────────────────────
let cronJob = null;

function configurarCron() {
  if (cronJob) { cronJob.stop(); cronJob = null; }

  const cfg = db.prepare('SELECT * FROM configuracion_backup WHERE id = 1').get();
  if (!cfg || !cfg.habilitado || cfg.frecuencia === 'manual') return;

  const [hora, min] = (cfg.hora || '02:00').split(':').map(Number);
  let expr;
  switch (cfg.frecuencia) {
    case 'diario':
      expr = `${min} ${hora} * * *`;
      break;
    case 'semanal':
      expr = `${min} ${hora} * * ${cfg.dia_semana}`;
      break;
    case 'mensual':
      expr = `${min} ${hora} ${cfg.dia_mes} * *`;
      break;
    case 'anual': {
      const [mes, dia] = (cfg.fecha_anual || '01-01').split('-').map(Number);
      expr = `${min} ${hora} ${dia} ${mes} *`;
      break;
    }
    default:
      return;
  }

  if (!cron.validate(expr)) {
    console.error('[BACKUP] Expresión cron inválida:', expr);
    return;
  }

  cronJob = cron.schedule(expr, () => {
    crearBackupInterno('auto').catch(err =>
      console.error('[BACKUP] Error en backup automático:', err.message)
    );
  });
  console.log(`[BACKUP] Backup automático programado: ${expr}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getCarpeta() {
  const cfg = db.prepare('SELECT carpeta_destino FROM configuracion_backup WHERE id = 1').get();
  return (cfg?.carpeta_destino?.trim()) || DEFAULT_BACKUP_DIR;
}

function validarRuta(ruta) {
  if (!ruta || typeof ruta !== 'string') return false;
  if (ruta.includes('\0')) return false;
  const resuelto = path.resolve(ruta);
  // Bloquear raíces del sistema (Windows y Linux)
  const bloqueadas = ['C:\\Windows', 'C:\\Program Files', '/bin', '/sbin', '/usr', '/etc', '/boot'];
  return !bloqueadas.some(b => resuelto.toLowerCase().startsWith(b.toLowerCase()));
}

function timestamp() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-') + '_' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
}

function nombreArchivo(tipo) {
  return `SistemaUniversal_Backup_${timestamp()}_${tipo}.zip`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function listarBackups(carpeta) {
  if (!fs.existsSync(carpeta)) return [];
  return fs.readdirSync(carpeta)
    .filter(f => BACKUP_REGEX.test(f))
    .map(f => {
      const stat = fs.statSync(path.join(carpeta, f));
      return { nombre: f, fecha: stat.mtime.toISOString(), tamano: formatBytes(stat.size), tamano_bytes: stat.size };
    })
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
}

function aplicarRetencion(carpeta, max) {
  const lista = listarBackups(carpeta);
  if (lista.length <= max) return;
  lista.slice(max).forEach(b => {
    try { fs.unlinkSync(path.join(carpeta, b.nombre)); } catch (_) {}
  });
}

// ── Crear backup interno ──────────────────────────────────────────────────────
async function crearBackupInterno(tipo = 'manual') {
  const carpeta = getCarpeta();
  if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true });

  const nombre   = nombreArchivo(tipo);
  const destino  = path.join(carpeta, nombre);
  const tmpDb    = path.join(os.tmpdir(), `backup_tmp_${Date.now()}.db`);

  // Crear copia consistente de la DB (funciona con WAL y conexiones activas)
  db.exec(`VACUUM INTO '${tmpDb.replace(/'/g, "''")}'`);

  const meta = {
    version:        '1.0.0',
    schema_version: SCHEMA_VERSION,
    tipo,
    timestamp:      new Date().toISOString(),
    tablas: [
      'atracciones', 'usuarios', 'turnos', 'vipers',
      'juego_etapas', 'juego_subcategorias', 'turno_etapas_historial',
      'viper_eventos', 'configuracion_serial', 'configuracion_rf',
      'configuracion_general', 'configuracion_backup',
    ],
    checksum_db: crypto.createHash('sha256').update(fs.readFileSync(tmpDb)).digest('hex'),
  };

  await new Promise((resolve, reject) => {
    const output  = fs.createWriteStream(destino);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);

    archive.file(tmpDb, { name: 'turnos.db' });
    archive.append(JSON.stringify(meta, null, 2), { name: 'meta.json' });
    archive.finalize();
  });

  try { fs.unlinkSync(tmpDb); } catch (_) {}

  // Retención
  const cfg = db.prepare('SELECT max_backups FROM configuracion_backup WHERE id = 1').get();
  if (cfg?.max_backups > 0) aplicarRetencion(carpeta, cfg.max_backups);

  return { nombre, destino };
}

// ── Validar ZIP de backup ─────────────────────────────────────────────────────
function validarZip(rutaZip) {
  if (!fs.existsSync(rutaZip)) return { ok: false, error: 'El archivo no existe.' };

  let zip;
  try {
    zip = new AdmZip(rutaZip);
  } catch (_) {
    return { ok: false, error: 'El archivo está corrupto o no es un ZIP válido.' };
  }

  const entradas = zip.getEntries().map(e => e.entryName);
  if (!entradas.includes('turnos.db')) return { ok: false, error: 'El backup no contiene la base de datos.' };
  if (!entradas.includes('meta.json')) return { ok: false, error: 'El backup no contiene metadatos.' };

  let meta;
  try {
    meta = JSON.parse(zip.readAsText('meta.json'));
  } catch (_) {
    return { ok: false, error: 'Los metadatos del backup están corruptos.' };
  }

  if (!meta.schema_version) return { ok: false, error: 'El backup no tiene versión de esquema.' };
  if (meta.schema_version > SCHEMA_VERSION) {
    return { ok: false, error: `El backup es de una versión más nueva (esquema ${meta.schema_version}). Actualizá el sistema primero.` };
  }

  // Verificar checksum
  const dbEntry = zip.getEntry('turnos.db');
  if (meta.checksum_db) {
    const checksum = crypto.createHash('sha256').update(dbEntry.getData()).digest('hex');
    if (checksum !== meta.checksum_db) return { ok: false, error: 'El archivo de base de datos está corrupto (checksum inválido).' };
  }

  return { ok: true, meta };
}

// ═══════════════════════════════════════════════════════════════════════════════
// RUTAS API
// ═══════════════════════════════════════════════════════════════════════════════

router.use(requireAuth('admin', 'superadmin'));

// ── GET /api/backup/config ────────────────────────────────────────────────────
router.get('/config', (req, res) => {
  const cfg = db.prepare('SELECT * FROM configuracion_backup WHERE id = 1').get();
  res.json(cfg);
});

// ── PUT /api/backup/config ────────────────────────────────────────────────────
router.put('/config', (req, res) => {
  const { habilitado, frecuencia, hora, dia_semana, dia_mes, fecha_anual, max_backups, carpeta_destino } = req.body;

  const frecuenciasValidas = ['manual', 'diario', 'semanal', 'mensual', 'anual'];
  if (frecuencia && !frecuenciasValidas.includes(frecuencia)) {
    return res.status(400).json({ error: 'Frecuencia inválida.' });
  }
  if (hora && !/^\d{1,2}:\d{2}$/.test(hora)) {
    return res.status(400).json({ error: 'Hora inválida. Usar formato HH:MM.' });
  }
  if (carpeta_destino && !validarRuta(carpeta_destino)) {
    return res.status(400).json({ error: 'Ruta de carpeta inválida o no permitida.' });
  }
  if (max_backups !== undefined && (max_backups < 1 || max_backups > 365)) {
    return res.status(400).json({ error: 'Cantidad de backups debe estar entre 1 y 365.' });
  }

  const actual = db.prepare('SELECT * FROM configuracion_backup WHERE id = 1').get();
  db.prepare(`
    UPDATE configuracion_backup SET
      habilitado      = ?,
      frecuencia      = ?,
      hora            = ?,
      dia_semana      = ?,
      dia_mes         = ?,
      fecha_anual     = ?,
      max_backups     = ?,
      carpeta_destino = ?
    WHERE id = 1
  `).run(
    habilitado !== undefined ? (habilitado ? 1 : 0) : actual.habilitado,
    frecuencia      || actual.frecuencia,
    hora            || actual.hora,
    dia_semana      !== undefined ? Number(dia_semana)  : actual.dia_semana,
    dia_mes         !== undefined ? Number(dia_mes)     : actual.dia_mes,
    fecha_anual     || actual.fecha_anual,
    max_backups     !== undefined ? Number(max_backups) : actual.max_backups,
    carpeta_destino !== undefined ? (carpeta_destino || null) : actual.carpeta_destino,
  );

  configurarCron();
  res.json({ ok: true });
});

// ── GET /api/backup/listar ────────────────────────────────────────────────────
router.get('/listar', (req, res) => {
  try {
    const carpeta = getCarpeta();
    const lista   = listarBackups(carpeta);
    res.json({ carpeta, lista });
  } catch (err) {
    res.status(500).json({ error: 'Error al listar backups.' });
  }
});

// ── POST /api/backup/crear ────────────────────────────────────────────────────
router.post('/crear', async (req, res) => {
  try {
    const { nombre } = await crearBackupInterno('manual');
    res.json({ ok: true, nombre });
  } catch (err) {
    console.error('[BACKUP] Error al crear backup:', err.message);
    res.status(500).json({ error: 'No se pudo crear el backup. Revisá los permisos de la carpeta de destino.' });
  }
});

// ── POST /api/backup/restaurar ────────────────────────────────────────────────
// Valida el backup y prepara la restauración para el próximo inicio del servidor.
router.post('/restaurar', async (req, res) => {
  const { nombre } = req.body;

  if (!nombre || !BACKUP_REGEX.test(nombre)) {
    return res.status(400).json({ error: 'Nombre de backup inválido.' });
  }

  const carpeta = getCarpeta();
  const rutaZip = path.join(carpeta, nombre);
  const validacion = validarZip(rutaZip);

  if (!validacion.ok) {
    return res.status(400).json({ error: validacion.error });
  }

  try {
    // 1. Crear backup de seguridad del estado actual antes de restaurar
    const { nombre: nombreSeguridad } = await crearBackupInterno('auto');

    // 2. Extraer la DB del ZIP y guardarla como restauración pendiente
    const zip    = new AdmZip(rutaZip);
    const dbData = zip.getEntry('turnos.db').getData();

    const pendingDb   = path.join(DB_DIR_RUNTIME, 'pending_restore.db');
    const pendingFlag = path.join(DB_DIR_RUNTIME, '.restore_pending');

    fs.writeFileSync(pendingDb, dbData);
    fs.writeFileSync(pendingFlag, JSON.stringify({
      backup:    nombre,
      safety:    nombreSeguridad,
      timestamp: new Date().toISOString(),
      meta:      validacion.meta,
    }));

    res.json({
      ok: true,
      mensaje: 'La restauración quedó preparada. Reiniciá el servidor para completar el proceso. Si algo sale mal, se restaurará automáticamente el backup de seguridad creado ahora.',
      backup_seguridad: nombreSeguridad,
    });
  } catch (err) {
    console.error('[BACKUP] Error al preparar restauración:', err.message);
    // Limpiar archivos parciales
    try { fs.unlinkSync(path.join(DB_DIR_RUNTIME, 'pending_restore.db')); } catch (_) {}
    try { fs.unlinkSync(path.join(DB_DIR_RUNTIME, '.restore_pending')); } catch (_) {}
    res.status(500).json({ error: 'No se pudo preparar la restauración.' });
  }
});

// ── DELETE /api/backup/:nombre ────────────────────────────────────────────────
router.delete('/:nombre', (req, res) => {
  const { nombre } = req.params;
  if (!BACKUP_REGEX.test(nombre)) {
    return res.status(400).json({ error: 'Nombre de backup inválido.' });
  }

  const carpeta = getCarpeta();
  const ruta    = path.join(carpeta, nombre);

  if (!fs.existsSync(ruta)) return res.status(404).json({ error: 'Backup no encontrado.' });

  try {
    fs.unlinkSync(ruta);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo eliminar el backup.' });
  }
});

// ── GET /api/backup/descargar/:nombre ─────────────────────────────────────────
router.get('/descargar/:nombre', (req, res) => {
  const { nombre } = req.params;
  if (!BACKUP_REGEX.test(nombre)) {
    return res.status(400).json({ error: 'Nombre de archivo inválido.' });
  }

  const carpeta = getCarpeta();
  const ruta    = path.join(carpeta, nombre);

  if (!fs.existsSync(ruta)) return res.status(404).json({ error: 'Backup no encontrado.' });

  res.download(ruta, nombre);
});

// ── GET /api/backup/estado-restauracion ──────────────────────────────────────
router.get('/estado-restauracion', (req, res) => {
  const flag = path.join(DB_DIR_RUNTIME, '.restore_pending');
  if (fs.existsSync(flag)) {
    try {
      const info = JSON.parse(fs.readFileSync(flag, 'utf8'));
      return res.json({ pendiente: true, info });
    } catch (_) {}
  }
  res.json({ pendiente: false });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTACIÓN CSV / XLSX
// ═══════════════════════════════════════════════════════════════════════════════

// Función para escapar campos CSV (RFC 4180)
function csvField(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function csvRow(fields) {
  return fields.map(csvField).join(',') + '\r\n';
}

// BOM UTF-8 para compatibilidad con Excel
const BOM = '\uFEFF';

function formatFecha(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  if (isNaN(d)) return dt;
  return d.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false });
}

// ── POST /api/backup/exportar/csv ─────────────────────────────────────────────
router.post('/exportar/csv', async (req, res) => {
  const { tipo = 'turnos', desde, hasta, atraccion_id, estado } = req.body;

  try {
    let csv = BOM;

    if (tipo === 'turnos') {
      const condiciones = ['1=1'];
      const params = [];

      if (desde) { condiciones.push("DATE(t.created_at) >= DATE(?)"); params.push(desde); }
      if (hasta) { condiciones.push("DATE(t.created_at) <= DATE(?)"); params.push(hasta); }
      if (atraccion_id) { condiciones.push("t.atraccion_id = ?"); params.push(Number(atraccion_id)); }
      if (estado) { condiciones.push("t.estado = ?"); params.push(estado); }

      const filas = db.prepare(`
        SELECT
          t.id,
          t.created_at,
          t.called_at,
          t.jugando_desde,
          t.finished_at,
          a.nombre         AS juego,
          sc.nombre        AS subcategoria,
          t.nombre_cliente AS familia,
          t.cantidad_miembros,
          t.biper_numero,
          v.codigo_viper   AS viper,
          t.estado,
          uc.nombre        AS creado_por,
          uf.nombre        AS finalizado_por
        FROM turnos t
        LEFT JOIN atracciones       a  ON t.atraccion_id    = a.id
        LEFT JOIN juego_subcategorias sc ON t.subcategoria_id = sc.id
        LEFT JOIN vipers            v  ON t.viper_id        = v.id
        LEFT JOIN usuarios          uc ON t.creado_por      = uc.id
        LEFT JOIN usuarios          uf ON t.finalizado_por  = uf.id
        WHERE ${condiciones.join(' AND ')}
        ORDER BY t.id
      `).all(...params);

      csv += csvRow(['ID','Fecha Registro','Fecha Llamado','Inicio Juego','Fecha Finalización',
        'Juego','Subcategoría','Familia','Cantidad Miembros','Biper','VIPER',
        'Estado','Registrado por','Finalizado por']);
      filas.forEach(r => csv += csvRow([
        r.id, formatFecha(r.created_at), formatFecha(r.called_at),
        formatFecha(r.jugando_desde), formatFecha(r.finished_at),
        r.juego, r.subcategoria, r.familia, r.cantidad_miembros,
        r.biper_numero, r.viper, r.estado, r.creado_por, r.finalizado_por,
      ]));

    } else if (tipo === 'usuarios') {
      const filas = db.prepare(`
        SELECT u.id, u.nombre, u.username, u.rol, a.nombre AS atraccion, u.activo, u.created_at
        FROM usuarios u
        LEFT JOIN atracciones a ON u.atraccion_id = a.id
        WHERE u.rol != 'superadmin'
        ORDER BY u.rol, u.nombre
      `).all();
      csv += csvRow(['ID','Nombre','Usuario','Rol','Atracción','Activo','Fecha Creación']);
      filas.forEach(r => csv += csvRow([
        r.id, r.nombre, r.username, r.rol, r.atraccion, r.activo ? 'Sí' : 'No', formatFecha(r.created_at),
      ]));

    } else if (tipo === 'juegos') {
      const filas = db.prepare(`
        SELECT id, nombre, duracion_minutos, min_miembros, max_miembros,
               usa_etapas, usa_subcategorias, activa
        FROM atracciones ORDER BY nombre
      `).all();
      csv += csvRow(['ID','Nombre','Duración (min)','Mín. Miembros','Máx. Miembros',
        'Usa Etapas','Usa Subcategorías','Activa']);
      filas.forEach(r => csv += csvRow([
        r.id, r.nombre, r.duracion_minutos, r.min_miembros, r.max_miembros,
        r.usa_etapas ? 'Sí' : 'No', r.usa_subcategorias ? 'Sí' : 'No', r.activa ? 'Sí' : 'No',
      ]));

    } else if (tipo === 'vipers') {
      const filas = db.prepare(`
        SELECT id, codigo_viper, estado, canal, fecha_creacion, ultima_activacion, ultimo_test
        FROM vipers ORDER BY id
      `).all();
      csv += csvRow(['ID','Código VIPER','Estado','Canal','Fecha Creación','Última Activación','Último Test']);
      filas.forEach(r => csv += csvRow([
        r.id, r.codigo_viper, r.estado, r.canal,
        formatFecha(r.fecha_creacion), formatFecha(r.ultima_activacion), formatFecha(r.ultimo_test),
      ]));

    } else if (tipo === 'estadisticas') {
      const resumen = db.prepare(`
        SELECT
          COUNT(*)                                                           AS total,
          SUM(CASE WHEN estado='finalizado'              THEN 1 ELSE 0 END) AS finalizados,
          SUM(CASE WHEN estado='esperando'               THEN 1 ELSE 0 END) AS en_espera,
          SUM(CASE WHEN estado IN ('llamado','jugando')  THEN 1 ELSE 0 END) AS en_curso,
          SUM(CASE WHEN estado IN ('cancelado','no_llego') THEN 1 ELSE 0 END) AS cancelados
        FROM turnos
      `).get();

      const porJuego = db.prepare(`
        SELECT a.nombre, COUNT(*) AS total, SUM(CASE WHEN t.estado='finalizado' THEN 1 ELSE 0 END) AS finalizados
        FROM turnos t JOIN atracciones a ON t.atraccion_id = a.id
        GROUP BY a.id ORDER BY total DESC
      `).all();

      csv += csvRow(['RESUMEN GENERAL']);
      csv += csvRow(['Total Turnos','Finalizados','En Espera','En Curso','Cancelados']);
      csv += csvRow([resumen.total, resumen.finalizados, resumen.en_espera, resumen.en_curso, resumen.cancelados]);
      csv += '\r\n';
      csv += csvRow(['TURNOS POR JUEGO']);
      csv += csvRow(['Juego','Total','Finalizados']);
      porJuego.forEach(r => csv += csvRow([r.nombre, r.total, r.finalizados]));
    } else {
      return res.status(400).json({ error: 'Tipo de exportación no válido.' });
    }

    const nombreArchivo = `SistemaUniversal_${tipo.charAt(0).toUpperCase() + tipo.slice(1)}_${timestamp().replace('_', '-')}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    res.send(csv);

  } catch (err) {
    console.error('[BACKUP] Error al exportar CSV:', err.message);
    res.status(500).json({ error: 'Error al generar la exportación.' });
  }
});

// ── POST /api/backup/exportar/xlsx ────────────────────────────────────────────
router.post('/exportar/xlsx', async (req, res) => {
  const { desde, hasta } = req.body;

  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sistema Universal';
    wb.created = new Date();

    const condTurnos = [];
    const paramsTurnos = [];
    if (desde) { condTurnos.push("DATE(t.created_at) >= DATE(?)"); paramsTurnos.push(desde); }
    if (hasta) { condTurnos.push("DATE(t.created_at) <= DATE(?)"); paramsTurnos.push(hasta); }
    const whereTurnos = condTurnos.length ? condTurnos.join(' AND ') : '1=1';

    function agregarHoja(nombre, headers, filas) {
      const ws = wb.addWorksheet(nombre);
      ws.addRow(headers);
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E1B4B' } };
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      filas.forEach(f => ws.addRow(f));
      ws.columns.forEach(col => {
        let maxLen = 10;
        col.eachCell(c => { if (c.value) maxLen = Math.max(maxLen, String(c.value).length + 2); });
        col.width = Math.min(maxLen, 50);
      });
    }

    // Hoja: Turnos
    const turnos = db.prepare(`
      SELECT t.id, t.created_at, t.called_at, t.jugando_desde, t.finished_at,
             a.nombre AS juego, sc.nombre AS subcategoria, t.nombre_cliente,
             t.cantidad_miembros, t.biper_numero, v.codigo_viper, t.estado,
             uc.nombre AS creado_por, uf.nombre AS finalizado_por
      FROM turnos t
      LEFT JOIN atracciones a ON t.atraccion_id = a.id
      LEFT JOIN juego_subcategorias sc ON t.subcategoria_id = sc.id
      LEFT JOIN vipers v ON t.viper_id = v.id
      LEFT JOIN usuarios uc ON t.creado_por = uc.id
      LEFT JOIN usuarios uf ON t.finalizado_por = uf.id
      WHERE ${whereTurnos}
      ORDER BY t.id
    `).all(...paramsTurnos);

    agregarHoja('Turnos',
      ['ID','Fecha','Llamado','Inicio','Finalización','Juego','Subcategoría','Familia','Miembros','Biper','VIPER','Estado','Creado por','Finalizado por'],
      turnos.map(r => [r.id, formatFecha(r.created_at), formatFecha(r.called_at), formatFecha(r.jugando_desde), formatFecha(r.finished_at), r.juego, r.subcategoria, r.nombre_cliente, r.cantidad_miembros, r.biper_numero, r.codigo_viper, r.estado, r.creado_por, r.finalizado_por])
    );

    // Hoja: Juegos
    const juegos = db.prepare(`
      SELECT id, nombre, duracion_minutos, min_miembros, max_miembros, usa_etapas, usa_subcategorias, activa
      FROM atracciones ORDER BY nombre
    `).all();
    agregarHoja('Juegos',
      ['ID','Nombre','Duración (min)','Mín. Miembros','Máx. Miembros','Usa Etapas','Usa Subcategorías','Activa'],
      juegos.map(r => [r.id, r.nombre, r.duracion_minutos, r.min_miembros, r.max_miembros, r.usa_etapas ? 'Sí' : 'No', r.usa_subcategorias ? 'Sí' : 'No', r.activa ? 'Sí' : 'No'])
    );

    // Hoja: Usuarios (sin contraseñas)
    const usuarios = db.prepare(`
      SELECT u.id, u.nombre, u.username, u.rol, a.nombre AS atraccion, u.activo, u.created_at
      FROM usuarios u LEFT JOIN atracciones a ON u.atraccion_id = a.id
      WHERE u.rol != 'superadmin' ORDER BY u.rol, u.nombre
    `).all();
    agregarHoja('Usuarios',
      ['ID','Nombre','Usuario','Rol','Atracción','Activo','Fecha Creación'],
      usuarios.map(r => [r.id, r.nombre, r.username, r.rol, r.atraccion, r.activo ? 'Sí' : 'No', formatFecha(r.created_at)])
    );

    // Hoja: VIPERs
    const vipers = db.prepare(`
      SELECT id, codigo_viper, estado, canal, fecha_creacion, ultima_activacion, ultimo_test
      FROM vipers ORDER BY id
    `).all();
    agregarHoja('VIPERs',
      ['ID','Código VIPER','Estado','Canal','Fecha Creación','Última Activación','Último Test'],
      vipers.map(r => [r.id, r.codigo_viper, r.estado, r.canal, formatFecha(r.fecha_creacion), formatFecha(r.ultima_activacion), formatFecha(r.ultimo_test)])
    );

    // Hoja: Estadísticas
    const estHoja = wb.addWorksheet('Estadísticas');
    const resumen = db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN estado='finalizado' THEN 1 ELSE 0 END) AS finalizados,
        SUM(CASE WHEN estado='esperando'  THEN 1 ELSE 0 END) AS en_espera,
        SUM(CASE WHEN estado IN ('cancelado','no_llego') THEN 1 ELSE 0 END) AS cancelados
      FROM turnos
    `).get();
    estHoja.addRow(['RESUMEN GENERAL']).font = { bold: true };
    estHoja.addRow(['Total Turnos', 'Finalizados', 'En Espera', 'Cancelados']);
    estHoja.addRow([resumen.total, resumen.finalizados, resumen.en_espera, resumen.cancelados]);
    estHoja.addRow([]);
    estHoja.addRow(['TURNOS POR JUEGO']).font = { bold: true };
    estHoja.addRow(['Juego', 'Total', 'Finalizados']);
    db.prepare(`
      SELECT a.nombre, COUNT(*) AS total, SUM(CASE WHEN t.estado='finalizado' THEN 1 ELSE 0 END) AS fin
      FROM turnos t JOIN atracciones a ON t.atraccion_id = a.id GROUP BY a.id ORDER BY total DESC
    `).all().forEach(r => estHoja.addRow([r.nombre, r.total, r.fin]));
    estHoja.columns.forEach(c => { c.width = 25; });

    const nombreArchivo = `SistemaUniversal_Exportacion_${timestamp().replace('_', '-')}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    await wb.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('[BACKUP] Error al exportar XLSX:', err.message);
    res.status(500).json({ error: 'Error al generar el Excel.' });
  }
});

module.exports = { router, configurarCron };
