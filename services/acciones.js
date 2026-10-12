// ── Historial de acciones sobre los turnos ────────────────────────────────────
// Registra en turno_acciones quién hizo qué sobre cada turno (operador,
// recepción, admin o el sistema). Se guarda una copia de los datos del turno
// y del usuario en el momento de la acción, sin depender de claves foráneas:
// un turno eliminado o un usuario renombrado siguen apareciendo tal cual.
//
// Registrar nunca debe interrumpir la operación que se está realizando: ante
// cualquier error solo se informa por consola.
const db = require('../db/database');

const USUARIO_SISTEMA = { id: null, nombre: 'Sistema', rol: 'sistema' };

let _insertar = null;
function _stmt() {
  if (!_insertar) {
    _insertar = db.prepare(`
      INSERT INTO turno_acciones (
        turno_id, atraccion_id, atraccion_nombre, biper_numero, nombre_cliente,
        cantidad_miembros, accion, usuario_id, usuario_nombre, usuario_rol,
        etapa_nombre, detalle
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `);
  }
  return _insertar;
}

// Completa nombre de atracción y de etapa si el turno recibido no los trae
// (por ejemplo, una fila leída directamente de la tabla turnos).
function _completarTurno(turno) {
  let atraccionNombre = turno.atraccion_nombre ?? null;
  let etapaNombre     = turno.etapa_actual_nombre ?? null;
  if (atraccionNombre == null && turno.atraccion_id != null) {
    atraccionNombre = db.prepare('SELECT nombre FROM atracciones WHERE id = ?').get(turno.atraccion_id)?.nombre ?? null;
  }
  if (etapaNombre == null && turno.etapa_actual_id != null) {
    etapaNombre = db.prepare('SELECT nombre FROM juego_etapas WHERE id = ?').get(turno.etapa_actual_id)?.nombre ?? null;
  }
  return { atraccionNombre, etapaNombre };
}

/**
 * Registra una acción sobre un turno. Nunca lanza excepciones.
 * @param {object} turno    Fila del turno (al menos id, atraccion_id, biper_numero).
 * @param {string} accion   Clave de la acción (ej. 'llamado', 'finalizado').
 * @param {object|null} usuario  Usuario de la sesión; null = acción automática del sistema.
 * @param {string|null} detalle  Texto libre explicativo.
 * @param {object} [opciones]    { etapaNombre } para forzar la etapa registrada.
 */
function registrarAccion(turno, accion, usuario, detalle = null, opciones = {}) {
  try {
    if (!turno) return;
    const u = usuario && usuario.id != null ? usuario : USUARIO_SISTEMA;
    const { atraccionNombre, etapaNombre } = _completarTurno(turno);
    _stmt().run(
      turno.id ?? null,
      turno.atraccion_id ?? null,
      atraccionNombre,
      turno.biper_numero != null ? String(turno.biper_numero) : null,
      turno.nombre_cliente ?? null,
      turno.cantidad_miembros ?? null,
      accion,
      u.id ?? null,
      u.nombre ?? null,
      u.rol ?? 'sistema',
      opciones.etapaNombre !== undefined ? opciones.etapaNombre : etapaNombre,
      detalle ?? null
    );
  } catch (err) {
    console.error('[ACCIONES] No se pudo registrar la acción', accion, 'del turno', turno?.id, err.message);
  }
}

// Detalle estándar para los integrantes de una combinación que cambian junto
// con el turno sobre el que se actuó.
function detalleCombinacion(turnoPrincipal, extra = null) {
  const base = `Junto con beeper ${turnoPrincipal?.biper_numero ?? '?'} (combinación)`;
  return extra ? `${base}. ${extra}` : base;
}

module.exports = { registrarAccion, detalleCombinacion, USUARIO_SISTEMA };
