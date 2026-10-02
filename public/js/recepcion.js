const socket = io();
let me = null;
let atracciones = [];
let colaData    = [];

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
}

// Nombre visible de un beeper: el apodo si tiene; si no, una versión corta del
// código (el código completo puede ser muy largo y se muestra como tooltip).
function nombreBeeper(v) {
  const apodo = String(v?.apodo ?? '').trim();
  if (apodo) return apodo;
  const codigo = String(v?.codigo_viper ?? '');
  return codigo.length > 12 ? codigo.slice(0, 12) + '…' : codigo;
}

// Formatea minutos de forma legible: 45 → "45 min", 60 → "1 h", 160 → "2 h 40 min"
function formatMinutos(minutos) {
  const total = Math.max(0, Math.ceil(Number(minutos) || 0));
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// Escapa para uso en atributos onclick (HTML + JS string con comillas simples)
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, "\\'");
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function init() {
  const res = await fetch('/api/auth/me');
  if (!res.ok) { window.location.href = '/login.html'; return; }
  me = await res.json();
  if (!['admin','recepcion'].includes(me.rol)) {
    window.location.href = '/login.html'; return;
  }
  document.getElementById('usuarioNombre').textContent = me.nombre;
  if (me.permiso_gestionar_juegos) document.getElementById('btnJuegos').style.display = 'inline-flex';

  await cargarAtracciones();
  await cargarVipersActivos();
  await cargarCola();
  await asignarBiperAutomatico();
}

