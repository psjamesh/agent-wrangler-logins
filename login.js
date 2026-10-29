import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { overridesIn } from './claude-config.js';
import { CODEX_CONFIG } from './codex-mirror.js';

const [provider, dir, ...extra] = process.argv.slice(2);
if (!['claude', 'codex'].includes(provider) || !dir || !path.isAbsolute(dir) || extra.length) {
  console.error('Usage: login.js <claude|codex> <absolute login folder>');
  process.exit(1);
}
if (provider === 'claude') {
  const overrides = overridesIn(process.env);
  if (overrides.length) {
    console.error(`Logins refused: unset ${overrides.join(' ')} first`);
    process.exit(1);
  }
}

const label = provider === 'claude' ? 'Claude' : 'Codex';
const env = { ...process.env, [provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME']: dir };
const prefix = provider === 'claude' ? [] : Object.entries(CODEX_CONFIG).flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`]);

function run(args, step) {
  const result = spawnSync(provider, [...prefix, ...args], { env, stdio: 'inherit' });
  if (result.error) {
    console.error(result.error.code === 'ENOENT'
      ? `${label} not found on this terminal's PATH. Install the CLI or update your shell PATH, then retry.`
      : `${label} ${step} could not start (${result.error.code}).`);
    process.exit(result.error.code === 'ENOENT' ? 127 : 1);
  }
  if (result.signal || result.status !== 0) {
    const code = result.status ?? (128 + (os.constants.signals[result.signal] || 1));
    console.error(`${label} ${step} failed (${result.signal || `exit ${code}`}). Authentication was not verified. Retry the launcher to try again.`);
    process.exit(code);
  }
}

if (provider === 'claude') {
  console.log('Claude sign-in: choose Claude account with subscription for Pro, Max, Team, or Enterprise. No API key is needed.');
  console.log('Complete sign-in in Claude, then type /exit to return here and check authentication status.');
} else console.log('Codex sign-in: opening the dedicated login flow…');
run(provider === 'claude' ? [] : ['login'], 'sign-in');
console.log(`${label} sign-in finished. Checking authentication status…`);
run(provider === 'claude' ? ['auth', 'status', '--text'] : ['login', 'status'], 'authentication status check');
