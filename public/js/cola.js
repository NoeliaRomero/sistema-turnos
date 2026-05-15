const socket = io();

let colaData   = [];
let filtroId   = '';  // '' = todos
let timerTick  = null;

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
    btn.textContent = j.nombre;
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
    return `
    <div class="card-jugando" id="jugando-${t.id}">
      <div class="juego-label"><i class="bi bi-controller me-1"></i>${t.juego.nombre}</div>
      <div class="biper-grande">${t.biper_numero}</div>
      <div class="familia-nombre">${t.nombre_cliente || 'Sin nombre'}</div>
      <div class="info-row">
        <span class="tag-miembros"><i class="bi bi-people me-1"></i>${t.cantidad_miembros} personas</span>
        <span style="font-size:.8rem; color:rgba(255,255,255,.5);">${t.tiempo_transcurrido} min en juego</span>
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
      html += `<div class="juego-sep"><i class="bi bi-controller me-2"></i>${j.nombre}</div>`;
    }

    html += j.cola.map(t => {
      const esProximo = t.posicion === 1 && t.tiempo_espera_estimado === 0;
      return `
      <div class="card-cola ${esProximo ? 'proximo' : ''}" id="cola-${t.id}">
        <div class="posicion">${t.posicion}</div>
        <div class="biper-col">${t.biper_numero}</div>
        <div class="familia-col">
          <div class="nombre">${t.nombre_cliente || 'Sin nombre'}</div>
          <div class="sub">
            <i class="bi bi-people me-1"></i>${t.cantidad_miembros} personas
            ${!filtroId ? '' : ''}
          </div>
        </div>
        <div class="espera-col ${esProximo ? 'proximo' : ''}">
          ${esProximo
            ? `<div class="espera-num">¡Próximo!</div>`
            : `<div class="espera-num">~${t.tiempo_espera_estimado}</div>
               <div class="espera-label">min espera</div>`}
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
socket.on('turno:nuevo',     () => { cargarCola(); });
socket.on('turno:llamado',   () => { cargarCola(); flash(); });
socket.on('turno:finalizado',() => { cargarCola(); });

// Actualizar progreso cada 60 seg sin recargar del servidor
setInterval(() => {
  if (colaData.length) renderTodo();
}, 60000);

// ── Init ──────────────────────────────────────────────────────────────────────
cargarCola();