document.getElementById('btnLogout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});
document.getElementById('btnRefresh').addEventListener('click', cargarCola);

// ── Atracciones ───────────────────────────────────────────────────────────────
async function cargarAtracciones() {
  const res = await fetch('/api/atracciones');
  atracciones = await res.json();
  const sel = document.getElementById('selectJuego');
  const seleccionPrevia = sel.value;
  sel.innerHTML = '<option value="">Seleccionar juego…</option>';
  atracciones.forEach(a => {
    const minM = a.min_miembros || 1;
    const maxM = a.max_miembros || 30;
    sel.innerHTML += `<option value="${a.id}" data-duracion="${a.duracion_minutos}" data-min-miembros="${minM}" data-max-miembros="${maxM}" data-usa-subcategorias="${a.usa_subcategorias || 0}">${escapeHtml(a.nombre)} (${formatMinutos(a.duracion_minutos)})</option>`;
  });
  // Al recargar por un cambio de juego, conservar lo que la recepcionista ya había elegido
  if (seleccionPrevia && atracciones.some(a => String(a.id) === seleccionPrevia)) {
    sel.value = seleccionPrevia;
  }
}

// ── VIPERs activos (selección opcional al registrar un grupo) ──────────────────
async function cargarVipersActivos() {
  const sel = document.getElementById('selectViper');
  if (!sel) return;
  try {
    const res    = await fetch('/api/vipers/activos');
    const vipers = res.ok ? await res.json() : [];
    sel.innerHTML = '<option value="">Sin beeper físico</option>';
    vipers.forEach(v => {
      sel.innerHTML += `<option value="${v.id}" title="${escapeHtml(v.codigo_viper)}">${escapeHtml(nombreBeeper(v))}</option>`;
    });
  } catch (_) { /* el módulo VIPER es opcional, no debe romper el registro */ }
}

document.getElementById('selectJuego').addEventListener('change', async () => {
  const opt = document.getElementById('selectJuego').selectedOptions[0];
  const duracion = opt?.dataset.duracion;
  const minM     = parseInt(opt?.dataset.minMiembros) || 1;
  const maxM     = parseInt(opt?.dataset.maxMiembros) || 30;
  const duEl     = document.getElementById('duracionJuego');
  const inputM   = document.getElementById('inputMiembros');

  if (duracion) {
    duEl.innerHTML = `<i class="bi bi-clock me-1"></i>Duración: <strong>${formatMinutos(duracion)}</strong>&nbsp;&nbsp;<i class="bi bi-people ms-2 me-1"></i>Personas: <strong>${minM}–${maxM}</strong>`;
    inputM.min = minM;
    inputM.max = maxM;
    const current = parseInt(inputM.value) || 1;
    if (current < minM) inputM.value = minM;
    if (current > maxM) inputM.value = maxM;
  } else {
    duEl.textContent = '';
    inputM.min = 1;
    inputM.max = 30;
  }

  // Manejar subcategorias
  const wrapSub = document.getElementById('wrapSubcategoria');
  const selSub  = document.getElementById('selectSubcategoria');
  selSub.innerHTML = '<option value="">Seleccionar subcategoría…</option>';

  const juegoId       = opt?.value;
  const usaSubs       = opt?.dataset.usaSubcategorias === '1';

  if (juegoId && usaSubs) {
    try {
      const r    = await fetch(`/api/atracciones/${juegoId}/subcategorias`);
      const subs = r.ok ? await r.json() : [];
      subs.forEach(s => {
        selSub.innerHTML += `<option value="${s.id}">${escapeHtml(s.nombre)}</option>`;
      });
    } catch (_) {}
    wrapSub.classList.remove('d-none');
  } else {
    wrapSub.classList.add('d-none');
  }

  actualizarEsperaEstimada();
});

function actualizarEsperaEstimada() {
  const atraccionId = document.getElementById('selectJuego').value;
  const wrap        = document.getElementById('tiempoEsperaWrap');
  const msg         = document.getElementById('tiempoEsperaMsg');
  if (!atraccionId || !colaData.length) { wrap.classList.add('d-none'); return; }

  const juego = colaData.find(j => String(j.id) === String(atraccionId));
  if (!juego) { wrap.classList.add('d-none'); return; }

  // El nuevo grupo irá al final de la cola
  const totalEspera = juego.jugando.reduce((s, t) => s + t.tiempo_restante, 0) +
                      juego.cola.length * juego.duracion_minutos;

  wrap.classList.remove('d-none');
  if (totalEspera === 0) {
    msg.innerHTML = `<strong>¡Puede jugar casi de inmediato!</strong> No hay grupos en espera.`;
  } else {
    msg.innerHTML = `Tiempo de espera estimado para este juego: <strong>~${formatMinutos(totalEspera)}</strong>`;
  }
}

// ── Cola con tabs por juego ───────────────────────────────────────────────────
let _activeTabId = null;

async function cargarCola() {
  const res = await fetch('/api/turnos/cola');
  const data = await res.json();
  colaData = data.juegos;
  renderCola();
  actualizarEsperaEstimada();
}

function renderCola() {
  const cont = document.getElementById('colaPorJuego');

  if (!colaData.length) {
    cont.innerHTML = `<p class="text-center text-muted py-4">
      <i class="bi bi-inbox fs-1 d-block mb-2 opacity-50"></i>Sin juegos configurados</p>`;
    return;
  }

  // Recordar tab activo antes de re-renderizar
  const tabAnterior = document.querySelector('#tabsJuego .nav-link.active')?.dataset.juegoId;
  if (tabAnterior) _activeTabId = tabAnterior;
  // Si no hay tab activo aún, usar el primero
  if (!_activeTabId || !colaData.find(j => String(j.id) === _activeTabId)) {
    _activeTabId = String(colaData[0]?.id ?? '');
  }

  // ── Construir pestañas ───────────────────────────────────────────────────
  const navItems = colaData.map(j => {
    const esActivo = String(j.id) === _activeTabId;
    const badgeJ   = j.jugando.length ? `<span class="badge bg-primary ms-1">${j.jugando.length}</span>` : '';
    const badgeE   = j.cola.length    ? `<span class="badge bg-warning text-dark ms-1">${j.cola.length}</span>` : '';
    return `
    <li class="nav-item" role="presentation">
      <button class="nav-link px-3 py-2 ${esActivo ? 'active' : ''}"
        data-bs-toggle="tab" data-bs-target="#tab-${j.id}"
        data-juego-id="${j.id}" role="tab">
        <i class="bi bi-controller me-1"></i>${j.nombre}${badgeJ}${badgeE}
      </button>
    </li>`;
  }).join('');

  // ── Construir paneles ────────────────────────────────────────────────────
  const panes = colaData.map(j => {
    const esActivo = String(j.id) === _activeTabId;
    return `
    <div class="tab-pane fade ${esActivo ? 'show active' : ''}" id="tab-${j.id}" role="tabpanel">
      ${renderJuegoPane(j)}
    </div>`;
  }).join('');

  cont.innerHTML = `
    <ul class="nav nav-tabs border-bottom mb-3" id="tabsJuego" role="tablist">${navItems}</ul>
    <div class="tab-content">${panes}</div>`;

  // Actualizar _activeTabId al cambiar de tab
  document.querySelectorAll('#tabsJuego .nav-link').forEach(btn => {
    btn.addEventListener('shown.bs.tab', () => { _activeTabId = btn.dataset.juegoId; });
  });
}

// ── Contenido de cada panel de juego ─────────────────────────────────────────
function renderJuegoPane(j) {
  if (!j.jugando.length && !j.cola.length) {
    return `<p class="text-center text-muted py-4">
      <i class="bi bi-inbox fs-2 d-block mb-2 opacity-50"></i>Sin grupos registrados</p>`;
  }

  let html = '';

  // ── Grupos jugando ───────────────────────────────────────────────────────
  if (j.jugando.length) {
    html += `<div class="seccion-titulo"><i class="bi bi-play-fill me-1"></i>Jugando ahora</div>`;
    html += j.jugando.map(t => {
      const btnFinalizar = me?.permiso_llamar_turno
        ? `<button class="btn btn-danger btn-sm fw-bold px-3"
             onclick="pedirFinalizarGrupo(${t.id},'${esc(t.nombre_cliente||'Sin nombre')}')">
             <i class="bi bi-check-lg me-1"></i>Finalizar
           </button>`
        : '';
      const btnCancelarTurno = me?.permiso_cancelar_turno
        ? `<button class="btn btn-outline-danger btn-sm fw-bold px-3"
             onclick="pedirCancelarTurno(${t.id},'${esc(t.nombre_cliente||'Sin nombre')}')">
             <i class="bi bi-x-octagon me-1"></i>Cancelar
           </button>`
        : '';
      // Mientras el grupo siga en estado 'llamado' (todavía no marcó "Llegó" el
      // operador) se puede volver a llamar al mismo turno/beeper las veces que
      // haga falta — reutiliza el mismo flujo de llamado (con sus confirmaciones).
      const btnLlamarNuevamente = (me?.permiso_llamar_turno && t.estado === 'llamado')
        ? `<button class="btn btn-outline-success btn-sm fw-bold px-3"
             onclick="_ejecutarLlamar(${t.id})">
             <i class="bi bi-megaphone me-1"></i>Llamar nuevamente
           </button>`
        : '';
      // Info de etapa para recepción
      let etapaHtml = '';
      if (t.etapa_actual_nombre) {
        const sigTexto = t.etapa_siguiente_nombre
          ? `<span class="text-muted small"><i class="bi bi-arrow-right me-1"></i>Próxima: <strong>${escapeHtml(t.etapa_siguiente_nombre)}</strong></span>`
          : `<span class="text-muted small"><i class="bi bi-flag-fill me-1"></i>Última etapa</span>`;
        etapaHtml = `
          <div class="d-flex align-items-center gap-2 mt-1 flex-wrap">
            <span class="etapa-recep-badge"><i class="bi bi-layers me-1"></i>${escapeHtml(t.etapa_actual_nombre)}</span>
            ${sigTexto}
          </div>`;
      }
      const subcatHtml = t.subcategoria_nombre
        ? `<span class="badge bg-success bg-opacity-75 ms-1"><i class="bi bi-diagram-3 me-1"></i>${escapeHtml(t.subcategoria_nombre)}</span>`
        : '';
      // El badge de estado refleja el estado real: 'llamado' es la ventana previa
      // (5 min) antes de pasar a 'jugando' — no es lo mismo, sobre todo si el juego
      // usa etapas y todavía está en la primera (ej. "En charla").
      const badgeEstado = t.estado === 'jugando'
        ? `<span class="badge bg-primary"><i class="bi bi-play-fill me-1"></i>JUGANDO</span>`
        : `<span class="badge bg-warning text-dark"><i class="bi bi-megaphone-fill me-1"></i>LLAMADO</span>`;
      return `
      <div class="turno-row jugando d-flex align-items-center justify-content-between flex-wrap gap-2">
        <div class="d-flex align-items-center gap-3">
          <span class="biper-num">${escapeHtml(t.biper_numero)}</span>
          <div>
            <div class="fw-bold">${escapeHtml(t.nombre_cliente || 'Sin nombre')}</div>
            <div class="d-flex gap-2 mt-1 flex-wrap">
              <span class="miembros-badge"><i class="bi bi-people me-1"></i>${t.cantidad_miembros} persona${t.cantidad_miembros !== 1 ? 's' : ''}</span>
              ${badgeEstado}
              ${subcatHtml}
            </div>
            ${etapaHtml}
          </div>
        </div>
        <div class="d-flex align-items-center gap-3">
          <div class="text-end">
            <div class="fw-semibold text-primary">${formatMinutos(t.tiempo_restante)} restantes</div>
            <div class="text-muted small">${formatMinutos(t.tiempo_transcurrido)} transcurridos</div>
          </div>
          ${btnLlamarNuevamente}
          ${btnCancelarTurno}
          ${btnFinalizar}
        </div>
      </div>`;
    }).join('');
  }

  // ── Cola en espera ───────────────────────────────────────────────────────
  if (j.cola.length) {
    html += `<div class="seccion-titulo mt-3"><i class="bi bi-hourglass-split me-1"></i>En espera</div>`;

    // Calcular posición dentro de cada subcategoría para flechas y botón de llamar
    const colaBySubcat = {};
    j.cola.forEach(t => {
      const key = t.subcategoria_id ?? '__null__';
      if (!colaBySubcat[key]) colaBySubcat[key] = [];
      colaBySubcat[key].push(t);
    });

    html += j.cola.map(t => {
      // Combinación en espera de este turno (solo si quedan 2+ grupos juntos).
      // Se dibuja UNA sola tarjeta, en el lugar del primero; el resto no.
      const combo = _comboDe(j, t);
      if (combo && combo[0].id !== t.id) return '';
      const grupo = combo || [t];
      const ultimo = grupo[grupo.length - 1];

      const claseEspera = t.tiempo_espera_estimado === 0 ? 'espera-0'
        : t.tiempo_espera_estimado <= 30 ? 'espera-baja' : 'espera-alta';

      // Posición dentro de la misma subcategoría (solo determina quién puede
      // ser llamado/combinado — esa restricción no aplica al reordenamiento)
      const subcatKey     = t.subcategoria_id ?? '__null__';
      const subcatList    = colaBySubcat[subcatKey] || [];
      const posSubcat     = subcatList.findIndex(x => x.id === t.id) + 1;
      const esPrimeroSubcat = posSubcat === 1;

      // Posición real dentro de TODA la cola en espera del juego — de esto
      // dependen las flechas de subir/bajar, sin importar la subcategoría.
      const esPrimeroCola = t.posicion === 1;
      const esUltimoCola  = ultimo.posicion === j.cola.length;

      // Botón de acción: "Llamar" para el primero (si está combinado, llama a
      // toda la combinación); si hay alguien jugando de la misma subcategoría,
      // cualquiera puede sumarse. "Combinar" une grupos en espera sin llamarlos.
      let btnLlamar = '';
      if (me?.permiso_llamar_turno) {
        const hayJugandoMismaSubcat = j.usa_subcategorias
          ? j.jugando.some(g => g.subcategoria_id === t.subcategoria_id)
          : j.jugando.length > 0;

        const puedeCombinar = subcatList.some(x =>
          !grupo.some(c => c.id === x.id) && !_comboDe(j, x));
        const btnCombinar = puedeCombinar
          ? `<button class="btn btn-warning btn-sm fw-bold px-3"
              onclick="abrirCombinar(${j.id},${t.id})">
              <i class="bi bi-people-fill me-1"></i>Combinar
            </button>`
          : '';

        if (esPrimeroSubcat || hayJugandoMismaSubcat) {
          btnLlamar = `<button class="btn btn-success btn-sm fw-bold px-3"
            onclick="llamarGrupo(${t.id},${hayJugandoMismaSubcat},'${esc(j.nombre)}','${esc(_nombreCombo(t, combo))}')">
            <i class="bi bi-megaphone me-1"></i>Llamar${combo ? ' juntos' : ''}
          </button>${btnCombinar}`;
        } else {
          btnLlamar = `<button class="btn btn-outline-secondary btn-sm px-3" disabled
            title="Primero debe llamarse al grupo #1 de su subcategoría">
            <i class="bi bi-lock me-1"></i>Espera turno
          </button>${btnCombinar}`;
        }
      }

      // Flechas basadas en la posición real dentro de toda la cola (no por subcategoría)
      const btnSubir = `<button class="btn btn-outline-secondary btn-sm py-0 px-2" title="Subir en la cola"
        ${esPrimeroCola ? 'disabled' : ''} onclick="moverTurno(${t.id},'subir')">
        <i class="bi bi-chevron-up"></i>
      </button>`;
      const btnBajar = `<button class="btn btn-outline-secondary btn-sm py-0 px-2" title="Bajar en la cola"
        ${esUltimoCola ? 'disabled' : ''} onclick="moverTurno(${t.id},'bajar')">
        <i class="bi bi-chevron-down"></i>
      </button>`;
      // Input de posición: escribir el puesto deseado y Enter mueve el turno directo ahí
      const inputPasos = `<input type="number" min="1" max="${j.cola.length}" value="${t.posicion}" id="pasos-${t.id}"
        class="form-control form-control-sm py-0 px-1 text-center" style="width:42px" title="Escribí el puesto deseado y presioná Enter"
        onkeydown="if(event.key==='Enter'){event.preventDefault();moverAPosicion(${t.id},${t.posicion},this.value);}">`;

      const subcatEsperaHtml = t.subcategoria_nombre
        ? `<span class="badge bg-success bg-opacity-75"><i class="bi bi-diagram-3 me-1"></i>${escapeHtml(t.subcategoria_nombre)}</span>`
        : '';

      // Editar / eliminar son por grupo: en una combinación se reemplazan por
      // "Separar" (después se puede editar o eliminar cada grupo suelto).
      const btnsGrupo = combo
        ? `<button class="btn btn-outline-secondary btn-sm px-2" title="Separar la combinación"
            onclick="separarCombinacion(${t.id})">
            <i class="bi bi-scissors"></i>
          </button>`
        : `<button class="btn btn-outline-primary btn-sm px-2" title="Editar turno"
            onclick="pedirEditarTurno(${t.id})">
            <i class="bi bi-pencil"></i>
          </button><button class="btn btn-outline-danger btn-sm px-2" title="Eliminar turno"
            onclick="pedirEliminarTurno(${t.id},'${esc(t.nombre_cliente||'Sin nombre')}','${esc(j.nombre)}',${t.cantidad_miembros})">
            <i class="bi bi-trash"></i>
          </button>`;

      const personas = grupo.reduce((s, g) => s + (g.cantidad_miembros || 0), 0);
      const beepersHtml = grupo.map(g => `<span class="biper-num">${escapeHtml(g.biper_numero)}</span>`).join('');
      const nombres = grupo.map(g => escapeHtml(g.nombre_cliente || 'Sin nombre')).join(' + ');
      const comboBadge = combo
        ? `<span class="badge bg-warning text-dark"><i class="bi bi-link-45deg me-1"></i>Combinado</span>`
        : '';

      return `
      <div class="turno-row d-flex align-items-center justify-content-between flex-wrap gap-2 ${esPrimeroSubcat ? '' : 'opacity-65'}">
        <div class="d-flex align-items-center gap-3">
          <div class="pos-num">${t.posicion}</div>
          <div class="d-flex gap-1">${beepersHtml}</div>
          <div>
            <div class="fw-bold">${nombres}</div>
            <div class="d-flex gap-2 mt-1 flex-wrap">
              <span class="miembros-badge"><i class="bi bi-people me-1"></i>${personas} persona${personas !== 1 ? 's' : ''}</span>
              ${subcatEsperaHtml}
              ${comboBadge}
            </div>
          </div>
        </div>
        <div class="d-flex align-items-center gap-2">
          <div class="d-flex align-items-center gap-1">
            <div class="d-flex flex-column gap-1">${btnSubir}${btnBajar}</div>
            ${inputPasos}
          </div>
          <span class="espera-badge ${claseEspera}">
            <i class="bi bi-hourglass-split me-1"></i>
            ${t.tiempo_espera_estimado === 0 ? '¡Próximo!' : `~${formatMinutos(t.tiempo_espera_estimado)}`}
          </span>
          ${btnsGrupo}
          ${btnLlamar}
        </div>
      </div>`;
    }).join('');
  }

  return html;
}

// (esc() definido al inicio del archivo)

// ── Formulario ────────────────────────────────────────────────────────────────
async function asignarBiperAutomatico() {
  try {
    const res = await fetch('/api/turnos/proximo-biper');
    if (!res.ok) return;
    const { biper_numero } = await res.json();
    document.getElementById('inputBiper').value = biper_numero;
  } catch (_) { /* si falla, la recepcionista puede cargarlo a mano */ }
}

document.getElementById('btnAutoBiper').addEventListener('click', asignarBiperAutomatico);

// Datos del registro pendiente de confirmar (beeper ya usado en otro juego)
let _pendingRegistro = null;
const modalConfBiperRegistro = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('modalConfBiperRegistro'));

