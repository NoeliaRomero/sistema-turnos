/**
 * demo-panel.js — Banner y panel de control para la versión demo
 * Se incluye en todas las páginas HTML de la rama demo-cliente.
 */
(async () => {
  // Verificar que estamos en modo demo
  let demoStatus = null;
  try {
    const r = await fetch('/api/demo/status');
    demoStatus = r.ok ? await r.json() : null;
  } catch (_) { return; }
  if (!demoStatus?.demo) return;

  // Verificar sesión del usuario (puede ser null en páginas públicas)
  let me = null;
  try {
    const r = await fetch('/api/auth/me');
    if (r.ok) me = await r.json();
  } catch (_) {}

  // ── CSS ───────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    /* ── Banner demo ── */
    #demo-banner {
      position: fixed; top: 0; left: 0; right: 0; z-index: 10000;
      height: 38px;
      background: linear-gradient(90deg, #92400e 0%, #b45309 50%, #92400e 100%);
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      font-family: 'Segoe UI', system-ui, sans-serif;
      font-size: 13px;
      color: #fef3c7;
    }
    #demo-banner .db-left {
      display: flex; align-items: center; gap: 10px;
    }
    #demo-banner .db-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #fbbf24;
      animation: db-pulse 2s ease infinite;
      flex-shrink: 0;
    }
    @keyframes db-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.6;transform:scale(1.3)} }
    #demo-banner .db-label {
      font-weight: 700; letter-spacing: 1px; text-transform: uppercase; font-size: 11px;
      color: #fbbf24;
    }
    #demo-banner .db-text {
      color: rgba(254,243,199,.8); font-size: 12px;
    }
    #demo-banner .db-right {
      display: flex; align-items: center; gap: 8px;
    }
    #demo-banner .db-creds {
      font-size: 11px; color: rgba(254,243,199,.7);
      background: rgba(0,0,0,.2); border-radius: 6px; padding: 3px 10px;
    }
    #demo-banner .db-creds strong { color: #fef3c7; }
    #demo-btn-panel {
      background: rgba(0,0,0,.25); border: 1px solid rgba(254,243,199,.3);
      color: #fef3c7; border-radius: 6px; padding: 3px 12px;
      font-size: 11px; font-weight: 700; cursor: pointer;
      text-transform: uppercase; letter-spacing: .5px;
      transition: background .2s;
    }
    #demo-btn-panel:hover { background: rgba(0,0,0,.45); }

    /* ── Ajuste de body para el banner ── */
    body { padding-top: 38px !important; }
    /* Excepción: cola.html usa overflow hidden y height 100vh */
    body.cola-body { height: calc(100vh - 38px) !important; }

    /* ── Modal del panel de control ── */
    #demo-modal-backdrop {
      display: none; position: fixed; inset: 0; z-index: 11000;
      background: rgba(0,0,0,.55); align-items: flex-end; justify-content: center;
    }
    #demo-modal-backdrop.open { display: flex; }
    #demo-modal {
      background: #1e293b; color: #f1f5f9;
      border-radius: 20px 20px 0 0;
      padding: 28px 28px 36px;
      width: 100%; max-width: 520px;
      box-shadow: 0 -8px 40px rgba(0,0,0,.4);
      font-family: 'Segoe UI', system-ui, sans-serif;
      animation: dm-slide-up .25s ease;
    }
    @keyframes dm-slide-up { from{transform:translateY(100%)} to{transform:translateY(0)} }
    #demo-modal .dm-header {
      display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;
    }
    #demo-modal .dm-title {
      font-size: 1.1rem; font-weight: 800; letter-spacing: 1px;
      text-transform: uppercase; color: #fbbf24;
    }
    #demo-modal .dm-close {
      background: rgba(255,255,255,.1); border: none; color: #94a3b8;
      width: 32px; height: 32px; border-radius: 50%; cursor: pointer;
      font-size: 18px; display: flex; align-items: center; justify-content: center;
      transition: background .2s;
    }
    #demo-modal .dm-close:hover { background: rgba(255,255,255,.2); color: #f1f5f9; }
    #demo-modal .dm-section {
      font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase;
      color: #64748b; margin: 20px 0 10px;
    }
    #demo-modal .dm-btn {
      display: flex; align-items: center; gap: 14px;
      width: 100%; background: rgba(255,255,255,.06);
      border: 1px solid rgba(255,255,255,.1); border-radius: 12px;
      padding: 14px 18px; margin-bottom: 10px; cursor: pointer;
      color: #f1f5f9; text-align: left; transition: background .15s, border-color .15s;
    }
    #demo-modal .dm-btn:hover { background: rgba(255,255,255,.1); border-color: rgba(255,255,255,.2); }
    #demo-modal .dm-btn-icon {
      width: 40px; height: 40px; border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; flex-shrink: 0;
    }
    #demo-modal .dm-btn-info .dm-btn-title { font-weight: 700; font-size: .95rem; }
    #demo-modal .dm-btn-info .dm-btn-desc  { font-size: .78rem; color: #94a3b8; margin-top: 2px; }
    #demo-modal .dm-btn.danger { border-color: rgba(239,68,68,.3); }
    #demo-modal .dm-btn.danger:hover { background: rgba(239,68,68,.15); border-color: rgba(239,68,68,.5); }
    #demo-modal .dm-creds-box {
      background: rgba(251,191,36,.08); border: 1px solid rgba(251,191,36,.2);
      border-radius: 10px; padding: 14px 18px; margin-bottom: 10px;
      font-size: .82rem; color: #fef3c7;
    }
    #demo-modal .dm-creds-box .dm-cred-row {
      display: flex; gap: 10px; align-items: center; margin-bottom: 4px;
    }
    #demo-modal .dm-creds-box .dm-cred-role {
      width: 90px; color: #94a3b8; font-size: .75rem; flex-shrink: 0;
    }
    #demo-modal .dm-creds-box code {
      background: rgba(0,0,0,.3); padding: 1px 7px; border-radius: 4px;
      font-family: monospace; color: #fbbf24;
    }
    /* Toast demo */
    #demo-toast {
      position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
      background: #0f172a; color: #f1f5f9; padding: 12px 24px;
      border-radius: 10px; font-size: .88rem; font-weight: 600;
      box-shadow: 0 4px 20px rgba(0,0,0,.4); z-index: 12000;
      opacity: 0; transition: opacity .3s; pointer-events: none;
    }
    #demo-toast.show { opacity: 1; }
  `;
  document.head.appendChild(style);

  // ── Banner HTML ───────────────────────────────────────────────────────────
  const banner = document.createElement('div');
  banner.id = 'demo-banner';
  banner.innerHTML = `
    <div class="db-left">
      <div class="db-dot"></div>
      <span class="db-label">Demo</span>
      <span class="db-text">Sistema de demostración — los datos pueden restaurarse en cualquier momento</span>
    </div>
    <div class="db-right">
      <span class="db-creds">
        <strong>demo</strong> / demo123
      </span>
      ${me ? `<button id="demo-btn-panel">⚙ Panel Demo</button>` : ''}
    </div>
  `;
  document.body.prepend(banner);

  if (!me) return; // Sin sesión no mostramos el panel

  // ── Toast ─────────────────────────────────────────────────────────────────
  const toast = document.createElement('div');
  toast.id = 'demo-toast';
  document.body.appendChild(toast);

  function showToast(msg, durationMs = 3000) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), durationMs);
  }

  // ── Modal HTML ────────────────────────────────────────────────────────────
  const backdrop = document.createElement('div');
  backdrop.id = 'demo-modal-backdrop';
  backdrop.innerHTML = `
    <div id="demo-modal">
      <div class="dm-header">
        <span class="dm-title">🎭 Panel de Control Demo</span>
        <button class="dm-close" id="dm-close-btn">✕</button>
      </div>

      <div class="dm-creds-box">
        <div class="dm-cred-row"><span class="dm-cred-role">Admin Demo</span><code>demo</code> / <code>demo123</code></div>
        <div class="dm-cred-row"><span class="dm-cred-role">Operador</span><code>carlos_op</code> / <code>demo123</code></div>
        <div class="dm-cred-row"><span class="dm-cred-role">Recepción</span><code>maria_rec</code> / <code>demo123</code></div>
      </div>

      <div class="dm-section">Simulaciones de estado</div>

      <button class="dm-btn" id="dm-btn-lleno">
        <div class="dm-btn-icon" style="background:rgba(239,68,68,.2)">🔥</div>
        <div class="dm-btn-info">
          <div class="dm-btn-title">Simular parque lleno</div>
          <div class="dm-btn-desc">Agrega grupos en espera a todos los juegos</div>
        </div>
      </button>

      <button class="dm-btn" id="dm-btn-tranquilo">
        <div class="dm-btn-icon" style="background:rgba(16,185,129,.2)">😌</div>
        <div class="dm-btn-info">
          <div class="dm-btn-title">Simular parque tranquilo</div>
          <div class="dm-btn-desc">Reduce la cola a pocos grupos</div>
        </div>
      </button>

      <button class="dm-btn" id="dm-btn-nuevos">
        <div class="dm-btn-icon" style="background:rgba(59,130,246,.2)">➕</div>
        <div class="dm-btn-info">
          <div class="dm-btn-title">Agregar nuevos grupos</div>
          <div class="dm-btn-desc">Genera 2–3 grupos en espera por juego</div>
        </div>
      </button>

      <button class="dm-btn" id="dm-btn-vaciar">
        <div class="dm-btn-icon" style="background:rgba(251,191,36,.2)">🧹</div>
        <div class="dm-btn-info">
          <div class="dm-btn-title">Vaciar colas de espera</div>
          <div class="dm-btn-desc">Elimina todos los grupos en espera</div>
        </div>
      </button>

      <div class="dm-section">Restaurar</div>

      <button class="dm-btn danger" id="dm-btn-reset">
        <div class="dm-btn-icon" style="background:rgba(239,68,68,.2)">🔄</div>
        <div class="dm-btn-info">
          <div class="dm-btn-title">Restablecer Demo</div>
          <div class="dm-btn-desc">Borra todo y vuelve al estado inicial del primer día</div>
        </div>
      </button>
    </div>
  `;
  document.body.appendChild(backdrop);

  // ── Abrir / cerrar ────────────────────────────────────────────────────────
  function openPanel() { backdrop.classList.add('open'); }
  function closePanel() { backdrop.classList.remove('open'); }

  document.getElementById('demo-btn-panel')?.addEventListener('click', openPanel);
  document.getElementById('dm-close-btn').addEventListener('click', closePanel);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) closePanel(); });

  // ── Acciones ──────────────────────────────────────────────────────────────
  async function demoAction(endpoint, confirmMsg, successMsg, loadingMsg = 'Procesando…') {
    if (confirmMsg && !confirm(confirmMsg)) return;
    closePanel();
    showToast(loadingMsg, 8000);
    try {
      const r = await fetch(`/api/demo/${endpoint}`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) { showToast('❌ ' + (d.error || 'Error'), 4000); return; }
      showToast(successMsg);
      // Recargar si es reset para reflejar estado limpio
      if (endpoint === 'reset') {
        setTimeout(() => window.location.href = '/admin.html', 1500);
      }
    } catch (err) {
      showToast('❌ Error de conexión', 4000);
    }
  }

  document.getElementById('dm-btn-reset').addEventListener('click', () =>
    demoAction('reset',
      '⚠️ Esto borrará TODOS los datos creados durante la demo y restaurará el estado inicial.\n\n¿Continuar?',
      '✅ Demo restaurada. Redirigiendo…',
      '🔄 Restaurando demo…'
    )
  );

  document.getElementById('dm-btn-lleno').addEventListener('click', () =>
    demoAction('simular/lleno', null, '🔥 ¡Parque lleno! Colas actualizadas.', '⏳ Generando grupos…')
  );

  document.getElementById('dm-btn-tranquilo').addEventListener('click', () =>
    demoAction('simular/tranquilo', null, '😌 Colas reducidas. Parque tranquilo.', '⏳ Ajustando colas…')
  );

  document.getElementById('dm-btn-nuevos').addEventListener('click', () =>
    demoAction('nuevos-turnos', null, '✅ Nuevos grupos agregados a las colas.', '⏳ Generando grupos…')
  );

  document.getElementById('dm-btn-vaciar').addEventListener('click', () =>
    demoAction('vaciar-colas',
      '¿Vaciar todas las colas de espera? Los grupos jugando no se verán afectados.',
      '🧹 Colas vaciadas.',
      '⏳ Vaciando colas…'
    )
  );
})();
