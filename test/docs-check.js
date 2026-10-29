import fs from 'node:fs';
import assert from 'node:assert/strict';
const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
for (const phrase of ['psjamesh/agent-wrangler-logins', 'macOS', '^1.54.0', 'Default', 'Add login', 'Reopen terminal', 'CLAUDE_CONFIG_DIR', 'CLAUDE_SECURESTORAGE_CONFIG_DIR', '.credentials.json', 'Forget', 'Remove', 'AW_DATA_DIR', 'resume', 'fork', 'reconnect', 'uninstall', 'AW_HOST_CHECKOUT', 'sessions:read', 'managed-settings.json', 'settings.local.json', 'apiKeyHelper', 'Acceptance on an installed package', 'Locked Keychain', 'Plaintext fallback', 'Resume and fork', 'cli_auth_credentials_store', 'codex-home/auth.json', 'Codex keyring sign-in']) assert.ok(readme.includes(phrase), `Missing documentation: ${phrase}`);
for (const phrase of ['Paste token', 'setup-token', 'CLAUDE_CODE_OAUTH_TOKEN=', 'Claude settings files are not checked yet', 'Codex email', 'mirror home']) assert.ok(!readme.includes(phrase), `Stale documentation: ${phrase}`);
for (const [, target] of readme.matchAll(/\]\(([^)]+)\)/g)) if (!target.includes('://') && !target.startsWith('#')) assert.ok(fs.existsSync(new URL(`../${target}`, import.meta.url)), `Broken link: ${target}`);
console.log('Product documentation and local links checked');
