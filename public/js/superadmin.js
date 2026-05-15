// ── Auth ──────────────────────────────────────────────────────────────────────
(async () => {
  const res = await fetch('/api/auth/me');
  if (!res.ok) { window.location.href = '/login.html'; return; }
  const me = await res.json();
  if (me.rol !== 'superadmin') { window.location.href = '/login.html'; return; }
  document.getElementById('devNombre').textContent = me.nombre;
  cargarAdmins();
})();

document.getElementById('btnLogout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});
document.getElementById('btnRefresh').addEventListener('click', cargarAdmins);

// ── Definición de features ────────────────────────────────────────────────────
const FEATURES = [
  {
    key:   'feature_graficos',
    icon:  '📊',
    label: 'Estadísticas y gráficos',
    desc:  'Acceso al panel de estadísticas: turnos por día, por atracción, por operador y tiempos de espera',
    grupo: 'Lo que el administrador puede ver',
  },
  {
    key:   'feature_juegos',
    icon:  '🎮',
    label: 'Gestión de juegos / atracciones',
    desc:  'Crear, editar, activar y desactivar juegos. Configurar duración y límite de personas por sesión',
    grupo: 'Lo que el administrador puede hacer',
  },
  {
    key:   'feature_cancelar_turno',
    icon:  '❌',
    label: 'Cancelar bipers',
    desc:  'Puede habilitar a operadores y recepcionistas para cancelar el turno de clientes que no llegaron',
    grupo: 'Permisos que el administrador puede otorgar a su equipo',
  },
  {
    key:   'feature_llamar_turno',
    icon:  '📣',
    label: 'Llamar y finalizar desde recepción',
    desc:  'Puede habilitar a recepcionistas para llamar al siguiente grupo y finalizar turnos en curso',
    grupo: 'Permisos que el administrador puede otorgar a su equipo',
  },
];

// ── Cargar admins ─────────────────────────────────────────────────────────────
async function cargarAdmins() {
  const res    = await fetch('/api/superadmin/admins');
  const admins = await res.json();
  const cont   = document.getElementById('listaAdmins');

  if (!admins.length) {
    cont.innerHTML = `<div class="empty"><i class="bi bi-people"></i>No hay cuentas de administrador creadas todavía</div>`;
    return;
  }

  // Agrupar features por grupo para el render
  const grupos = [...new Set(FEATURES.map(f => f.grupo))];

  cont.innerHTML = admins.map(a => {
    const estadoBadge = a.activo
      ? '<span class="badge-estado activo">● Activo</span>'
      : '<span class="badge-estado inactivo">● Inactivo</span>';

    const featuresHtml = grupos.map(grupo => {
      const featsDelGrupo = FEATURES.filter(f => f.grupo === grupo);
      const filas = featsDelGrupo.map(f => `
        <div class="feature-row">
          <div class="d-flex align-items-start gap-3">
            <span class="feature-icon">${f.icon}</span>
            <div>
              <div class="feature-label">${f.label}</div>
              <div class="feature-desc">${f.desc}</div>
            </div>
          </div>
          <div class="form-check form-switch mb-0 ms-3 flex-shrink-0">
            <input class="form-check-input" type="checkbox" role="switch"
              id="${f.key}-${a.id}" ${a[f.key] ? 'checked' : ''}
              onchange="toggleFeature(${a.id}, '${f.key}', this.checked)">
          </div>
        </div>`).join('');

      return `
        <div class="grupo-label">${grupo}</div>
        ${filas}`;
    }).join('');

    return `
    <div class="admin-card mb-4" id="card-${a.id}">
      <div class="admin-card-header">
        <div>
          <div class="admin-name">${a.nombre} ${planPill(a)}</div>
          <div class="admin-username mt-1">@${a.username}</div>
        </div>
        ${estadoBadge}
      </div>
      <div class="admin-card-body">
        ${featuresHtml}
      </div>
    </div>`;
  }).join('');
}

// ── Toggle feature ─────────────────────────────────────────────────────────────
async function toggleFeature(adminId, changedKey, valor) {
  // Leer estado actual de todos los checkboxes de este admin
  const payload = {};
  FEATURES.forEach(f => {
    const el = document.getElementById(`${f.key}-${adminId}`);
    payload[f.key] = el ? (el.checked ? 1 : 0) : 0;
  });

  const res = await fetch(`/api/superadmin/admins/${adminId}/features`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });

  if (!res.ok) {
    mostrarToast('Error al guardar el cambio', 'danger');
    // Revertir
    const el = document.getElementById(`${changedKey}-${adminId}`);
    if (el) el.checked = !valor;
    return;
  }

  // Actualizar pill del plan
  const pill = document.querySelector(`#card-${adminId} .plan-pill`);
  if (pill) pill.outerHTML = planPill(payload);

  const feat  = FEATURES.find(f => f.key === changedKey);
  const accion = valor ? 'Activado' : 'Desactivado';
  mostrarToast(`${valor ? '✓' : '✗'} ${accion}: ${feat?.label || changedKey}`, valor ? 'ok' : 'warn');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function planPill(data) {
  const activos = FEATURES.filter(f => data[f.key]).length;
  const total   = FEATURES.length;
  if (activos === total)   return '<span class="plan-pill plan-full">Plan Completo</span>';
  if (activos === 0)       return '<span class="plan-pill plan-limited">Sin módulos</span>';
  return `<span class="plan-pill plan-basic">${activos}/${total} módulos</span>`;
}

function mostrarToast(mensaje, tipo = 'ok') {
  const id  = 'toast-' + Date.now();
  const col = { ok:'toast-ok', warn:'toast-warn', danger:'bg-danger text-white' }[tipo] || 'bg-secondary text-white';
  document.getElementById('toastContainer').insertAdjacentHTML('beforeend', `
    <div id="${id}" class="toast align-items-center border-0 ${col}" role="alert">
      <div class="d-flex">
        <div class="toast-body fw-semibold">${mensaje}</div>
        <button type="button" class="btn-close me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>`);
  const el = document.getElementById(id);
  new bootstrap.Toast(el, { delay: 2800 }).show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}
