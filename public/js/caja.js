const socket = io();

let turnos = [];
let me     = null;

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function init() {
  const res = await fetch('/api/auth/me');
  if (!res.ok) { window.location.href = '/login.html'; return; }
  me = await res.json();
  if (!['admin','caja'].includes(me.rol)) { window.location.href = '/login.html'; return; }
  document.getElementById('usuarioNombre').textContent = me.nombre;

  // Mostrar botón "Juegos" solo si tiene el permiso
  if (me.permiso_gestionar_juegos) {
    document.getElementById('btnJuegos').style.display = 'inline-flex';
  }

  await cargarAtracciones();
  await cargarTurnos();
}

document.getElementById('btnLogout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

// ── Carga inicial ─────────────────────────────────────────────────────────────
async function cargarAtracciones() {
  const res = await fetch('/api/atracciones');
  const atracciones = await res.json();
  const sel = document.getElementById('selectAtraccion');
  sel.innerHTML = '<option value="">Seleccionar…</option>';
  atracciones.forEach(a => {
    sel.innerHTML += `<option value="${a.id}">${escapeHtml(a.nombre)}${a.duracion_minutos ? ` (${a.duracion_minutos} min)` : ''}</option>`;
  });
}

async function cargarTurnos() {
  const [r1, r2] = await Promise.all([
    fetch('/api/turnos?estado=esperando'),
    fetch('/api/turnos?estado=llamado')
  ]);
  turnos = [...(await r1.json()), ...(await r2.json())]
    .sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
  renderTurnos();
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderTurnos() {
  const lista    = document.getElementById('listaTurnos');
  const contador = document.getElementById('contadorTurnos');
  contador.textContent = turnos.length;

  if (!turnos.length) {
    lista.innerHTML = `<p class="text-center text-muted py-5">
      <i class="bi bi-inbox fs-1 d-block mb-2 opacity-50"></i>Sin turnos registrados</p>`;
    return;
  }

  lista.innerHTML = turnos.map(t => {
    const cancelBtn = me.permiso_cancelar_turno
      ? `<button class="btn btn-sm btn-outline-danger ms-2" onclick="cancelarTurno(${t.id})" title="Cancelar biper">
           <i class="bi bi-x-circle"></i>
         </button>` : '';
    return `
    <div class="turno-row ${t.estado} rounded p-3 mb-2 bg-white d-flex align-items-center justify-content-between" id="turno-${t.id}">
      <div class="d-flex align-items-center gap-3">
        <span class="biper-num">${escapeHtml(t.biper_numero)}</span>
        <div>
          <div class="fw-semibold">${t.nombre_cliente ? escapeHtml(t.nombre_cliente) : '<span class="text-muted">Sin nombre</span>'}</div>
          <div class="small text-muted">${escapeHtml(t.atraccion_nombre)}${t.duracion_minutos ? ` · ${t.duracion_minutos} min` : ''}</div>
        </div>
      </div>
      <div class="d-flex align-items-center gap-1">
        <span class="estado-badge estado-${t.estado}">${t.estado === 'esperando' ? 'Esperando' : 'Llamado'}</span>
        <span class="small text-muted ms-1">${formatHora(t.created_at)}</span>
        ${cancelBtn}
      </div>
    </div>`;
  }).join('');
}

// ── Formulario nueva venta ────────────────────────────────────────────────────
document.getElementById('formVenta').addEventListener('submit', async e => {
  e.preventDefault();
  const atraccion_id   = document.getElementById('selectAtraccion').value;
  const biper_numero   = document.getElementById('inputBiper').value;
  const nombre_cliente = document.getElementById('inputNombre').value.trim();

  if (!atraccion_id || !biper_numero) {
    mostrarToast('Completá atracción y número de biper', 'warning'); return;
  }
  const res  = await fetch('/api/turnos', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ atraccion_id, biper_numero, nombre_cliente })
  });
  const data = await res.json();
  if (!res.ok) { mostrarToast(data.error||'Error al registrar', 'danger'); return; }
  mostrarToast(`Turno registrado – Biper ${data.biper_numero}`, 'success');
  e.target.reset();
});

document.getElementById('btnAutoBiper').addEventListener('click', async () => {
  const res = await fetch('/api/turnos/proximo-biper');
  const { biper_numero } = await res.json();
  document.getElementById('inputBiper').value = biper_numero;
});

// ── Cancelar biper ────────────────────────────────────────────────────────────
async function cancelarTurno(id) {
  if (!confirm('¿Cancelar el biper? El turno quedará anulado.')) return;
  const res = await fetch(`/api/turnos/${id}/cancelar`, { method: 'PUT' });
  if (!res.ok) { const d = await res.json(); mostrarToast(d.error||'Sin permiso', 'danger'); return; }
  mostrarToast('Turno cancelado', 'warning');
  turnos = turnos.filter(x => x.id !== id);
  renderTurnos();
}

// ── Socket ────────────────────────────────────────────────────────────────────
socket.on('turno:nuevo',    t => { turnos.push(t); renderTurnos(); });
socket.on('turno:llamado',  t => { const i = turnos.findIndex(x=>x.id===t.id); if(i!==-1)turnos[i]=t; else turnos.push(t); renderTurnos(); });
socket.on('turno:finalizado',t=>{ turnos = turnos.filter(x=>x.id!==t.id); renderTurnos(); });

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatHora(dt) {
  return new Date(dt).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' });
}
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
  new bootstrap.Toast(el, { delay: 3500 }).show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}

init();
