const socket = io();

let colaData   = [];
let filtroId   = '';  // '' = todos
let timerTick  = null;

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

// ── Color por juego ──────────────────────────────────────────────────────────
// Cada juego se pinta con un color propio (estable mientras no cambie el orden
// alfabético que devuelve el backend) para distinguirlos de un vistazo en la
// pantalla, sobre todo cuando se muestran varios juegos mezclados.
const PALETA_JUEGOS = [
  { accent: '#3b82f6', bg: 'rgba(59,130,246,0.14)',  bgStrong: '#3b82f6', border: 'rgba(59,130,246,0.35)',  text: '#93c5fd' }, // azul
  { accent: '#f97316', bg: 'rgba(249,115,22,0.14)',  bgStrong: '#f97316', border: 'rgba(249,115,22,0.35)',  text: '#fdba74' }, // naranja
  { accent: '#10b981', bg: 'rgba(16,185,129,0.14)',  bgStrong: '#10b981', border: 'rgba(16,185,129,0.35)',  text: '#6ee7b7' }, // verde
  { accent: '#ec4899', bg: 'rgba(236,72,153,0.14)',  bgStrong: '#ec4899', border: 'rgba(236,72,153,0.35)',  text: '#f9a8d4' }, // rosa
  { accent: '#a855f7', bg: 'rgba(168,85,247,0.14)',  bgStrong: '#a855f7', border: 'rgba(168,85,247,0.35)',  text: '#d8b4fe' }, // violeta
  { accent: '#06b6d4', bg: 'rgba(6,182,212,0.14)',   bgStrong: '#06b6d4', border: 'rgba(6,182,212,0.35)',   text: '#67e8f9' }, // cian
  { accent: '#eab308', bg: 'rgba(234,179,8,0.14)',   bgStrong: '#eab308', border: 'rgba(234,179,8,0.35)',   text: '#fde047' }, // amarillo
  { accent: '#ef4444', bg: 'rgba(239,68,68,0.14)',   bgStrong: '#ef4444', border: 'rgba(239,68,68,0.35)',   text: '#fca5a5' }, // rojo
];
function colorDeJuego(juegoId) {
  const idx = colaData.findIndex(j => j.id === juegoId);
  return PALETA_JUEGOS[(idx >= 0 ? idx : 0) % PALETA_JUEGOS.length];
}
function estiloJuego(juegoId) {
  const c = colorDeJuego(juegoId);
  return `--jc-accent:${c.accent}; --jc-bg:${c.bg}; --jc-bg-strong:${c.bgStrong}; --jc-border:${c.border}; --jc-text:${c.text};`;
}

// ── Reloj ─────────────────────────────────────────────────────────────────────
function tickReloj() {
  document.getElementById('clock').textContent =
    new Date().toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}
tickReloj();
setInterval(tickReloj, 1000);

// ── Cargar datos ──────────────────────────────────────────────────────────────
async function cargarCola() {
  const res  = await fetch('/api/turnos/cola');
  const data = await res.json();
  colaData   = data.juegos;
  construirFiltros();
  renderTodo();
}

function construirFiltros() {
  const cont = document.getElementById('filtros');
  cont.innerHTML = '<span style="color:rgba(255,255,255,.4); font-size:.8rem; text-transform:uppercase; letter-spacing:1px;">Filtrar:</span>';

  const btnTodos = document.createElement('button');
  btnTodos.className = `filtro-btn ${filtroId === '' ? 'activo' : ''}`;
  btnTodos.dataset.id = '';
  btnTodos.textContent = 'Todos los juegos';
  btnTodos.addEventListener('click', () => setFiltro(''));
  cont.appendChild(btnTodos);

  colaData.forEach(j => {
    const btn = document.createElement('button');
    btn.className = `filtro-btn ${filtroId === String(j.id) ? 'activo' : ''}`;
    btn.dataset.id = j.id;
    btn.style.cssText = estiloJuego(j.id);
    btn.innerHTML = `<span class="dot-juego" style="background:${colorDeJuego(j.id).accent}"></span>${escapeHtml(j.nombre)}`;
    btn.addEventListener('click', () => setFiltro(String(j.id)));
    cont.appendChild(btn);
  });
}

function setFiltro(id) {
  filtroId = id;
  document.querySelectorAll('.filtro-btn').forEach(b => {
    b.classList.toggle('activo', b.dataset.id === id);
  });
  renderTodo();
}

// ── Render completo ───────────────────────────────────────────────────────────
function renderTodo() {
  const juegos = filtroId
    ? colaData.filter(j => String(j.id) === filtroId)
    : colaData;

  renderJugando(juegos);
  renderCola(juegos);
}

