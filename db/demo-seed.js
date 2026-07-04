'use strict';

const db     = require('./database');
const bcrypt = require('bcryptjs');

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(ms) {
  const d   = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const AHORA = Date.now();

function minutosAtras(min) {
  return fmt(AHORA - min * 60_000);
}

function diasAtras(dias, hora, minuto = 0) {
  const d = new Date(AHORA);
  d.setDate(d.getDate() - dias);
  d.setHours(hora, minuto, 0, 0);
  return fmt(d.getTime());
}

function addMin(ms, min) {
  return fmt(ms + min * 60_000);
}

// ── Limpiar datos demo (preserva superadmin + demo) ───────────────────────────

function clearDemoData() {
  db.exec('DELETE FROM turno_etapas_historial');
  db.exec('DELETE FROM turnos');
  db.exec('DELETE FROM juego_etapas');
  db.exec('DELETE FROM atracciones');
  db.exec("DELETE FROM usuarios WHERE username NOT IN ('superadmin', 'demo')");
  db.exec('DELETE FROM viper_eventos');
  db.exec('DELETE FROM vipers');
  db.exec("UPDATE configuracion_serial SET puerto = NULL WHERE id = 1");
}

// ── Seed completo ─────────────────────────────────────────────────────────────

function seedDemoData() {
  clearDemoData();

  // ── Usuario demo (admin) ─────────────────────────────────────────────────
  if (db.prepare("SELECT COUNT(*) AS c FROM usuarios WHERE username = 'demo'").get().c === 0) {
    const h = bcrypt.hashSync('demo123', 10);
    db.prepare(`INSERT INTO usuarios (nombre, username, password_hash, rol,
      permiso_gestionar_juegos, permiso_cancelar_turno, permiso_llamar_turno,
      feature_graficos, feature_juegos, feature_cancelar_turno, feature_llamar_turno)
      VALUES (?,?,?,'admin',1,1,1,1,1,1,1)`)
      .run('Usuario Demo', 'demo', h);
  }

  // ── Operadores y recepcionistas ──────────────────────────────────────────
  const h = bcrypt.hashSync('demo123', 10);

  const op1 = Number(db.prepare(`INSERT INTO usuarios (nombre, username, password_hash, rol,
    permiso_llamar_turno, permiso_cancelar_turno, activo)
    VALUES (?,?,?,'operador',1,1,1)`)
    .run('Carlos Mendoza', 'carlos_op', h).lastInsertRowid);

  const op2 = Number(db.prepare(`INSERT INTO usuarios (nombre, username, password_hash, rol,
    permiso_llamar_turno, permiso_cancelar_turno, activo)
    VALUES (?,?,?,'operador',1,1,1)`)
    .run('Lucía Torres', 'lucia_op', h).lastInsertRowid);

  const op3 = Number(db.prepare(`INSERT INTO usuarios (nombre, username, password_hash, rol,
    permiso_llamar_turno, permiso_cancelar_turno, activo)
    VALUES (?,?,?,'operador',1,0,1)`)
    .run('Diego Romero', 'diego_op', h).lastInsertRowid);

  const rec1 = Number(db.prepare(`INSERT INTO usuarios (nombre, username, password_hash, rol,
    permiso_llamar_turno, permiso_cancelar_turno, permiso_gestionar_juegos, activo)
    VALUES (?,?,?,'recepcion',1,1,0,1)`)
    .run('María González', 'maria_rec', h).lastInsertRowid);

  db.prepare(`INSERT INTO usuarios (nombre, username, password_hash, rol,
    permiso_llamar_turno, activo)
    VALUES (?,?,?,'recepcion',1,1)`)
    .run('Sofía Herrera', 'sofia_rec', h);

  // ── Juegos / Atracciones ─────────────────────────────────────────────────
  const ij = db.prepare(`INSERT INTO atracciones
    (nombre, duracion_minutos, min_miembros, max_miembros, activa, usa_etapas)
    VALUES (?,?,?,?,1,?)`);

  const kartId   = Number(ij.run('Karting',                 25, 2,  8, 1).lastInsertRowid);
  const escapeId = Number(ij.run('Escape Room: El Búnker',  60, 2,  6, 1).lastInsertRowid);
  const laserId  = Number(ij.run('Laser Tag',               30, 4, 20, 1).lastInsertRowid);
  const paintId  = Number(ij.run('Paintball',               45, 4, 12, 0).lastInsertRowid);
  const vrId     = Number(ij.run('Realidad Virtual',        20, 1,  4, 1).lastInsertRowid);
  const terrorId = Number(ij.run('Casa del Terror',         15, 2,  8, 0).lastInsertRowid);

  // Asignar operadores a atracciones
  db.prepare("UPDATE usuarios SET atraccion_id = ? WHERE id = ?").run(kartId,   op1);
  db.prepare("UPDATE usuarios SET atraccion_id = ? WHERE id = ?").run(laserId,  op2);
  db.prepare("UPDATE usuarios SET atraccion_id = ? WHERE id = ?").run(escapeId, op3);

  // ── Etapas ───────────────────────────────────────────────────────────────
  const ie = db.prepare(`INSERT INTO juego_etapas
    (juego_id, nombre, duracion_minutos, orden, activa) VALUES (?,?,?,?,1)`);

  const kE1 = Number(ie.run(kartId,   'Briefing de seguridad', 5,  1).lastInsertRowid);
  const kE2 = Number(ie.run(kartId,   'Carrera',              15,  2).lastInsertRowid);
  const kE3 = Number(ie.run(kartId,   'Fotos en el podio',     5,  3).lastInsertRowid);

  const esE1 = Number(ie.run(escapeId, 'Introducción y reglas', 10, 1).lastInsertRowid);
  const esE2 = Number(ie.run(escapeId, 'Primera sala',          20, 2).lastInsertRowid);
  const esE3 = Number(ie.run(escapeId, 'Sala final',            20, 3).lastInsertRowid);
  const esE4 = Number(ie.run(escapeId, 'Debrief y fotos',       10, 4).lastInsertRowid);

  const lE1 = Number(ie.run(laserId,  'Equipamiento',    5, 1).lastInsertRowid);
  const lE2 = Number(ie.run(laserId,  'Batalla',        20, 2).lastInsertRowid);
  const lE3 = Number(ie.run(laserId,  'Marcador final',  5, 3).lastInsertRowid);

  const vrE1 = Number(ie.run(vrId,    'Calibración VR',  5, 1).lastInsertRowid);
  const vrE2 = Number(ie.run(vrId,    'Experiencia VR', 15, 2).lastInsertRowid);

  // ── VIPERs ───────────────────────────────────────────────────────────────
  const iv = db.prepare(`INSERT INTO vipers
    (codigo_viper, activo, estado, fecha_creacion)
    VALUES (?,?,?,datetime('now','localtime'))`);

  const vipers = [];
  for (let i = 1; i <= 10; i++) {
    const activo = i <= 7;
    vipers.push(Number(iv.run(`V-${String(i).padStart(3, '0')}`, activo ? 1 : 0, activo ? 'ACTIVO' : 'PENDIENTE').lastInsertRowid));
  }

  // ── Insertar turno helper ─────────────────────────────────────────────────
  function turno({ atraccionId, biper, nombre, cant, estado, etapaId = null, viperId = null, llamadoPorId = null, minDesdeCall = null, ordenCola = null }) {
    const calledAt = estado === 'llamado' && minDesdeCall != null ? minutosAtras(minDesdeCall) : null;
    return Number(db.prepare(`
      INSERT INTO turnos
        (atraccion_id, biper_numero, nombre_cliente, cantidad_miembros,
         estado, etapa_actual_id, viper_id, llamado_por, called_at, orden_cola)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(atraccionId, String(biper), nombre, cant, estado,
           etapaId, viperId, llamadoPorId, calledAt, ordenCola).lastInsertRowid);
  }

  function historial({ turnoId, etapaId, etapaNombre, etapaOrden, llamadoPorId = null, minDesdeInicio = null, minDesdeFinalizacion = null }) {
    const iniciadaAt   = minDesdeInicio       != null ? minutosAtras(minDesdeInicio)       : null;
    const finalizadaAt = minDesdeFinalizacion != null ? minutosAtras(minDesdeFinalizacion)  : null;
    db.prepare(`
      INSERT INTO turno_etapas_historial
        (turno_id, etapa_id, etapa_nombre, etapa_orden, iniciada_at, iniciada_por, finalizada_at, finalizada_por)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(turnoId, etapaId, etapaNombre, etapaOrden, iniciadaAt, llamadoPorId, finalizadaAt, finalizadaAt != null ? llamadoPorId : null);
  }

  // ── KARTING — 25 min (Briefing 5, Carrera 15, Podio 5) ─────────────────
  // Llamado 1: Familia García — en "Carrera", llamado hace 12 min
  const tK1 = turno({ atraccionId: kartId, biper: 3,  nombre: 'Familia García',   cant: 4, estado: 'llamado',    etapaId: kE2, viperId: vipers[0], llamadoPorId: op1, minDesdeCall: 12 });
  historial({ turnoId: tK1, etapaId: kE1, etapaNombre: 'Briefing de seguridad', etapaOrden: 1, llamadoPorId: op1, minDesdeInicio: 12, minDesdeFinalizacion: 7 });
  historial({ turnoId: tK1, etapaId: kE2, etapaNombre: 'Carrera',               etapaOrden: 2, llamadoPorId: op1, minDesdeInicio: 7 });

  // Llamado 2: Los Rodríguez — en "Briefing", llamado hace 3 min
  const tK2 = turno({ atraccionId: kartId, biper: 7,  nombre: 'Los Rodríguez',   cant: 2, estado: 'llamado',    etapaId: kE1, viperId: vipers[1], llamadoPorId: op1, minDesdeCall: 3 });
  historial({ turnoId: tK2, etapaId: kE1, etapaNombre: 'Briefing de seguridad', etapaOrden: 1, llamadoPorId: op1, minDesdeInicio: 3 });

  // Esperando
  turno({ atraccionId: kartId, biper: 12, nombre: 'Familia López',     cant: 3, estado: 'esperando', etapaId: kE1, ordenCola: 1 });
  turno({ atraccionId: kartId, biper: 4,  nombre: 'Los Mendoza',       cant: 5, estado: 'esperando', etapaId: kE1, ordenCola: 2 });
  turno({ atraccionId: kartId, biper: 9,  nombre: 'Grupo Sánchez',     cant: 2, estado: 'esperando', etapaId: kE1, ordenCola: 3 });

  // ── ESCAPE ROOM — 60 min (Intro 10, Sala1 20, SalaFinal 20, Debrief 10) ─
  // Llamado: Familia Fernández — en "Primera sala", llamado hace 35 min
  const tE1 = turno({ atraccionId: escapeId, biper: 1, nombre: 'Familia Fernández', cant: 4, estado: 'llamado', etapaId: esE2, viperId: vipers[2], llamadoPorId: op3, minDesdeCall: 35 });
  historial({ turnoId: tE1, etapaId: esE1, etapaNombre: 'Introducción y reglas', etapaOrden: 1, llamadoPorId: op3, minDesdeInicio: 35, minDesdeFinalizacion: 25 });
  historial({ turnoId: tE1, etapaId: esE2, etapaNombre: 'Primera sala',          etapaOrden: 2, llamadoPorId: op3, minDesdeInicio: 25 });

  // Esperando
  turno({ atraccionId: escapeId, biper: 6,  nombre: 'Los Herrera',  cant: 3, estado: 'esperando', ordenCola: 1 });
  turno({ atraccionId: escapeId, biper: 11, nombre: 'Grupo Torres', cant: 2, estado: 'esperando', ordenCola: 2 });

  // ── LASER TAG — 30 min (Equip 5, Batalla 20, Marcador 5) ────────────────
  // Llamado: Cumpleaños de Mateo — en "Batalla", llamado hace 18 min
  const tL1 = turno({ atraccionId: laserId, biper: 2, nombre: 'Cumpleaños de Mateo', cant: 15, estado: 'llamado', etapaId: lE2, llamadoPorId: op2, minDesdeCall: 18 });
  historial({ turnoId: tL1, etapaId: lE1, etapaNombre: 'Equipamiento',    etapaOrden: 1, llamadoPorId: op2, minDesdeInicio: 18, minDesdeFinalizacion: 13 });
  historial({ turnoId: tL1, etapaId: lE2, etapaNombre: 'Batalla',          etapaOrden: 2, llamadoPorId: op2, minDesdeInicio: 13 });

  // Esperando
  turno({ atraccionId: laserId, biper: 5,  nombre: 'Team Gómez',    cant: 8,  estado: 'esperando', ordenCola: 1 });
  turno({ atraccionId: laserId, biper: 8,  nombre: 'Los Guerreros', cant: 12, estado: 'esperando', ordenCola: 2 });
  turno({ atraccionId: laserId, biper: 20, nombre: 'Familia Vega',  cant: 6,  estado: 'esperando', ordenCola: 3 });

  // ── PAINTBALL — 45 min, sin etapas ──────────────────────────────────────
  // Llamado 1: Empresa XYZ, llamado hace 20 min
  turno({ atraccionId: paintId, biper: 10, nombre: 'Empresa XYZ Team', cant: 8, estado: 'llamado', viperId: vipers[3], minDesdeCall: 20 });
  // Llamado 2: Equipo Azul, llamado hace 5 min
  turno({ atraccionId: paintId, biper: 13, nombre: 'Equipo Azul',      cant: 6, estado: 'llamado', viperId: vipers[4], minDesdeCall: 5 });

  // Esperando
  turno({ atraccionId: paintId, biper: 15, nombre: 'Los Campeones',    cant: 4, estado: 'esperando', ordenCola: 1 });
  turno({ atraccionId: paintId, biper: 22, nombre: 'Familia Quiroga',  cant: 7, estado: 'esperando', ordenCola: 2 });

  // ── REALIDAD VIRTUAL — 20 min (Calib 5, Experiencia 15) ─────────────────
  // Llamado: Martínez x2 — en "Experiencia VR", llamado hace 8 min
  const tV1 = turno({ atraccionId: vrId, biper: 14, nombre: 'Martínez x2', cant: 2, estado: 'llamado', etapaId: vrE2, viperId: vipers[5], minDesdeCall: 8 });
  historial({ turnoId: tV1, etapaId: vrE1, etapaNombre: 'Calibración VR',  etapaOrden: 1, minDesdeInicio: 8, minDesdeFinalizacion: 3 });
  historial({ turnoId: tV1, etapaId: vrE2, etapaNombre: 'Experiencia VR',  etapaOrden: 2, minDesdeInicio: 3 });

  // Esperando
  turno({ atraccionId: vrId, biper: 16, nombre: 'González Individual', cant: 1, estado: 'esperando', etapaId: vrE1, ordenCola: 1 });
  turno({ atraccionId: vrId, biper: 17, nombre: 'Familia Ruiz',        cant: 3, estado: 'esperando', etapaId: vrE1, ordenCola: 2 });

  // ── CASA DEL TERROR — 15 min, sin etapas ────────────────────────────────
  turno({ atraccionId: terrorId, biper: 18, nombre: 'Grupo de Teens',   cant: 4, estado: 'esperando', ordenCola: 1 });
  turno({ atraccionId: terrorId, biper: 19, nombre: 'Los Valientes',    cant: 6, estado: 'esperando', ordenCola: 2 });
  turno({ atraccionId: terrorId, biper: 23, nombre: 'Familia Morales',  cant: 3, estado: 'esperando', ordenCola: 3 });

  // ── Historial (turnos finalizados para estadísticas) ─────────────────────
  const finalizados = [
    // [atraccionId, biper, nombre, cant, diasAtras, hora, duracionMin]
    // HOY
    [kartId,   1, 'Familia Pérez',       4, 0, 10, 25],
    [kartId,   2, 'Los Suárez',          3, 0, 11, 25],
    [kartId,   3, 'Escuela 6° B',        8, 0, 12, 25],
    [kartId,   4, 'Los Ríos',            2, 0, 13, 25],
    [escapeId, 1, 'Los Díaz',            3, 0, 10, 60],
    [escapeId, 2, 'Familia Castro',      4, 0, 11, 60],
    [escapeId, 3, 'Grupo Universitario', 5, 0, 12, 60],
    [laserId,  1, 'Team Lakers',        12, 0, 10, 30],
    [laserId,  2, 'Los Rayos',           8, 0, 11, 30],
    [laserId,  3, 'Cumple Julia',       16, 0, 12, 30],
    [laserId,  4, 'Grupo Mixto A',       9, 0, 13, 30],
    [paintId,  1, 'Despedida Lucas',    10, 0, 10, 45],
    [paintId,  2, 'Equipo Rojo',         6, 0, 11, 45],
    [paintId,  3, 'Los Tigres',          8, 0, 12, 45],
    [vrId,     1, 'Señor Méndez',        1, 0, 10, 20],
    [vrId,     2, 'Pareja Flores',       2, 0, 11, 20],
    [vrId,     3, 'Familia Ortiz',       4, 0, 12, 20],
    [terrorId, 1, 'Grupo Halloween',     5, 0, 10, 15],
    [terrorId, 2, 'Los Aventureros',     4, 0, 11, 15],
    [terrorId, 3, 'Teens Noche',         7, 0, 12, 15],

    // AYER
    [kartId,   1, 'Los Nova',            4, 1, 10, 25],
    [kartId,   2, 'Familia Kim',         3, 1, 11, 25],
    [kartId,   3, 'Equipo Juvenil',      6, 1, 12, 25],
    [kartId,   4, 'Grupo A',             2, 1, 14, 25],
    [kartId,   5, 'Los Pereyra',         5, 1, 15, 25],
    [escapeId, 1, 'Familia Matías',      5, 1, 10, 60],
    [escapeId, 2, 'Los Amigos',          4, 1, 12, 60],
    [escapeId, 3, 'Grupo Pro',           3, 1, 14, 60],
    [laserId,  1, 'Team Pro',           20, 1, 10, 30],
    [laserId,  2, 'Los Ninjas',         10, 1, 11, 30],
    [laserId,  3, 'Cumple Franco',      15, 1, 12, 30],
    [laserId,  4, 'Grupo Mixto B',      11, 1, 14, 30],
    [laserId,  5, 'Team Élite',         18, 1, 15, 30],
    [paintId,  1, 'Empresa ABC',        12, 1, 10, 45],
    [paintId,  2, 'Los Leones',          8, 1, 12, 45],
    [paintId,  3, 'Team Delta',          6, 1, 14, 45],
    [vrId,     1, 'Familia Gómez',       4, 1, 10, 20],
    [vrId,     2, 'Dr. López',           1, 1, 11, 20],
    [vrId,     3, 'Pareja Torres',       2, 1, 12, 20],
    [vrId,     4, 'Los Soria',           3, 1, 14, 20],
    [terrorId, 1, 'Amigos Teens',        6, 1, 10, 15],
    [terrorId, 2, 'Familia Brave',       5, 1, 11, 15],
    [terrorId, 3, 'Los Temerarios',      8, 1, 12, 15],

    // 2 DÍAS ATRÁS
    [kartId,   1, 'Familia Serrano',     3, 2, 10, 25],
    [kartId,   2, 'Los Morales',         5, 2, 11, 25],
    [kartId,   3, 'Grupo C',             2, 2, 12, 25],
    [kartId,   4, 'Los Vargas',          4, 2, 14, 25],
    [escapeId, 1, 'Team Escape',         4, 2, 10, 60],
    [escapeId, 2, 'Los Maestros',        6, 2, 12, 60],
    [laserId,  1, 'Cumple Marcos',      18, 2, 10, 30],
    [laserId,  2, 'Team Azul',          12, 2, 11, 30],
    [laserId,  3, 'Los Veloces',         9, 2, 13, 30],
    [paintId,  1, 'Despedida Fer',       8, 2, 10, 45],
    [paintId,  2, 'Los Campeones 2',    10, 2, 12, 45],
    [vrId,     1, 'Familia Reyes',       4, 2, 10, 20],
    [vrId,     2, 'Pareja Paz',          2, 2, 11, 20],
    [terrorId, 1, 'Grupo Miedo',         5, 2, 10, 15],
    [terrorId, 2, 'Los Valientes II',    7, 2, 11, 15],

    // 3 DÍAS ATRÁS
    [kartId,   1, 'Los Guerreros Jr',    6, 3, 10, 25],
    [kartId,   2, 'Familia Benítez',     4, 3, 11, 25],
    [escapeId, 1, 'Los Curiosos',        3, 3, 10, 60],
    [laserId,  1, 'Super Batalla',      20, 3, 10, 30],
    [laserId,  2, 'Team Neon',          15, 3, 12, 30],
    [paintId,  1, 'Empresa XYZ Jr',      8, 3, 10, 45],
    [vrId,     1, 'Los Viajeros VR',     2, 3, 10, 20],
    [terrorId, 1, 'Grupo Terror',        6, 3, 10, 15],

    // 5 DÍAS ATRÁS
    [kartId,   1, 'Weekend Warriors',    5, 5, 10, 25],
    [kartId,   2, 'Los Amigos K',        3, 5, 11, 25],
    [escapeId, 1, 'Familia Ramírez',     5, 5, 10, 60],
    [laserId,  1, 'Big Battle',         20, 5, 10, 30],
    [paintId,  1, 'Team Challenge',     12, 5, 10, 45],
    [vrId,     1, 'Explorer 1',          1, 5, 10, 20],
    [terrorId, 1, 'Noche de Terror',     8, 5, 10, 15],

    // 7 DÍAS ATRÁS
    [kartId,   1, 'Domingo en Familia',  6, 7, 11, 25],
    [kartId,   2, 'Los Chicos',          4, 7, 12, 25],
    [escapeId, 1, 'Los Detectives',      4, 7, 11, 60],
    [laserId,  1, 'Grand Tournament',   20, 7, 10, 30],
    [laserId,  2, 'Team Flash',         12, 7, 12, 30],
    [paintId,  1, 'Batalla Dominical',   8, 7, 10, 45],
    [vrId,     1, 'Familia VR',          4, 7, 11, 20],
    [terrorId, 1, 'Los Intrépidos',      5, 7, 10, 15],
  ];

  const insFin = db.prepare(`
    INSERT INTO turnos
      (atraccion_id, biper_numero, nombre_cliente, cantidad_miembros,
       estado, created_at, called_at, finished_at)
    VALUES (?,?,?,?,'finalizado',?,?,?)
  `);

  finalizados.forEach(([aId, biper, nombre, cant, dias, hora, durMin], idx) {
    const creMs  = new Date(diasAtras(dias, hora).replace(' ', 'T')).getTime();
    const callMs = creMs + 2 * 60_000;
    const finMs  = callMs + durMin * 60_000;
    insFin.run(aId, String((idx % 30) + 1), nombre, cant,
               fmt(creMs), fmt(callMs), fmt(finMs));
  });

  console.log('[DEMO] ✅ Datos de demostración generados exitosamente');
  console.log('[DEMO] 👤 Ingresá con:  demo / demo123');
}

// ── initDemo: llamada al arrancar el servidor ──────────────────────────────────

function initDemo() {
  const tieneDemo   = db.prepare("SELECT COUNT(*) AS c FROM usuarios WHERE username = 'demo'").get().c > 0;
  const tieneJuegos = db.prepare("SELECT COUNT(*) AS c FROM atracciones WHERE nombre = 'Karting'").get().c > 0;

  if (!tieneDemo || !tieneJuegos) {
    console.log('[DEMO] Inicializando datos de demostración...');
    seedDemoData();
  } else {
    console.log('[DEMO] Datos de demostración ya presentes. 👤 demo / demo123');
  }
}

module.exports = { initDemo, seedDemoData };
