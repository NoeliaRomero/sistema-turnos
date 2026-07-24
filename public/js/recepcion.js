const socket = io();
let me = null;
let atracciones = [];
let colaData    = [];

// ── Auth ──────────────────────────────────────────────────────────────────────
async function init() {
  const res = await fetch('/api/auth/me');
  if (!res.ok) { window.location.href = '/login.html'; return; }
  me = await res.json();
  if (!['admin','recepcion'].includes(me.rol)) {
    window.location.href = '/login.html'; return;
  }
  document.getElementById('usuarioNombre').textContent = me.nombre;
  if (me.permiso_gestionar_juegos) document.getElementById('btnJuegos').style.display = 'inline-flex';

  await cargarAtracciones();
  await cargarVipersActivos();
  await cargarCola();
}

document.getElementById('btnLogout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});
document.getElementById('btnRefresh').addEventListener('click', cargarCola);

// ── Atracciones ───────────────────────────────────────────────────────────────
async function cargarAtracciones() {
  const res = await fetch('/api/atracciones');
  atracciones = await res.json();
  const sel = document.getElementById('selectJuego');
  sel.innerHTML = '<option value="">Seleccionar juego…</option>';
  atracciones.forEach(a => {
    const minM = a.min_miembros || 1;
    const maxM = a.max_miembros || 30;
    sel.innerHTML += `<option value="${a.id}" data-duracion="${a.duracion_minutos}" data-min-miembros="${minM}" data-max-miembros="${maxM}" data-usa-subcategorias="${a.usa_subcategorias || 0}">${a.nombre} (${a.duracion_minutos} min)</option>`;
  });
}

// ── VIPERs activos (selección opcional al registrar un grupo) ──────────────────
async function cargarVipersActivos() {
  const sel = document.getElementById('selectViper');
  if (!sel) return;
  try {
    const res    = await fetch('/api/vipers/activos');
    const vipers = res.ok ? await res.json() : [];
    sel.innerHTML = '<option value="">Sin VIPER físico</option>';
    vipers.forEach(v => {
      sel.innerHTML += `<option value="${v.id}">${v.codigo_viper}</option>`;
    });
  } catch (_) { /* el módulo VIPER es opcional, no debe romper el registro */ }
}

document.getElementById('selectJuego').addEventListener('change', async () => {
  const opt = document.getElementById('selectJuego').selectedOptions[0];
  const duracion = opt?.dataset.duracion;
  const minM     = parseInt(opt?.dataset.minMiembros) || 1;
  const maxM     = parseInt(opt?.dataset.maxMiembros) || 30;
  const duEl     = document.getElementById('duracionJuego');
  const inputM   = document.getElementById('inputMiembros');

  if (duracion) {
    duEl.innerHTML = `<i class="bi bi-clock me-1"></i>Duración: <strong>${duracion} min</strong>&nbsp;&nbsp;<i class="bi bi-people ms-2 me-1"></i>Personas: <strong>${minM}–${maxM}</strong>`;
    inputM.min = minM;
    inputM.max = maxM;
    const current = parseInt(inputM.value) || 1;
    if (current < minM) inputM.value = minM;
    if (current > maxM) inputM.value = maxM;
  } else {
    duEl.textContent = '';
    inputM.min = 1;
    inputM.max = 30;
  }

  // Manejar subcategorias
  const wrapSub = document.getElementById('wrapSubcategoria');
  const selSub  = document.getElementById('selectSubcategoria');
  selSub.innerHTML = '<option value="">Seleccionar subcategoría…</option>';

  const juegoId       = opt?.value;
  const usaSubs       = opt?.dataset.usaSubcategorias === '1';

  if (juegoId && usaSubs) {
    try {
      const r    = await fetch(`/api/atracciones/${juegoId}/subcategorias`);
      const subs = r.ok ? await r.json() : [];
      subs.forEach(s => {
        selSub.innerHTML += `<option value="${s.id}">${s.nombre}</option>`;
      });
    } catch (_) {}
    wrapSub.classList.remove('d-none');
  } else {
    wrapSub.classList.add('d-none');
  }

  actualizarEsperaEstimada();
});

function actualizarEsperaEstimada() {
  const atraccionId = document.getElementById('selectJuego').value;
  const wrap        = document.getElementById('tiempoEsperaWrap');
  const msg         = document.getElementById('tiempoEsperaMsg');
  if (!atraccionId || !colaData.length) { wrap.classList.add('d-none'); return; }

  const juego = colaData.find(j => String(j.id) === String(atraccionId));
  if (!juego) { wrap.classList.add('d-none'); return; }

  // El nuevo grupo irá al final de la cola
  const totalEspera = juego.jugando.reduce((s, t) => s + t.tiempo_restante, 0) +
                      juego.cola.length * juego.duracion_minutos;

  wrap.classList.remove('d-none');
  if (totalEspera === 0) {
    msg.innerHTML = `<strong>¡Puede jugar casi de inmediato!</strong> No hay grupos en espera.`;
  } else {
    msg.innerHTML = `Tiempo de espera estimado para este juego: <strong>~${Math.ceil(totalEspera)} minutos</strong>`;
  }
}

// ── Cola con tabs por juego ───────────────────────────────────────────────────
let _activeTabId = null;

async function cargarCola() {
  const res = await fetch('/api/turnos/cola');
  const data = await res.json();
  colaData = data.juegos;
  renderCola();
  actualizarEsperaEstimada();
}

function renderCola() {
  const cont = document.getElementById('colaPorJuego');

  if (!colaData.length) {
    cont.innerHTML = `<p class="text-center text-muted py-4">
      <i class="bi bi-inbox fs-1 d-block mb-2 opacity-50"></i>Sin juegos configurados</p>`;
    return;
  }

  // Recordar tab activo antes de re-renderizar
  const tabAnterior = document.querySelector('#tabsJuego .nav-link.active')?.dataset.juegoId;
  if (tabAnterior) _activeTabId = tabAnterior;
  // Si no hay tab activo aún, usar el primero
  if (!_activeTabId || !colaData.find(j => String(j.id) === _activeTabId)) {
    _activeTabId = String(colaData[0]?.id ?? '');
  }

  // ── Construir pestañas ───────────────────────────────────────────────────
  const navItems = colaData.map(j => {
    const esActivo = String(j.id) === _activeTabId;
    const badgeJ   = j.jugando.length ? `<span class="badge bg-primary ms-1">${j.jugando.length}</span>` : '';
    const badgeE   = j.cola.length    ? `<span class="badge bg-warning text-dark ms-1">${j.cola.length}</span>` : '';
    return `
    <li class="nav-item" role="presentation">
      <button class="nav-link px-3 py-2 ${esActivo ? 'active' : ''}"
        data-bs-toggle="tab" data-bs-target="#tab-${j.id}"
        data-juego-id="${j.id}" role="tab">
        <i class="bi bi-controller me-1"></i>${j.nombre}${badgeJ}${badgeE}
      </button>
    </li>`;
  }).join('');

  // ── Construir paneles ────────────────────────────────────────────────────
  const panes = colaData.map(j => {
    const esActivo = String(j.id) === _activeTabId;
    return `
    <div class="tab-pane fade ${esActivo ? 'show active' : ''}" id="tab-${j.id}" role="tabpanel">
      ${renderJuegoPane(j)}
    </div>`;
  }).join('');

  cont.innerHTML = `
    <ul class="nav nav-tabs border-bottom mb-3" id="tabsJuego" role="tablist">${navItems}</ul>
    <div class="tab-content">${panes}</div>`;

  // Actualizar _activeTabId al cambiar de tab
  document.querySelectorAll('#tabsJuego .nav-link').forEach(btn => {
    btn.addEventListener('shown.bs.tab', () => { _activeTabId = btn.dataset.juegoId; });
  });
}

// ── Contenido de cada panel de juego ─────────────────────────────────────────
function renderJuegoPane(j) {
  if (!j.jugando.length && !j.cola.length) {
    return `<p class="text-center text-muted py-4">
      <i class="bi bi-inbox fs-2 d-block mb-2 opacity-50"></i>Sin grupos registrados</p>`;
  }

  let html = '';

  // ── Grupos jugando ───────────────────────────────────────────────────────
  if (j.jugando.length) {
    html += `<div class="seccion-titulo"><i class="bi bi-play-fill me-1"></i>Jugando ahora</div>`;
    html += j.jugando.map(t => {
      const btnFinalizar = me?.permiso_llamar_turno
        ? `<button class="btn btn-danger btn-sm fw-bold px-3"
             onclick="pedirFinalizarGrupo(${t.id},'${esc(t.nombre_cliente||'Sin nombre')}')">
             <i class="bi bi-check-lg me-1"></i>Finalizar
           </button>`
        : '';
      // Info de etapa para recepción
      let etapaHtml = '';
      if (t.etapa_actual_nombre) {
        const sigTexto = t.etapa_siguiente_nombre
          ? `<span class="text-muted small"><i class="bi bi-arrow-right me-1"></i>Próxima: <strong>${t.etapa_siguiente_nombre}</strong></span>`
          : `<span class="text-muted small"><i class="bi bi-flag-fill me-1"></i>Última etapa</span>`;
        etapaHtml = `
          <div class="d-flex align-items-center gap-2 mt-1 flex-wrap">
            <span class="etapa-recep-badge"><i class="bi bi-layers me-1"></i>${t.etapa_actual_nombre}</span>
            ${sigTexto}
          </div>`;
      }
      const subcatHtml = t.subcategoria_nombre
        ? `<span class="badge bg-success bg-opacity-75 ms-1"><i class="bi bi-diagram-3 me-1"></i>${t.subcategoria_nombre}</span>`
        : '';
      return `
      <div class="turno-row jugando d-flex align-items-center justify-content-between flex-wrap gap-2">
        <div class="d-flex align-items-center gap-3">
          <span class="biper-num">${t.biper_numero}</span>
          <div>
            <div class="fw-bold">${t.nombre_cliente || 'Sin nombre'}</div>
            <div class="d-flex gap-2 mt-1 flex-wrap">
              <span class="miembros-badge"><i class="bi bi-people me-1"></i>${t.cantidad_miembros} persona${t.cantidad_miembros !== 1 ? 's' : ''}</span>
              <span class="badge bg-primary"><i class="bi bi-play-fill me-1"></i>JUGANDO</span>
              ${subcatHtml}
            </div>
            ${etapaHtml}
          </div>
        </div>
        <div class="d-flex align-items-center gap-3">
          <div class="text-end">
            <div class="fw-semibold text-primary">${t.tiempo_restante} min restantes</div>
            <div class="text-muted small">${t.tiempo_transcurrido} min transcurridos</div>
          </div>
          ${btnFinalizar}
        </div>
      </div>`;
    }).join('');
  }

  // ── Cola en espera ───────────────────────────────────────────────────────
  if (j.cola.length) {
    html += `<div class="seccion-titulo mt-3"><i class="bi bi-hourglass-split me-1"></i>En espera</div>`;
    html += j.cola.map(t => {
      const claseEspera = t.tiempo_espera_estimado === 0 ? 'espera-0'
        : t.tiempo_espera_estimado <= 30 ? 'espera-baja' : 'espera-alta';
      const esPrimero = t.posicion === 1;

      let btnLlamar = '';
      if (me?.permiso_llamar_turno) {
        if (esPrimero) {
          const hayJugando = j.jugando.length > 0;
          btnLlamar = `<button class="btn btn-success btn-sm fw-bold px-3"
            onclick="llamarGrupo(${t.id},${hayJugando},'${esc(j.nombre)}','${esc(t.nombre_cliente||'Sin nombre')}')">
            <i class="bi bi-megaphone me-1"></i>Llamar
          </button>`;
        } else {
          btnLlamar = `<button class="btn btn-outline-secondary btn-sm px-3" disabled
            title="Primero debe llamarse al grupo #1 de la cola">
            <i class="bi bi-lock me-1"></i>Espera turno
          </button>`;
        }
      }

      const esUltimo   = t.posicion === j.cola.length;
      const btnSubir   = `<button class="btn btn-outline-secondary btn-sm py-0 px-2" title="Subir en la cola"
        ${esPrimero ? 'disabled' : ''} onclick="moverTurno(${t.id},'subir')">
        <i class="bi bi-chevron-up"></i>
      </button>`;
      const btnBajar   = `<button class="btn btn-outline-secondary btn-sm py-0 px-2" title="Bajar en la cola"
        ${esUltimo ? 'disabled' : ''} onclick="moverTurno(${t.id},'bajar')">
        <i class="bi bi-chevron-down"></i>
      </button>`;

      const subcatEsperaHtml = t.subcategoria_nombre
        ? `<span class="badge bg-success bg-opacity-75"><i class="bi bi-diagram-3 me-1"></i>${t.subcategoria_nombre}</span>`
        : '';
      return `
      <div class="turno-row d-flex align-items-center justify-content-between flex-wrap gap-2 ${esPrimero ? '' : 'opacity-65'}">
        <div class="d-flex align-items-center gap-3">
          <div class="pos-num">${t.posicion}</div>
          <span class="biper-num">${t.biper_numero}</span>
          <div>
            <div class="fw-bold">${t.nombre_cliente || 'Sin nombre'}</div>
            <div class="d-flex gap-2 mt-1 flex-wrap">
              <span class="miembros-badge"><i class="bi bi-people me-1"></i>${t.cantidad_miembros} persona${t.cantidad_miembros !== 1 ? 's' : ''}</span>
              ${subcatEsperaHtml}
            </div>
          </div>
        </div>
        <div class="d-flex align-items-center gap-2">
          <div class="d-flex flex-column gap-1">${btnSubir}${btnBajar}</div>
          <span class="espera-badge ${claseEspera}">
            <i class="bi bi-hourglass-split me-1"></i>
            ${t.tiempo_espera_estimado === 0 ? '¡Próximo!' : `~${t.tiempo_espera_estimado} min`}
          </span>
          ${btnLlamar}
        </div>
      </div>`;
    }).join('');
  }

  return html;
}

// Escapa comillas simples para uso en atributos onclick
function esc(s) { return String(s).replace(/'/g, "\\'"); }

// ── Formulario ────────────────────────────────────────────────────────────────
document.getElementById('btnAutoBiper').addEventListener('click', async () => {
  const res = await fetch('/api/turnos/proximo-biper');
  const { biper_numero } = await res.json();
  document.getElementById('inputBiper').value = biper_numero;
});

// Botones +/- para miembros
document.getElementById('btnMenos').addEventListener('click', () => {
  const el  = document.getElementById('inputMiembros');
  const min = parseInt(el.min) || 1;
  if (parseInt(el.value) > min) el.value = parseInt(el.value) - 1;
});
document.getElementById('btnMas').addEventListener('click', () => {
  const el  = document.getElementById('inputMiembros');
  const max = parseInt(el.max) || 30;
  if (parseInt(el.value) < max) el.value = parseInt(el.value) + 1;
});

document.getElementById('formRegistro').addEventListener('submit', async e => {
  e.preventDefault();
  const atraccion_id      = document.getElementById('selectJuego').value;
  const biper_numero      = document.getElementById('inputBiper').value;
  const nombre_cliente    = document.getElementById('inputNombre').value.trim();
  const cantidad_miembros = parseInt(document.getElementById('inputMiembros').value) || 1;
  const viper_id          = document.getElementById('selectViper')?.value || null;

  const opt           = document.getElementById('selectJuego').selectedOptions[0];
  const usaSubs       = opt?.dataset.usaSubcategorias === '1';
  const subcategoria_id = usaSubs ? (document.getElementById('selectSubcategoria').value || null) : null;

  if (!atraccion_id || !biper_numero || !nombre_cliente) {
    mostrarToast('Completá juego, biper y nombre del grupo', 'warning'); return;
  }
  if (usaSubs && !subcategoria_id) {
    mostrarToast('Seleccioná una subcategoría para este juego', 'warning'); return;
  }
  const minM = parseInt(opt?.dataset.minMiembros) || 1;
  const maxM = parseInt(opt?.dataset.maxMiembros) || 30;
  if (cantidad_miembros < minM || cantidad_miembros > maxM) {
    mostrarToast(`Este juego requiere entre ${minM} y ${maxM} personas`, 'warning'); return;
  }

  const res  = await fetch('/api/turnos', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ atraccion_id, biper_numero, nombre_cliente, cantidad_miembros, viper_id, subcategoria_id })
  });
  const data = await res.json();

  if (!res.ok) { mostrarToast(data.error || 'Error al registrar', 'danger'); return; }

  mostrarToast(`✅ ${nombre_cliente} – Biper ${data.biper_numero} registrado`, 'success');
  document.getElementById('formRegistro').reset();
  document.getElementById('inputMiembros').value = '1';
  document.getElementById('duracionJuego').textContent = '';
  document.getElementById('tiempoEsperaWrap').classList.add('d-none');
  document.getElementById('wrapSubcategoria').classList.add('d-none');
  document.getElementById('selectSubcategoria').innerHTML = '<option value="">Seleccionar subcategoría…</option>';
  await cargarCola();
});

