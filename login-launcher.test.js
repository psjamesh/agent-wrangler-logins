import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loginCommand as claudeCommand, AUTH_OVERRIDES } from './claude-config.js';
import { loginCommand as codexCommand } from './codex-mirror.js';

function fixture(t, provider) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-login-launcher-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, "login ' $HOME `touch injected` ; folder");
  fs.mkdirSync(dir);
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  const calls = path.join(root, 'calls.jsonl');
  fs.writeFileSync(path.join(bin, provider), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify({ args, dir: process.env.${provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME'} }) + '\\n');
if (args.includes('status')) {
  console.log('Test CLI: authentication status checked');
  process.exit(Number(process.env.STATUS_EXIT || 0));
}
if (process.env.INTERACTIVE === '1') {
  if (args.length) process.exit(8);
  console.log('Test CLI: select subscription sign-in');
  if (fs.readFileSync(0, 'utf8').trim() !== 'subscription') process.exit(9);
}
console.log('Test CLI: dedicated sign-in');
process.exit(Number(process.env.LOGIN_EXIT || 0));
`, { mode: 0o755 });
  const command = (provider === 'claude' ? claudeCommand : codexCommand)(dir);
  const run = (extra = {}, prefix = '', input) => spawnSync('/bin/sh', ['-c', prefix + command], {
    input, cwd: root, env: { PATH: `${bin}:/usr/bin:/bin`, HOME: root, CALLS: calls, ...extra }, encoding: 'utf8',
  });
  return { run, command, dir, root, calls: () => fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse) : [] };
}

for (const provider of ['claude', 'codex']) {
  test(`${provider}: short launcher runs native sign-in then status in the isolated folder with safe quoting`, (t) => {
    const f = fixture(t, provider);
    assert.doesNotMatch(f.command, /AUTH_TOKEN|cli_auth_credentials_store|&&|;.*login status/);
    const r = f.run();
    assert.equal(r.status, 0, r.stderr);
    const prefix = provider === 'claude' ? [] : ['-c', 'cli_auth_credentials_store="keyring"'];
    assert.deepEqual(f.calls(), [
      { args: provider === 'claude' ? [] : [...prefix, 'login'], dir: f.dir },
      { args: provider === 'claude' ? ['auth', 'status', '--text'] : [...prefix, 'login', 'status'], dir: f.dir },
    ]);
    assert.match(r.stdout, /Test CLI: authentication status checked/);
    assert.equal(fs.existsSync(path.join(f.root, 'injected')), false);
  });

  test(`${provider}: login failure stays visible, skips status and preserves its exit`, (t) => {
    const f = fixture(t, provider);
    const r = f.run({ LOGIN_EXIT: '23' });
    assert.equal(r.status, 23, r.stderr);
    assert.equal(f.calls().length, 1);
    assert.match(r.stderr, /sign-in failed.*23/i);
    assert.doesNotMatch(r.stdout, /authentication status checked/);
  });

  test(`${provider}: failed status never becomes success`, (t) => {
    const f = fixture(t, provider);
    const r = f.run({ STATUS_EXIT: '7' });
    assert.equal(r.status, 7, r.stderr);
    assert.equal(f.calls().length, 2);
    assert.match(r.stderr, /status.*failed.*7/i);
  });

  test(`${provider}: missing CLI gives an actionable error and a failed exit`, (t) => {
    const f = fixture(t, provider);
    const r = f.run({ PATH: '/nonexistent' });
    assert.equal(r.status, 127);
    assert.match(r.stderr, /not found.*PATH/i);
  });
}

test('Claude refuses every override from the terminal environment by name without revealing values', (t) => {
  const f = fixture(t, 'claude');
  for (const name of AUTH_OVERRIDES) {
    const r = f.run({}, `export ${name}='private-value'; `);
    assert.equal(r.status, 1, name);
    assert.match(r.stderr, new RegExp(`unset ${name} first`));
    assert.doesNotMatch(r.stdout + r.stderr, /private-value/);
  }
  const r = f.run({}, 'export ANTHROPIC_API_KEY=; ');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ANTHROPIC_API_KEY/);
  assert.deepEqual(f.calls(), []);
});

test('Claude subscription onboarding receives terminal input and explains how to reach status', (t) => {
  const f = fixture(t, 'claude');
  const r = f.run({ INTERACTIVE: '1' }, '', 'subscription\n');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /choose Claude account with subscription/);
  assert.match(r.stdout, /No API key is needed/);
  assert.match(r.stdout, /type \/exit/);
  assert.match(r.stdout, /Test CLI: select subscription sign-in/);
  assert.match(r.stdout, /Test CLI: authentication status checked/);
});
