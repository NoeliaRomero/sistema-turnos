const socket = io();

let colaData   = [];
let filtroId   = '';  // '' = todos
let timerTick  = null;

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
}

// Formatea minutos de espera como horas cuando pasan los 60 (ej. "1h 20").
// Devuelve {numero, unidad} para renderizar el número grande y la unidad chica
// por separado, como en el mockup.
function formatEsperaPartes(min) {
  if (min < 60) return { numero: String(min), unidad: 'MIN' };
  const horas = Math.floor(min / 60);
  const resto = min % 60;
  return resto === 0
    ? { numero: `${horas}`, unidad: 'H' }
    : { numero: `${horas}h${resto}`, unidad: 'MIN' };
}

// ── Color + ícono por juego ──────────────────────────────────────────────────
// Cada juego se pinta con un color/ícono propio (estable mientras no cambie el
// orden alfabético que devuelve el backend) para distinguirlos de un vistazo.
const PALETA_JUEGOS = [
  { accent: '#3b82f6', bg: 'rgba(59,130,246,0.12)',  bgStrong: '#3b82f6', border: 'rgba(59,130,246,0.35)',  text: '#93c5fd' }, // azul
  { accent: '#a855f7', bg: 'rgba(168,85,247,0.12)',  bgStrong: '#a855f7', border: 'rgba(168,85,247,0.35)',  text: '#d8b4fe' }, // violeta
  { accent: '#f97316', bg: 'rgba(249,115,22,0.12)',  bgStrong: '#f97316', border: 'rgba(249,115,22,0.35)',  text: '#fdba74' }, // naranja
  { accent: '#ec4899', bg: 'rgba(236,72,153,0.12)',  bgStrong: '#ec4899', border: 'rgba(236,72,153,0.35)',  text: '#f9a8d4' }, // rosa
  { accent: '#10b981', bg: 'rgba(16,185,129,0.12)',  bgStrong: '#10b981', border: 'rgba(16,185,129,0.35)',  text: '#6ee7b7' }, // verde
  { accent: '#06b6d4', bg: 'rgba(6,182,212,0.12)',   bgStrong: '#06b6d4', border: 'rgba(6,182,212,0.35)',   text: '#67e8f9' }, // cian
  { accent: '#eab308', bg: 'rgba(234,179,8,0.12)',   bgStrong: '#eab308', border: 'rgba(234,179,8,0.35)',   text: '#fde047' }, // amarillo
  { accent: '#ef4444', bg: 'rgba(239,68,68,0.12)',   bgStrong: '#ef4444', border: 'rgba(239,68,68,0.35)',   text: '#fca5a5' }, // rojo
];
// Íconos genéricos que rotan junto con el color — no dependen del nombre del
// juego (que es libre / lo define el admin), así funciona para cualquier
// juego futuro sin necesidad de mapear nombre → ícono a mano.
const ICONOS_JUEGOS = [
  'bi-speedometer2', 'bi-bullseye', 'bi-trophy-fill', 'bi-lightning-charge-fill',
  'bi-joystick', 'bi-stars', 'bi-gem', 'bi-fire',
];

// Se indexa por el ID del juego (fijo en la base), no por su posición en la
// lista: el backend ordena por nombre, así que renombrar o agregar un juego
// corre el orden alfabético — si indexáramos por posición, TODOS los colores
// se reacomodarían en cascada cada vez que eso pasa. Con el id, el color de
// cada juego queda fijo para siempre, sin importar cómo se reordene la lista.
function colorDeJuego(juegoId) {
  return PALETA_JUEGOS[juegoId % PALETA_JUEGOS.length];
}
function iconoDeJuego(juegoId) {
  return ICONOS_JUEGOS[juegoId % ICONOS_JUEGOS.length];
}
// Fondo ilustrado por juego: se matchea por palabra clave en el nombre, no por
// id — así el mismo archivo sirve para "Karting", "Karting Indoor", etc., y un
// juego sin imagen conocida (ej. "Tiro al Blanco") simplemente no lleva foto,
// sin romper nada.
const IMAGENES_JUEGOS = [
  { match: /kart/i,               archivo: 'karting.png' },
  { match: /paintball/i,          archivo: 'paintball.png' },
  { match: /escape\s*room/i,      archivo: 'escaperoom.png' },
  { match: /atraco/i,             archivo: 'atraco.png' },
];
function imagenDeJuego(nombre) {
  const encontrado = IMAGENES_JUEGOS.find(e => e.match.test(nombre || ''));
  return encontrado ? `/assets/juegos/${encontrado.archivo}` : null;
}