function renderJugando(juegos) {
  const cont = document.getElementById('listaJugando');
  const grupos = juegos.flatMap(j => j.jugando.map(t => ({ ...t, juego: j })));

  if (!grupos.length) {
    cont.innerHTML = '<div class="sin-datos"><i>🎮</i>Sin grupos jugando</div>';
    return;
  }

  cont.innerHTML = grupos.map(t => {
    const pct     = t.juego.duracion_minutos > 0
      ? Math.min(100, Math.round((t.tiempo_transcurrido / t.juego.duracion_minutos) * 100)) : 0;
    const vencido = t.tiempo_transcurrido > t.juego.duracion_minutos;

    const etapaHtml = t.etapa_actual_nombre
      ? `<div class="etapa-tv">
           <span class="etapa-tv-actual"><i class="bi bi-layers me-1"></i>${escapeHtml(t.etapa_actual_nombre)}</span>
           ${t.etapa_siguiente_nombre
             ? `<span class="etapa-tv-sig"><i class="bi bi-arrow-right me-1"></i>${escapeHtml(t.etapa_siguiente_nombre)}</span>`
             : `<span class="etapa-tv-sig" style="opacity:.5">Última etapa</span>`}
         </div>`
      : '';

    // El estado real (llamado = ventana previa de 5 min / jugando = ya en curso)
    // se muestra explícito: no son lo mismo, sobre todo con juegos por etapas.
    const estadoChip = t.estado === 'jugando'
      ? `<span class="estado-chip jugando"><i class="bi bi-play-fill me-1"></i>Jugando</span>`
      : `<span class="estado-chip llamado"><i class="bi bi-megaphone-fill me-1"></i>Llamado</span>`;

    return `
    <div class="card-jugando" id="jugando-${t.id}" style="${estiloJuego(t.juego.id)}">
      <div class="juego-label-row">
        <div class="juego-label"><i class="bi bi-controller me-1"></i>${escapeHtml(t.juego.nombre)}</div>
        ${estadoChip}
      </div>
      <div class="biper-grande">${escapeHtml(t.biper_numero)}</div>
      <div class="familia-nombre">${escapeHtml(t.nombre_cliente || 'Sin nombre')}</div>
      ${etapaHtml}
      <div class="info-row">
        <span class="tag-miembros"><i class="bi bi-people me-1"></i>${t.cantidad_miembros} personas</span>
        <span style="font-size:.95rem; color:rgba(255,255,255,.6);">${t.tiempo_transcurrido} min en juego</span>
      </div>
      <div class="progreso-wrap">
        <div class="progreso-label">
          <span>Progreso del turno</span>
          <span>${vencido ? '⚠️ Tiempo excedido' : `${t.tiempo_restante} min restantes`}</span>
        </div>
        <div class="progreso-bar">
          <div class="progreso-fill ${vencido ? 'vencido' : ''}" style="width:${pct}%"></div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderCola(juegos) {
  const cont = document.getElementById('listaCola');
  let html = '';
  let hayCola = false;

  juegos.forEach(j => {
    if (!j.cola.length) return;
    hayCola = true;

    if (!filtroId) {
      html += `<div class="juego-sep" style="${estiloJuego(j.id)}"><span class="dot-juego"></span>${escapeHtml(j.nombre)}</div>`;
    }

    html += j.cola.map(t => {
      const esProximo = t.posicion === 1 && t.tiempo_espera_estimado === 0;
      return `
      <div class="card-cola ${esProximo ? 'proximo' : ''}" id="cola-${t.id}" style="${esProximo ? '' : estiloJuego(j.id)}">
        <div class="posicion">${t.posicion}</div>
        <div class="biper-col">${escapeHtml(t.biper_numero)}</div>
        <div class="familia-col">
          <div class="nombre">${escapeHtml(t.nombre_cliente || 'Sin nombre')}</div>
          <div class="sub">
            <i class="bi bi-people me-1"></i>${t.cantidad_miembros} personas
            ${!filtroId ? '' : ''}
          </div>
        </div>
        <div class="espera-col ${esProximo ? 'proximo' : ''}">
          ${esProximo
            ? `<div class="espera-num">¡Próximo!</div>`
            : t.tiempo_espera_estimado < 60
              ? `<div class="espera-num">~${t.tiempo_espera_estimado}</div>
                 <div class="espera-label">min espera</div>`
              : `<div class="espera-num">~${formatEspera(t.tiempo_espera_estimado)}</div>
                 <div class="espera-label">de espera</div>`}
        </div>
      </div>`;
    }).join('');
  });

  if (!hayCola) {
    cont.innerHTML = '<div class="sin-datos"><i>⏳</i>Sin grupos en espera</div>';
  } else {
    cont.innerHTML = html;
  }
}

// ── Flash de pantalla ─────────────────────────────────────────────────────────
function flash() {
  const el = document.getElementById('flash');
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 400);
}

// ── Socket ────────────────────────────────────────────────────────────────────
socket.on('turno:nuevo',         () => { cargarCola(); });
socket.on('turno:llamado',       () => { cargarCola(); flash(); });
socket.on('turno:etapa_avanzada',() => { cargarCola(); flash(); });
socket.on('turno:finalizado',    () => { cargarCola(); });
socket.on('juego:actualizado',   () => { cargarCola(); });

// Recalcular tiempos localmente cada 30s (igual que pantalla.js)
setInterval(() => {
  if (!colaData.length) return;
  const ahora = Date.now();
  colaData.forEach(j => {
    j.jugando.forEach(t => {
      const baseTime = t.jugando_desde || t.called_at;
      if (baseTime) {
        t.tiempo_transcurrido = Math.floor((ahora - new Date(baseTime).getTime()) / 60000);
        t.tiempo_restante     = Math.max(0, (j.duracion_minutos || 0) - t.tiempo_transcurrido);
      }
    });
  });
  renderTodo();
}, 30000);

// ── Init ──────────────────────────────────────────────────────────────────────
cargarCola();
