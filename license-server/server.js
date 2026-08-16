/**
 * Servidor de Licencias — se despliega en Railway / Render / VPS
 * Completamente independiente del sistema de turnos.
 *
 * Variables de entorno requeridas (.env):
 *   JWT_PRIVATE_KEY     — Clave privada RSA (RS256) para firmar tokens
 *   ADMIN_JWT_SECRET    — Secreto para JWT del panel de admin
 *   LICENSE_ADMIN_PASS  — Contraseña del admindevadmin (solo primer run)
 *   PORT                — Puerto (default 4000)
 *   DB_PATH             — Ruta al archivo SQLite (default ./data/licenses.db)
 */

require('dotenv').config();

const express    = require('express');
const app        = express();
const PORT       = process.env.PORT || 4000;

app.use(express.json());

// Rate limiting básico (instalar: npm i express-rate-limit)
try {
  const rateLimit = require('express-rate-limit');
  app.use('/api/licenses/validate', rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 20,
    message: { ok: false, error: 'TOO_MANY_REQUESTS' },
  }));
} catch { /* opcional */ }

// Rutas
app.use('/api/licenses', require('./routes/licenses'));

// Health check
app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`[LicenseServer] Escuchando en puerto ${PORT}`);
});
