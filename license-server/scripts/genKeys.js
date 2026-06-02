/**
 * genKeys.js
 * Genera el par de claves RSA para firmar JWTs de licencias.
 *
 * Usar UNA sola vez:
 *   node license-server/scripts/genKeys.js
 *
 * Salida:
 *   private.key  → va al servidor de licencias (.env como JWT_PRIVATE_KEY)
 *   public.key   → va al cliente Electron (electron/license.js → JWT_PUBLIC_KEY)
 */

const { generateKeyPairSync } = require('crypto');
const fs   = require('fs');
const path = require('path');

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength:      2048,
  publicKeyEncoding:  { type: 'spki',  format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const outDir = path.join(__dirname, '../../keys');
fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(path.join(outDir, 'private.key'), privateKey);
fs.writeFileSync(path.join(outDir, 'public.key'),  publicKey);

console.log('✅ Par de claves RSA generado en /keys/');
console.log('');
console.log('── CLAVE PRIVADA (va a .env del servidor de licencias) ──────────────');
console.log('JWT_PRIVATE_KEY=' + JSON.stringify(privateKey));
console.log('');
console.log('── CLAVE PÚBLICA (va a electron/license.js → JWT_PUBLIC_KEY) ────────');
console.log(publicKey);
console.log('');
console.log('⚠️  Guardá la clave privada en un lugar seguro. No la subas a GitHub.');
