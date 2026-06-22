// ── Auth ──────────────────────────────────────────────────────────────────────
let me = null;
(async () => {
  const res = await fetch('/api/auth/me');
  if (!res.ok) { window.location.href = '/login.html'; return; }
  me = await res.json();
  if (me.rol !== 'admin') { window.location.href = '/login.html'; return; }
  document.getElementById('usuarioNombre').textContent = me.nombre;
  cargarVipers();
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