document.getElementById('btnConfBiperRegistroSi').addEventListener('click', async () => {
  modalConfBiperRegistro().hide();
  const payload = _pendingRegistro;
  _pendingRegistro = null;
  if (payload) await enviarRegistro({ ...payload, confirmar_biper_otro_juego: true });
});

document.getElementById('btnConfBiperRegistroNo').addEventListener('click', () => {
  modalConfBiperRegistro().hide();
  _pendingRegistro = null;
  const input = document.getElementById('inputBiper');
  input.focus();
  input.select();
});

// Botones +/- para miembros
document.getElementById('btnMenos').addEventListener('click', () => {
  const el  = document.getElementById('inputMiembros');
  const min = parseInt(el.min) || 1;
  if (parseInt(el.value) > min) el.value = parseInt(el.value) - 1;
});
document.getElementById('btnMas').addEventListener('click', () => {
  const el  = document.getElementById('inputMiembros');
  const max = parseInt(el.max) || 30;
  if (parseInt(el.value) < max) el.value = parseInt(el.value) + 1;
});

document.getElementById('formRegistro').addEventListener('submit', async e => {
  e.preventDefault();
  const atraccion_id      = document.getElementById('selectJuego').value;
  const biper_numero      = document.getElementById('inputBiper').value;
  const nombre_cliente    = document.getElementById('inputNombre').value.trim();
  const cantidad_miembros = parseInt(document.getElementById('inputMiembros').value) || 1;
  const viper_id          = document.getElementById('selectViper')?.value || null;

  const opt           = document.getElementById('selectJuego').selectedOptions[0];
  const usaSubs       = opt?.dataset.usaSubcategorias === '1';
  const subcategoria_id = usaSubs ? (document.getElementById('selectSubcategoria').value || null) : null;

  if (!atraccion_id || !biper_numero || !nombre_cliente) {
    mostrarToast('Completá juego, beeper y nombre del grupo', 'warning'); return;
  }
  if (usaSubs && !subcategoria_id) {
    mostrarToast('Seleccioná una subcategoría para este juego', 'warning'); return;
  }
  const minM = parseInt(opt?.dataset.minMiembros) || 1;
  const maxM = parseInt(opt?.dataset.maxMiembros) || 30;
  if (cantidad_miembros < minM || cantidad_miembros > maxM) {
    mostrarToast(`Este juego requiere entre ${minM} y ${maxM} personas`, 'warning'); return;
  }

  await enviarRegistro({ atraccion_id, biper_numero, nombre_cliente, cantidad_miembros, viper_id, subcategoria_id });
});

