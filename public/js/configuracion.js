// ── Auth ──────────────────────────────────────────────────────────────────────
let me = null;
const socket = io();

(async () => {
  const res = await fetch('/api/auth/me');
  if (!res.ok) { window.location.href = '/login.html'; return; }
  me = await res.json();
  if (me.rol !== 'admin') { window.location.href = '/login.html'; return; }
  document.getElementById('usuarioNombre').textContent = me.nombre;
  cargarVipers();
  cargarSerialConfig();
})();

document.getElementById('btnVolver').addEventListener('click', () => {
  window.location.href = '/admin.html';
});

document.getElementById('btnLogout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

// ── Menú lateral / paneles dinámicos ───────────────────────────────────────────
document.getElementById('configMenu').addEventListener('click', e => {
  const btn = e.target.closest('[data-panel]');
  if (!btn) return;

  document.querySelectorAll('#configMenu .list-group-item').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  document.querySelectorAll('.config-panel').forEach(p => p.classList.add('d-none'));
  document.getElementById('panel' + btn.dataset.panel.charAt(0).toUpperCase() + btn.dataset.panel.slice(1)).classList.remove('d-none');
});

// ── Socket.io: log serial + actualización de VIPERs ────────────────────────────
socket.on('serial:log', data => {
  const log = document.getElementById('serialLog');
  if (!log) return;
  const hora = new Date(data?.ts || Date.now()).toLocaleTimeString();
  log.insertAdjacentHTML('beforeend', `[${hora}] ${escapeHtml(data?.mensaje ?? data)}\n`);
  log.scrollTop = log.scrollHeight;
});

socket.on('viper:actualizado', () => cargarVipers());

// ── VIPER ─────────────────────────────────────────────────────────────────────
const ESTADO_BADGE = {
  PENDIENTE: '<span class="estado-badge estado-PENDIENTE">Pendiente</span>',
  VALIDANDO: '<span class="estado-badge estado-VALIDANDO">Validando…</span>',
  ACTIVO:    '<span class="estado-badge estado-ACTIVO">Activo</span>',
  ERROR:     '<span class="estado-badge estado-ERROR">Error</span>',
};

async function cargarVipers() {
  const res = await fetch('/api/vipers');
  if (!res.ok) return;
  const vipers = await res.json();
  const tbody = document.getElementById('tablaVipers');
  if (!tbody) return;
  tbody.innerHTML = vipers.length === 0
    ? '<tr><td colspan="5" class="text-center text-muted py-4">No hay VIPERs registrados</td></tr>'
    : vipers.map(v => `
      <tr>
        <td class="ps-4 fw-semibold">${v.id}</td>
        <td>${escapeHtml(v.codigo_viper)}</td>
        <td class="text-center">${ESTADO_BADGE[v.estado] || ESTADO_BADGE.PENDIENTE}</td>
        <td class="text-center">${v.tiene_codigo ? 'Sí' : 'No'}</td>
        <td class="text-end pe-4">${renderAccion(v)}</td>
      </tr>`).join('');
}

function renderAccion(v) {
  const botones = [];
  if (v.estado === 'PENDIENTE') {
    botones.push(`<button class="btn btn-sm btn-outline-primary" onclick="abrirEnviarSenal(${v.id})">Enviar señal</button>`);
  } else if (v.estado === 'VALIDANDO') {
    botones.push('<span class="text-muted small fst-italic">Esperando dispositivo…</span>');
  } else if (v.estado === 'ERROR') {
    botones.push(`<button class="btn btn-sm btn-outline-warning" onclick="abrirEnviarSenal(${v.id})">Reintentar</button>`);
  } else if (v.estado === 'ACTIVO') {
    botones.push('<span class="text-muted small fst-italic me-2">Activado</span>');
  }
  if (v.tiene_codigo) {
    botones.push(`<button class="btn btn-sm btn-outline-secondary" onclick="verCodigo(${v.id})">Ver código</button>`);
  }
  return botones.join(' ');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
}

// ── Enviar señal ────────────────────────────────────────────────────────────────
let viperSeleccionado = null;
const modalEnviarSenalInst = new bootstrap.Modal(document.getElementById('modalEnviarSenal'));

function abrirEnviarSenal(id) {
  viperSeleccionado = id;
  document.getElementById('senalMensaje').value = 'READY_PARA_TEST_DE_CABLE';
  document.getElementById('senalError').classList.add('d-none');
  modalEnviarSenalInst.show();
}

document.getElementById('btnConfirmarEnviarSenal').addEventListener('click', async () => {
  const mensaje = document.getElementById('senalMensaje').value.trim();
  const errEl   = document.getElementById('senalError');
  errEl.classList.add('d-none');

  if (!mensaje) {
    errEl.textContent = 'El mensaje a enviar es obligatorio.';
    errEl.classList.remove('d-none');
    return;
  }

  const res = await fetch(`/api/vipers/${viperSeleccionado}/enviar-senal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mensaje }),
  });

  if (res.ok) {
    modalEnviarSenalInst.hide();
    mostrarToast('Señal enviada, esperando respuesta del dispositivo', 'success');
    cargarVipers();
  } else {
    const data = await res.json();
    errEl.textContent = data.error || 'Error al enviar la señal.';
    errEl.classList.remove('d-none');
  }
});

// ── Ver código ──────────────────────────────────────────────────────────────────
const modalVerCodigoInst = new bootstrap.Modal(document.getElementById('modalVerCodigo'));

async function verCodigo(id) {
  const res = await fetch(`/api/vipers/${id}/codigo`);
  if (!res.ok) {
    mostrarToast('Error al obtener el código', 'danger');
    return;
  }
  const data = await res.json();
  document.getElementById('codigoRawTexto').value = data.codigo_raw || '';
  modalVerCodigoInst.show();
}

// ── Agregar VIPER ────────────────────────────────────────────────────────────────
const modalViperInst = new bootstrap.Modal(document.getElementById('modalViper'));

document.getElementById('btnNuevoViper').addEventListener('click', () => {
  document.getElementById('vCodigoViper').value = '';
  document.getElementById('viperError').classList.add('d-none');
  modalViperInst.show();
});

document.getElementById('modalViper').addEventListener('shown.bs.modal', () => {
  document.getElementById('vCodigoViper').focus();
});

document.getElementById('btnGuardarViper').addEventListener('click', async () => {
  const codigo = document.getElementById('vCodigoViper').value.trim();
  const errEl  = document.getElementById('viperError');
  errEl.classList.add('d-none');

  if (!codigo) {
    errEl.textContent = 'El código VIPER es obligatorio.';
    errEl.classList.remove('d-none');
    return;
  }

  const res = await fetch('/api/vipers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo_viper: codigo }),
  });

  if (res.ok) {
    modalViperInst.hide();
    mostrarToast('VIPER agregado correctamente', 'success');
    cargarVipers();
  } else {
    const data = await res.json();
    errEl.textContent = data.error || 'Error al guardar el VIPER.';
    errEl.classList.remove('d-none');
  }
});

// ── Configuración Serial ─────────────────────────────────────────────────────────
async function cargarSerialConfig() {
  try {
    const [cfgRes, puertosRes] = await Promise.all([
      fetch('/api/serial/config'),
      fetch('/api/serial/puertos'),
    ]);
    const cfg     = cfgRes.ok ? await cfgRes.json() : {};
    const puertos = puertosRes.ok ? await puertosRes.json() : [];

    const sel = document.getElementById('selectPuertoCom');
    const lista = puertos.length ? puertos.map(p => p.path) : ['COM1','COM2','COM3','COM4'];
    sel.innerHTML = lista.map(p => `<option value="${p}">${p}</option>`).join('');
    if (cfg.puerto && !lista.includes(cfg.puerto)) {
      sel.insertAdjacentHTML('afterbegin', `<option value="${cfg.puerto}">${cfg.puerto}</option>`);
    }
    if (cfg.puerto) sel.value = cfg.puerto;

    if (cfg.baudios) document.getElementById('selectBaudios').value = String(cfg.baudios);

    const badge = document.getElementById('badgeConexionSerial');
    if (cfg.conectado) {
      badge.textContent = 'Conectado';
      badge.className = 'estado-badge estado-ACTIVO';
    } else {
      badge.textContent = 'Desconectado';
      badge.className = 'estado-badge estado-ERROR';
    }
  } catch (_) { /* el panel serial es informativo, no debe romper la pantalla */ }
}

document.getElementById('formSerialConfig').addEventListener('submit', async e => {
  e.preventDefault();
  const puerto  = document.getElementById('selectPuertoCom').value;
  const baudios = document.getElementById('selectBaudios').value;

  const res = await fetch('/api/serial/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ puerto, baudios }),
  });

  if (res.ok) {
    mostrarToast('Configuración serial guardada', 'success');
    cargarSerialConfig();
  } else {
    const data = await res.json();
    mostrarToast(data.error || 'Error al guardar la configuración', 'danger');
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
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
  new bootstrap.Toast(el, { delay: 3500 }).show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}
