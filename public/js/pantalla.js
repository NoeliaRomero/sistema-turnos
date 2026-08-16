const socket = io();

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
}

// Formatea minutos de espera como horas cuando pasan los 60 (ej. "1h 20min").
function formatEspera(min) {
  if (min < 60) return `${min} min`;
  const horas = Math.floor(min / 60);
  const resto = min % 60;
  return resto === 0 ? `${horas}h` : `${horas}h ${resto}min`;
}

// ── Color por juego (mismo criterio que cola.js: un color propio y estable
// por juego, para distinguirlos de un vistazo en pantalla) ───────────────────
const PALETA_JUEGOS = [
  { accent: '#3b82f6', bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.3)',  text: '#93c5fd' },
  { accent: '#f97316', bg: 'rgba(249,115,22,0.10)', border: 'rgba(249,115,22,0.3)',  text: '#fdba74' },
  { accent: '#10b981', bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.3)',  text: '#6ee7b7' },
  { accent: '#ec4899', bg: 'rgba(236,72,153,0.10)', border: 'rgba(236,72,153,0.3)',  text: '#f9a8d4' },
  { accent: '#a855f7', bg: 'rgba(168,85,247,0.10)', border: 'rgba(168,85,247,0.3)',  text: '#d8b4fe' },
  { accent: '#06b6d4', bg: 'rgba(6,182,212,0.10)',  border: 'rgba(6,182,212,0.3)',   text: '#67e8f9' },
  { accent: '#eab308', bg: 'rgba(234,179,8,0.10)',  border: 'rgba(234,179,8,0.3)',   text: '#fde047' },
  { accent: '#ef4444', bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.3)',   text: '#fca5a5' },
];
// Íconos genéricos que rotan junto con el color — no dependen del nombre del
// juego (lo define el admin libremente), así funciona para cualquier juego
// futuro sin necesidad de mapear nombre → ícono a mano.
const ICONOS_JUEGOS = [
  'bi-speedometer2', 'bi-bullseye', 'bi-trophy-fill', 'bi-lightning-charge-fill',
  'bi-joystick', 'bi-stars', 'bi-gem', 'bi-fire',
];
// Se indexa por el ID del juego (fijo en la base), no por su posición en la
// lista: ver la misma nota en cola.js — así el color de cada juego no se
// reacomoda en cascada cuando se renombra o agrega otro juego.
function colorDeJuego(juegoId) {
  return PALETA_JUEGOS[juegoId % PALETA_JUEGOS.length];
}
function iconoDeJuego(juegoId) {
  return ICONOS_JUEGOS[juegoId % ICONOS_JUEGOS.length];
}
// Fondo ilustrado por juego (mismo criterio que cola.js): se matchea por
// palabra clave en el nombre, no por id, y si no hay imagen conocida para ese
// juego (ej. "Tiro al Blanco") simplemente no lleva foto.
const IMAGENES_JUEGOS = [
  { match: /kart/i,          archivo: 'karting.png' },
  { match: /paintball/i,     archivo: 'paintball.png' },
  { match: /escape\s*room/i, archivo: 'escaperoom.png' },
  { match: /atraco/i,        archivo: 'atraco.png' },
];
function imagenDeJuego(nombre) {
  const encontrado = IMAGENES_JUEGOS.find(e => e.match.test(nombre || ''));
  return encontrado ? `/assets/juegos/${encontrado.archivo}` : null;
}

function estiloJuego(juegoId) {
  const c = colorDeJuego(juegoId);
  const juego = estadoJuegos.find(j => j.id === juegoId);
  const img   = imagenDeJuego(juego?.nombre);
  const imgCss = img ? `url('${img}')` : 'none';
  return `--jc-accent:${c.accent}; --jc-bg:${c.bg}; --jc-border:${c.border}; --jc-text:${c.text}; --jc-img:${imgCss};`;
}

// ── Reloj ─────────────────────────────────────────────────────────────────────
function tickReloj() {
  document.getElementById('clock').textContent =
    new Date().toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}
tickReloj();
setInterval(tickReloj, 1000);

// ── Flash de pantalla ─────────────────────────────────────────────────────────
function flashPantalla() {
  const el = document.getElementById('flash');
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 300);
}

// ── Toast de turno cancelado ──────────────────────────────────────────────────
let toastCanceladoTimeout = null;
function mostrarToastCancelado(mensaje) {
  const el = document.getElementById('toastCancelado');
  if (!el) return;
  el.textContent = mensaje;
  el.classList.add('show');
  if (toastCanceladoTimeout) clearTimeout(toastCanceladoTimeout);
  toastCanceladoTimeout = setTimeout(() => el.classList.remove('show'), 2500);
}

// ── Sonido de llamada ─────────────────────────────────────────────────────────
function beep() {
  try {
    const ctx   = new (window.AudioContext || window.webkitAudioContext)();
    const notas = [880, 1100, 880];
    notas.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.18);
      gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + i * 0.18 + 0.04);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + i * 0.18 + 0.16);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.2);
    });
  } catch (_) {}
}

// ── Estado local ──────────────────────────────────────────────────────────────
let estadoJuegos = []; // Array de juegos con activos + cola

// ── Cargar datos iniciales ────────────────────────────────────────────────────
async function cargarCola() {
  try {
    const res = await fetch('/api/turnos/cola-publica');
    if (!res.ok) return;
    const { juegos } = await res.json();
    estadoJuegos = juegos;
    renderJuegos();
  } catch (_) {}
}