async function enviarRegistro(payload) {
  const res  = await fetch('/api/turnos', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();

  if (data.advertencia === 'biper_en_otro_juego_registro') {
    _pendingRegistro = payload;
    document.getElementById('confBiperRegistroTexto').innerHTML =
      `El beeper <strong>${escapeHtml(data.biper_numero)}</strong> ya está asignado en:<br><br>
       <div class="ms-2 mb-2">
         <div><span class="text-muted">Juego:</span> <strong>${escapeHtml(data.juego_origen)}</strong></div>
         <div><span class="text-muted">Familia / Grupo:</span> <strong>${escapeHtml(data.nombre_cliente || 'Sin nombre')}</strong></div>
       </div>
       ¿Es la misma familia?`;
    modalConfBiperRegistro().show();
    return;
  }

  if (!res.ok) { mostrarToast(data.error || 'Error al registrar', 'danger'); return; }

  mostrarToast(`✅ ${payload.nombre_cliente} – Beeper ${data.biper_numero} registrado`, 'success');
  document.getElementById('formRegistro').reset();
  document.getElementById('inputMiembros').value = '1';
  document.getElementById('duracionJuego').textContent = '';
  document.getElementById('tiempoEsperaWrap').classList.add('d-none');
  document.getElementById('wrapSubcategoria').classList.add('d-none');
  document.getElementById('selectSubcategoria').innerHTML = '<option value="">Seleccionar subcategoría…</option>';
  await cargarCola();
  await asignarBiperAutomatico();
}

// ── Finalizar turno desde recepción ──────────────────────────────────────────
let _pendingFinalizarId   = null;
let _pendingFinalizarNombre = null;
const modalConfFinalizar  = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('modalConfFinalizar'));

