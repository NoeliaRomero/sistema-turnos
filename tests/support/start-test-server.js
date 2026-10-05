'use strict';

/**
 * E2E web server launcher (used by playwright.config.ts → webServer.command).
 *
 * Playwright starts the webServer BEFORE globalSetup runs, so the isolated data
 * folder has to be prepared here, right before the app opens its database:
 *
 *   1. Wipe and recreate tests/.db (every run starts from a fresh, seeded DB).
 *   2. Write a fixed installation id and a license signed for it with the
 *      developer key (tools/private.pem) — the same thing
 *      tools/generar-licencia.js + "Activar licencia" do, but only inside the
 *      isolated test folder. The real db/ folder is never touched.
 *   3. Point every runtime path at that folder (SISTEMA_DB_DIR covers the DB,
 *      session.key, license.lic, install.id and server.port) and start server.js.
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const ROOT        = path.resolve(__dirname, '..', '..');
const DATA_DIR    = path.join(ROOT, 'tests', '.db');
const BACKUP_DIR  = path.join(DATA_DIR, 'backups');
const PRIVATE_KEY = path.join(ROOT, 'tools', 'private.pem');
const INSTALL_ID  = 'E2E00000-PLAYWRIG-HTTESTDB-00000000';

// Safety net: never let this script run against the real data folder.
if (path.resolve(DATA_DIR) === path.resolve(ROOT, 'db')) {
  throw new Error('Refusing to reset the real db/ folder');
}

fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

if (!fs.existsSync(PRIVATE_KEY)) {
  console.error('[e2e] tools/private.pem not found: cannot sign a test license.');
  console.error('[e2e] Every /api route except auth/licencia/superadmin returns 403 without a license.');
  process.exit(1);
}

const payload = {
  installation_id: INSTALL_ID,
  customer_name:   'Playwright E2E',
  issued_at:       new Date().toISOString(),
  expires_at:      null,
  plan:            'full',
  max_sessions:    20,
};
const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
const signer     = crypto.createSign('RSA-SHA256');
signer.update(payloadB64);
signer.end();
const signature  = signer.sign(fs.readFileSync(PRIVATE_KEY, 'utf8')).toString('base64url');

fs.writeFileSync(path.join(DATA_DIR, 'install.id'), INSTALL_ID, 'utf8');
fs.writeFileSync(path.join(DATA_DIR, 'license.lic'), `${payloadB64}.${signature}`, 'utf8');

process.env.SISTEMA_DB_DIR     = DATA_DIR;
process.env.SISTEMA_BACKUP_DIR = BACKUP_DIR;
process.env.PORT               = process.env.PORT || '3999';

require(path.join(ROOT, 'server.js'));
