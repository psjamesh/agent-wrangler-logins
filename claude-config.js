import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expandHome, shellQuote, writeJsonAtomic } from './persistence.js';

export const SHARED = ['projects', 'sessions', 'skills', 'agents', 'commands', 'CLAUDE.md'];
export const REQUIRED = ['projects', 'sessions'];
export const NEVER_SHARED = ['.claude.json', '.credentials.json', 'settings.json', 'settings.local.json', 'remote-settings.json', 'policy-limits.json', 'daemon', 'jobs'];
export const SEEDED_SETTINGS = ['hooks', 'permissions', 'model', 'statusLine', 'enabledPlugins', 'extraKnownMarketplaces'];
export const AUTH_OVERRIDES = [
  'CLAUDE_SECURESTORAGE_CONFIG_DIR',
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
  'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_BEDROCK_BASE_URL', 'ANTHROPIC_VERTEX_BASE_URL', 'ANTHROPIC_FOUNDRY_BASE_URL', 'ANTHROPIC_FOUNDRY_RESOURCE',
  'ANTHROPIC_PROFILE', 'ANTHROPIC_CONFIG_DIR', 'ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_ORGANIZATION_ID',
];

export function defaultClaudeDir() {
  return path.resolve(expandHome(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')));
}

export function linkShared(dir, source = defaultClaudeDir()) {
  const result = { linked: [], conflicts: [], missing: [] };
  for (const name of SHARED) {
    if (NEVER_SHARED.includes(name)) throw new Error(`Refusing to share ${name}`);
    const target = path.join(source, name);
    const entry = path.join(dir, name);
    const existing = fs.lstatSync(entry, { throwIfNoEntry: false });
    if (existing) {
      if (!existing.isSymbolicLink() || fs.readlinkSync(entry) !== target) result.conflicts.push(name);
    } else if (!fs.existsSync(target)) result.missing.push(name);
    else { fs.symlinkSync(target, entry); result.linked.push(name); }
  }
  result.unready = REQUIRED.filter((name) => result.missing.includes(name) || result.conflicts.includes(name));
  return result;
}

export function seedSettings(dir, source = defaultClaudeDir()) {
  const file = path.join(dir, 'settings.json');
  if (fs.lstatSync(file, { throwIfNoEntry: false })) return false;
  const from = path.join(source, 'settings.json');
  let settings;
  try { settings = JSON.parse(fs.readFileSync(from, 'utf8')); }
  catch (err) {
    if (err.code === 'ENOENT') return false;
    throw new Error(`Cannot read ${from} to copy its settings`);
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error(`Cannot read ${from} to copy its settings`);
  const seeded = Object.fromEntries(SEEDED_SETTINGS.filter((key) => Object.hasOwn(settings, key)).map((key) => [key, settings[key]]));
  writeJsonAtomic(file, seeded);
  return true;
}

export function plaintextCredentials(dir) {
  return !!fs.lstatSync(path.join(dir, '.credentials.json'), { throwIfNoEntry: false });
}

export function overridesIn(env) {
  return AUTH_OVERRIDES.filter((name) => env[name] !== undefined);
}

export function loginCommand(dir) {
  const check = `set -- $(env | cut -d= -f1 | grep -xE "${AUTH_OVERRIDES.join('|')}"); [ $# -eq 0 ] || { echo "Logins refused: unset $* first" >&2; exit 1; }`;
  return `/bin/sh -c ${shellQuote(check)} && CLAUDE_CONFIG_DIR=${shellQuote(dir)} claude`;
}
