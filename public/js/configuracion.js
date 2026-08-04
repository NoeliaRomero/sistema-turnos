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
  cargarEstadoArduino();
  cargarRfConfig();
  cargarMetricasViper();
  cargarEventosViper();
  setInterval(cargarEstadoArduino, 15000);
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

let vipersCache = [];

async function cargarVipers() {
  const res = await fetch('/api/vipers');
  if (!res.ok) return;
  const vipers = await res.json();
  vipersCache = vipers;
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
  botones.push(`<button class="btn btn-sm btn-outline-dark" onclick="abrirEditarViper(${v.id})">Editar</button>`);
  botones.push(`<button class="btn btn-sm btn-outline-danger" onclick="abrirEliminarViper(${v.id})">Eliminar</button>`);
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

// ── Editar VIPER ───────────────────────────────────────────────────────────────
const modalEditarViperInst = new bootstrap.Modal(document.getElementById('modalEditarViper'));
let viperEditando = null;

function abrirEditarViper(id) {
  const v = vipersCache.find(x => x.id === id);
  if (!v) return;
  viperEditando = id;
  document.getElementById('eCodigoViper').value = v.codigo_viper || '';
  document.getElementById('eCodigoRf').value = v.codigo_rf || '';
  document.getElementById('eCanal').value = v.canal || 1;
  document.getElementById('eEstado').value = v.estado || 'PENDIENTE';
  document.getElementById('editarViperError').classList.add('d-none');
  modalEditarViperInst.show();
}

document.getElementById('btnGuardarEdicionViper').addEventListener('click', async () => {
  const codigo = document.getElementById('eCodigoViper').value.trim();
  const errEl  = document.getElementById('editarViperError');
  errEl.classList.add('d-none');

  if (!codigo) {
    errEl.textContent = 'El código VIPER es obligatorio.';
    errEl.classList.remove('d-none');
    return;
  }

  const res = await fetch(`/api/vipers/${viperEditando}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      codigo_viper: codigo,
      codigo_rf: document.getElementById('eCodigoRf').value.trim(),
      canal: document.getElementById('eCanal').value,
      estado: document.getElementById('eEstado').value,
    }),
  });

  if (res.ok) {
    modalEditarViperInst.hide();
    mostrarToast('VIPER actualizado correctamente', 'success');
    cargarVipers();
  } else {
    const data = await res.json();
    errEl.textContent = data.error || 'Error al actualizar el VIPER.';
    errEl.classList.remove('d-none');
  }
});

// ── Eliminar VIPER ─────────────────────────────────────────────────────────────
const modalEliminarViperInst = new bootstrap.Modal(document.getElementById('modalEliminarViper'));
let viperEliminando = null;

function abrirEliminarViper(id) {
  viperEliminando = id;
  modalEliminarViperInst.show();
}

document.getElementById('btnConfirmarEliminarViper').addEventListener('click', async () => {
  const res = await fetch(`/api/vipers/${viperEliminando}`, { method: 'DELETE' });
  if (res.ok) {
    modalEliminarViperInst.hide();
    mostrarToast('VIPER eliminado correctamente', 'success');
    cargarVipers();
  } else {
    const data = await res.json();
    modalEliminarViperInst.hide();
    mostrarToast(data.error || 'Error al eliminar el VIPER.', 'danger');
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

// ── Configuración Serial (dentro del panel VIPER) ────────────────────────────
document.getElementById('formSerialConfigViper').addEventListener('submit', async e => {
  e.preventDefault();
  const puerto  = document.getElementById('vSerialPuerto').value.trim();
  const baudios = document.getElementById('vSerialBaudios').value;

  const res = await fetch('/api/serial/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ puerto, baudios }),
  });

  if (res.ok) {
    mostrarToast('Configuración guardada', 'success');
    cargarSerialConfig();
    cargarEstadoArduino();
  } else {
    const data = await res.json();
    mostrarToast(data.error || 'Error al guardar la configuración', 'danger');
  }
});

// ── Estado del Arduino ────────────────────────────────────────────────────────
function formatearDuracion(ms) {
  if (!ms) return '00:00:00';
  const totalSeg = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSeg / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSeg % 3600) / 60)).padStart(2, '0');
  const s = String(totalSeg % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

async function cargarEstadoArduino() {
  const res = await fetch('/api/vipers/estado-arduino');
  if (!res.ok) return;
  const data = await res.json();

  const badge = document.getElementById('arduinoEstado');
  badge.textContent = data.estado;
  badge.className = 'estado-badge ' + (data.estado === 'Conectado' ? 'estado-ACTIVO' : 'estado-ERROR');

  document.getElementById('arduinoFirmware').textContent = data.firmware || '–';
  document.getElementById('arduinoPuerto').textContent = data.puerto || '–';
  document.getElementById('arduinoUltimaConexion').textContent = data.ultima_conexion
    ? new Date(data.ultima_conexion).toLocaleTimeString() : '–';
  document.getElementById('arduinoTiempoActivo').textContent = formatearDuracion(data.tiempo_activo_ms);

  const diag = data.diagnostico || {};
  document.getElementById('diagPuertoConfigurado').textContent = diag.puerto_configurado || '–';
  document.getElementById('diagPuertoConectado').textContent = diag.puerto_conectado || '–';
  document.getElementById('diagUltimaPrueba').textContent = diag.ultima_prueba_resultado || '–';
  document.getElementById('diagUltimaComunicacion').textContent = diag.ultima_comunicacion_exitosa
    ? new Date(diag.ultima_comunicacion_exitosa).toLocaleString() : '–';
}

// ── Configuración RF ──────────────────────────────────────────────────────────
async function cargarRfConfig() {
  const res = await fetch('/api/vipers/rf-config');
  if (!res.ok) return;
  const cfg = await res.json();
  if (cfg.frecuencia) document.getElementById('rfFrecuencia').value = cfg.frecuencia;
  if (cfg.canal) document.getElementById('rfCanal').value = String(cfg.canal);
  document.getElementById('rfRetransmisiones').value = cfg.retransmisiones ?? 3;
  document.getElementById('rfIntervalo').value = cfg.intervalo_ms ?? 100;
}

document.getElementById('formRfConfig').addEventListener('submit', async e => {
  e.preventDefault();
  const body = {
    frecuencia: document.getElementById('rfFrecuencia').value,
    canal: document.getElementById('rfCanal').value,
    retransmisiones: document.getElementById('rfRetransmisiones').value,
    intervalo_ms: document.getElementById('rfIntervalo').value,
  };
  const res = await fetch('/api/vipers/rf-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    mostrarToast('Configuración RF guardada', 'success');
  } else {
    const data = await res.json();
    mostrarToast(data.error || 'Error al guardar la configuración RF', 'danger');
  }
});

// ── Herramientas de Diagnóstico ───────────────────────────────────────────────
function mostrarResultadoDiagnostico(texto, tipo = 'info') {
  const el = document.getElementById('diagnosticoResultado');
  el.className = `alert alert-${tipo} small mb-0`;
  el.style.fontFamily = 'monospace';
  el.style.whiteSpace = 'pre-wrap';
  el.textContent = texto;
  el.classList.remove('d-none');
}

document.getElementById('btnProbarConexion').addEventListener('click', async () => {
  mostrarResultadoDiagnostico('Probando conexión...', 'info');
  const res = await fetch('/api/vipers/ping', { method: 'POST' });
  if (res.ok) {
    mostrarResultadoDiagnostico('✓ Conexión correcta', 'success');
  } else {
    const data = await res.json();
    mostrarResultadoDiagnostico(`✗ Error de comunicación\n${data.detalle || data.error || ''}`, 'danger');
  }
  cargarEstadoArduino();
});

document.getElementById('btnReiniciarArduino').addEventListener('click', async () => {
  if (!confirm('¿Reiniciar el Arduino de forma remota?')) return;
  mostrarResultadoDiagnostico('Reiniciando Arduino...', 'info');
  const res = await fetch('/api/vipers/reiniciar-arduino', { method: 'POST' });
  if (res.ok) {
    mostrarResultadoDiagnostico('✓ Comando de reinicio enviado', 'success');
  } else {
    const data = await res.json();
    mostrarResultadoDiagnostico(`✗ Error al reiniciar\n${data.error || ''}`, 'danger');
  }
  cargarEstadoArduino();
});

document.getElementById('btnLeerConfig').addEventListener('click', async () => {
  mostrarResultadoDiagnostico('Consultando configuración del Arduino...', 'info');
  const res = await fetch('/api/vipers/leer-configuracion');
  if (res.ok) {
    const data = await res.json();
    mostrarResultadoDiagnostico(data.configuracion || '(sin datos)', 'secondary');
  } else {
    const data = await res.json();
    mostrarResultadoDiagnostico(`✗ Error\n${data.error || ''}`, 'danger');
  }
});

// ── Aprendizaje de Código VIPER ───────────────────────────────────────────────
const modalAsociarRfInst = new bootstrap.Modal(document.getElementById('modalAsociarRf'));

document.getElementById('btnAprenderViper').addEventListener('click', async () => {
  mostrarResultadoDiagnostico('Arduino en modo escucha, esperando código RF...', 'info');
  const res = await fetch('/api/vipers/aprender', { method: 'POST' });
  if (!res.ok) {
    const data = await res.json();
    mostrarResultadoDiagnostico(`✗ Error\n${data.error || ''}`, 'danger');
    return;
  }
  const data = await res.json();
  mostrarResultadoDiagnostico(`Código detectado:\n${data.codigo}`, 'success');

  const vipersRes = await fetch('/api/vipers');
  const vipers = vipersRes.ok ? await vipersRes.json() : [];
  const select = document.getElementById('rfAsociarViperId');
  select.innerHTML = vipers.map(v => `<option value="${v.id}">${escapeHtml(v.codigo_viper)}</option>`).join('');

  document.getElementById('rfCodigoDetectado').value = data.codigo;
  document.getElementById('rfAsociarError').classList.add('d-none');
  modalAsociarRfInst.show();
});

document.getElementById('btnConfirmarAsociarRf').addEventListener('click', async () => {
  const viperId = document.getElementById('rfAsociarViperId').value;
  const codigo  = document.getElementById('rfCodigoDetectado').value;
  const errEl   = document.getElementById('rfAsociarError');
  errEl.classList.add('d-none');

  if (!viperId) {
    errEl.textContent = 'Seleccioná un VIPER para asociar el código.';
    errEl.classList.remove('d-none');
    return;
  }

  const res = await fetch(`/api/vipers/${viperId}/codigo-rf`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo_rf: codigo }),
  });

  if (res.ok) {
    modalAsociarRfInst.hide();
    mostrarToast('Código RF asociado correctamente', 'success');
  } else {
    const data = await res.json();
    errEl.textContent = data.error || 'Error al asociar el código.';
    errEl.classList.remove('d-none');
  }
});

// ── Métricas del sistema ──────────────────────────────────────────────────────
async function cargarMetricasViper() {
  const res = await fetch('/api/vipers/metricas');
  if (!res.ok) return;
  const m = await res.json();
  document.getElementById('metRegistrados').textContent = m.vipers_registrados;
  document.getElementById('metActivos').textContent = m.vipers_activos;
  document.getElementById('metLlamadasHoy').textContent = m.llamadas_hoy;
  document.getElementById('metLlamadasMes').textContent = m.llamadas_mes;
  document.getElementById('metUltimoActivado').textContent = m.ultimo_viper_activado || '–';
  document.getElementById('metTasaExito').textContent = m.tasa_exito != null ? `${m.tasa_exito}%` : '–';
}

// ── Historial de Eventos ──────────────────────────────────────────────────────
const ACK_LABEL = {
  ENTREGADO: '✓ Señal entregada',
  ERROR: '⚠ Error',
};

async function cargarEventosViper() {
  const params = new URLSearchParams();
  const fecha   = document.getElementById('filtroEventoFecha').value;
  const usuario = document.getElementById('filtroEventoUsuario').value.trim();
  const estado  = document.getElementById('filtroEventoEstado').value;
  if (fecha)   params.set('fecha', fecha);
  if (usuario) params.set('usuario', usuario);
  if (estado)  params.set('estado', estado);

  const res = await fetch(`/api/vipers/eventos?${params.toString()}`);
  if (!res.ok) return;
  const eventos = await res.json();
  const tbody = document.getElementById('tablaEventosViper');

  tbody.innerHTML = eventos.length === 0
    ? '<tr><td colspan="5" class="text-center text-muted py-3">Sin eventos registrados</td></tr>'
    : eventos.map(ev => `
      <tr>
        <td class="small">${new Date(ev.created_at).toLocaleString()}</td>
        <td class="small">${escapeHtml(ev.usuario_nombre || '–')}</td>
        <td class="small">${escapeHtml(ev.accion)}</td>
        <td class="small">${escapeHtml(ev.codigo_viper || '–')}</td>
        <td class="small">${ev.ack_estado ? (ACK_LABEL[ev.ack_estado] || ev.ack_estado) : (ev.resultado || '–')}</td>
      </tr>`).join('');
}

document.getElementById('btnFiltrarEventos').addEventListener('click', cargarEventosViper);

// Refrescar métricas y eventos cuando cambia el estado de un VIPER
socket.on('viper:actualizado', () => { cargarMetricasViper(); cargarEventosViper(); });

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