function pedirFinalizarGrupo(id, nombreFamilia) {
  _pendingFinalizarId     = id;
  _pendingFinalizarNombre = nombreFamilia;
  document.getElementById('confFinalizarNombre').textContent = nombreFamilia;
  modalConfFinalizar().show();
}

document.getElementById('btnConfFinalizarSi').addEventListener('click', async (e) => {
  modalConfFinalizar().hide();
  if (!_pendingFinalizarId) return;
  e.target.disabled = true;
  try {
    const res  = await fetch(`/api/turnos/${_pendingFinalizarId}/finalizar`, { method: 'PUT' });
    const data = await res.json();
    if (!res.ok) { mostrarToast(data.error || 'Error al finalizar', 'danger'); }
    else         { mostrarToast(`✅ Turno de ${_pendingFinalizarNombre} finalizado`, 'success'); }
    _pendingFinalizarId = _pendingFinalizarNombre = null;
    await cargarCola();
  } finally {
    e.target.disabled = false;
  }
});
document.getElementById('btnConfFinalizarNo').addEventListener('click', () => {
  modalConfFinalizar().hide();
  _pendingFinalizarId = _pendingFinalizarNombre = null;
});

// ── Cancelar turno (llamado/jugando) desde recepción ─────────────────────────
let _pendingCancelarTurnoId     = null;
let _pendingCancelarTurnoNombre = null;
const modalConfCancelarTurno    = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('modalConfCancelarTurno'));

function pedirCancelarTurno(id, nombreFamilia) {
  _pendingCancelarTurnoId     = id;
  _pendingCancelarTurnoNombre = nombreFamilia;
  document.getElementById('confCancelarTurnoNombre').textContent = nombreFamilia;
  modalConfCancelarTurno().show();
}

document.getElementById('btnConfCancelarTurnoSi').addEventListener('click', async (e) => {
  modalConfCancelarTurno().hide();
  if (!_pendingCancelarTurnoId) return;
  e.target.disabled = true;
  try {
    const res  = await fetch(`/api/turnos/${_pendingCancelarTurnoId}/cancelar-turno`, { method: 'PUT' });
    const data = await res.json();
    if (!res.ok) { mostrarToast(data.error || 'Error al cancelar', 'danger'); }
    else         { mostrarToast(`Turno de ${_pendingCancelarTurnoNombre} cancelado`, 'warning'); }
    _pendingCancelarTurnoId = _pendingCancelarTurnoNombre = null;
    await cargarCola();
  } finally {
    e.target.disabled = false;
  }
});
document.getElementById('btnConfCancelarTurnoNo').addEventListener('click', () => {
  modalConfCancelarTurno().hide();
  _pendingCancelarTurnoId = _pendingCancelarTurnoNombre = null;
});

// ── Llamar grupo desde recepción ──────────────────────────────────────────────
let _pendingLlamarId = null;
const modalConfLlamar = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('modalConfLlamar'));

async function llamarGrupo(id, hayJugando, nombreJuego, nombreFamilia) {
  if (hayJugando) {
    // Pedir confirmación antes de llamar
    _pendingLlamarId = id;
    document.getElementById('confLlamarTexto').innerHTML =
      `<strong>${escapeHtml(nombreJuego)}</strong> ya tiene un grupo jugando.<br>
       ¿Querés llamar igualmente a <strong>${escapeHtml(nombreFamilia)}</strong>?`;
    modalConfLlamar().show();
    return;
  }
  await _ejecutarLlamar(id);
}

document.getElementById('btnConfLlamarSi').addEventListener('click', async () => {
  modalConfLlamar().hide();
  const idParaLlamar = _pendingLlamarId;
  _pendingLlamarId = null;
  if (idParaLlamar) await _ejecutarLlamar(idParaLlamar);
});
document.getElementById('btnConfLlamarNo').addEventListener('click', () => {
  modalConfLlamar().hide();
  _pendingLlamarId = null;
});

const modalConfCapacidad = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('modalConfCapacidad'));

document.getElementById('btnConfCapacidadSi').addEventListener('click', async () => {
  modalConfCapacidad().hide();
  const idParaLlamar = _pendingLlamarId;
  _pendingLlamarId = null;
  if (idParaLlamar) await _ejecutarLlamar(idParaLlamar, true);
});
document.getElementById('btnConfCapacidadNo').addEventListener('click', () => {
  modalConfCapacidad().hide();
  _pendingLlamarId = null;
});

const modalConfViperOtroJuego = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('modalConfViperOtroJuego'));

document.getElementById('btnConfViperOtroJuegoSi').addEventListener('click', async () => {
  modalConfViperOtroJuego().hide();
  const idParaLlamar = _pendingLlamarId;
  _pendingLlamarId = null;
  if (idParaLlamar) await _ejecutarLlamar(idParaLlamar, true);
});
document.getElementById('btnConfViperOtroJuegoNo').addEventListener('click', () => {
  modalConfViperOtroJuego().hide();
  _pendingLlamarId = null;
});

