const socket = io();

let turnos        = [];
let me            = null;
let filtroId      = '';
let timerInterval = null;

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
}

// Nombre visible de un beeper: el apodo si tiene; si no, una versión corta del
// código (el código completo puede ser muy largo y se muestra como tooltip).
function nombreBeeper(v) {
  const apodo = String(v?.apodo ?? '').trim();
  if (apodo) return apodo;
  const codigo = String(v?.codigo_viper ?? '');
  return codigo.length > 12 ? codigo.slice(0, 12) + '…' : codigo;
}

// Etiqueta del beeper físico asociado a un turno (apodo o código corto + tooltip)
function etiquetaBeeperTurno(t) {
  if (!t.viper_codigo) return '';
  const nombre = nombreBeeper({ apodo: t.viper_apodo, codigo_viper: t.viper_codigo });
  return `<span class="atraccion-tag" style="background:#ede9fe;color:#5b21b6" title="${escapeHtml(t.viper_codigo)}"><i class="bi bi-broadcast me-1"></i>${escapeHtml(nombre)}</span>`;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function init() {
  const res = await fetch('/api/auth/me');
  if (!res.ok) { window.location.href = '/login.html'; return; }
  me = await res.json();

  // Bug 8: Admin no puede acceder al panel operador
  if (!['operador'].includes(me.rol)) { window.location.href = '/login.html'; return; }

  document.getElementById('usuarioNombre').textContent = me.nombre;

  if (me.permiso_gestionar_juegos) {
    document.getElementById('btnJuegos').style.display = 'inline-flex';
  }

  await cargarAtracciones();
  await cargarTurnos();
  await verificarPuesto();

  timerInterval = setInterval(actualizarTimers, 1000);
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
    sel.innerHTML += `<option value="${a.id}">${escapeHtml(a.nombre)}</option>`;
  });

  // Operador ve solo su juego, selector bloqueado
  if (me.rol === 'operador' && me.atraccion_id) {
    sel.value    = String(me.atraccion_id);
    filtroId     = String(me.atraccion_id);
    sel.disabled = true;
  }

  // Bug 9: operador sin atracción asignada — mostrar aviso claro
  if (me.rol === 'operador' && !me.atraccion_id) {
    const container = document.querySelector('.container-fluid');
    const aviso = document.createElement('div');
    aviso.className = 'alert alert-warning d-flex align-items-start gap-3 mt-3';
    aviso.innerHTML = `
      <i class="bi bi-exclamation-triangle-fill fs-4 flex-shrink-0 text-warning mt-1"></i>
      <div>
        <div class="fw-bold mb-1">Sin atracción asignada</div>
        <div>Este operador no tiene ninguna atracción asignada. Contactá al Administrador para que asigne una atracción a tu usuario antes de continuar.</div>
      </div>`;
    container.insertBefore(aviso, container.firstChild);
  }

  sel.addEventListener('change', () => { filtroId = sel.value; renderTurnos(); });
}

