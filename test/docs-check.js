import fs from 'node:fs';
import assert from 'node:assert/strict';
const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
for (const phrase of ['psjamesh/agent-wrangler-logins', '^1.48.0', 'Default', 'Add login', 'Paste token', 'Forget', 'Remove', 'AW_DATA_DIR', '0600', 'resume', 'fork', 'reconnect', 'uninstall', 'AW_HOST_CHECKOUT']) assert.ok(readme.includes(phrase), `Missing documentation: ${phrase}`);
for (const [, target] of readme.matchAll(/\]\(([^)]+)\)/g)) if (!target.includes('://')) assert.ok(fs.existsSync(new URL(`../${target}`, import.meta.url)), `Broken link: ${target}`);
console.log('Product documentation and local links checked');
