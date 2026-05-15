let me = null;
const modalJuego = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('modalJuego'));

// ── Auth ──────────────────────────────────────────────────────────────────────
(async () => {
  const res = await fetch('/api/auth/me');
  if (!res.ok) { window.location.href = '/login.html'; return; }
  me = await res.json();
  if (!me.permiso_gestionar_juegos) {
    const dest = { admin:'/admin.html', operador:'/operador.html', recepcion:'/recepcion.html' };
    window.location.href = dest[me.rol] || '/login.html';
    return;
  }
  // Admin sin feature_juegos habilitada por el superadmin
  if (me.rol === 'admin' && !me.feature_juegos) {
    window.location.href = '/admin.html';
    return;
  }
  document.getElementById('usuarioNombre').textContent = me.nombre;
  cargarJuegos();
})();

const destinos = { admin:'/admin.html', operador:'/operador.html', recepcion:'/recepcion.html' };
document.getElementById('btnVolver').addEventListener('click', () => {
  window.location.href = destinos[me?.rol] || '/';
});
document.getElementById('btnLogout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

// ── Cargar juegos ─────────────────────────────────────────────────────────────
async function cargarJuegos() {
  const res    = await fetch('/api/atracciones/todas');
  const juegos = await res.json();
  const tbody  = document.getElementById('tablaJuegos');

  if (!juegos.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-5">Sin juegos registrados</td></tr>';
    return;
  }

  tbody.innerHTML = juegos.map(j => `
    <tr>
      <td class="ps-4 fw-semibold">${j.nombre}</td>
      <td><span class="duracion-badge"><i class="bi bi-clock me-1"></i>${j.duracion_minutos} min</span></td>
      <td><span class="text-muted small"><i class="bi bi-people me-1"></i>${j.min_miembros || 1}–${j.max_miembros || 20}</span></td>
      <td class="text-center">
        <span class="badge rounded-pill px-3 ${j.activa ? 'badge-activo' : 'badge-inactivo'}">
          ${j.activa ? 'Activo' : 'Inactivo'}
        </span>
      </td>
      <td class="text-end pe-4">
        <button class="btn btn-sm btn-outline-primary" onclick="editarJuego(${j.id}, '${j.nombre.replace(/'/g,"\\'")}', ${j.duracion_minutos}, ${j.activa}, ${j.min_miembros || 1}, ${j.max_miembros || 20})">
          <i class="bi bi-pencil me-1"></i>Editar
        </button>
      </td>
    </tr>`).join('');
}

// ── Nuevo juego ───────────────────────────────────────────────────────────────
document.getElementById('btnNuevoJuego').addEventListener('click', () => {
  document.getElementById('juegoId').value        = '';
  document.getElementById('jNombre').value        = '';
  document.getElementById('jDuracion').value      = '30';
  document.getElementById('jMinMiembros').value   = '1';
  document.getElementById('jMaxMiembros').value   = '20';
  document.getElementById('jActivo').checked      = true;
  document.getElementById('activoWrap').style.display = 'none';
  document.getElementById('juegoError').classList.add('d-none');
  document.getElementById('modalJuegoTitle').textContent = 'Nuevo Juego';
  modalJuego().show();
});

function editarJuego(id, nombre, duracion, activo, minM, maxM) {
  document.getElementById('juegoId').value        = id;
  document.getElementById('jNombre').value        = nombre;
  document.getElementById('jDuracion').value      = duracion;
  document.getElementById('jMinMiembros').value   = minM;
  document.getElementById('jMaxMiembros').value   = maxM;
  document.getElementById('jActivo').checked      = !!activo;
  document.getElementById('activoWrap').style.display = 'block';
  document.getElementById('juegoError').classList.add('d-none');
  document.getElementById('modalJuegoTitle').textContent = 'Editar Juego';
  modalJuego().show();
}

document.getElementById('btnGuardarJuego').addEventListener('click', async () => {
  const id       = document.getElementById('juegoId').value;
  const nombre   = document.getElementById('jNombre').value.trim();
  const duracion = parseInt(document.getElementById('jDuracion').value, 10);
  const activa   = document.getElementById('jActivo').checked ? 1 : 0;
  const minM     = parseInt(document.getElementById('jMinMiembros').value, 10) || 1;
  const maxM     = parseInt(document.getElementById('jMaxMiembros').value, 10) || 20;
  const errEl    = document.getElementById('juegoError');
  errEl.classList.add('d-none');

  if (!nombre) { errEl.textContent = 'El nombre es requerido'; errEl.classList.remove('d-none'); return; }
  if (!duracion || duracion < 1) { errEl.textContent = 'La duración debe ser mayor a 0'; errEl.classList.remove('d-none'); return; }
  if (minM < 1 || maxM < minM) { errEl.textContent = 'El rango de personas no es válido'; errEl.classList.remove('d-none'); return; }

  const url    = id ? `/api/atracciones/${id}` : '/api/atracciones';
  const method = id ? 'PUT' : 'POST';
  const res    = await fetch(url, {
    method, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre, duracion_minutos: duracion, activa, min_miembros: minM, max_miembros: maxM })
  });
  const data = await res.json();

  if (!res.ok) { errEl.textContent = data.error || 'Error al guardar'; errEl.classList.remove('d-none'); return; }

  modalJuego().hide();
  mostrarToast(id ? 'Juego actualizado' : 'Juego creado', 'success');
  cargarJuegos();
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
  new bootstrap.Toast(el, { delay: 3000 }).show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}