let _llamarEnCurso = false;
async function _ejecutarLlamar(id, force = false) {
  if (_llamarEnCurso) return;
  _llamarEnCurso = true;
  try {
  const res  = await fetch(`/api/turnos/${id}/llamar`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(force ? { force: true } : {}),
  });
  const data = await res.json();
  if (!res.ok) {
    mostrarToast(data.error || 'No se pudo llamar al grupo', 'danger');
    return;
  }
  if (data.advertencia === 'biper_en_otro_juego') {
    _pendingLlamarId = id;
    const restanteTexto = data.tiempo_restante > 0
      ? `con aproximadamente <strong>${formatMinutos(data.tiempo_restante)} restantes</strong>`
      : 'con tiempo excedido';
    document.getElementById('confViperOtroJuegoTexto').innerHTML =
      `El beeper <strong>${escapeHtml(data.biper_numero)}</strong> está actualmente jugando en:<br><br>
       <div class="ms-2 mb-2">
         <div><span class="text-muted">Juego:</span> <strong>${escapeHtml(data.juego_origen)}</strong></div>
         <div><span class="text-muted">Familia / Grupo:</span> <strong>${escapeHtml(data.nombre_cliente || 'Sin nombre')}</strong></div>
         <div><span class="text-muted">Tiempo restante:</span> ${restanteTexto}</div>
       </div>
       ¿Querés llamarlo igualmente?`;
    modalConfViperOtroJuego().show();
    return;
  }
  if (data.advertencia === 'capacidad_excedida') {
    _pendingLlamarId = id;
    document.getElementById('confCapacidadTexto').innerHTML =
      `Actualmente hay <strong>${data.personasJugando}</strong> persona${data.personasJugando !== 1 ? 's' : ''} jugando.<br>
       Este grupo tiene <strong>${data.personasGrupo}</strong> persona${data.personasGrupo !== 1 ? 's' : ''}.<br>
       Si lo llamás habrá <strong>${data.totalPersonas}</strong> personas jugando y el máximo permitido es <strong>${data.maximoPermitido}</strong>.<br>
       ¿Deseás llamarlo igualmente?`;
    modalConfCapacidad().show();
    return;
  }
  if (data.combinados?.length) {
    const beepers = [data, ...data.combinados].map(t => t.biper_numero).join(', ');
    mostrarToast(`📣 Combinación llamada a jugar – beepers ${beepers}`, 'success');
  } else {
    mostrarToast(`📣 Beeper ${data.biper_numero} – ${data.nombre_cliente || 'Grupo'} llamado a jugar`, 'success');
  }
  await cargarCola();
  } finally {
    _llamarEnCurso = false;
  }
}

// ── Combinar grupos ───────────────────────────────────────────────────────────
// Une grupos en espera del mismo juego y subcategoría SIN llamarlos: quedan
// juntos en la cola y, cuando le toca al primero, se llaman todos a la vez.
// El total de personas de la combinación no puede superar el máximo del juego.
const modalCombinar = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('modalCombinar'));
let _combinar = null; // { juego, base, yaCombinados, candidatos, maximo, enOtroJuego, seleccion:Set }

// Integrantes en espera de la combinación del turno (null si no está combinado
// o si quedó solo).
function _comboDe(juego, t) {
  if (!t.combinacion_id) return null;
  const miembros = juego.cola.filter(x => x.combinacion_id === t.combinacion_id);
  return miembros.length >= 2 ? miembros : null;
}

function _nombreCombo(t, combo) {
  return combo
    ? combo.map(c => c.nombre_cliente || 'Sin nombre').join(' + ')
    : (t.nombre_cliente || 'Sin nombre');
}

// Beepers llamados/jugando en un juego distinto al indicado → nombre de ese juego
function _beepersEnOtroJuego(juegoId) {
  const mapa = new Map();
  colaData.filter(j => j.id !== juegoId).forEach(j =>
    j.jugando.forEach(t => mapa.set(String(t.biper_numero), j.nombre)));
  return mapa;
}

function abrirCombinar(juegoId, turnoId) {
  const juego = colaData.find(j => j.id === juegoId);
  const base  = juego?.cola.find(t => t.id === turnoId);
  if (!juego || !base) return;

  const mismaSubcat  = t => !juego.usa_subcategorias || t.subcategoria_id === base.subcategoria_id;
  const comboBase    = _comboDe(juego, base) || [base];
  const yaCombinados = comboBase.filter(t => t.id !== base.id);
  const idsCombo     = new Set(comboBase.map(t => t.id));

  _combinar = {
    juego, base, yaCombinados,
    maximo: juego.max_miembros || 20,
    enOtroJuego: _beepersEnOtroJuego(juegoId),
    candidatos: juego.cola.filter(t => !idsCombo.has(t.id) && mismaSubcat(t)),
    seleccion: new Set(),
  };

  const subcatTxt = base.subcategoria_nombre ? ` (${escapeHtml(base.subcategoria_nombre)})` : '';
  document.getElementById('combinarIntro').innerHTML =
    `Elegí con qué grupos en espera combinar a <strong>${escapeHtml(base.nombre_cliente || 'Sin nombre')}</strong> en <strong>${escapeHtml(juego.nombre)}</strong>${subcatTxt}. Quedan juntos en la cola y se llaman todos a la vez cuando les toque.`;

  _renderCombinar();
  modalCombinar().show();
}

function _personasCombinar() {
  const c = _combinar;
  const grupo = [c.base, ...c.yaCombinados, ...c.candidatos.filter(t => c.seleccion.has(t.id))];
  return grupo.reduce((s, t) => s + (t.cantidad_miembros || 0), 0);
}

function _filaCombinar(t, { marcado, disabled, fijo, motivo }) {
  return `
  <label class="d-flex align-items-center gap-3 border rounded-3 p-2 ${disabled && !fijo ? 'opacity-50' : ''}" style="cursor:${disabled ? 'default' : 'pointer'}">
    <input type="checkbox" class="form-check-input m-0" ${marcado ? 'checked' : ''} ${disabled ? 'disabled' : ''}
      onchange="_toggleCombinar(${t.id}, this.checked)">
    <span class="biper-num">${escapeHtml(t.biper_numero)}</span>
    <div class="flex-fill">
      <div class="fw-bold">${escapeHtml(t.nombre_cliente || 'Sin nombre')}</div>
      <div class="small text-muted">#${t.posicion} en cola · ${t.cantidad_miembros} persona${t.cantidad_miembros !== 1 ? 's' : ''}</div>
      ${motivo ? `<div class="small ${fijo ? 'text-warning-emphasis' : 'text-danger'}">${motivo}</div>` : ''}
    </div>
  </label>`;
}