// ── Render principal ──────────────────────────────────────────────────────────
function renderJuegos() {
  const grid    = document.getElementById('juegosGrid');
  const sinDatos = document.getElementById('sinDatos');
  const juegosConActividad = estadoJuegos.filter(j =>
    j.activos.length > 0 || j.cola.length > 0
  );

  if (!juegosConActividad.length) {
    sinDatos.style.display = '';
    grid.style.display = 'none';
    return;
  }

  sinDatos.style.display = 'none';
  grid.style.display = '';
  grid.innerHTML = juegosConActividad.map(j => renderJuegoCard(j)).join('');
}

function renderJuegoCard(j) {
  const totalActivos = j.activos.length;
  const totalCola    = j.cola.length;
  const icono        = iconoDeJuego(j.id);
  const tieneImg     = !!imagenDeJuego(j.nombre);

  const activosHtml = totalActivos
    ? j.activos.map(t => {
        const esLlamado  = t.estado === 'llamado';
        const chipEstado = esLlamado
          ? '<span class="meta-chip chip-llamado"><i class="bi bi-megaphone-fill me-1"></i>Llamado</span>'
          : '<span class="meta-chip chip-jugando"><i class="bi bi-play-fill me-1"></i>Jugando</span>';
        const chipTiempo = `<span class="meta-chip chip-tiempo"><i class="bi bi-clock me-1"></i>${t.tiempo_transcurrido ?? 0} min</span>`;
        const chipEtapa  = t.etapa_actual_nombre
          ? `<span class="meta-chip chip-etapa"><i class="bi bi-layers me-1"></i>${escapeHtml(t.etapa_actual_nombre)}</span>` : '';
        return `
          <div class="turno-activo ${esLlamado ? 'estado-llamado' : ''} ${tieneImg ? 'con-imagen' : ''} nuevo">
            ${tieneImg ? '<div class="foto-fondo"></div>' : `<i class="bi ${icono} icono-fondo"></i>`}
            <div class="biper-tv">${escapeHtml(t.biper_numero)}</div>
            <div class="turno-info">
              <div class="turno-cliente">${escapeHtml(t.nombre_cliente || 'Sin nombre')}</div>
              <div class="turno-meta">
                ${chipEstado}${chipTiempo}${chipEtapa}
                ${t.cantidad_miembros > 1 ? `<span class="meta-chip chip-tiempo"><i class="bi bi-people-fill me-1"></i>${t.cantidad_miembros} pers.</span>` : ''}
              </div>
            </div>
          </div>`;
      }).join('')
    : '<p class="sin-activo">Sin turno activo</p>';

  const colaHtml = totalCola
    ? `<div class="cola-lista">${j.cola.slice(0, 5).map(t => {
        const esProximo = t.posicion === 1 && t.tiempo_espera_estimado === 0;
        return `
        <div class="cola-item">
          <span class="posicion">#${t.posicion}</span>
          <span class="biper-cola">${escapeHtml(t.biper_numero)}</span>
          <span class="cola-cliente">${escapeHtml(t.nombre_cliente || 'Sin nombre')}</span>
          <span class="espera-chip" style="${esProximo ? 'color:#4ade80;font-weight:800;' : ''}">${esProximo ? '¡Próximo!' : `~${formatEspera(t.tiempo_espera_estimado ?? 0)}`}</span>
        </div>`;
      }).join('')}
        ${totalCola > 5 ? `<div class="sin-cola">+${totalCola - 5} más en cola</div>` : ''}
      </div>`
    : '<p class="sin-cola">Cola vacía</p>';

  return `
    <div class="juego-card" id="juego-${j.id}" style="${estiloJuego(j.id)}">
      <div class="juego-header">
        <span class="juego-nombre"><i class="bi ${icono}"></i>${escapeHtml(j.nombre)}</span>
        <div class="juego-contadores">
          <span class="contador-badge badge-activo"><i class="bi bi-play-fill"></i> ${totalActivos} activo${totalActivos !== 1 ? 's' : ''}</span>
          <span class="contador-badge badge-espera"><i class="bi bi-hourglass-split"></i> ${totalCola} en cola</span>
        </div>
      </div>
      <div class="juego-body">
        <div class="seccion-label">En Juego</div>
        ${activosHtml}
        <hr class="divisor">
        <div class="seccion-label">En Espera</div>
        ${colaHtml}
      </div>
    </div>`;
}

// ── Socket: actualizar en tiempo real ─────────────────────────────────────────
socket.on('turno:llamado', () => {
  flashPantalla();
  beep();
  cargarCola();
});
socket.on('turno:jugando',        () => cargarCola());
socket.on('turno:nuevo',          () => cargarCola());
socket.on('turno:finalizado',     (turno) => {
  if (turno && turno.estado === 'cancelado') {
    mostrarToastCancelado(`Turno cancelado — Biper ${turno.biper_numero ?? ''}`);
  }
  cargarCola();
});
socket.on('turno:etapa_avanzada', () => cargarCola());
socket.on('juego:actualizado',    () => cargarCola());

// ── Actualizar timers localmente cada 30s sin recargar todo ──────────────────
setInterval(() => {
  const ahora = Date.now();
  estadoJuegos.forEach(j => {
    j.activos.forEach(t => {
      const baseTime = t.jugando_desde || t.called_at;
      if (baseTime) {
        t.tiempo_transcurrido = Math.floor((ahora - new Date(baseTime).getTime()) / 60000);
      }
    });
  });
  // Solo re-render si hay datos (evitar parpadeo innecesario)
  if (estadoJuegos.some(j => j.activos.length > 0)) renderJuegos();
}, 30000);

// ── Init ──────────────────────────────────────────────────────────────────────
cargarCola();
