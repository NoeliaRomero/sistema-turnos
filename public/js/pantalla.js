const socket = io();

const HISTORIAL_MAX = 8;
let historial = [];

// ── Reloj ─────────────────────────────────────────────────────────────────────
function tickReloj() {
  document.getElementById('clock').textContent =
    new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
tickReloj();
setInterval(tickReloj, 1000);

// ── Sonido de llamada (beep sintético) ────────────────────────────────────────
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notas = [880, 1100, 880];
    notas.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.18);
      gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + i * 0.18 + 0.04);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + i * 0.18 + 0.16);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.2);
    });
  } catch (_) {}
}

// ── Flash de pantalla ─────────────────────────────────────────────────────────
function flashPantalla() {
  const el = document.getElementById('flash');
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 300);
}

// ── Mostrar turno llamado ─────────────────────────────────────────────────────
function mostrarTurno(turno) {
  document.getElementById('sinTurnos').style.display   = 'none';
  const area = document.getElementById('turnoActual');
  area.style.display = 'block';

  document.getElementById('dispBiper').textContent    = turno.biper_numero;
  document.getElementById('dispNombre').textContent   = turno.nombre_cliente || '';
  document.getElementById('dispAtraccion').textContent = turno.atraccion_nombre;

  // Reiniciar animación
  area.classList.remove('pulse');
  void area.offsetWidth;
  area.classList.add('pulse');

  beep();
  flashPantalla();

  // Agregar al historial
  historial = historial.filter(h => h.id !== turno.id);
  historial.unshift(turno);
  if (historial.length > HISTORIAL_MAX) historial.pop();
  renderHistorial();
}

// ── Historial ─────────────────────────────────────────────────────────────────
function renderHistorial() {
  const cont = document.getElementById('historial');
  if (historial.length === 0) {
    cont.innerHTML = '<span style="color:rgba(255,255,255,0.2); font-size:.9rem;">Sin historial aún</span>';
    return;
  }
  cont.innerHTML = historial.map((t, i) => `
    <div class="hist-chip ${i === 0 ? 'active' : ''}">
      <span class="hn">${t.biper_numero}</span>
      ${t.nombre_cliente ? `<span style="margin-left:6px;font-size:.85rem;">${t.nombre_cliente}</span>` : ''}
    </div>
  `).join('');
}

// ── Socket ────────────────────────────────────────────────────────────────────
socket.on('turno:llamado', (turno) => {
  mostrarTurno(turno);
});

socket.on('turno:finalizado', (turno) => {
  // Si el turno finalizado es el que se está mostrando, volver a sin-turno
  const dispBiper = document.getElementById('dispBiper').textContent;
  if (dispBiper === String(turno.biper_numero)) {
    // Mostrar el último del historial si hay más
    const siguiente = historial.find(h => h.id !== turno.id);
    if (siguiente) {
      mostrarTurno(siguiente);
    } else {
      document.getElementById('turnoActual').style.display = 'none';
      document.getElementById('sinTurnos').style.display   = 'block';
    }
  }
  historial = historial.filter(h => h.id !== turno.id);
  renderHistorial();
});