function _renderCombinar() {
  const c = _combinar;
  const total  = _personasCombinar();
  const libres = c.maximo - total;

  document.getElementById('combinarContador').textContent = `${total} / ${c.maximo}`;
  const barra = document.getElementById('combinarBarra');
  barra.style.width = `${Math.min(100, (total / c.maximo) * 100)}%`;
  barra.className = `progress-bar ${total > c.maximo ? 'bg-danger' : 'bg-warning'}`;

  const filas = c.yaCombinados.map(t =>
    _filaCombinar(t, { marcado: true, disabled: true, fijo: true, motivo: 'Ya combinado' }));

  c.candidatos.forEach(t => {
    const marcado = c.seleccion.has(t.id);
    const otroJ   = c.enOtroJuego.get(String(t.biper_numero));
    const enOtraCombi = !!_comboDe(c.juego, t);
    const noEntra = !marcado && (t.cantidad_miembros || 0) > libres;
    const motivo  = enOtraCombi ? 'Ya está combinado con otro grupo'
                  : otroJ ? `Jugando en ${escapeHtml(otroJ)}`
                  : noEntra ? 'Supera el máximo de personas' : '';
    filas.push(_filaCombinar(t, { marcado, disabled: !marcado && !!motivo, motivo }));
  });

  document.getElementById('combinarLista').innerHTML = filas.length
    ? filas.join('')
    : `<p class="text-muted small text-center my-2">No hay otros grupos en espera de esta subcategoría.</p>`;

  const aviso = document.getElementById('combinarAviso');
  const msg = total > c.maximo ? `Se supera el máximo de ${c.maximo} personas del juego.` : '';
  aviso.innerHTML = msg;
  aviso.classList.toggle('d-none', !msg);

  document.getElementById('btnCombinarConfirmar').disabled = !!msg || c.seleccion.size === 0;
}

function _toggleCombinar(id, marcado) {
  if (marcado) _combinar.seleccion.add(id); else _combinar.seleccion.delete(id);
  _renderCombinar();
}

document.getElementById('btnCombinarConfirmar').addEventListener('click', async (e) => {
  const c = _combinar;
  if (!c || !c.seleccion.size) return;
  e.currentTarget.disabled = true;

  const res  = await fetch('/api/turnos/combinar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ turno_id: c.base.id, con: [...c.seleccion] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    mostrarToast(data.error || 'No se pudo combinar', 'danger');
    e.currentTarget.disabled = false;
    return;
  }
  modalCombinar().hide();
  _combinar = null;
  mostrarToast(`🔗 Grupos combinados (${data.personas} personas) — se llamarán juntos`, 'success');
  await cargarCola();
});

async function separarCombinacion(id) {
  const res = await fetch(`/api/turnos/${id}/descombinar`, { method: 'PUT' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    mostrarToast(data.error || 'No se pudo separar', 'danger');
    return;
  }
  mostrarToast('Combinación separada', 'warning');
  await cargarCola();
}

// ── Reordenar cola ────────────────────────────────────────────────────────────
async function moverTurno(id, direccion, pasos) {
  const cantidad = Math.max(1, parseInt(pasos, 10) || 1);
  const res  = await fetch(`/api/turnos/${id}/mover`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direccion, pasos: cantidad }),
  });
  if (!res.ok) {
    const data = await res.json();
    mostrarToast(data.error || 'No se pudo mover el turno', 'danger');
    return;
  }
  await cargarCola();
}

// Mueve el turno directamente al puesto escrito en el input (Enter).
function moverAPosicion(id, posActual, posDestinoRaw) {
  const destino = parseInt(posDestinoRaw, 10);
  if (!Number.isFinite(destino) || destino < 1) return;
  const diff = destino - posActual;
  if (diff === 0) return;
  moverTurno(id, diff < 0 ? 'subir' : 'bajar', Math.abs(diff));
}

// ── Editar turno en espera ────────────────────────────────────────────────────
let _editarTurnoId      = null;
let _editarAtraccionId  = null;
let _editarUsaSubs      = false;

const modalEditar = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('modalEditarTurno'));

async function pedirEditarTurno(id) {
  // Obtener datos actuales del turno desde la cola local
  let turno = null;
  for (const j of colaData) {
    turno = j.cola.find(t => t.id === id);
    if (turno) { _editarAtraccionId = j.id; _editarUsaSubs = !!j.usa_subcategorias; break; }
  }
  if (!turno) { mostrarToast('No se encontró el turno', 'danger'); return; }

  _editarTurnoId = id;

  // Poblar campos
  const inputM = document.getElementById('editarInputMiembros');
  inputM.value = turno.cantidad_miembros;
  inputM.min   = turno.min_miembros || 1;
  inputM.max   = turno.max_miembros || 30;
  document.getElementById('editarCapacidadTexto').textContent =
    (turno.min_miembros || turno.max_miembros)
      ? `Mínimo: ${turno.min_miembros || 1} · Máximo: ${turno.max_miembros || 30} personas`
      : '';

  const wrapSub = document.getElementById('editarSubcategoriaWrap');
  const selSub  = document.getElementById('editarSelectSubcategoria');
  document.getElementById('editarMsgError').classList.add('d-none');

  if (_editarUsaSubs) {
    // Cargar subcategorías del juego desde la API de atracciones
    try {
      const res  = await fetch(`/api/atracciones/${_editarAtraccionId}/subcategorias`);
      const subs = await res.json();
      selSub.innerHTML = subs.map(s =>
        `<option value="${s.id}" ${s.id === turno.subcategoria_id ? 'selected' : ''}>${escapeHtml(s.nombre)}</option>`
      ).join('');
      wrapSub.classList.remove('d-none');
    } catch (_) {
      wrapSub.classList.add('d-none');
    }
  } else {
    wrapSub.classList.add('d-none');
  }

  modalEditar().show();
}

document.getElementById('editarBtnMenos').addEventListener('click', () => {
  const el  = document.getElementById('editarInputMiembros');
  const min = parseInt(el.min) || 1;
  if (parseInt(el.value) > min) el.value = parseInt(el.value) - 1;
});
document.getElementById('editarBtnMas').addEventListener('click', () => {
  const el  = document.getElementById('editarInputMiembros');
  const max = parseInt(el.max) || 30;
  if (parseInt(el.value) < max) el.value = parseInt(el.value) + 1;
});
document.getElementById('btnCancelarEditar').addEventListener('click', () => {
  modalEditar().hide(); _editarTurnoId = null;
});
document.getElementById('btnCerrarModalEditar').addEventListener('click', () => {
  modalEditar().hide(); _editarTurnoId = null;
});

