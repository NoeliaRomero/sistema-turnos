// ── Auth ──────────────────────────────────────────────────────────────────────
(async () => {
  const res = await fetch('/api/auth/me');
  if (!res.ok) { window.location.href = '/login.html'; return; }
  const me = await res.json();
  if (me.rol !== 'admin') { window.location.href = '/login.html'; return; }
  document.getElementById('usuarioNombre').textContent = me.nombre;
})();

document.getElementById('btnLogout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

// ── Estado global ─────────────────────────────────────────────────────────────
let charts      = {};
let atracciones = [];
let periodo     = 'hoy';
let eliminandoId = null;
let adminMe     = null;

async function init() {
  // Verificar features habilitadas para esta cuenta admin
  const resMe = await fetch('/api/auth/me');
  adminMe = await resMe.json();

  // Ocultar tab Estadísticas si no tiene feature_graficos
  if (!adminMe.feature_graficos) {
    document.getElementById('tabBtnStats').style.display = 'none';
    document.getElementById('tabStats').innerHTML = `
      <div class="text-center py-5 text-muted">
        <i class="bi bi-lock fs-1 d-block mb-3 opacity-50"></i>
        <h5 class="fw-bold">Módulo no disponible</h5>
        <p class="small">Las estadísticas no están incluidas en tu plan actual.</p>
      </div>`;
  }

  // Ocultar enlace a Juegos si no tiene feature_juegos
  if (!adminMe.feature_juegos) {
    const btnJuegos = document.getElementById('btnJuegosNav');
    if (btnJuegos) btnJuegos.style.display = 'none';
  }

  await cargarAtracciones();
  if (adminMe.feature_graficos) await cargarStats();
  await cargarUsuarios();
}

// ── Atracciones (para el selector del modal usuario) ──────────────────────────
async function cargarAtracciones() {
  const res = await fetch('/api/atracciones');
  atracciones = await res.json();
  const sel = document.getElementById('uAtraccion');
  sel.innerHTML = '<option value="">Sin asignar</option>';
  atracciones.forEach(a => {
    sel.innerHTML += `<option value="${a.id}">${a.nombre}</option>`;
  });
}

// ── Filtro período ────────────────────────────────────────────────────────────
document.getElementById('filtroPeriodo').addEventListener('click', e => {
  const btn = e.target.closest('[data-periodo]');
  if (!btn) return;
  periodo = btn.dataset.periodo;
  document.querySelectorAll('#filtroPeriodo button').forEach(b => {
    b.className = b === btn ? 'btn btn-primary btn-sm' : 'btn btn-outline-secondary btn-sm';
  });
  cargarStats();
});
document.getElementById('btnRefreshStats').addEventListener('click', cargarStats);

// ── Estadísticas ──────────────────────────────────────────────────────────────
async function cargarStats() {
  const res  = await fetch(`/api/stats?periodo=${periodo}`);
  const data = await res.json();
  renderCards(data.resumen);
  renderAtraccionChart(data.porAtraccion);
  renderDiasChart(data.porDia);
  renderHorasChart(data.porHora);
  renderOperadoresChart(data.llamadosPorOp, data.finalizadosPorOp);
  renderTablaOperadores(data.tablaOperadores);
}

function renderCards(r) {
  document.getElementById('sTotal').textContent       = r.total       ?? 0;
  document.getElementById('sFinalizados').textContent = r.finalizados ?? 0;
  document.getElementById('sEspera').textContent      = r.en_espera   ?? 0;
  const pe = r.prom_espera;
  document.getElementById('sPromEspera').textContent  = pe != null ? `${pe} min` : '—';
}

const COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4','#84cc16'];

function mkChart(id, type, data, options = {}) {
  if (charts[id]) charts[id].destroy();
  const ctx = document.getElementById(id).getContext('2d');
  charts[id] = new Chart(ctx, { type, data, options: { responsive: true, maintainAspectRatio: false, ...options } });
}

function renderAtraccionChart(data) {
  mkChart('chartAtraccion', 'doughnut', {
    labels:   data.map(d => d.nombre),
    datasets: [{ data: data.map(d => d.total), backgroundColor: COLORS, borderWidth: 2 }]
  }, { plugins: { legend: { position: 'bottom', labels: { padding: 16, font: { size: 13 } } } } });
}

function renderDiasChart(data) {
  mkChart('chartDias', 'line', {
    labels:   data.map(d => formatFecha(d.dia)),
    datasets: [{
      label: 'Turnos', data: data.map(d => d.total),
      fill: true, backgroundColor: 'rgba(59,130,246,0.12)',
      borderColor: '#3b82f6', borderWidth: 2,
      pointBackgroundColor: '#3b82f6', tension: 0.4
    }]
  }, { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } });
}

