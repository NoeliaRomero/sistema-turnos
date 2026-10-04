let me = null;
const modalJuego = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('modalJuego'));

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
}

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
      <td class="ps-4 fw-semibold">
        ${escapeHtml(j.nombre)}
        ${j.usa_etapas ? `<span class="etapas-badge ms-2"><i class="bi bi-layers me-1"></i>${j.etapas.length} etapas</span>` : ''}
        ${j.usa_subcategorias ? `<span class="subcategorias-badge ms-2"><i class="bi bi-diagram-3 me-1"></i>${j.subcategorias.length} subcategorías</span>` : ''}
        ${j.usa_vueltas ? `<span class="vueltas-badge ms-2"><i class="bi bi-arrow-repeat me-1"></i>${(j.vueltas || []).map(v => v.cantidad).join(' / ')} vueltas</span>` : ''}
      </td>
      <td><span class="duracion-badge"><i class="bi bi-clock me-1"></i>${j.duracion_minutos} min</span></td>
      <td><span class="text-muted small"><i class="bi bi-people me-1"></i>${j.min_miembros || 1}–${j.max_miembros || 20}</span></td>
      <td class="text-center">
        <span class="badge rounded-pill px-3 ${j.activa ? 'badge-activo' : 'badge-inactivo'}">
          ${j.activa ? 'Activo' : 'Inactivo'}
        </span>
      </td>
      <td class="text-end pe-4">
        <button class="btn btn-sm btn-outline-primary" onclick="editarJuego(${j.id})">
          <i class="bi bi-pencil me-1"></i>Editar
        </button>
      </td>
    </tr>`).join('');
}

// ── Lógica de etapas ──────────────────────────────────────────────────────────
let _juegosCache = [];

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
    <input type="text"   class="form-control etapa-nombre"   placeholder="Nombre de la etapa" value="${nombre.replace(/"/g,'&quot;')}" maxlength="60">
    <input type="number" class="form-control etapa-minutos"  placeholder="Min" min="1" max="300" value="${minutos}">
    <span class="input-group-text text-muted" style="font-size:.8rem">min</span>
    <button type="button" class="btn btn-outline-secondary btn-move" title="Subir">
      <i class="bi bi-arrow-up"></i>
    </button>
    <button type="button" class="btn btn-outline-secondary btn-move" title="Bajar">
      <i class="bi bi-arrow-down"></i>
    </button>
    <button type="button" class="btn btn-outline-danger btn-eliminar-etapa" title="Eliminar">
      <i class="bi bi-trash"></i>
    </button>`;
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
    div.remove();
    calcularTotalEtapas();
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

// Fila editable de una opción de vueltas (ej. 5, 10, 15)
function crearFilaVuelta(id = '', cantidad = '') {
  const div = document.createElement('div');
  div.className = 'vuelta-row';
  div.dataset.id = id;
  div.innerHTML = `
    <input type="number" class="form-control vuelta-cantidad" placeholder="Cantidad de vueltas" min="1" step="1" value="${cantidad === '' ? '' : Number(cantidad)}">
    <span class="text-muted small">vueltas</span>
    <button type="button" class="btn btn-outline-secondary btn-move" title="Subir"><i class="bi bi-arrow-up"></i></button>
    <button type="button" class="btn btn-outline-secondary btn-move" title="Bajar"><i class="bi bi-arrow-down"></i></button>
    <button type="button" class="btn btn-outline-danger btn-eliminar-vuelta" title="Eliminar"><i class="bi bi-trash"></i></button>`;
  div.querySelector('[title="Subir"]').addEventListener('click', () => {
    const prev = div.previousElementSibling;
    if (prev) div.parentNode.insertBefore(div, prev);
  });
  div.querySelector('[title="Bajar"]').addEventListener('click', () => {
    const next = div.nextElementSibling;
    if (next) div.parentNode.insertBefore(next, div);
  });
  div.querySelector('.btn-eliminar-vuelta').addEventListener('click', () => div.remove());
  return div;
}

document.getElementById('btnAgregarEtapa').addEventListener('click', () => {
  document.getElementById('listaEtapas').appendChild(crearFilaEtapa());
  calcularTotalEtapas();
});

document.getElementById('btnAgregarSubcategoria').addEventListener('click', () => {
  document.getElementById('listaSubcategorias').appendChild(crearFilaSubcategoria());
});