document.getElementById('btnConfirmarEditar').addEventListener('click', async () => {
  if (!_editarTurnoId) return;

  const cantidad_miembros = parseInt(document.getElementById('editarInputMiembros').value, 10);
  const msgEl = document.getElementById('editarMsgError');
  msgEl.classList.add('d-none');

  const body = { cantidad_miembros };
  if (_editarUsaSubs) {
    body.subcategoria_id = document.getElementById('editarSelectSubcategoria').value || null;
  }

  const btn = document.getElementById('btnConfirmarEditar');
  btn.disabled = true;
  try {
    const res  = await fetch(`/api/turnos/${_editarTurnoId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      msgEl.textContent = data.error || 'Error al guardar los cambios.';
      msgEl.classList.remove('d-none');
      return;
    }
    modalEditar().hide();
    _editarTurnoId = null;
    mostrarToast('✅ Turno actualizado correctamente', 'success');
    await cargarCola();
  } catch (_) {
    msgEl.textContent = 'Error de comunicación con el servidor.';
    msgEl.classList.remove('d-none');
  } finally {
    btn.disabled = false;
  }
});

// ── Eliminar turno en espera ──────────────────────────────────────────────────
let _eliminarTurnoId = null;
const modalEliminar  = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('modalEliminarTurno'));

function pedirEliminarTurno(id, nombreFamilia, nombreJuego, personas) {
  _eliminarTurnoId = id;
  document.getElementById('eliminarDetalleFamilia').textContent =
    `Familia: ${nombreFamilia} · ${personas} persona${personas !== 1 ? 's' : ''}`;
  document.getElementById('eliminarDetalleJuego').textContent = `Juego: ${nombreJuego}`;
  modalEliminar().show();
}

document.getElementById('btnConfEliminarNo').addEventListener('click', () => {
  modalEliminar().hide(); _eliminarTurnoId = null;
});

document.getElementById('btnConfEliminarSi').addEventListener('click', async () => {
  if (!_eliminarTurnoId) return;
  const btn = document.getElementById('btnConfEliminarSi');
  btn.disabled = true;
  try {
    const res  = await fetch(`/api/turnos/${_eliminarTurnoId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      modalEliminar().hide();
      mostrarToast(data.error || 'No se pudo eliminar el turno', 'danger');
    } else {
      modalEliminar().hide();
      mostrarToast('🗑️ Turno eliminado', 'success');
      await cargarCola();
    }
  } catch (_) {
    modalEliminar().hide();
    mostrarToast('Error de comunicación con el servidor.', 'danger');
  } finally {
    btn.disabled = false;
    _eliminarTurnoId = null;
  }
});

// ── Socket (actualización en tiempo real) ─────────────────────────────────────
socket.on('turno:nuevo',         () => cargarCola());
socket.on('turno:llamado',       () => cargarCola());
socket.on('turno:etapa_avanzada',() => cargarCola());
socket.on('turno:finalizado',    () => cargarCola());
socket.on('turno:reordenado',    () => cargarCola());
socket.on('turno:editado',       () => cargarCola());
socket.on('turno:eliminado',     () => cargarCola());
socket.on('juego:actualizado',   () => { cargarCola(); cargarAtracciones(); });

// ── Notificación de turno finalizado (enviada por operador) ───────────────────
socket.on('recepcion:notificacion', (data) => {
  if (!me || !['admin','recepcion'].includes(me.rol)) return;

  const siguienteTxt = data.siguiente
    ? `<div class="notif-siguiente">
         <i class="bi bi-arrow-right-circle me-1"></i>
         <strong>Siguiente:</strong> ${data.siguiente.nombre_cliente}
         &nbsp;·&nbsp; Beeper <strong>${data.siguiente.biper_numero}</strong>
         &nbsp;·&nbsp; ${data.siguiente.cantidad_miembros} persona${data.siguiente.cantidad_miembros !== 1 ? 's' : ''}
       </div>`
    : `<div class="notif-siguiente text-muted">
         <i class="bi bi-inbox me-1"></i>Sin grupos en espera para ${data.atraccion}
       </div>`;

  const toastId = 'notif-' + Date.now();
  document.getElementById('toastContainer').insertAdjacentHTML('beforeend', `
    <div id="${toastId}" class="toast notif-operador border-0" role="alert" aria-live="assertive">
      <div class="toast-header notif-header border-0">
        <i class="bi bi-person-check-fill me-2"></i>
        <strong class="me-auto">Turno finalizado — ${data.atraccion}</strong>
        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast"></button>
      </div>
      <div class="toast-body">
        <span class="notif-op">Op. ${data.operador}</span> finalizó a
        <strong>${data.familiaFinalizada}</strong>
        (Beeper&nbsp;<strong>${data.biper_finalizado}</strong>)
        ${siguienteTxt}
      </div>
    </div>`);

  const el = document.getElementById(toastId);
  new bootstrap.Toast(el, { delay: 9000 }).show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
});

// ── Toast ─────────────────────────────────────────────────────────────────────
// Tope de carteles visibles a la vez — si clickeás rápido y seguido un botón
// que siempre da el mismo error, no queda una fila de carteles tapando la
// pantalla: al llegar al tope, se saca el más viejo antes de mostrar el nuevo.
const TOAST_MAX_VISIBLES = 2;

function mostrarToast(mensaje, tipo = 'success') {
  const container = document.getElementById('toastContainer');

  const visibles = Array.from(container.children);
  while (visibles.length >= TOAST_MAX_VISIBLES) {
    const masViejo = visibles.shift();
    const inst = bootstrap.Toast.getInstance(masViejo);
    if (inst) inst.hide(); else masViejo.remove();
  }

  const id  = 'toast-' + Date.now();
  // Fondos claros (warning/info) llevan texto y botón de cierre oscuros para que se lean.
  const claro = tipo === 'warning' || tipo === 'info';
  const col = { success:'bg-success', danger:'bg-danger', warning:'bg-warning', info:'bg-info' }[tipo] || 'bg-secondary';
  container.insertAdjacentHTML('beforeend', `
    <div id="${id}" class="toast align-items-center ${col} ${claro ? 'text-dark' : 'text-white'} border-0 shadow" role="alert">
      <div class="d-flex">
        <div class="toast-body fw-semibold">${mensaje}</div>
        <button type="button" class="btn-close ${claro ? '' : 'btn-close-white'} me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>`);
  const el = document.getElementById(id);
  new bootstrap.Toast(el, { delay: 4000 }).show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}

init();
