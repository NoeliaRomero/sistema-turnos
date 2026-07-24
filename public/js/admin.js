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

  // Ocultar tab Juegos si no tiene feature_juegos
  if (!adminMe.feature_juegos) {
    const tabJuegos = document.getElementById('tabBtnJuegos');
    if (tabJuegos) tabJuegos.closest('.nav-item').style.display = 'none';
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
let _usuariosCache = [];

async function cargarUsuarios() {
  const res      = await fetch('/api/usuarios');
  const usuarios = await res.json();
  _usuariosCache = usuarios;
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
        <button class="btn btn-sm btn-outline-danger" onclick="pedirEliminar(${u.id})">
          <i class="bi bi-trash"></i>
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
  const u = _usuariosCache.find(x => x.id === id);
  document.getElementById('eliminarUsuarioNombre').textContent = u ? `"${u.nombre}" (@${u.username})` : '';
  modalEliminar.show();
}

document.getElementById('btnCancelarEliminarUsuario').addEventListener('click', () => {
  modalEliminar.hide();
  eliminandoId = null;
});

document.getElementById('btnConfirmarEliminar').addEventListener('click', async () => {
  const id = eliminandoId;
  eliminandoId = null;
  modalEliminar.hide();
  if (!id) return;
  const res  = await fetch(`/api/usuarios/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) { mostrarToast(data.error || 'Error al eliminar', 'danger'); return; }
  mostrarToast('Usuario eliminado', 'success');
  cargarUsuarios();
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

// ── Gestión de Juegos (integrada en admin, reemplaza el iframe) ───────────────

let _juegosCache = [];

async function cargarJuegos() {
  const res    = await fetch('/api/atracciones/todas');
  const juegos = await res.json();
  _juegosCache = juegos;
  const tbody  = document.getElementById('tablaJuegos');
  if (!juegos.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-5">Sin juegos registrados</td></tr>';
    return;
  }
  tbody.innerHTML = juegos.map(j => `
    <tr>
      <td class="ps-4 fw-semibold">
        ${j.nombre}
        ${j.usa_etapas ? `<span class="etapas-badge ms-2"><i class="bi bi-layers me-1"></i>${j.etapas.length} etapas</span>` : ''}
        ${j.usa_subcategorias ? `<span class="subcategorias-badge ms-2"><i class="bi bi-diagram-3 me-1"></i>${j.subcategorias.length} subcategorías</span>` : ''}
      </td>
      <td><span class="duracion-badge"><i class="bi bi-clock me-1"></i>${j.duracion_minutos} min</span></td>
      <td><span class="text-muted small"><i class="bi bi-people me-1"></i>${j.min_miembros || 1}–${j.max_miembros || 20}</span></td>
      <td class="text-center">
        <span class="badge rounded-pill px-3 ${j.activa ? 'badge-activo' : 'badge-inactivo'}">
          ${j.activa ? 'Activo' : 'Inactivo'}
        </span>
      </td>
      <td class="text-end pe-4">
        <button class="btn btn-sm btn-outline-primary me-1" onclick="editarJuego(${j.id})">
          <i class="bi bi-pencil me-1"></i>Editar
        </button>
        <button class="btn btn-sm btn-outline-danger" onclick="confirmarEliminarJuego(${j.id})">
          <i class="bi bi-trash me-1"></i>Eliminar
        </button>
      </td>
    </tr>`).join('');
}

const modalJuego = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('modalJuego'));

function calcularTotalEtapas() {
  const inputs = document.querySelectorAll('#listaEtapas .etapa-minutos');
  const total  = Array.from(inputs).reduce((s, el) => s + (parseInt(el.value) || 0), 0);
  document.getElementById('totalDuracion').textContent = `${total} minutos`;
  return total;
}

function crearFilaEtapa(nombre = '', minutos = 15, activa = 1) {
  const div = document.createElement('div');
  div.className = 'etapa-row';
  div.innerHTML = `
    <input type="text"   class="form-control etapa-nombre"  placeholder="Nombre de la etapa" value="${String(nombre).replace(/"/g,'&quot;')}" maxlength="60">
    <input type="number" class="form-control etapa-minutos" placeholder="Min" min="1" max="300" value="${minutos}">
    <span class="input-group-text text-muted" style="font-size:.8rem">min</span>
    <button type="button" class="btn btn-outline-secondary btn-move" title="Subir"><i class="bi bi-arrow-up"></i></button>
    <button type="button" class="btn btn-outline-secondary btn-move" title="Bajar"><i class="bi bi-arrow-down"></i></button>
    <button type="button" class="btn btn-outline-danger btn-eliminar-etapa" title="Eliminar"><i class="bi bi-trash"></i></button>`;
  div.dataset.activa = activa ? '1' : '0';
  div.querySelector('.etapa-minutos').addEventListener('input', calcularTotalEtapas);
  div.querySelector('[title="Subir"]').addEventListener('click', () => {
    const prev = div.previousElementSibling;
    if (prev) { div.parentNode.insertBefore(div, prev); calcularTotalEtapas(); }
  });
  div.querySelector('[title="Bajar"]').addEventListener('click', () => {
    const next = div.nextElementSibling;
    if (next) { div.parentNode.insertBefore(next, div); calcularTotalEtapas(); }
  });
  div.querySelector('.btn-eliminar-etapa').addEventListener('click', () => {
    div.remove(); calcularTotalEtapas();
  });
  return div;
}

function crearFilaSubcategoria(id = '', nombre = '') {
  const div = document.createElement('div');
  div.className = 'sub-row';
  div.dataset.id = id;
  div.innerHTML = `
    <input type="text" class="form-control sub-nombre" placeholder="Nombre de la subcategoría" value="${String(nombre).replace(/"/g,'&quot;')}" maxlength="60">
    <button type="button" class="btn btn-outline-secondary btn-move" title="Subir"><i class="bi bi-arrow-up"></i></button>
    <button type="button" class="btn btn-outline-secondary btn-move" title="Bajar"><i class="bi bi-arrow-down"></i></button>
    <button type="button" class="btn btn-outline-danger btn-eliminar-sub" title="Eliminar"><i class="bi bi-trash"></i></button>`;
  div.querySelector('[title="Subir"]').addEventListener('click', () => {
    const prev = div.previousElementSibling;
    if (prev) div.parentNode.insertBefore(div, prev);
  });
  div.querySelector('[title="Bajar"]').addEventListener('click', () => {
    const next = div.nextElementSibling;
    if (next) div.parentNode.insertBefore(next, div);
  });
  div.querySelector('.btn-eliminar-sub').addEventListener('click', () => div.remove());
  return div;
}

function limpiarModalJuego() {
  document.getElementById('juegoId').value      = '';
  document.getElementById('jNombre').value      = '';
  document.getElementById('jDuracion').value    = '30';
  document.getElementById('jMinMiembros').value = '1';
  document.getElementById('jMaxMiembros').value = '20';
  document.getElementById('jActivo').checked    = true;
  document.getElementById('jUsaEtapas').checked = false;
  document.getElementById('jUsaSubcategorias').checked = false;
  document.getElementById('listaEtapas').innerHTML = '';
  document.getElementById('listaSubcategorias').innerHTML = '';
  document.getElementById('totalDuracion').textContent = '0 minutos';
  document.getElementById('wrapDuracionManual').classList.remove('d-none');
  document.getElementById('seccionEtapas').classList.add('d-none');
  document.getElementById('seccionSubcategorias').classList.add('d-none');
  document.getElementById('activoWrap').style.display = 'none';
  document.getElementById('juegoError').classList.add('d-none');
}

document.getElementById('btnNuevoJuego').addEventListener('click', () => {
  limpiarModalJuego();
  document.getElementById('modalJuegoTitle').textContent = 'Nuevo Juego';
  modalJuego().show();
});

document.getElementById('jUsaEtapas').addEventListener('change', function () {
  const usaEtapas = this.checked;
  document.getElementById('wrapDuracionManual').classList.toggle('d-none', usaEtapas);
  document.getElementById('seccionEtapas').classList.toggle('d-none', !usaEtapas);
  if (usaEtapas && document.getElementById('listaEtapas').children.length === 0) {
    document.getElementById('listaEtapas').appendChild(crearFilaEtapa());
    calcularTotalEtapas();
  }
});

document.getElementById('btnAgregarEtapa').addEventListener('click', () => {
  document.getElementById('listaEtapas').appendChild(crearFilaEtapa());
  calcularTotalEtapas();
});

document.getElementById('jUsaSubcategorias').addEventListener('change', function () {
  document.getElementById('seccionSubcategorias').classList.toggle('d-none', !this.checked);
  if (this.checked && document.getElementById('listaSubcategorias').children.length === 0) {
    document.getElementById('listaSubcategorias').appendChild(crearFilaSubcategoria());
  }
});

document.getElementById('btnAgregarSubcategoria').addEventListener('click', () => {
  document.getElementById('listaSubcategorias').appendChild(crearFilaSubcategoria());
});

async function editarJuego(id) {
  const res    = await fetch('/api/atracciones/todas');
  const juegos = await res.json();
  const j      = juegos.find(x => x.id === id);
  if (!j) return;
  limpiarModalJuego();
  document.getElementById('modalJuegoTitle').textContent = 'Editar Juego';
  document.getElementById('juegoId').value      = j.id;
  document.getElementById('jNombre').value      = j.nombre;
  document.getElementById('jMinMiembros').value = j.min_miembros || 1;
  document.getElementById('jMaxMiembros').value = j.max_miembros || 20;
  document.getElementById('jActivo').checked    = !!j.activa;
  document.getElementById('activoWrap').style.display = 'block';
  if (j.usa_etapas) {
    document.getElementById('jUsaEtapas').checked = true;
    document.getElementById('wrapDuracionManual').classList.add('d-none');
    document.getElementById('seccionEtapas').classList.remove('d-none');
    const lista = document.getElementById('listaEtapas');
    (j.etapas || []).forEach(e => lista.appendChild(crearFilaEtapa(e.nombre, e.duracion_minutos, e.activa ?? 1)));
    calcularTotalEtapas();
  } else {
    document.getElementById('jDuracion').value = j.duracion_minutos;
  }
  if (j.usa_subcategorias) {
    document.getElementById('jUsaSubcategorias').checked = true;
    document.getElementById('seccionSubcategorias').classList.remove('d-none');
    const listaSubs = document.getElementById('listaSubcategorias');
    (j.subcategorias || []).forEach(s => listaSubs.appendChild(crearFilaSubcategoria(s.id, s.nombre)));
  }
  modalJuego().show();
}

document.getElementById('btnGuardarJuego').addEventListener('click', async () => {
  const id              = document.getElementById('juegoId').value;
  const nombre          = document.getElementById('jNombre').value.trim();
  const usaEtapas       = document.getElementById('jUsaEtapas').checked;
  const usaSubcategorias = document.getElementById('jUsaSubcategorias').checked;
  const activa          = document.getElementById('jActivo').checked ? 1 : 0;
  const minM            = parseInt(document.getElementById('jMinMiembros').value, 10) || 1;
  const maxM            = parseInt(document.getElementById('jMaxMiembros').value, 10) || 20;
  const errEl           = document.getElementById('juegoError');
  errEl.classList.add('d-none');

  if (!nombre) { errEl.textContent = 'El nombre es requerido'; errEl.classList.remove('d-none'); return; }
  if (minM < 1 || maxM < minM) { errEl.textContent = 'El rango de personas no es válido'; errEl.classList.remove('d-none'); return; }

  let payload = { nombre, activa, min_miembros: minM, max_miembros: maxM, usa_etapas: usaEtapas, usa_subcategorias: usaSubcategorias };

  if (usaEtapas) {
    const filas = document.querySelectorAll('#listaEtapas .etapa-row');
    if (!filas.length) { errEl.textContent = 'Debe agregar al menos una etapa'; errEl.classList.remove('d-none'); return; }
    const etapas = Array.from(filas).map(fila => ({
      nombre: fila.querySelector('.etapa-nombre').value.trim(),
      duracion_minutos: parseInt(fila.querySelector('.etapa-minutos').value, 10) || 1,
      activa: fila.dataset.activa !== '0' ? 1 : 0,
    }));
    if (etapas.some(e => !e.nombre)) { errEl.textContent = 'Todas las etapas deben tener nombre'; errEl.classList.remove('d-none'); return; }
    payload.etapas = etapas;
  } else {
    const duracion = parseInt(document.getElementById('jDuracion').value, 10);
    if (!duracion || duracion < 1) { errEl.textContent = 'La duración debe ser mayor a 0'; errEl.classList.remove('d-none'); return; }
    payload.duracion_minutos = duracion;
  }

  if (usaSubcategorias) {
    const filasS = document.querySelectorAll('#listaSubcategorias .sub-row');
    if (!filasS.length) { errEl.textContent = 'Debe agregar al menos una subcategoría'; errEl.classList.remove('d-none'); return; }
    const subcategorias = Array.from(filasS).map(fila => ({
      id:     fila.dataset.id || undefined,
      nombre: fila.querySelector('.sub-nombre').value.trim(),
    }));
    if (subcategorias.some(s => !s.nombre)) { errEl.textContent = 'Todas las subcategorías deben tener nombre'; errEl.classList.remove('d-none'); return; }
    payload.subcategorias = subcategorias;
  }

  const url    = id ? `/api/atracciones/${id}` : '/api/atracciones';
  const method = id ? 'PUT' : 'POST';
  const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data   = await res.json();
  if (!res.ok) { errEl.textContent = data.error || 'Error al guardar'; errEl.classList.remove('d-none'); return; }
  modalJuego().hide();
  mostrarToast(id ? 'Juego actualizado' : 'Juego creado', 'success');
  cargarJuegos();
});

// Cargar juegos al activar el tab
document.getElementById('tabBtnJuegos')?.addEventListener('shown.bs.tab', () => {
  cargarJuegos();
});

// ── Eliminar juego ─────────────────────────────────────────────────────────────
let _pendingEliminarJuegoId = null;

const modalEliminarJuego = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('modalEliminarJuego'));

function confirmarEliminarJuego(id) {
  const juego = _juegosCache.find(j => j.id === id);
  _pendingEliminarJuegoId = id;
  document.getElementById('eliminarJuegoNombre').textContent = juego ? `"${juego.nombre}"` : '';
  modalEliminarJuego().show();
}

document.getElementById('btnCancelarEliminarJuego').addEventListener('click', () => {
  modalEliminarJuego().hide();
  _pendingEliminarJuegoId = null;
});

document.getElementById('btnConfirmarEliminarJuego').addEventListener('click', async () => {
  const id = _pendingEliminarJuegoId;
  _pendingEliminarJuegoId = null;
  modalEliminarJuego().hide();
  if (!id) return;

  const res  = await fetch(`/api/atracciones/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) {
    mostrarToast(data.error || 'No se pudo eliminar el juego', 'danger');
    return;
  }
  mostrarToast('Juego eliminado', 'success');
  cargarJuegos();
});

init();