document.getElementById('jUsaVueltas').addEventListener('change', function () {
  document.getElementById('seccionVueltas').classList.toggle('d-none', !this.checked);
  if (this.checked && document.getElementById('listaVueltas').children.length === 0) {
    document.getElementById('listaVueltas').appendChild(crearFilaVuelta());
  }
});

document.getElementById('btnAgregarVuelta').addEventListener('click', () => {
  document.getElementById('listaVueltas').appendChild(crearFilaVuelta());
});

document.getElementById('jUsaSubcategorias').addEventListener('change', function () {
  document.getElementById('seccionSubcategorias').classList.toggle('d-none', !this.checked);
  if (this.checked && document.getElementById('listaSubcategorias').children.length === 0) {
    document.getElementById('listaSubcategorias').appendChild(crearFilaSubcategoria());
  }
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

document.getElementById('jLlamadoAutomatico').addEventListener('change', function () {
  document.getElementById('wrapTiempoAutoLlamado').classList.toggle('d-none', !this.checked);
});

function limpiarModal() {
  document.getElementById('juegoId').value      = '';
  document.getElementById('jNombre').value      = '';
  document.getElementById('jDuracion').value    = '30';
  document.getElementById('jMinMiembros').value = '1';
  document.getElementById('jMaxMiembros').value = '20';
  document.getElementById('jActivo').checked    = true;
  document.getElementById('jUsaEtapas').checked = false;
  document.getElementById('jUsaSubcategorias').checked = false;
  document.getElementById('jUsaVueltas').checked = false;
  document.getElementById('jLlamadoAutomatico').checked = false;
  document.getElementById('jTiempoAutoLlamado').value   = '10';
  document.getElementById('wrapTiempoAutoLlamado').classList.add('d-none');
  document.getElementById('listaEtapas').innerHTML = '';
  document.getElementById('listaSubcategorias').innerHTML = '';
  document.getElementById('listaVueltas').innerHTML = '';
  document.getElementById('totalDuracion').textContent = '0 minutos';
  document.getElementById('wrapDuracionManual').classList.remove('d-none');
  document.getElementById('seccionEtapas').classList.add('d-none');
  document.getElementById('seccionSubcategorias').classList.add('d-none');
  document.getElementById('seccionVueltas').classList.add('d-none');
  document.getElementById('activoWrap').style.display = 'none';
  document.getElementById('juegoError').classList.add('d-none');
}

// ── Nuevo juego ───────────────────────────────────────────────────────────────
document.getElementById('btnNuevoJuego').addEventListener('click', () => {
  limpiarModal();
  document.getElementById('modalJuegoTitle').textContent = 'Nuevo Juego';
  modalJuego().show();
});

async function editarJuego(id) {
  const res    = await fetch('/api/atracciones/todas');
  const juegos = await res.json();
  const j      = juegos.find(x => x.id === id);
  if (!j) return;

  limpiarModal();
  document.getElementById('modalJuegoTitle').textContent = 'Editar Juego';
  document.getElementById('juegoId').value      = j.id;
  document.getElementById('jNombre').value      = j.nombre;
  document.getElementById('jMinMiembros').value = j.min_miembros || 1;
  document.getElementById('jMaxMiembros').value = j.max_miembros || 20;
  document.getElementById('jActivo').checked    = !!j.activa;
  document.getElementById('activoWrap').style.display = 'block';
  document.getElementById('jLlamadoAutomatico').checked = !!j.llamado_automatico;
  document.getElementById('jTiempoAutoLlamado').value   = j.tiempo_entre_llamados_segundos || 10;
  document.getElementById('wrapTiempoAutoLlamado').classList.toggle('d-none', !j.llamado_automatico);

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
  if (j.usa_vueltas) {
    document.getElementById('jUsaVueltas').checked = true;
    document.getElementById('seccionVueltas').classList.remove('d-none');
    const listaVueltas = document.getElementById('listaVueltas');
    (j.vueltas || []).forEach(v => listaVueltas.appendChild(crearFilaVuelta(v.id, v.cantidad)));
  }

  modalJuego().show();
}

// ── Guardar juego ─────────────────────────────────────────────────────────────
document.getElementById('btnGuardarJuego').addEventListener('click', async () => {
  const id        = document.getElementById('juegoId').value;
  const nombre    = document.getElementById('jNombre').value.trim();
  const usaEtapas = document.getElementById('jUsaEtapas').checked;
  const activa    = document.getElementById('jActivo').checked ? 1 : 0;
  const minM      = parseInt(document.getElementById('jMinMiembros').value, 10) || 1;
  const maxM      = parseInt(document.getElementById('jMaxMiembros').value, 10) || 20;
  const errEl     = document.getElementById('juegoError');
  errEl.classList.add('d-none');

  if (!nombre) { errEl.textContent = 'El nombre es requerido'; errEl.classList.remove('d-none'); return; }
  if (minM < 1 || maxM < minM) { errEl.textContent = 'El rango de personas no es válido'; errEl.classList.remove('d-none'); return; }

  const usaSubcategorias   = document.getElementById('jUsaSubcategorias').checked;
  const llamadoAutomatico  = document.getElementById('jLlamadoAutomatico').checked;
  const tiempoAutoLlamado  = parseInt(document.getElementById('jTiempoAutoLlamado').value, 10);
  if (llamadoAutomatico && (!tiempoAutoLlamado || tiempoAutoLlamado < 1)) {
    errEl.textContent = 'El tiempo entre llamados debe ser mayor a 0 segundos';
    errEl.classList.remove('d-none');
    return;
  }
  const usaVueltas = document.getElementById('jUsaVueltas').checked;
  let payload = {
    nombre, activa, min_miembros: minM, max_miembros: maxM, usa_etapas: usaEtapas, usa_subcategorias: usaSubcategorias,
    usa_vueltas: usaVueltas,
    llamado_automatico: llamadoAutomatico, tiempo_entre_llamados_segundos: llamadoAutomatico ? tiempoAutoLlamado : null,
  };

  if (usaEtapas) {
    const filas = document.querySelectorAll('#listaEtapas .etapa-row');
    if (filas.length === 0) {
      errEl.textContent = 'Debe agregar al menos una etapa';
      errEl.classList.remove('d-none');
      return;
    }
    const etapas = Array.from(filas).map(fila => ({
      nombre: fila.querySelector('.etapa-nombre').value.trim(),
      duracion_minutos: parseInt(fila.querySelector('.etapa-minutos').value, 10) || 1,
      activa: fila.dataset.activa !== '0' ? 1 : 0,
    }));
    const vacias = etapas.filter(e => !e.nombre);
    if (vacias.length) {
      errEl.textContent = 'Todas las etapas deben tener nombre';
      errEl.classList.remove('d-none');
      return;
    }
    payload.etapas = etapas;
  } else {
    const duracion = parseInt(document.getElementById('jDuracion').value, 10);
    if (!duracion || duracion < 1) {
      errEl.textContent = 'La duración debe ser mayor a 0';
      errEl.classList.remove('d-none');
      return;
    }
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

  if (usaVueltas) {
    const filasV = document.querySelectorAll('#listaVueltas .vuelta-row');
    if (!filasV.length) { errEl.textContent = 'Debe agregar al menos una opción de vueltas'; errEl.classList.remove('d-none'); return; }
    const vueltas = Array.from(filasV).map(fila => ({
      id:       fila.dataset.id || undefined,
      cantidad: Number(fila.querySelector('.vuelta-cantidad').value),
    }));
    const cantidades = vueltas.map(v => v.cantidad);
    if (cantidades.some(n => !Number.isInteger(n) || n < 1)) { errEl.textContent = 'Las vueltas deben ser números enteros mayores a cero'; errEl.classList.remove('d-none'); return; }
    if (new Set(cantidades).size !== cantidades.length) { errEl.textContent = 'No se puede repetir la misma cantidad de vueltas'; errEl.classList.remove('d-none'); return; }
    payload.vueltas = vueltas;
  }

  const url    = id ? `/api/atracciones/${id}` : '/api/atracciones';
  const method = id ? 'PUT' : 'POST';
  const res    = await fetch(url, {
    method, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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
  // Fondos claros (warning/info) llevan texto y botón de cierre oscuros para que se lean.
  const claro = tipo === 'warning' || tipo === 'info';
  const col = { success:'bg-success', danger:'bg-danger', warning:'bg-warning', info:'bg-info' }[tipo] || 'bg-secondary';
  document.getElementById('toastContainer').insertAdjacentHTML('beforeend', `
    <div id="${id}" class="toast align-items-center ${col} ${claro ? 'text-dark' : 'text-white'} border-0 shadow" role="alert">
      <div class="d-flex">
        <div class="toast-body fw-semibold">${mensaje}</div>
        <button type="button" class="btn-close ${claro ? '' : 'btn-close-white'} me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>`);
  const el = document.getElementById(id);
  new bootstrap.Toast(el, { delay: 3000 }).show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}