// ── Finalizar turno desde recepción ──────────────────────────────────────────
let _pendingFinalizarId   = null;
let _pendingFinalizarNombre = null;
const modalConfFinalizar  = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('modalConfFinalizar'));

function pedirFinalizarGrupo(id, nombreFamilia) {
  _pendingFinalizarId     = id;
  _pendingFinalizarNombre = nombreFamilia;
  document.getElementById('confFinalizarNombre').textContent = nombreFamilia;
  modalConfFinalizar().show();
}

document.getElementById('btnConfFinalizarSi').addEventListener('click', async () => {
  modalConfFinalizar().hide();
  if (!_pendingFinalizarId) return;
  const res  = await fetch(`/api/turnos/${_pendingFinalizarId}/finalizar`, { method: 'PUT' });
  const data = await res.json();
  if (!res.ok) { mostrarToast(data.error || 'Error al finalizar', 'danger'); }
  else         { mostrarToast(`✅ Turno de ${_pendingFinalizarNombre} finalizado`, 'success'); }
  _pendingFinalizarId = _pendingFinalizarNombre = null;
  await cargarCola();
});
document.getElementById('btnConfFinalizarNo').addEventListener('click', () => {
  modalConfFinalizar().hide();
  _pendingFinalizarId = _pendingFinalizarNombre = null;
});

