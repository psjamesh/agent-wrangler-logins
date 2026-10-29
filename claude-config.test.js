import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SHARED, NEVER_SHARED, AUTH_OVERRIDES, linkShared, seedSettings, plaintextCredentials, overridesIn } from './claude-config.js';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-claude-config-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'default'); const dir = path.join(root, 'login');
  fs.mkdirSync(dir);
  for (const name of ['projects', 'sessions', 'skills', 'agents', 'commands', 'plugins', 'daemon', 'jobs']) fs.mkdirSync(path.join(source, name), { recursive: true });
  for (const name of ['.claude.json', '.credentials.json', 'remote-settings.json', 'policy-limits.json', 'settings.local.json', 'CLAUDE.md']) fs.writeFileSync(path.join(source, name), 'fixture-private');
  fs.writeFileSync(path.join(source, 'settings.json'), JSON.stringify({
    hooks: { Stop: [] }, permissions: { allow: ['Bash(ls)'] }, model: 'opus', statusLine: { type: 'command', command: 'true' },
    enabledPlugins: { 'p@m': true }, extraKnownMarketplaces: { m: {} },
    env: { ANTHROPIC_API_KEY: 'fixture-private' }, apiKeyHelper: '/bin/fixture-private', mcpServers: { s: {} }, theme: 'dark',
  }));
  return { source, dir };
}

test('shared links follow the table and identity files are never shared', (t) => {
  const { source, dir } = fixture(t);
  assert.equal(seedSettings(dir, source), true);
  const result = linkShared(dir, source);
  assert.deepEqual(result.linked, SHARED);
  assert.deepEqual(result.unready, []);
  for (const name of SHARED) assert.equal(fs.readlinkSync(path.join(dir, name)), path.join(source, name), name);
  assert.deepEqual(fs.readdirSync(dir).sort(), [...SHARED, 'settings.json'].sort());
  assert.equal(fs.existsSync(path.join(dir, 'plugins')), false);
  for (const name of NEVER_SHARED) {
    assert.ok(!SHARED.includes(name), name);
    const entry = fs.lstatSync(path.join(dir, name), { throwIfNoEntry: false });
    assert.ok(!entry || (entry.isFile() && !entry.isSymbolicLink()), name);
  }
  assert.ok(!fs.readFileSync(path.join(dir, 'settings.json'), 'utf8').includes('fixture-private'));
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))), ['hooks', 'permissions', 'model', 'statusLine', 'enabledPlugins', 'extraKnownMarketplaces']);
  assert.deepEqual(linkShared(dir, source), { linked: [], conflicts: [], missing: [], unready: [] });
});

test('settings are seeded once and never resynced; unreadable defaults refuse', (t) => {
  const { source, dir } = fixture(t);
  seedSettings(dir, source);
  fs.writeFileSync(path.join(source, 'settings.json'), JSON.stringify({ model: 'changed' }));
  assert.equal(seedSettings(dir, source), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).model, 'opus');
  const fresh = path.join(path.dirname(dir), 'fresh'); fs.mkdirSync(fresh);
  fs.writeFileSync(path.join(source, 'settings.json'), '{broken');
  assert.throws(() => seedSettings(fresh, source), /Cannot read .*settings\.json/);
  fs.writeFileSync(path.join(source, 'settings.json'), '[]');
  assert.throws(() => seedSettings(fresh, source), /Cannot read .*settings\.json/);
  fs.rmSync(path.join(source, 'settings.json'));
  assert.equal(seedSettings(fresh, source), false);
  assert.equal(fs.existsSync(path.join(fresh, 'settings.json')), false);
});

test('missing or replaced required links leave a login unready without touching the default folder', (t) => {
  const { source, dir } = fixture(t);
  fs.rmSync(path.join(source, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'projects'));
  const result = linkShared(dir, source);
  assert.deepEqual(result.unready, ['projects', 'sessions']);
  assert.deepEqual(result.conflicts, ['projects']);
  assert.deepEqual(result.missing, ['sessions']);
  assert.equal(fs.existsSync(path.join(source, 'sessions')), false);
  assert.equal(fs.lstatSync(path.join(dir, 'projects')).isDirectory(), true);
});

test('plaintext credentials are detected without being opened', (t) => {
  const { dir } = fixture(t);
  assert.equal(plaintextCredentials(dir), false);
  fs.writeFileSync(path.join(dir, '.credentials.json'), 'fixture-private', { mode: 0o000 });
  assert.equal(plaintextCredentials(dir), true);
  fs.rmSync(path.join(dir, '.credentials.json'));
  fs.symlinkSync(path.join(dir, 'missing'), path.join(dir, '.credentials.json'));
  assert.equal(plaintextCredentials(dir), true);
});

test('override detection counts a variable set to an empty string', () => {
  assert.deepEqual(overridesIn({ CLAUDE_SECURESTORAGE_CONFIG_DIR: '', PATH: '/bin' }), ['CLAUDE_SECURESTORAGE_CONFIG_DIR']);
  assert.deepEqual(overridesIn({ ANTHROPIC_BASE_URL: 'x', ANTHROPIC_API_KEY: 'x' }), ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL']);
  for (const name of ['CLAUDE_SECURESTORAGE_CONFIG_DIR', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_MANTLE', 'CLAUDE_CODE_CUSTOM_OAUTH_URL', 'CLAUDE_CODE_MANAGED_SETTINGS_PATH']) assert.ok(AUTH_OVERRIDES.includes(name), name);
});