async function cargarTurnos() {
  const [r1, r2, r3] = await Promise.all([
    fetch('/api/turnos?estado=esperando'),
    fetch('/api/turnos?estado=llamado'),
    fetch('/api/turnos?estado=jugando'),
  ]);
  turnos = [
    ...(await r1.json()),
    ...(await r2.json()),
    ...(await r3.json()),
  ];
  renderTurnos();
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderTurnos() {
  const filtrados = filtroId ? turnos.filter(t => String(t.atraccion_id) === filtroId) : turnos;
  const esperando = filtrados.filter(t => t.estado === 'esperando')
    .sort((a,b) => (a.orden_cola - b.orden_cola) || (a.id - b.id));
  const activos   = filtrados.filter(t => t.estado === 'llamado' || t.estado === 'jugando')
    .sort((a,b) => new Date(a.called_at) - new Date(b.called_at));

  document.getElementById('cntEsperando').textContent = esperando.length;
  document.getElementById('cntLlamado').textContent   = activos.length;

  document.getElementById('listaEsperando').innerHTML = esperando.length
    ? esperando.map(cardEsperando).join('') : vacio();
  document.getElementById('listaLlamados').innerHTML  = activos.length
    ? activos.map(cardActivo).join('') : vacio('Ningún turno activo');
}

// El botón "Llamar" solo aparece si el operador tiene permiso_llamar_turno
// (lo activa el Administrador) y el turno es de su propia atracción asignada.
function cardEsperando(t) {
  const esAsignado = me.atraccion_id === t.atraccion_id || me.rol === 'admin';
  const llamarBtn  = (me.permiso_llamar_turno && esAsignado)
    ? `<button class="btn btn-success btn-sm px-3 fw-bold" onclick="llamarTurnoOperador(${t.id},this)">
         <i class="bi bi-megaphone me-1"></i>Llamar
       </button>`
    : `<span class="badge bg-warning text-dark px-3 py-2">
         <i class="bi bi-hourglass-split me-1"></i>En espera
       </span>`;
  return `
    <div class="turno-card esperando" id="turno-${t.id}">
      <div class="d-flex align-items-center justify-content-between flex-wrap gap-2">
        <div class="d-flex align-items-center gap-3">
          <div class="biper-num">${escapeHtml(t.biper_numero)}</div>
          <div>
            <div class="fw-semibold">${t.nombre_cliente ? escapeHtml(t.nombre_cliente) : '<span class="text-muted">Sin nombre</span>'}</div>
            <div class="d-flex align-items-center gap-2 mt-1 flex-wrap">
              <span class="atraccion-tag">${escapeHtml(t.atraccion_nombre)}</span>
              ${t.subcategoria_nombre ? `<span class="atraccion-tag" style="background:#d1fae5;color:#065f46"><i class="bi bi-diagram-3 me-1"></i>${escapeHtml(t.subcategoria_nombre)}</span>` : ''}
              ${t.vueltas != null ? `<span class="atraccion-tag" style="background:#e0f2fe;color:#075985"><i class="bi bi-arrow-repeat me-1"></i>${Number(t.vueltas)} vueltas</span>` : ''}
              <span class="duracion-tag"><i class="bi bi-people me-1"></i>${t.cantidad_miembros} persona${t.cantidad_miembros !== 1 ? 's' : ''}</span>
              ${t.duracion_minutos ? `<span class="duracion-tag"><i class="bi bi-clock me-1"></i>${t.duracion_minutos} min</span>` : ''}
              ${etiquetaBeeperTurno(t)}
              <span class="hora-tag">${formatHora(t.created_at)}</span>
            </div>
          </div>
        </div>
        <div class="d-flex gap-2">
          ${llamarBtn}
        </div>
      </div>
    </div>`;
}

// Bug 4: turnos 'llamado' (ventana 5 min) vs 'jugando' (en actividad)
function cardActivo(t) {
  if (t.estado === 'llamado') {
    return cardLlamado(t);
  }
  return cardJugando(t);
}

// Estado 'llamado': biper sonó, cliente tiene 5 min para llegar
// Solo se muestra el botón "No Llegó" — ningún botón de finalizar
function cardLlamado(t) {
  const msPasados     = t.called_at ? (Date.now() - new Date(t.called_at).getTime()) : 0;
  const restoMs       = Math.max(0, 5 * 60 * 1000 - msPasados);
  const restoMin      = Math.floor(restoMs / 60000);
  const restoSeg      = Math.floor((restoMs % 60000) / 1000);

  const esAsignado  = me.atraccion_id === t.atraccion_id || me.rol === 'admin';
  const cancelBtn   = (me.permiso_cancelar_turno && esAsignado)
    ? `<button class="btn btn-danger btn-sm px-3 fw-bold" onclick="cancelarTurno(${t.id})">
         <i class="bi bi-person-x me-1"></i>No Llegó
       </button>` : '';
  const llegoBtn    = esAsignado
    ? `<button class="btn btn-success btn-sm px-3 fw-bold" onclick="llegoTurno(${t.id},this)">
         <i class="bi bi-check-circle me-1"></i>Llegó
       </button>` : '';
  // Mientras no se marque "Llegó" se puede volver a llamar (resuena el mismo
  // biper/VIPER del mismo turno, sin duplicar nada ni crear otro registro).
  const llamarDeNuevoBtn = (me.permiso_llamar_turno && esAsignado)
    ? `<button class="btn btn-outline-primary btn-sm px-3 fw-bold" onclick="llamarTurnoOperador(${t.id},this)">
         <i class="bi bi-megaphone me-1"></i>Llamar nuevamente
       </button>` : '';

  return `
    <div class="turno-card llamado" id="turno-${t.id}">
      <div class="d-flex align-items-center justify-content-between flex-wrap gap-2">
        <div class="d-flex align-items-center gap-3">
          <div class="biper-num">${escapeHtml(t.biper_numero)}</div>
          <div>
            <div class="fw-semibold">${t.nombre_cliente ? escapeHtml(t.nombre_cliente) : '<span class="text-muted">Sin nombre</span>'}</div>
            <div class="d-flex align-items-center gap-2 mt-1 flex-wrap">
              <span class="atraccion-tag">${escapeHtml(t.atraccion_nombre)}</span>
              ${t.subcategoria_nombre ? `<span class="atraccion-tag" style="background:#d1fae5;color:#065f46"><i class="bi bi-diagram-3 me-1"></i>${escapeHtml(t.subcategoria_nombre)}</span>` : ''}
              ${t.vueltas != null ? `<span class="atraccion-tag" style="background:#e0f2fe;color:#075985"><i class="bi bi-arrow-repeat me-1"></i>${Number(t.vueltas)} vueltas</span>` : ''}
              <span class="duracion-tag"><i class="bi bi-people me-1"></i>${t.cantidad_miembros} persona${t.cantidad_miembros !== 1 ? 's' : ''}</span>
              ${etiquetaBeeperTurno(t)}
              <span class="badge bg-warning text-dark px-2">
                <i class="bi bi-bell-fill me-1"></i>Llamado
              </span>
              <span class="timer-badge timer-countdown" id="timer-${t.id}"
                    data-called="${t.called_at}" data-tipo="llamado">
                <i class="bi bi-alarm me-1"></i>${restoMin}:${String(restoSeg).padStart(2,'0')} para iniciar
              </span>
            </div>
          </div>
        </div>
        <div class="d-flex gap-2 flex-wrap">
          ${llegoBtn}
          ${llamarDeNuevoBtn}
          ${cancelBtn}
        </div>
      </div>
    </div>`;
}

// Estado 'jugando': cliente llegó, actividad en curso
// Botones de finalizar — SIN "No Llegó"
function cardJugando(t) {
  const baseTime   = t.jugando_desde || t.called_at;
  const elapsed    = tiempoTranscurrido(baseTime);
  const duracion   = t.duracion_minutos || 0;
  const vencido    = duracion > 0 && elapsed > duracion;
  const esAsignado = me.atraccion_id === t.atraccion_id || me.rol === 'admin';

  let etapaHtml    = '';
  let btnFinalizar = '';

  if (t.usa_etapas && t.etapa_actual_nombre) {
    const esMasEtapas = !!t.etapa_siguiente_nombre;
    const sigTexto = esMasEtapas
      ? `<span class="etapa-sig"><i class="bi bi-arrow-right me-1"></i>Próxima: <strong>${escapeHtml(t.etapa_siguiente_nombre)}</strong></span>`
      : `<span class="etapa-sig text-muted"><i class="bi bi-flag-fill me-1"></i>Última etapa</span>`;
    etapaHtml = `
      <div class="etapa-info mt-2">
        <span class="etapa-actual"><i class="bi bi-layers me-1"></i>Etapa: <strong>${escapeHtml(t.etapa_actual_nombre)}</strong></span>
        ${sigTexto}
      </div>`;

    if (esAsignado) {
      if (esMasEtapas) {
        btnFinalizar = `<button class="btn btn-primary btn-sm px-3 fw-bold" onclick="finalizarTurno(${t.id},this)">
          <i class="bi bi-skip-forward-fill me-1"></i>Finalizar Etapa
        </button>`;
      } else {
        btnFinalizar = `<button class="btn btn-success btn-sm px-3 fw-bold" onclick="finalizarTurno(${t.id},this)">
          <i class="bi bi-trophy me-1"></i>Finalizar
        </button>`;
      }
    }
  } else if (esAsignado) {
    // Sin etapas → Finalizar
    btnFinalizar = `<button class="btn btn-success btn-sm px-3 fw-bold" onclick="finalizarTurno(${t.id},this)">
      <i class="bi bi-trophy me-1"></i>Finalizar
    </button>`;
  }

  return `
    <div class="turno-card jugando" id="turno-${t.id}">
      <div class="d-flex align-items-center justify-content-between flex-wrap gap-2">
        <div class="d-flex align-items-center gap-3">
          <div class="biper-num">${escapeHtml(t.biper_numero)}</div>
          <div>
            <div class="fw-semibold">${t.nombre_cliente ? escapeHtml(t.nombre_cliente) : '<span class="text-muted">Sin nombre</span>'}</div>
            <div class="d-flex align-items-center gap-2 mt-1 flex-wrap">
              <span class="atraccion-tag">${escapeHtml(t.atraccion_nombre)}</span>
              ${t.subcategoria_nombre ? `<span class="atraccion-tag" style="background:#d1fae5;color:#065f46"><i class="bi bi-diagram-3 me-1"></i>${escapeHtml(t.subcategoria_nombre)}</span>` : ''}
              ${t.vueltas != null ? `<span class="atraccion-tag" style="background:#e0f2fe;color:#075985"><i class="bi bi-arrow-repeat me-1"></i>${Number(t.vueltas)} vueltas</span>` : ''}
              <span class="duracion-tag"><i class="bi bi-people me-1"></i>${t.cantidad_miembros} persona${t.cantidad_miembros !== 1 ? 's' : ''}</span>
              ${duracion ? `<span class="duracion-tag"><i class="bi bi-clock me-1"></i>${duracion} min est.</span>` : ''}
              ${etiquetaBeeperTurno(t)}
              <span class="badge bg-primary text-white px-2">
                <i class="bi bi-play-circle me-1"></i>Jugando
              </span>
              <span class="timer-badge ${vencido ? 'timer-vencido' : ''}"
                    data-base="${baseTime}" data-duracion="${duracion}" data-tipo="jugando"
                    id="timer-${t.id}">
                <i class="bi bi-stopwatch me-1"></i>${formatearMinutos(elapsed)} en juego
              </span>
            </div>
            ${etapaHtml}
          </div>
        </div>
        <div class="d-flex gap-2 flex-wrap">
          ${btnFinalizar}
        </div>
      </div>
    </div>`;
}

function vacio(msg = 'Sin turnos en espera') {
  return `<p class="text-center text-muted py-4">
    <i class="bi bi-inbox fs-1 d-block mb-2 opacity-50"></i>${msg}</p>`;
}

function actualizarTimers() {
  // Actualizar timers de jugando (tiempo transcurrido)
  document.querySelectorAll('[data-base][data-tipo="jugando"]').forEach(el => {
    const elapsed  = tiempoTranscurrido(el.dataset.base);
    const duracion = parseInt(el.dataset.duracion) || 0;
    const vencido  = duracion > 0 && elapsed > duracion;
    el.innerHTML   = `<i class="bi bi-stopwatch me-1"></i>${formatearMinutos(elapsed)} en juego`;
    el.className   = `timer-badge ${vencido ? 'timer-vencido' : ''}`;
  });

  // Actualizar countdown de llamado (segundos restantes)
  document.querySelectorAll('[data-called][data-tipo="llamado"]').forEach(el => {
    const msPasados = el.dataset.called ? (Date.now() - new Date(el.dataset.called).getTime()) : 0;
    const restoMs   = Math.max(0, 5 * 60 * 1000 - msPasados);
    const restoMin  = Math.floor(restoMs / 60000);
    const restoSeg  = Math.floor((restoMs % 60000) / 1000);
    el.innerHTML = `<i class="bi bi-alarm me-1"></i>${restoMin}:${String(restoSeg).padStart(2,'0')} para iniciar`;
  });
}

// ── Acciones ──────────────────────────────────────────────────────────────────
// Bug 12: no existe función llamarTurno — el sistema lo hace automáticamente

async function finalizarTurno(id, btn) {
  if (btn) { btn.disabled = true; }
  try {
    const res = await fetch(`/api/turnos/${id}/finalizar`, { method: 'PUT' });
    if (!res.ok) { const d = await res.json(); mostrarToast(d.error || 'Error', 'danger'); }
  } finally {
    if (btn) { btn.disabled = false; }
  }
}

async function llegoTurno(id, btn) {
  if (btn) { btn.disabled = true; }
  try {
    const res = await fetch(`/api/turnos/${id}/llegar`, { method: 'PUT' });
    if (!res.ok) { const d = await res.json(); mostrarToast(d.error || 'Error', 'danger'); }
  } finally {
    if (btn) { btn.disabled = false; }
  }
}

// Llama (o vuelve a llamar) un turno. Sirve tanto para el primer llamado desde
// "En Cola" como para "Llamar nuevamente" mientras sigue en estado 'llamado'.
async function llamarTurnoOperador(id, btn, force = false) {
  if (btn) { btn.disabled = true; }
  try {
    const res = await fetch(`/api/turnos/${id}/llamar`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(force ? { force: true } : {}),
    });
    const data = await res.json();
    if (!res.ok) { mostrarToast(data.error || 'No se pudo llamar al grupo', 'danger'); return; }

    if (data.advertencia === 'biper_en_otro_juego') {
      const resto = data.tiempo_restante > 0 ? ` (~${data.tiempo_restante} min restantes)` : '';
      if (confirm(`El beeper ${data.biper_numero} está jugando en "${data.juego_origen}"${resto}. ¿Llamarlo igualmente?`)) {
        await llamarTurnoOperador(id, btn, true);
      }
      return;
    }
    if (data.advertencia === 'capacidad_excedida') {
      if (confirm(`Se superaría la capacidad máxima (quedarían ${data.totalPersonas}/${data.maximoPermitido} personas). ¿Llamar igualmente?`)) {
        await llamarTurnoOperador(id, btn, true);
      }
      return;
    }
    mostrarToast(`Beeper ${data.biper_numero} llamado`, 'success');
  } finally {
    if (btn) { btn.disabled = false; }
  }
}