// ── Llamar grupo desde recepción ──────────────────────────────────────────────
let _pendingLlamarId = null;
const modalConfLlamar = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('modalConfLlamar'));

async function llamarGrupo(id, hayJugando, nombreJuego, nombreFamilia) {
  if (hayJugando) {
    // Pedir confirmación antes de llamar
    _pendingLlamarId = id;
    document.getElementById('confLlamarTexto').innerHTML =
      `<strong>${nombreJuego}</strong> ya tiene un grupo jugando.<br>
       ¿Querés llamar igualmente a <strong>${nombreFamilia}</strong>?`;
    modalConfLlamar().show();
    return;
  }
  await _ejecutarLlamar(id);
}

document.getElementById('btnConfLlamarSi').addEventListener('click', async () => {
  modalConfLlamar().hide();
  const idParaLlamar = _pendingLlamarId;
  _pendingLlamarId = null;
  if (idParaLlamar) await _ejecutarLlamar(idParaLlamar);
});
document.getElementById('btnConfLlamarNo').addEventListener('click', () => {
  modalConfLlamar().hide();
  _pendingLlamarId = null;
});

const modalConfCapacidad = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('modalConfCapacidad'));

document.getElementById('btnConfCapacidadSi').addEventListener('click', async () => {
  modalConfCapacidad().hide();
  const idParaLlamar = _pendingLlamarId;
  _pendingLlamarId = null;
  if (idParaLlamar) await _ejecutarLlamar(idParaLlamar, true);
});
document.getElementById('btnConfCapacidadNo').addEventListener('click', () => {
  modalConfCapacidad().hide();
  _pendingLlamarId = null;
});

