'use strict';
// Writes a .env with freshly generated random secrets for `docker compose -f docker-compose.unified.yml up`.
// Refuses to overwrite an existing .env (delete it first if you really want new secrets: sessions and saved
// admin-pasted API keys encrypted with the old PORTAL_SECRETS_ENCRYPTION_KEY would stop working).
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const target = path.join(__dirname, '..', '.env');
if (fs.existsSync(target)) { console.error('.env already exists - not overwriting it.'); process.exit(1); }
const r = () => crypto.randomBytes(32).toString('hex');
const lines = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'PORTAL_SECRETS_ENCRYPTION_KEY', 'AI_ML_SERVICE_TOKEN', 'OPERATIONS_TOKEN', 'BRIDGE_SERVICE_SECRET'].map((k) => `${k}=${r()}`);
lines.push('CORS_ORIGIN=http://localhost:3000', 'PORTAL_ADMIN_EMAIL=', 'PORTAL_ADMIN_PASSWORD=', 'GROQ_API_KEY=', 'GEMINI_API_KEY=');
fs.writeFileSync(target, lines.join('\n') + '\n', { flag: 'wx', mode: 0o600 });
console.log('Wrote .env with generated secrets. Set PORTAL_ADMIN_EMAIL / PORTAL_ADMIN_PASSWORD (and optionally GROQ_API_KEY / GEMINI_API_KEY) in it.');