async function cancelarTurno(id) {
  if (!confirm('¿Marcar como "No llegó"? El turno volverá al final de la cola de espera.')) return;
  const res = await fetch(`/api/turnos/${id}/cancelar`, { method: 'PUT' });
  if (!res.ok) { const d = await res.json(); mostrarToast(d.error || 'Sin permiso para cancelar', 'danger'); return; }
  mostrarToast('Marcado como "No llegó" — el turno volvió al final de la cola', 'warning');
  await cargarTurnos();
}

// ── Socket ────────────────────────────────────────────────────────────────────
socket.on('turno:nuevo', t => {
  turnos.push(t); renderTurnos(); destacar(t.id);
  mostrarToast(`Nuevo turno – Beeper ${escapeHtml(t.biper_numero)} (${escapeHtml(t.atraccion_nombre)})`, 'info');
});
socket.on('turno:llamado',        t => { upsert(t); renderTurnos(); });
socket.on('turno:jugando',        t => { upsert(t); renderTurnos(); });
socket.on('turno:etapa_avanzada', t => { upsert(t); renderTurnos(); });
socket.on('turno:finalizado',     t => { turnos = turnos.filter(x => x.id !== t.id); renderTurnos(); });
socket.on('turno:reordenado',     () => cargarTurnos());
// El puesto se cierra solo al empezar un nuevo día: volver a elegir etapa.
socket.on('puesto:cerrado', () => verificarPuesto());

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