const modalConfViperOtroJuego = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('modalConfViperOtroJuego'));

document.getElementById('btnConfViperOtroJuegoSi').addEventListener('click', async () => {
  modalConfViperOtroJuego().hide();
  const idParaLlamar = _pendingLlamarId;
  _pendingLlamarId = null;
  if (idParaLlamar) await _ejecutarLlamar(idParaLlamar, true);
});
document.getElementById('btnConfViperOtroJuegoNo').addEventListener('click', () => {
  modalConfViperOtroJuego().hide();
  _pendingLlamarId = null;
});

async function _ejecutarLlamar(id, force = false) {
  const res  = await fetch(`/api/turnos/${id}/llamar`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(force ? { force: true } : {}),
  });
  const data = await res.json();
  if (!res.ok) {
    mostrarToast(data.error || 'No se pudo llamar al grupo', 'danger');
    return;
  }
  if (data.advertencia === 'biper_en_otro_juego') {
    _pendingLlamarId = id;
    const restanteTexto = data.tiempo_restante > 0
      ? `con aproximadamente <strong>${data.tiempo_restante} min restantes</strong>`
      : 'con tiempo excedido';
    document.getElementById('confViperOtroJuegoTexto').innerHTML =
      `El VIPER <strong>${data.biper_numero}</strong> está actualmente jugando en
       <strong>${data.juego_origen}</strong>
       (${data.nombre_cliente || 'Sin nombre'}) ${restanteTexto}.<br><br>
       ¿Querés llamarlo igualmente?`;
    modalConfViperOtroJuego().show();
    return;
  }
  if (data.advertencia === 'capacidad_excedida') {
    _pendingLlamarId = id;
    document.getElementById('confCapacidadTexto').innerHTML =
      `Actualmente hay <strong>${data.personasJugando}</strong> persona${data.personasJugando !== 1 ? 's' : ''} jugando.<br>
       Este grupo tiene <strong>${data.personasGrupo}</strong> persona${data.personasGrupo !== 1 ? 's' : ''}.<br>
       Si lo llamás habrá <strong>${data.totalPersonas}</strong> personas jugando y el máximo permitido es <strong>${data.maximoPermitido}</strong>.<br>
       ¿Deseás llamarlo igualmente?`;
    modalConfCapacidad().show();
    return;
  }
  mostrarToast(`📣 Biper ${data.biper_numero} – ${data.nombre_cliente || 'Grupo'} llamado a jugar`, 'success');
  await cargarCola();
}

