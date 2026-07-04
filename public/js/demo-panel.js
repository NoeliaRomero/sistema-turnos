/**
 * demo-panel.js — Indicador visual discreto para la versión demo.
 */
(async () => {
  let demoStatus = null;
  try {
    const r = await fetch('/api/demo/status');
    demoStatus = r.ok ? await r.json() : null;
  } catch (_) { return; }
  if (!demoStatus?.demo) return;

  const style = document.createElement('style');
  style.textContent = `
    #demo-badge {
      position: fixed; top: 8px; right: 14px; z-index: 10000;
      background: rgba(146,64,14,.85); color: #fef3c7;
      font-family: 'Segoe UI', system-ui, sans-serif;
      font-size: 10px; font-weight: 700; letter-spacing: 1.5px;
      text-transform: uppercase; padding: 3px 10px;
      border-radius: 20px; pointer-events: none;
      box-shadow: 0 1px 4px rgba(0,0,0,.25);
    }
  `;
  document.head.appendChild(style);

  const badge = document.createElement('div');
  badge.id = 'demo-badge';
  badge.textContent = 'Demo';
  document.body.appendChild(badge);
})();