// 267 → "4 h 27 min"; 45 → "45 min"
function formatearMinutos(min) {
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}
function formatHora(dt) {
  if (!dt) return '';
  return new Date(dt).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' });
}
// Tope de carteles visibles a la vez — evita que clickear rápido y seguido un
// botón que da el mismo error apile una fila de carteles tapando la pantalla.
const TOAST_MAX_VISIBLES = 2;

function mostrarToast(mensaje, tipo = 'success') {
  const container = document.getElementById('toastContainer');

  const visibles = Array.from(container.children);
  while (visibles.length >= TOAST_MAX_VISIBLES) {
    const masViejo = visibles.shift();
    const inst = bootstrap.Toast.getInstance(masViejo);
    if (inst) inst.hide(); else masViejo.remove();
  }

  const id  = 'toast-' + Date.now();
  // Fondos claros (warning/info) llevan texto y botón de cierre oscuros para que se lean.
  const claro = tipo === 'warning' || tipo === 'info';
  const col = { success:'bg-success', danger:'bg-danger', warning:'bg-warning', info:'bg-info' }[tipo] || 'bg-secondary';
  container.insertAdjacentHTML('beforeend', `
    <div id="${id}" class="toast align-items-center ${col} ${claro ? 'text-dark' : 'text-white'} border-0 shadow" role="alert">
      <div class="d-flex">
        <div class="toast-body fw-semibold">${mensaje}</div>
        <button type="button" class="btn-close ${claro ? '' : 'btn-close-white'} me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>`);
  const el = document.getElementById(id);
  new bootstrap.Toast(el, { delay: 4000 }).show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}

