function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
}

// ── Auth ──────────────────────────────────────────────────────────────────────
(async () => {
  const res = await fetch('/api/auth/me');
  if (!res.ok) { window.location.href = '/login.html'; return; }
  const me = await res.json();
  if (me.rol !== 'superadmin') { window.location.href = '/login.html'; return; }
  document.getElementById('devNombre').textContent = me.nombre;
  cargarLicencia();
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
    label: 'Cancelar beepers',
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
          <div class="admin-name">${escapeHtml(a.nombre)} ${planPill(a)}</div>
          <div class="admin-username mt-1">@${escapeHtml(a.username)}</div>
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

// ══════════════════════════════════════════════════════════════════════════════
// LICENCIA DEL SISTEMA
// ══════════════════════════════════════════════════════════════════════════════

async function cargarLicencia() {
  try {
    const res  = await fetch('/api/licencia/info');
    const data = await res.json();

    // Installation ID
    document.getElementById('licInstallId').textContent = data.installation_id || '—';

    // Badge de estado
    const badge = document.getElementById('licEstadoBadge');
    if (data.estado === 'activa') {
      badge.className = 'lic-badge-ok';
      badge.textContent = '● ACTIVA';
    } else if (data.razon && data.razon.includes('vencida')) {
      badge.className = 'lic-badge-warn';
      badge.textContent = '● VENCIDA';
    } else {
      badge.className = 'lic-badge-error';
      badge.textContent = '● SIN LICENCIA';
    }

    // Detalle
    const detalle = document.getElementById('licEstadoDetalle');
    if (data.estado === 'activa' && data.licencia) {
      const lic = data.licencia;
      const vence = lic.vence
        ? new Date(lic.vence).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' })
        : 'Perpetua';
      const emitida = new Date(lic.emitida).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
      detalle.innerHTML = `
        <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:16px;">
          <div class="lic-field">
            <div class="lic-label">Cliente</div>
            <div class="lic-value">${escapeHtml(lic.cliente)}</div>
          </div>
          <div class="lic-field">
            <div class="lic-label">Plan</div>
            <div class="lic-value" style="text-transform:capitalize">${escapeHtml(lic.plan)}</div>
          </div>
          <div class="lic-field">
            <div class="lic-label">Emitida</div>
            <div class="lic-value">${emitida}</div>
          </div>
          <div class="lic-field">
            <div class="lic-label">Vence</div>
            <div class="lic-value">${vence}</div>
          </div>
          <div class="lic-field">
            <div class="lic-label">Sesiones máx.</div>
            <div class="lic-value">${lic.max_sesiones}</div>
          </div>
        </div>`;
    } else {
      const razon = data.razon || 'Sin licencia activa';
      detalle.innerHTML = `
        <div style="color:#94a3b8; font-size:.875rem;">
          <i class="bi bi-exclamation-triangle me-2" style="color:#fbbf24"></i>${escapeHtml(razon)}
        </div>`;
    }
  } catch (e) {
    document.getElementById('licEstadoDetalle').innerHTML =
      '<div style="color:#f87171; font-size:.875rem;">No se pudo cargar la información de licencia.</div>';
  }
}

async function copiarInstallId() {
  const id = document.getElementById('licInstallId').textContent;
  if (!id || id === '—') return;
  try {
    await navigator.clipboard.writeText(id);
    mostrarToast('Installation ID copiado al portapapeles', 'ok');
  } catch (_) {
    mostrarToast('No se pudo copiar automáticamente. Seleccioná el texto manualmente.', 'warn');
  }
}

document.getElementById('btnActivarLicencia').addEventListener('click', async () => {
  const cadena = document.getElementById('licCadena').value.trim();
  const msgEl  = document.getElementById('licActivarMsg');

  if (!cadena) {
    msgEl.className = 'mt-2 small text-warning';
    msgEl.textContent = 'Pegá la cadena de licencia antes de activar.';
    msgEl.classList.remove('d-none');
    return;
  }

  const btn = document.getElementById('btnActivarLicencia');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Verificando...';

  try {
    const res  = await fetch('/api/licencia/activar', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ licencia: cadena }),
    });
    const data = await res.json();

    if (res.ok && data.ok) {
      msgEl.className = 'mt-2 small';
      msgEl.style.color = '#34d399';
      msgEl.textContent = data.mensaje;
      msgEl.classList.remove('d-none');
      document.getElementById('licCadena').value = '';
      mostrarToast('Licencia activada correctamente', 'ok');
      await cargarLicencia();
    } else {
      msgEl.className = 'mt-2 small';
      msgEl.style.color = '#f87171';
      msgEl.textContent = data.error || 'Error al activar la licencia.';
      msgEl.classList.remove('d-none');
    }
  } catch (_) {
    msgEl.className = 'mt-2 small';
    msgEl.style.color = '#f87171';
    msgEl.textContent = 'Error de comunicación con el servidor.';
    msgEl.classList.remove('d-none');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>Activar licencia';
  }
});

document.getElementById('btnRevocarLicencia').addEventListener('click', async () => {
  if (!confirm('¿Confirmar revocación de la licencia activa?\n\nEl sistema quedará en estado no activado.')) return;

  try {
    const res  = await fetch('/api/licencia', { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) {
      mostrarToast('Licencia revocada', 'warn');
      await cargarLicencia();
    } else {
      mostrarToast(data.error || 'Error al revocar', 'danger');
    }
  } catch (_) {
    mostrarToast('Error de comunicación con el servidor.', 'danger');
  }
});

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


// ── Permiso configuración de red ──────────────────────────────────────────────
async function cargarPermisoRed() {
  try {
    const res = await fetch('/api/config-general');
    if (!res.ok) return;
    const cfg = await res.json();
    const sw = document.getElementById('switchPermisoRedAdmin');
    if (sw) sw.checked = !!cfg.admin_puede_configurar_red;
  } catch (_) {}
}

const switchPermisoRed = document.getElementById('switchPermisoRedAdmin');
if (switchPermisoRed) {
  switchPermisoRed.addEventListener('change', async () => {
    const msg = document.getElementById('msgPermisoRed');
    try {
      const res = await fetch('/api/config-general/permiso-red', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_puede_configurar_red: switchPermisoRed.checked }),
      });
      const data = await res.json();
      if (res.ok) {
        msg.className = 'alert alert-success mt-3 mb-0 small py-2';
        msg.textContent = `Permiso ${switchPermisoRed.checked ? 'habilitado' : 'deshabilitado'} correctamente.`;
      } else {
        msg.className = 'alert alert-danger mt-3 mb-0 small py-2';
        msg.textContent = data.error || 'Error al actualizar el permiso.';
      }
      msg.classList.remove('d-none');
      setTimeout(() => msg.classList.add('d-none'), 4000);
    } catch (_) {
      msg.className = 'alert alert-danger mt-3 mb-0 small py-2';
      msg.textContent = 'Error de conexión.';
      msg.classList.remove('d-none');
    }
  });
}

cargarPermisoRed();