function estiloJuego(juegoId) {
  const c = colorDeJuego(juegoId);
  const juego = colaData.find(j => j.id === juegoId);
  const img   = imagenDeJuego(juego?.nombre);
  const imgCss = img ? `url('${img}')` : 'none';
  return `--jc-accent:${c.accent}; --jc-bg:${c.bg}; --jc-bg-strong:${c.bgStrong}; --jc-border:${c.border}; --jc-text:${c.text}; --jc-img:${imgCss};`;
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
  cont.innerHTML = '<span class="etiqueta">Filtrar:</span>';

  const btnTodos = document.createElement('button');
  btnTodos.className = `filtro-btn ${filtroId === '' ? 'activo' : ''}`;
  btnTodos.dataset.id = '';
  btnTodos.innerHTML = '<i class="bi bi-grid-3x3-gap-fill"></i>Todos';
  btnTodos.addEventListener('click', () => setFiltro(''));
  cont.appendChild(btnTodos);

  colaData.forEach(j => {
    const btn = document.createElement('button');
    btn.className = `filtro-btn ${filtroId === String(j.id) ? 'activo' : ''}`;
    btn.dataset.id = j.id;
    btn.style.cssText = estiloJuego(j.id);
    btn.innerHTML = `<i class="bi ${iconoDeJuego(j.id)}"></i>${escapeHtml(j.nombre)}`;
    btn.addEventListener('click', () => setFiltro(String(j.id)));
    cont.appendChild(btn);
  });
}

function setFiltro(id) {
  filtroId = id;
  renderTodo();
  construirFiltros();
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
    cont.innerHTML = '<div class="sin-datos"><i class="bi bi-controller"></i>Sin grupos jugando</div>';
    return;
  }

  cont.innerHTML = grupos.map(t => {
    const pct     = t.juego.duracion_minutos > 0
      ? Math.min(100, Math.round((t.tiempo_transcurrido / t.juego.duracion_minutos) * 100)) : 0;
    const vencido = t.tiempo_transcurrido > t.juego.duracion_minutos;
    const icono   = iconoDeJuego(t.juego.id);
    const tieneImg = !!imagenDeJuego(t.juego.nombre);

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
    const estadoPill = t.estado === 'jugando'
      ? `<span class="estado-pill jugando"><span class="dot"></span>Jugando</span>`
      : `<span class="estado-pill llamado"><span class="dot"></span>Llamado</span>`;

    // Barra de progreso segmentada (12 bloques)
    const totalSeg = 12;
    const llenos   = Math.round((pct / 100) * totalSeg);
    const segmentosHtml = Array.from({ length: totalSeg }, (_, i) =>
      `<div class="segmento ${i < llenos ? (vencido ? 'vencido-seg' : 'lleno') : ''}"></div>`
    ).join('');

    return `
    <div class="card-jugando nuevo" id="jugando-${t.id}" style="${estiloJuego(t.juego.id)}">
      ${tieneImg ? '<div class="foto-fondo"></div>' : `<i class="bi ${icono} icono-fondo"></i>`}
      <div class="juego-label"><i class="bi ${icono}"></i>${escapeHtml(t.juego.nombre)}</div>
      <div class="biper-grande">${escapeHtml(t.biper_numero)}</div>
      <div class="familia-nombre">${escapeHtml(t.nombre_cliente || 'Sin nombre')}</div>
      ${estadoPill}
      ${etapaHtml}
      <div class="tag-miembros"><i class="bi bi-people-fill"></i>${t.cantidad_miembros} persona${t.cantidad_miembros !== 1 ? 's' : ''}</div>
      <div class="restante-wrap">
        <div class="restante-label">${vencido ? '⚠️ Tiempo excedido' : 'Tiempo restante'}</div>
        <div class="restante-num ${vencido ? 'vencido' : ''}">${t.tiempo_restante}<span class="u">MIN</span></div>
        <div class="segmentos">${segmentosHtml}</div>
      </div>
    </div>`;
  }).join('');
}

function renderCola(juegos) {
  const cont = document.getElementById('listaCola');

  // Une la cola de todos los juegos filtrados en una sola lista, ordenada por
  // tiempo de espera (así "Todos" muestra un orden real de llegada al frente,
  // no la cola de cada juego repitiendo la posición 01 por separado).
  const items = juegos.flatMap(j => j.cola.map(t => ({ ...t, juego: j })))
    .sort((a, b) => (a.tiempo_espera_estimado ?? 0) - (b.tiempo_espera_estimado ?? 0));

  if (!items.length) {
    cont.innerHTML = '<div class="sin-datos"><i class="bi bi-hourglass-split"></i>Sin grupos en espera</div>';
    return;
  }

  cont.innerHTML = items.map((t, i) => {
    const icono     = iconoDeJuego(t.juego.id);
    const esProximo = i === 0 && t.tiempo_espera_estimado === 0;
    const min       = t.tiempo_espera_estimado ?? 0;
    const p         = formatEsperaPartes(min);
    return `
      <div class="card-cola ${esProximo ? 'proximo' : ''}" id="cola-${t.id}">
        <div class="cola-posicion">${String(i + 1).padStart(2, '0')}</div>
        <div class="cola-datos">
          <div class="cola-nombre">${escapeHtml(t.nombre_cliente || 'Sin nombre')}</div>
          <div class="cola-juego" style="color:${colorDeJuego(t.juego.id).accent}">
            <i class="bi ${icono}"></i>${escapeHtml(t.juego.nombre)}
          </div>
        </div>
        <div class="cola-espera">
          ${esProximo
            ? `<div class="num" style="font-size:1.3rem">¡Próximo!</div>`
            : `<div class="aprox">Aprox.</div><div class="num">${p.numero}<span style="font-size:1rem"> ${p.unidad}</span></div>`}
        </div>
      </div>`;
  }).join('');
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