// ── Reordenar cola ────────────────────────────────────────────────────────────
async function moverTurno(id, direccion) {
  const res  = await fetch(`/api/turnos/${id}/mover`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direccion }),
  });
  if (!res.ok) {
    const data = await res.json();
    mostrarToast(data.error || 'No se pudo mover el turno', 'danger');
    return;
  }
  await cargarCola();
}

// ── Socket (actualización en tiempo real) ─────────────────────────────────────
socket.on('turno:nuevo',         () => cargarCola());
socket.on('turno:llamado',       () => cargarCola());
socket.on('turno:etapa_avanzada',() => cargarCola());
socket.on('turno:finalizado',    () => cargarCola());
socket.on('turno:reordenado',    () => cargarCola());

// ── Notificación de turno finalizado (enviada por operador) ───────────────────
socket.on('recepcion:notificacion', (data) => {
  if (!me || !['admin','recepcion'].includes(me.rol)) return;

  const siguienteTxt = data.siguiente
    ? `<div class="notif-siguiente">
         <i class="bi bi-arrow-right-circle me-1"></i>
         <strong>Siguiente:</strong> ${data.siguiente.nombre_cliente}
         &nbsp;·&nbsp; Biper <strong>${data.siguiente.biper_numero}</strong>
         &nbsp;·&nbsp; ${data.siguiente.cantidad_miembros} persona${data.siguiente.cantidad_miembros !== 1 ? 's' : ''}
       </div>`
    : `<div class="notif-siguiente text-muted">
         <i class="bi bi-inbox me-1"></i>Sin grupos en espera para ${data.atraccion}
       </div>`;

  const toastId = 'notif-' + Date.now();
  document.getElementById('toastContainer').insertAdjacentHTML('beforeend', `
    <div id="${toastId}" class="toast notif-operador border-0" role="alert" aria-live="assertive">
      <div class="toast-header notif-header border-0">
        <i class="bi bi-person-check-fill me-2"></i>
        <strong class="me-auto">Turno finalizado — ${data.atraccion}</strong>
        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast"></button>
      </div>
      <div class="toast-body">
        <span class="notif-op">Op. ${data.operador}</span> finalizó a
        <strong>${data.familiaFinalizada}</strong>
        (Biper&nbsp;<strong>${data.biper_finalizado}</strong>)
        ${siguienteTxt}
      </div>
    </div>`);

  const el = document.getElementById(toastId);
  new bootstrap.Toast(el, { delay: 9000 }).show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
});

// ── Toast ─────────────────────────────────────────────────────────────────────
function mostrarToast(mensaje, tipo = 'success') {
  const id  = 'toast-' + Date.now();
  const col = { success:'bg-success', danger:'bg-danger', warning:'bg-warning text-dark' }[tipo];
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
