import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { MANAGED, AUTH_SETTINGS, SETTINGS_ENV_OVERRIDES, settingsRefusal, projectFolders } from './claude-settings.js';

const SECRET = 'fixture-private-value';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-claude-settings-')));
  const saved = { ...MANAGED };
  t.after(() => {
    Object.assign(MANAGED, saved);
    execFileSync('/bin/chmod', ['-R', 'u+rwx', root]);
    fs.rmSync(root, { recursive: true, force: true });
  });
  MANAGED.dir = path.join(root, 'managed');
  MANAGED.prefs = path.join(root, 'prefs');
  const home = path.join(root, 'home');
  const login = path.join(root, 'login');
  const repo = path.join(home, 'repo');
  const cwd = path.join(repo, 'pkg', 'app');
  for (const dir of [MANAGED.dir, MANAGED.prefs, login, cwd]) fs.mkdirSync(dir, { recursive: true });
  const check = (dirs = [cwd]) => settingsRefusal({ dirs, loginDir: login, home, user: 'fixture-user' });
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
    return file;
  };
  const plist = (file, value) => {
    const json = write(`${file}.json`, value);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    execFileSync('/usr/bin/plutil', ['-convert', 'xml1', '-o', file, json]);
    fs.rmSync(json);
    return file;
  };
  return { root, home, login, repo, cwd, check, write, plist };
}

function worktreeOf(f) {
  const main = path.join(f.root, 'main');
  const gitDir = path.join(main, '.git', 'worktrees', 'wt');
  fs.mkdirSync(gitDir, { recursive: true });
  fs.writeFileSync(path.join(gitDir, 'commondir'), '../..\n');
  const tree = path.join(f.root, 'trees', 'wt');
  fs.mkdirSync(tree, { recursive: true });
  fs.writeFileSync(path.join(tree, '.git'), `gitdir: ${gitDir}\n`);
  return { main, tree };
}

test('settings sources: each source can trigger a named refusal', (t) => {
  const cases = [
    ['managed settings', (f) => path.join(MANAGED.dir, 'managed-settings.json')],
    ['managed drop-in', (f) => path.join(MANAGED.dir, 'managed-settings.d', '50-team.json')],
    ['per-user managed preferences', (f) => path.join(MANAGED.prefs, 'fixture-user', 'com.anthropic.claudecode.plist'), 'plist'],
    ['device managed preferences', (f) => path.join(MANAGED.prefs, 'com.anthropic.claudecode.plist'), 'plist'],
    ['cached server-managed settings', (f) => path.join(f.login, 'remote-settings.json')],
    ['login user settings', (f) => path.join(f.login, 'settings.json')],
    ['login user local settings', (f) => path.join(f.login, 'settings.local.json')],
    ['project settings', (f) => path.join(f.cwd, '.claude', 'settings.json')],
    ['project local settings', (f) => path.join(f.cwd, '.claude', 'settings.local.json')],
    ['ancestor settings', (f) => path.join(f.repo, '.claude', 'settings.local.json')],
    ['home settings as an ancestor', (f) => path.join(f.home, '.claude', 'settings.json')],
    ['worktree main checkout', (f) => path.join(worktreeOf(f).main, '.claude', 'settings.local.json'), 'json', (f) => [path.join(f.root, 'trees', 'wt')]],
    ['host worktree repo root', (f) => path.join(f.root, 'origin', '.claude', 'settings.json'), 'json', (f) => [f.cwd, path.join(f.root, 'origin')]],
    ['home when the launch folder is gone', (f) => path.join(f.home, '.claude', 'settings.local.json'), 'json', (f) => [path.join(f.root, 'gone')]],
  ];
  const triggers = [
    ...SETTINGS_ENV_OVERRIDES.map((name) => [{ env: { [name]: SECRET } }, `set ${name} in env`]),
    [{ env: { ANTHROPIC_BASE_URL: '' } }, 'set ANTHROPIC_BASE_URL in env'],
    ...AUTH_SETTINGS.map((key) => [{ [key]: SECRET }, `set ${key},`]),
  ];
  for (const [label, where, kind = 'json', dirs] of cases) {
    for (const [settings, named] of triggers) {
      const f = fixture(t);
      const file = where(f);
      if (label === 'host worktree repo root') fs.mkdirSync(path.join(f.root, 'origin'));
      (kind === 'plist' ? f.plist : f.write)(file, settings);
      const refusal = f.check(dirs?.(f));
      assert.ok(refusal?.includes(file), `${label}: ${refusal}`);
      assert.ok(refusal.includes(named), `${label}: ${refusal}`);
      assert.ok(refusal.endsWith("which overrides the login's sign-in"), refusal);
      assert.ok(!refusal.includes(SECRET), refusal);
    }
  }
});