init();


// ── Puesto del operador ───────────────────────────────────────────────────────
// Al iniciar sesión el operador elige de qué etapa(s) de su juego se encarga.
// Las demoras de esas etapas se le cargan mientras las tenga a cargo. En
// juegos sin etapas el puesto es el juego entero y se asigna solo.
let _puesto      = null;
let _modalPuesto = null;

async function verificarPuesto() {
  const res = await fetch('/api/puestos/mio');
  if (!res.ok) return;
  _puesto = await res.json();
  if (!_puesto.atraccion) return;

  if (!_puesto.etapas.length) {
    if (!_puesto.asignado) await guardarPuesto([]);
    mostrarPuesto([]);
    return;
  }

  const mias = _puesto.etapas.filter(e => _puesto.mias.includes(e.id)).map(e => e.nombre);
  document.getElementById('btnCambiarPuesto').classList.remove('d-none');
  mostrarPuesto(mias);
  if (!mias.length) abrirModalPuesto();
}

function mostrarPuesto(nombres) {
  const badge = document.getElementById('puestoActual');
  if (!nombres.length && _puesto?.etapas.length) {
    badge.classList.add('d-none');
    return;
  }
  const texto = nombres.length ? nombres.join(' · ') : _puesto.atraccion.nombre;
  badge.innerHTML = `<i class="bi bi-person-badge me-1"></i>${escapeHtml(texto)}`;
  badge.classList.remove('d-none');
}

