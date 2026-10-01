const socket = io();

let colaData   = [];
let filtroId   = '';  // '' = todos
let timerTick  = null;

// ── Paginado automático ───────────────────────────────────────────────────────
// En un TV nadie puede scrollear: si hay más tarjetas de las que entran cómodas
// en pantalla, en vez de desbordar (invisible) o achicar todo, se dividen en
// páginas que van rotando solas. Un cambio real de datos (llamada, turno nuevo,
// etc. — ver cargarCola) vuelve siempre a la página 1 para que lo urgente se
// vea ya; el recálculo local de tiempos cada 30s no toca la página actual.
const ROTACION_MS = 6000;
// 1 y no 2: .grid-jugando ahora es siempre 1 columna (ver CSS), porque cuántas
// entraban lado a lado dependía del ancho real que reporta cada TV — en la
// del usuario no entraban 2 y el grid las apilaba, cortando la de abajo. Con
// 1 columna fija + 1 por página es 100% predecible en cualquier pantalla.
const POR_PAGINA_JUGANDO = 1;
const POR_PAGINA_ESPERA  = 6;

let _pagJugando = 0, _timerJugando = null;
let _pagCola    = 0, _timerCola    = null;

function paginar(items, porPagina) {
  const paginas = [];
  for (let i = 0; i < items.length; i += porPagina) paginas.push(items.slice(i, i + porPagina));
  return paginas;
}

function renderDots(contId, paginas, paginaActual) {
  const el = document.getElementById(contId);
  if (!el) return;
  el.innerHTML = paginas.length > 1
    ? paginas.map((_, i) => `<span class="dot-pag ${i === paginaActual ? 'activo' : ''}"></span>`).join('')
    : '';
}

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
// Ícono a medida para los juegos conocidos (mismo criterio que las fotos:
// palabra clave en el nombre, no id). Un juego sin match usa la rotación
// genérica de abajo, indexada por id para que sea estable.
const ICONOS_POR_NOMBRE = [
  { match: /kart/i,          icono: 'bi-speedometer2' },
  { match: /paintball/i,     icono: 'bi-bullseye' },
  { match: /escape\s*room/i, icono: 'bi-key-fill' },
  { match: /atraco/i,        icono: 'bi-bank2' },
];
const ICONOS_FALLBACK = [
  'bi-joystick', 'bi-trophy-fill', 'bi-lightning-charge-fill', 'bi-stars',
  'bi-gem', 'bi-fire', 'bi-controller', 'bi-dice-5-fill',
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
  const juego    = colaData.find(j => j.id === juegoId);
  const conocido = ICONOS_POR_NOMBRE.find(e => e.match.test(juego?.nombre || ''));
  return conocido ? conocido.icono : ICONOS_FALLBACK[juegoId % ICONOS_FALLBACK.length];
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
    new Date().toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12: false });
}
tickReloj();
setInterval(tickReloj, 1000);

// ── Cargar datos ──────────────────────────────────────────────────────────────
async function cargarCola() {
  const res  = await fetch('/api/turnos/cola');
  const data = await res.json();
  colaData   = data.juegos;
  // Un cambio real de datos vuelve siempre a la página 1 (lo urgente se ve
  // ya); el recálculo local de tiempos cada 30s no pasa por acá.
  _pagJugando = 0;
  _pagCola    = 0;
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
  _pagJugando = 0;
  _pagCola    = 0;
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

  clearInterval(_timerJugando);

  if (!grupos.length) {
    cont.innerHTML = '<div class="sin-datos"><i class="bi bi-controller"></i>Sin grupos jugando</div>';
    renderDots('dotsJugando', [], 0);
    return;
  }

  const paginas = paginar(grupos, POR_PAGINA_JUGANDO);
  if (_pagJugando >= paginas.length) _pagJugando = 0;

  const pintar = () => {
    cont.innerHTML = paginas[_pagJugando].map(pintarCardJugando).join('');
    renderDots('dotsJugando', paginas, _pagJugando);
  };
  pintar();

  if (paginas.length > 1) {
    _timerJugando = setInterval(() => {
      _pagJugando = (_pagJugando + 1) % paginas.length;
      pintar();
    }, ROTACION_MS);
  }
}

function pintarCardJugando(t) {
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
      ${tieneImg ? '' : `<i class="bi ${icono} icono-fondo"></i>`}
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
}

function renderCola(juegos) {
  const cont = document.getElementById('listaCola');

  // Une la cola de todos los juegos filtrados en una sola lista, ordenada por
  // tiempo de espera (así "Todos" muestra un orden real de llegada al frente,
  // no la cola de cada juego repitiendo la posición 01 por separado).
  const items = juegos.flatMap(j => j.cola.map(t => ({ ...t, juego: j })))
    .sort((a, b) => (a.tiempo_espera_estimado ?? 0) - (b.tiempo_espera_estimado ?? 0));

  clearInterval(_timerCola);

  if (!items.length) {
    cont.innerHTML = '<div class="sin-datos"><i class="bi bi-hourglass-split"></i>Sin grupos en espera</div>';
    renderDots('dotsCola', [], 0);
    return;
  }

  // La posición (#1, #2...) y "¡Próximo!" se calculan sobre el índice real en
  // la lista completa ANTES de paginar, para que no se reinicien en cada página.
  const htmls = items.map((t, i) => {
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
  });

  const paginas = paginar(htmls, POR_PAGINA_ESPERA);
  if (_pagCola >= paginas.length) _pagCola = 0;

  const pintar = () => {
    cont.innerHTML = paginas[_pagCola].join('');
    renderDots('dotsCola', paginas, _pagCola);
  };
  pintar();

  if (paginas.length > 1) {
    _timerCola = setInterval(() => {
      _pagCola = (_pagCola + 1) % paginas.length;
      pintar();
    }, ROTACION_MS);
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