function renderHorasChart(data) {
  const labels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2,'0')}:00`);
  const counts = Array(24).fill(0);
  data.forEach(d => { counts[parseInt(d.hora)] = d.total; });
  const max = Math.max(...counts);
  mkChart('chartHoras', 'bar', {
    labels,
    datasets: [{
      label: 'Turnos', data: counts,
      backgroundColor: counts.map(v => v === max && max > 0 ? '#f59e0b' : 'rgba(59,130,246,0.6)'),
      borderRadius: 6
    }]
  }, { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } });
}

function renderOperadoresChart(llamados, finalizados) {
  const nombres = [...new Set([...llamados.map(d => d.nombre), ...finalizados.map(d => d.nombre)])];
  if (!nombres.length) { if (charts['chartOperadores']) charts['chartOperadores'].destroy(); return; }
  mkChart('chartOperadores', 'bar', {
    labels: nombres,
    datasets: [
      { label: 'Llamados',    data: nombres.map(n => llamados.find(d=>d.nombre===n)?.total||0),    backgroundColor: 'rgba(59,130,246,0.75)', borderRadius: 6 },
      { label: 'Finalizados', data: nombres.map(n => finalizados.find(d=>d.nombre===n)?.total||0), backgroundColor: 'rgba(16,185,129,0.75)', borderRadius: 6 }
    ]
  }, { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } });
}

function renderTablaOperadores(ops) {
  const tbody = document.getElementById('tablaOps');
  if (!ops.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">Sin datos de operadores</td></tr>';
    return;
  }
  tbody.innerHTML = ops.map(op => `
    <tr>
      <td class="fw-semibold">${op.nombre}</td>
      <td>${op.atraccion || '<span class="text-muted">—</span>'}</td>
      <td class="text-center"><span class="badge bg-primary rounded-pill">${op.llamados}</span></td>
      <td class="text-center"><span class="badge bg-success rounded-pill">${op.finalizados}</span></td>
      <td class="text-center">${op.tiempo_promedio ? `${op.tiempo_promedio} min` : '—'}</td>
    </tr>`).join('');
}

// ── Usuarios ──────────────────────────────────────────────────────────────────
async function cargarUsuarios() {
  const res      = await fetch('/api/usuarios');
  const usuarios = await res.json();
  const tbody    = document.getElementById('tablaUsuarios');

  if (!usuarios.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">Sin usuarios</td></tr>';
    return;
  }

  tbody.innerHTML = usuarios.map(u => {
    const perms = [];
    if (u.rol === 'admin') {
      perms.push('<span class="perm-badge">Todos</span>');
    } else if (u.rol === 'operador') {
      perms.push('<span class="perm-badge me-1"><i class="bi bi-megaphone"></i> Llamar</span>');
      if (u.permiso_cancelar_turno   && adminMe?.feature_cancelar_turno) perms.push('<span class="perm-badge me-1"><i class="bi bi-x-circle"></i> Cancelar</span>');
      if (u.permiso_gestionar_juegos && adminMe?.feature_juegos)         perms.push('<span class="perm-badge"><i class="bi bi-controller"></i> Juegos</span>');
    } else {
      if (u.permiso_llamar_turno     && adminMe?.feature_llamar_turno)   perms.push('<span class="perm-badge me-1"><i class="bi bi-megaphone"></i> Llamar</span>');
      if (u.permiso_cancelar_turno   && adminMe?.feature_cancelar_turno) perms.push('<span class="perm-badge me-1"><i class="bi bi-x-circle"></i> Cancelar</span>');
      if (u.permiso_gestionar_juegos && adminMe?.feature_juegos)         perms.push('<span class="perm-badge"><i class="bi bi-controller"></i> Juegos</span>');
    }
    return `
    <tr>
      <td class="ps-4 fw-semibold">${u.nombre}</td>
      <td class="text-muted">@${u.username}</td>
      <td><span class="rol-badge ${rolClass(u.rol)}">${rolLabel(u.rol)}</span></td>
      <td>${u.atraccion_nombre || '<span class="text-muted">—</span>'}</td>
      <td>${perms.join('') || '<span class="text-muted small">Sin permisos extra</span>'}</td>
      <td class="text-center">
        <span class="badge rounded-pill px-3 ${u.activo ? 'badge-activo' : 'badge-inactivo'}">
          ${u.activo ? 'Activo' : 'Inactivo'}
        </span>
      </td>
      <td class="text-end pe-4">
        <button class="btn btn-sm btn-outline-primary me-1" onclick="editarUsuario(${u.id})">
          <i class="bi bi-pencil"></i>
        </button>
        <button class="btn btn-sm btn-outline-danger" onclick="pedirEliminar(${u.id})" ${!u.activo?'disabled':''}>
          <i class="bi bi-person-x"></i>
        </button>
      </td>
    </tr>`;
  }).join('');
}

function rolClass(rol) { return { admin:'rol-admin', operador:'rol-operador', recepcion:'rol-recepcion' }[rol]||''; }
function rolLabel(rol) { return { admin:'Administrador', operador:'Operador', recepcion:'Recepción' }[rol]||rol; }

// ── Modal usuario ─────────────────────────────────────────────────────────────
const modalUsuario  = new bootstrap.Modal(document.getElementById('modalUsuario'));
const modalEliminar = new bootstrap.Modal(document.getElementById('modalEliminar'));

// Mostrar/ocultar campos según el rol seleccionado
document.getElementById('uRol').addEventListener('change', actualizarCamposRol);

function actualizarCamposRol() {
  const rol = document.getElementById('uRol').value;
  document.getElementById('atraccionWrap').style.display = rol === 'operador' ? 'block' : 'none';

  const mostrarPermisos = rol === 'operador' || rol === 'recepcion';
  document.getElementById('permisosWrap').style.display = mostrarPermisos ? 'block' : 'none';

  if (!mostrarPermisos) return;

  // Mostrar/ocultar cada permiso según lo que el superadmin habilitó para este admin
  const rowLlamar   = document.getElementById('uPermisoLlamar').closest('.form-check');
  const rowCancelar = document.getElementById('uPermisoCancelar').closest('.form-check');
  const rowJuegos   = document.getElementById('uPermisoJuegos').closest('.form-check');

  // "Llamar" no aplica a operadores (siempre lo tienen) y requiere feature_llamar_turno
  if (rowLlamar)   rowLlamar.style.display   = (rol === 'operador' || !adminMe?.feature_llamar_turno)   ? 'none' : '';
  if (rowCancelar) rowCancelar.style.display = (!adminMe?.feature_cancelar_turno) ? 'none' : '';
  if (rowJuegos)   rowJuegos.style.display   = (!adminMe?.feature_juegos)         ? 'none' : '';

  // Si ningún permiso es visible, ocultar el bloque entero
  const alguno = [rowLlamar, rowCancelar, rowJuegos].some(r => r && r.style.display !== 'none');
  document.getElementById('permisosWrap').style.display = alguno ? 'block' : 'none';
}

document.getElementById('btnNuevoUsuario').addEventListener('click', () => {
  limpiarModal();
  document.getElementById('modalTitle').textContent = 'Nuevo Usuario';
  document.getElementById('passLabel').innerHTML    = 'Contraseña <span class="text-danger">*</span>';
  document.getElementById('passHint').textContent   = '';
  modalUsuario.show();
});

function limpiarModal() {
  ['userId','uNombre','uUsername','uPassword'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('uRol').value               = '';
  document.getElementById('uAtraccion').value          = '';
  document.getElementById('uPermisoLlamar').checked    = false;
  document.getElementById('uPermisoJuegos').checked    = false;
  document.getElementById('uPermisoCancelar').checked  = false;
  document.getElementById('atraccionWrap').style.display = 'none';
  document.getElementById('permisosWrap').style.display  = 'none';
  document.getElementById('modalError').classList.add('d-none');
}

async function editarUsuario(id) {
  const res  = await fetch('/api/usuarios');
  const list = await res.json();
  const u    = list.find(x => x.id === id);
  if (!u) return;

  limpiarModal();
  document.getElementById('modalTitle').textContent      = 'Editar Usuario';
  document.getElementById('passLabel').innerHTML         = 'Contraseña <span class="text-muted fw-normal">(dejar vacío para no cambiar)</span>';
  document.getElementById('passHint').textContent        = 'Solo completá si querés cambiar la contraseña';
  document.getElementById('userId').value                = u.id;
  document.getElementById('uNombre').value               = u.nombre;
  document.getElementById('uUsername').value             = u.username;
  document.getElementById('uRol').value                  = u.rol;
  document.getElementById('uAtraccion').value             = u.atraccion_id || '';
  document.getElementById('uPermisoLlamar').checked      = !!u.permiso_llamar_turno;
  document.getElementById('uPermisoJuegos').checked      = !!u.permiso_gestionar_juegos;
  document.getElementById('uPermisoCancelar').checked    = !!u.permiso_cancelar_turno;

  actualizarCamposRol();
  modalUsuario.show();
}

document.getElementById('btnGuardarUsuario').addEventListener('click', guardarUsuario);

async function guardarUsuario() {
  const id      = document.getElementById('userId').value;
  const rol     = document.getElementById('uRol').value;
  const payload = {
    nombre:                  document.getElementById('uNombre').value.trim(),
    username:                document.getElementById('uUsername').value.trim(),
    password:                document.getElementById('uPassword').value,
    rol,
    atraccion_id:            document.getElementById('uAtraccion').value || null,
    activo:                  1,
    permiso_llamar_turno:     document.getElementById('uPermisoLlamar').checked   ? 1 : 0,
    permiso_gestionar_juegos: document.getElementById('uPermisoJuegos').checked   ? 1 : 0,
    permiso_cancelar_turno:   document.getElementById('uPermisoCancelar').checked ? 1 : 0,
  };
  const errEl = document.getElementById('modalError');
  errEl.classList.add('d-none');

  if (!payload.nombre || !payload.username || !payload.rol) {
    errEl.textContent = 'Completá nombre, usuario y rol'; errEl.classList.remove('d-none'); return;
  }
  if (!id && !payload.password) {
    errEl.textContent = 'La contraseña es requerida para usuarios nuevos'; errEl.classList.remove('d-none'); return;
  }

  const res  = await fetch(id ? `/api/usuarios/${id}` : '/api/usuarios', {
    method:  id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload)
  });
  const data = await res.json();

  if (!res.ok) { errEl.textContent = data.error||'Error al guardar'; errEl.classList.remove('d-none'); return; }
  modalUsuario.hide();
  mostrarToast(id ? 'Usuario actualizado' : 'Usuario creado', 'success');
  cargarUsuarios();
}

function pedirEliminar(id) {
  eliminandoId = id;
  modalEliminar.show();
}

document.getElementById('btnConfirmarEliminar').addEventListener('click', async () => {
  if (!eliminandoId) return;
  const res  = await fetch(`/api/usuarios/${eliminandoId}`, { method: 'DELETE' });
  const data = await res.json();
  modalEliminar.hide();
  if (!res.ok) { mostrarToast(data.error||'Error', 'danger'); return; }
  mostrarToast('Usuario desactivado', 'warning');
  cargarUsuarios();
  eliminandoId = null;
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatFecha(dt) {
  if (!dt) return '';
  const [, m, d] = dt.split('-');
  return `${d}/${m}`;
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
  new bootstrap.Toast(el, { delay: 3500 }).show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}

// ── VIPER ─────────────────────────────────────────────────────────────────────
async function cargarVipers() {
  const res = await fetch('/api/vipers');
  if (!res.ok) return;
  const vipers = await res.json();
  const tbody = document.getElementById('tablaVipers');
  if (!tbody) return;
  tbody.innerHTML = vipers.length === 0
    ? '<tr><td colspan="4" class="text-center text-muted py-4">No hay VIPERs registrados</td></tr>'
    : vipers.map(v => `
      <tr>
        <td class="ps-4 fw-semibold">${v.id}</td>
        <td>${escapeHtml(v.codigo_viper)}</td>
        <td class="text-center">
          ${v.activo
            ? '<span class="badge rounded-pill px-3 badge-activo">🟢 Activo</span>'
            : '<span class="badge rounded-pill px-3 badge-inactivo">🔴 No Activo</span>'}
        </td>
        <td class="text-end pe-4">
          ${v.activo
            ? '<span class="text-muted small fst-italic">Activado</span>'
            : `<button class="btn btn-sm btn-outline-success" onclick="activarViper(${v.id})">Enviar señal de activación</button>`}
        </td>
      </tr>`).join('');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
}

async function activarViper(id) {
  const res = await fetch(`/api/vipers/${id}/activar`, { method: 'PUT' });
  if (res.ok) {
    mostrarToast('Señal de activación enviada', 'success');
    cargarVipers();
  } else {
    mostrarToast('Error al activar el VIPER', 'danger');
  }
}

const modalViperEl = document.getElementById('modalViper');
if (modalViperEl) {
  const modalViperInst = new bootstrap.Modal(modalViperEl);

  document.getElementById('btnNuevoViper').addEventListener('click', () => {
    document.getElementById('vCodigoViper').value = '';
    document.getElementById('viperError').classList.add('d-none');
    modalViperInst.show();
  });

  modalViperEl.addEventListener('shown.bs.modal', () => {
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

  // Cargar vipers cuando se active el tab de configuraciones o el sub-tab de VIPER
  document.querySelectorAll('[data-bs-target="#tabConfiguraciones"], [data-bs-target="#tabConfigViper"]').forEach(btn => {
    btn.addEventListener('shown.bs.tab', cargarVipers);
  });
}

init();
