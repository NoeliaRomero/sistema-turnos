const socket = io();

let turnos   = [];
let me       = null;
let filtroId = '';
let timerInterval = null;

// ── Auth ──────────────────────────────────────────────────────────────────────
async function init() {
  const res = await fetch('/api/auth/me');
  if (!res.ok) { window.location.href = '/login.html'; return; }
  me = await res.json();
  if (!['admin','operador'].includes(me.rol)) { window.location.href = '/login.html'; return; }
  document.getElementById('usuarioNombre').textContent = me.nombre;

  // Mostrar botón "Juegos" solo si tiene el permiso
  if (me.permiso_gestionar_juegos) {
    document.getElementById('btnJuegos').style.display = 'inline-flex';
  }

  await cargarAtracciones();
  await cargarTurnos();

  // Actualizar tiempos en juego cada 60 segundos
  timerInterval = setInterval(actualizarTimers, 60000);
}

document.getElementById('btnLogout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

// ── Atracciones ───────────────────────────────────────────────────────────────
async function cargarAtracciones() {
  const res         = await fetch('/api/atracciones');
  const atracciones = await res.json();
  const sel         = document.getElementById('filtroAtraccion');

  atracciones.forEach(a => {
    sel.innerHTML += `<option value="${a.id}">${a.nombre}</option>`;
  });

  // Pre-seleccionar atracción del operador si está asignado
  if (me.rol === 'operador' && me.atraccion_id) {
    sel.value = String(me.atraccion_id);
    filtroId  = String(me.atraccion_id);
  }

  sel.addEventListener('change', () => { filtroId = sel.value; renderTurnos(); });
}

async function cargarTurnos() {
  const [r1, r2] = await Promise.all([
    fetch('/api/turnos?estado=esperando'),
    fetch('/api/turnos?estado=llamado')
  ]);
  turnos = [...(await r1.json()), ...(await r2.json())];
  renderTurnos();
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderTurnos() {
  const filtrados = filtroId ? turnos.filter(t => String(t.atraccion_id) === filtroId) : turnos;
  const esperando = filtrados.filter(t => t.estado === 'esperando')
    .sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
  const llamados  = filtrados.filter(t => t.estado === 'llamado')
    .sort((a,b) => new Date(a.called_at) - new Date(b.called_at));

  document.getElementById('cntEsperando').textContent = esperando.length;
  document.getElementById('cntLlamado').textContent   = llamados.length;

  document.getElementById('listaEsperando').innerHTML = esperando.length
    ? esperando.map(cardEsperando).join('') : vacio();
  document.getElementById('listaLlamados').innerHTML  = llamados.length
    ? llamados.map(cardLlamado).join('')    : vacio('Ningún turno llamado');
}

function cardEsperando(t) {
  const cancelBtn = me.permiso_cancelar_turno
    ? `<button class="btn btn-outline-danger btn-sm" onclick="cancelarTurno(${t.id})" title="Cliente no llegó">
         <i class="bi bi-x-circle me-1"></i>No llegó
       </button>` : '';
  return `
    <div class="turno-card esperando" id="turno-${t.id}">
      <div class="d-flex align-items-center justify-content-between flex-wrap gap-2">
        <div class="d-flex align-items-center gap-3">
          <div class="biper-num">${t.biper_numero}</div>
          <div>
            <div class="fw-semibold">${t.nombre_cliente || '<span class="text-muted">Sin nombre</span>'}</div>
            <div class="d-flex align-items-center gap-2 mt-1 flex-wrap">
              <span class="atraccion-tag">${t.atraccion_nombre}</span>
              ${t.duracion_minutos ? `<span class="duracion-tag"><i class="bi bi-clock me-1"></i>${t.duracion_minutos} min</span>` : ''}
              <span class="hora-tag">${formatHora(t.created_at)}</span>
            </div>
          </div>
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-primary btn-sm px-3 fw-bold" onclick="llamarTurno(${t.id})">
            <i class="bi bi-bell me-1"></i>Llamar
          </button>
          ${cancelBtn}
        </div>
      </div>
    </div>`;
}

function cardLlamado(t) {
  const elapsed   = tiempoTranscurrido(t.called_at);
  const duracion  = t.duracion_minutos || 0;
  const vencido   = duracion > 0 && elapsed > duracion;
  const cancelBtn = me.permiso_cancelar_turno
    ? `<button class="btn btn-outline-danger btn-sm" onclick="cancelarTurno(${t.id})" title="Cliente no llegó">
         <i class="bi bi-x-circle me-1"></i>No llegó
       </button>` : '';

  // Info de etapa (solo si el juego usa etapas)
  let etapaHtml = '';
  let btnFinalizar = '';
  if (t.usa_etapas && t.etapa_actual_nombre) {
    const sigTexto = t.etapa_siguiente_nombre
      ? `<span class="etapa-sig"><i class="bi bi-arrow-right me-1"></i>Próxima: <strong>${t.etapa_siguiente_nombre}</strong></span>`
      : `<span class="etapa-sig text-muted"><i class="bi bi-flag-fill me-1"></i>Última etapa</span>`;
    etapaHtml = `
      <div class="etapa-info mt-2">
        <span class="etapa-actual"><i class="bi bi-layers me-1"></i>Etapa: <strong>${t.etapa_actual_nombre}</strong></span>
        ${sigTexto}
      </div>`;
    const btnLabel = t.etapa_siguiente_nombre
      ? `<i class="bi bi-skip-forward-fill me-1"></i>Avanzar a ${t.etapa_siguiente_nombre}`
      : `<i class="bi bi-check-lg me-1"></i>Finalizar turno`;
    btnFinalizar = `<button class="btn btn-success btn-sm px-3 fw-bold" onclick="finalizarTurno(${t.id})">${btnLabel}</button>`;
  } else {
    btnFinalizar = `<button class="btn btn-success btn-sm px-3 fw-bold" onclick="finalizarTurno(${t.id})">
      <i class="bi bi-check-lg me-1"></i>Finalizar
    </button>`;
  }

  return `
    <div class="turno-card llamado" id="turno-${t.id}">
      <div class="d-flex align-items-center justify-content-between flex-wrap gap-2">
        <div class="d-flex align-items-center gap-3">
          <div class="biper-num">${t.biper_numero}</div>
          <div>
            <div class="fw-semibold">${t.nombre_cliente || '<span class="text-muted">Sin nombre</span>'}</div>
            <div class="d-flex align-items-center gap-2 mt-1 flex-wrap">
              <span class="atraccion-tag">${t.atraccion_nombre}</span>
              ${duracion ? `<span class="duracion-tag"><i class="bi bi-clock me-1"></i>${duracion} min est.</span>` : ''}
              <span class="timer-badge ${vencido ? 'timer-vencido' : ''}" data-called="${t.called_at}" data-duracion="${duracion}" id="timer-${t.id}">
                <i class="bi bi-stopwatch me-1"></i>${elapsed} min en juego
              </span>
            </div>
            ${etapaHtml}
          </div>
        </div>
        <div class="d-flex gap-2 flex-wrap">
          ${btnFinalizar}
          ${cancelBtn}
        </div>
      </div>
    </div>`;
}

function vacio(msg = 'Sin turnos en espera') {
  return `<p class="text-center text-muted py-4">
    <i class="bi bi-inbox fs-1 d-block mb-2 opacity-50"></i>${msg}</p>`;
}

// Actualiza los timers de turnos llamados sin re-renderizar todo
function actualizarTimers() {
  document.querySelectorAll('[data-called]').forEach(el => {
    const elapsed  = tiempoTranscurrido(el.dataset.called);
    const duracion = parseInt(el.dataset.duracion) || 0;
    const vencido  = duracion > 0 && elapsed > duracion;
    el.innerHTML   = `<i class="bi bi-stopwatch me-1"></i>${elapsed} min en juego`;
    el.className   = `timer-badge ${vencido ? 'timer-vencido' : ''}`;
  });
}

// ── Acciones ──────────────────────────────────────────────────────────────────
async function llamarTurno(id) {
  const res = await fetch(`/api/turnos/${id}/llamar`, { method: 'PUT' });
  if (!res.ok) { const d = await res.json(); mostrarToast(d.error||'Error', 'danger'); }
}

async function finalizarTurno(id) {
  await fetch(`/api/turnos/${id}/finalizar`, { method: 'PUT' });
}

async function cancelarTurno(id) {
  if (!confirm('¿Cancelar el biper? El turno quedará anulado.')) return;
  const res = await fetch(`/api/turnos/${id}/cancelar`, { method: 'PUT' });
  if (!res.ok) { const d = await res.json(); mostrarToast(d.error||'Sin permiso para cancelar', 'danger'); }
}

// ── Socket ────────────────────────────────────────────────────────────────────
socket.on('turno:nuevo', t => {
  turnos.push(t); renderTurnos(); destacar(t.id);
  mostrarToast(`Nuevo turno – Biper ${t.biper_numero} (${t.atraccion_nombre})`, 'info');
});
socket.on('turno:llamado',        t => { upsert(t); renderTurnos(); });
socket.on('turno:etapa_avanzada', t => { upsert(t); renderTurnos(); });
socket.on('turno:finalizado',     t => { turnos = turnos.filter(x => x.id !== t.id); renderTurnos(); });

// ── Helpers ───────────────────────────────────────────────────────────────────
function upsert(t) {
  const i = turnos.findIndex(x => x.id === t.id);
  if (i !== -1) turnos[i] = t; else turnos.push(t);
}
function destacar(id) {
  setTimeout(() => { const el = document.getElementById(`turno-${id}`); if (el) el.classList.add('nuevo-highlight'); }, 60);
}
function tiempoTranscurrido(dt) {
  if (!dt) return 0;
  return Math.floor((Date.now() - new Date(dt).getTime()) / 60000);
}
function formatHora(dt) {
  if (!dt) return '';
  return new Date(dt).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' });
}
function mostrarToast(mensaje, tipo = 'success') {
  const id  = 'toast-' + Date.now();
  const col = { success:'bg-success', danger:'bg-danger', warning:'bg-warning text-dark', info:'bg-info text-dark' }[tipo];
  document.getElementById('toastContainer').insertAdjacentHTML('beforeend', `
    <div id="${id}" class="toast align-items-center text-white ${col} border-0" role="alert">
      <div class="d-flex">
        <div class="toast-body fw-semibold">${mensaje}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>`);
  const el = document.getElementById(id);
  new bootstrap.Toast(el, { delay: 4000 }).show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}

init();
