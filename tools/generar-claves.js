#!/usr/bin/env node
/**
 * Herramienta de desarrollador — ONE-TIME use.
 * Genera el par de claves RSA-2048 para el sistema de licencias.
 *
 * USO: node tools/generar-claves.js
 *
 * Salida:
 *   tools/private.pem  → clave privada (NUNCA commitear, NUNCA enviar al cliente)
 *   Imprime la clave pública para copiar en routes/licencia.js
 *
 * IMPORTANTE: Guardar tools/private.pem en un lugar seguro fuera del repositorio.
 */

'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const OUT = path.join(__dirname, 'private.pem');

if (fs.existsSync(OUT)) {
  console.error('⚠️  tools/private.pem ya existe. Eliminarlo manualmente antes de regenerar.');
  process.exit(1);
}

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength:      2048,
  publicKeyEncoding:  { type: 'spki',  format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

fs.writeFileSync(OUT, privateKey, { mode: 0o600 });

console.log('✅ Clave privada guardada en tools/private.pem');
console.log('   ⚠️  Guardar en lugar seguro. NUNCA commitear.');
console.log('');
console.log('=== CLAVE PÚBLICA — copiar en routes/licencia.js (constante PUBLIC_KEY) ===');
console.log('');
console.log(publicKey);
console.log('=============================================================================');
