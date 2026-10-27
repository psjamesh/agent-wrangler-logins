import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractToken, captureCommand, watchCapture } from './claude-token.js';
const token = 'sk-ant-oat01-fixture_abcdefghijklmnopqr';

test('extracts a setup token from prose and ANSI, quotes capture paths', () => {
  assert.equal(extractToken(`before\u001b[32m${token}\u001b[0m after`), token);
  assert.equal(extractToken('no token'), null);
  assert.equal(captureCommand({ loginDir: "/tmp/one's login" }), "CLAUDE_CONFIG_DIR='/tmp/one'\\''s login/claude-scratch' 'claude' setup-token 2>&1 | tee '/tmp/one'\\''s login/claude-capture.txt'");
});

test('captures once, cleans scratch state and can be cancelled', async (t) => {
  const loginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-token-'));
  t.after(() => fs.rmSync(loginDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(loginDir, 'claude-scratch'));
  const capture = path.join(loginDir, 'claude-capture.txt');
  fs.writeFileSync(capture, 'waiting');
  const got = [];
  const done = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for Claude token capture')), 5000);
    t.after(() => clearTimeout(timeout));
    const stop = watchCapture({ loginDir, intervalMs: 5, onToken: (value) => { got.push(value); resolve(); }, onError: reject });
    t.after(stop);
  });
  fs.writeFileSync(capture, token);
  await done;
  assert.equal(fs.existsSync(capture), false);
  assert.equal(fs.existsSync(path.join(loginDir, 'claude-scratch')), false);
  fs.writeFileSync(capture, token);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(got, [token]);
  const stop = watchCapture({ loginDir, intervalMs: 5, onToken: () => assert.fail('cancelled') });
  stop();
  await new Promise((r) => setTimeout(r, 20));
});

test('capture timeout reports a useful error and removes private scratch data', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-token-timeout-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'claude-scratch'));
  fs.writeFileSync(path.join(root, 'claude-capture.txt'), 'waiting');
  const errors = [];
  const stop = watchCapture({ loginDir: root, intervalMs: 5, timeoutMs: 10, onToken: () => assert.fail('No token expected'), onError: (err) => errors.push(err.message) });
  t.after(stop);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.match(errors[0], /timed out.*Paste token/);
  assert.equal(fs.existsSync(path.join(root, 'claude-capture.txt')), false);
  assert.equal(fs.existsSync(path.join(root, 'claude-scratch')), false);
});
