#!/usr/bin/env node
/**
 * Herramienta de desarrollador — generador de licencias.
 *
 * USO:
 *   node tools/generar-licencia.js \
 *     --id    XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX  \
 *     --cliente "Nombre del Cliente SRL"            \
 *     [--vence  2027-08-10]                         \
 *     [--plan   full]                               \
 *     [--sesiones 20]
 *
 * El --id es el Installation ID que aparece en el panel Superadmin del cliente.
 * Si --vence se omite, la licencia es perpetua.
 * Planes disponibles: full, basic
 *
 * REQUIERE: tools/private.pem (clave privada RSA, NUNCA en el repositorio).
 */

'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

// ── Clave privada ─────────────────────────────────────────────────────────────
const PRIVATE_KEY_PATH = path.join(__dirname, 'private.pem');
if (!fs.existsSync(PRIVATE_KEY_PATH)) {
  console.error('❌ No se encontró tools/private.pem');
  console.error('   Ejecutar primero: node tools/generar-claves.js');
  process.exit(1);
}
const PRIVATE_KEY = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');

// ── Helpers CLI ───────────────────────────────────────────────────────────────
const args   = process.argv.slice(2);
const getArg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

const installId = getArg('--id');
const cliente   = getArg('--cliente');
const vence     = getArg('--vence');    // YYYY-MM-DD o null (perpetua)
const plan      = getArg('--plan') || 'full';
const sesiones  = parseInt(getArg('--sesiones') || '20', 10);

if (!installId || !cliente) {
  console.error('');
  console.error('Uso:');
  console.error('  node tools/generar-licencia.js \\');
  console.error('    --id    XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX \\');
  console.error('    --cliente "Nombre del Cliente" \\');
  console.error('    [--vence 2027-08-10] \\');
  console.error('    [--plan full|basic] \\');
  console.error('    [--sesiones 20]');
  console.error('');
  process.exit(1);
}

if (!['full', 'basic'].includes(plan)) {
  console.error('❌ Plan inválido. Opciones: full, basic');
  process.exit(1);
}

// ── Construir payload ─────────────────────────────────────────────────────────
const payload = {
  installation_id: installId.toUpperCase().trim(),
  customer_name:   cliente.trim(),
  issued_at:       new Date().toISOString(),
  expires_at:      vence ? new Date(vence + 'T23:59:59.000Z').toISOString() : null,
  plan,
  max_sessions:    sesiones,
};

const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');

// ── Firmar ────────────────────────────────────────────────────────────────────
const sign = crypto.createSign('RSA-SHA256');
sign.update(payloadB64);
sign.end();
const firma = sign.sign(PRIVATE_KEY).toString('base64url');

const licenciaStr = `${payloadB64}.${firma}`;

// ── Salida ────────────────────────────────────────────────────────────────────
const nombreArchivo = `licencia_${installId.replace(/-/g,'').slice(0,8)}_${Date.now()}.lic`;
const rutaSalida    = path.join(__dirname, nombreArchivo);
fs.writeFileSync(rutaSalida, licenciaStr, 'utf8');

console.log('');
console.log('✅ Licencia generada:');
console.log('');
console.log('  Cliente:        ', payload.customer_name);
console.log('  Installation ID:', payload.installation_id);
console.log('  Emitida:        ', payload.issued_at);
console.log('  Vence:          ', payload.expires_at || '(perpetua)');
console.log('  Plan:           ', payload.plan);
console.log('  Sesiones máx:  ', payload.max_sessions);
console.log('');
console.log('  Archivo:', rutaSalida);
console.log('');
console.log('=== CADENA DE LICENCIA (pegar en el panel Superadmin) ===');
console.log('');
console.log(licenciaStr);
console.log('');
console.log('=========================================================');