test('settings sources: managed policy helpers refuse; harmless settings pass', (t) => {
  for (const key of ['policyHelper', 'policyHelpers']) {
    const f = fixture(t);
    const file = f.write(path.join(MANAGED.dir, 'managed-settings.json'), { [key]: { command: SECRET } });
    assert.equal(f.check(), `managed Claude settings ${file} set ${key}, whose settings cannot be checked`);
    const p = fixture(t);
    p.write(path.join(p.cwd, '.claude', 'settings.json'), { [key]: { command: SECRET } });
    assert.equal(p.check(), null);
  }
  const f = fixture(t);
  f.write(path.join(MANAGED.dir, 'managed-settings.json'), { permissions: { deny: ['Bash(rm)'] }, env: { DISABLE_TELEMETRY: '1' } });
  f.write(path.join(MANAGED.dir, 'managed-settings.d', 'README.md'), '# not settings');
  f.plist(path.join(MANAGED.prefs, 'com.anthropic.claudecode.plist'), { model: 'opus' });
  f.write(path.join(f.login, 'settings.json'), { model: 'opus', env: { BASH_DEFAULT_TIMEOUT_MS: '1000' }, forceLoginMethod: 'claudeai' });
  f.write(path.join(f.cwd, '.claude', 'settings.json'), { hooks: {} });
  assert.equal(f.check(), null);
  assert.equal(f.check([f.cwd, f.cwd]), null);
});

test('settings sources: unreadable settings refuse rather than verify', (t) => {
  const unreadable = (file) => `cannot read Claude settings ${file}, so the login's sign-in cannot be verified`;
  const cases = [
    ['malformed JSON', (f) => f.write(path.join(f.cwd, '.claude', 'settings.json'), '{"env": {')],
    ['a JSON array', (f) => f.write(path.join(f.login, 'settings.json'), '[]')],
    ['JSON null', (f) => f.write(path.join(f.login, 'settings.local.json'), 'null')],
    ['env that is not an object', (f) => f.write(path.join(f.repo, '.claude', 'settings.json'), { env: ['ANTHROPIC_API_KEY'] })],
    ['env that is null', (f) => f.write(path.join(MANAGED.dir, 'managed-settings.json'), { env: null })],
    ['a file without read permission', (f) => {
      const file = f.write(path.join(f.cwd, '.claude', 'settings.local.json'), { env: { ANTHROPIC_API_KEY: SECRET } });
      fs.chmodSync(file, 0o000);
      return file;
    }],
    ['a folder without search permission', (f) => {
      const file = f.write(path.join(f.repo, '.claude', 'settings.json'), {});
      fs.chmodSync(path.dirname(file), 0o000);
      return file;
    }],
    ['a dangling symlink', (f) => {
      const file = path.join(f.cwd, '.claude', 'settings.json');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.symlinkSync(path.join(f.root, 'nowhere.json'), file);
      return file;
    }],
    ['a directory in place of the file', (f) => {
      const file = path.join(f.login, 'remote-settings.json');
      fs.mkdirSync(file);
      return file;
    }],
    ['an unreadable managed drop-in folder', (f) => {
      const dir = path.join(MANAGED.dir, 'managed-settings.d');
      fs.mkdirSync(dir);
      fs.chmodSync(dir, 0o000);
      return dir;
    }],
    ['a corrupt managed preferences plist', (f) => f.write(path.join(MANAGED.prefs, 'com.anthropic.claudecode.plist'), 'not a plist')],
    ['a worktree pointer that names no git folder', (f) => f.write(path.join(f.cwd, '.git'), 'not a pointer')],
  ];
  for (const [label, make] of cases) {
    const f = fixture(t);
    const file = make(f);
    assert.equal(f.check(), unreadable(file), label);
  }
});

test('settings sources: an unknown launch folder refuses', (t) => {
  const f = fixture(t);
  for (const dirs of [[], [null], ['relative/path']]) assert.equal(f.check(dirs), 'the launch folder is not known, so its Claude settings cannot be checked');
});

test('project folders cover the launch folder, its real path, ancestors and a worktree main checkout', (t) => {
  const f = fixture(t);
  const { main, tree } = worktreeOf(f);
  const folders = projectFolders([path.join(tree)], f.home);
  for (const dir of [tree, path.dirname(tree), f.root, '/', main]) assert.ok(folders.includes(dir), dir);
  const link = path.join(f.root, 'link');
  fs.symlinkSync(f.cwd, link);
  const linked = projectFolders([link], f.home);
  for (const dir of [link, f.cwd, f.repo, f.home]) assert.ok(linked.includes(dir), dir);
  assert.ok(projectFolders([path.join(f.root, 'gone')], f.home).includes(f.home));
});