function abrirModalPuesto() {
  document.getElementById('puestoJuego').textContent =
    `${_puesto.atraccion.nombre}: podés elegir más de una si las vas a atender vos solo.`;
  // Una etapa con encargado no se puede elegir: queda bloqueada con su nombre.
  document.getElementById('puestoEtapas').innerHTML = _puesto.etapas.map(e => `
    <label class="etapa-opcion ${e.responsable ? 'ocupada' : ''}">
      <input type="checkbox" class="form-check-input" value="${e.id}"
        ${_puesto.mias.includes(e.id) ? 'checked' : ''} ${e.responsable ? 'disabled' : ''}>
      <span class="fw-semibold flex-grow-1">${escapeHtml(e.nombre)}</span>
      ${e.responsable ? `<span class="badge bg-secondary-subtle text-secondary"><i class="bi bi-lock-fill me-1"></i>A cargo de ${escapeHtml(e.responsable.nombre)}</span>` : ''}
    </label>`).join('');
  const libres = _puesto.etapas.filter(e => !e.responsable).length;
  const errEl  = document.getElementById('puestoError');
  errEl.textContent = 'Todas las etapas ya tienen encargado. Pedí que liberen una para poder trabajar.';
  errEl.classList.toggle('d-none', libres > 0);
  document.getElementById('btnConfirmarPuesto').disabled = libres === 0;
  document.getElementById('btnCancelarPuesto').classList.toggle('d-none', !_puesto.mias.length);
  _modalPuesto ??= new bootstrap.Modal(document.getElementById('modalPuesto'));
  _modalPuesto.show();
}

async function guardarPuesto(etapas) {
  const res = await fetch('/api/puestos', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ etapas }),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

// Traer el estado actual antes de abrir: otro operador pudo haber tomado o
// liberado etapas desde la última consulta.
document.getElementById('btnCambiarPuesto').addEventListener('click', async () => {
  const res = await fetch('/api/puestos/mio');
  if (res.ok) _puesto = await res.json();
  abrirModalPuesto();
});

document.getElementById('btnConfirmarPuesto').addEventListener('click', async e => {
  const btn    = e.currentTarget;
  const errEl  = document.getElementById('puestoError');
  const etapas = [...document.querySelectorAll('#puestoEtapas input:checked')].map(i => Number(i.value));
  errEl.classList.add('d-none');

  if (!etapas.length) {
    errEl.textContent = 'Elegí al menos una etapa.';
    errEl.classList.remove('d-none');
    return;
  }

  btn.disabled = true;
  try {
    const { status, data } = await guardarPuesto(etapas);
    if (status !== 200) {
      // 409: otro operador eligió esa etapa recién; se refresca la lista
      errEl.textContent = data.error || 'No se pudo guardar la etapa';
      errEl.classList.remove('d-none');
      if (status === 409) {
        await verificarPuesto();
        errEl.textContent = data.error;
        errEl.classList.remove('d-none');
      }
      return;
    }
    _modalPuesto.hide();
    mostrarToast(`Ahora estás a cargo de: ${escapeHtml(data.etapas.join(', '))}`);
    await verificarPuesto();
  } finally {
    btn.disabled = !_puesto.etapas.some(e => !e.responsable);
  }
});
