const socket = io();

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
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

  const activosHtml = totalActivos
    ? j.activos.map(t => {
        const esLlamado  = t.estado === 'llamado';
        const chipEstado = esLlamado
          ? '<span class="meta-chip chip-llamado">&#128276; Llamado</span>'
          : '<span class="meta-chip chip-jugando">&#9654; Jugando</span>';
        const chipTiempo = `<span class="meta-chip chip-tiempo">&#8987; ${t.tiempo_transcurrido ?? 0} min</span>`;
        const chipEtapa  = t.etapa_actual_nombre
          ? `<span class="meta-chip chip-etapa">&#8635; ${escapeHtml(t.etapa_actual_nombre)}</span>` : '';
        return `
          <div class="turno-activo ${esLlamado ? 'estado-llamado' : ''} nuevo">
            <div class="biper-tv">${escapeHtml(t.biper_numero)}</div>
            <div class="turno-info">
              <div class="turno-cliente">${escapeHtml(t.nombre_cliente || 'Sin nombre')}</div>
              <div class="turno-meta">
                ${chipEstado}${chipTiempo}${chipEtapa}
                ${t.cantidad_miembros > 1 ? `<span class="meta-chip chip-tiempo">&#128101; ${t.cantidad_miembros} pers.</span>` : ''}
              </div>
            </div>
          </div>`;
      }).join('')
    : '<p class="sin-activo">Sin turno activo</p>';

  const colaHtml = totalCola
    ? `<div class="cola-lista">${j.cola.slice(0, 5).map(t => `
        <div class="cola-item">
          <span class="posicion">#${t.posicion}</span>
          <span class="biper-cola">${escapeHtml(t.biper_numero)}</span>
          <span class="cola-cliente">${escapeHtml(t.nombre_cliente || 'Sin nombre')}</span>
          <span class="espera-chip">~${t.tiempo_espera_estimado ?? 0} min</span>
        </div>`).join('')}
        ${totalCola > 5 ? `<div class="sin-cola">+${totalCola - 5} más en cola</div>` : ''}
      </div>`
    : '<p class="sin-cola">Cola vacía</p>';

  return `
    <div class="juego-card" id="juego-${j.id}">
      <div class="juego-header">
        <span class="juego-nombre">${escapeHtml(j.nombre)}</span>
        <div class="juego-contadores">
          <span class="contador-badge badge-activo">&#9654; ${totalActivos} activo${totalActivos !== 1 ? 's' : ''}</span>
          <span class="contador-badge badge-espera">&#8987; ${totalCola} en cola</span>
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
