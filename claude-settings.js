import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { AUTH_OVERRIDES } from './claude-config.js';

export const MANAGED = { dir: '/Library/Application Support/ClaudeCode', prefs: '/Library/Managed Preferences', plutil: '/usr/bin/plutil' };
export const SETTINGS_ENV_OVERRIDES = [...AUTH_OVERRIDES, 'CLAUDE_CONFIG_DIR'];
export const AUTH_SETTINGS = ['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport', 'gcpAuthRefresh'];
export const MANAGED_HELPERS = ['policyHelper', 'policyHelpers'];
const PLIST = 'com.anthropic.claudecode.plist';

class Unreadable extends Error {
  constructor(file) { super(`cannot read Claude settings ${file}, so the login's sign-in cannot be verified`); }
}

const MISSING = ['ENOENT', 'ENOTDIR'];
function absent(err, file) {
  if (!MISSING.includes(err.code)) return false;
  try { return !fs.lstatSync(file, { throwIfNoEntry: false }); } catch (e) { return MISSING.includes(e.code); }
}

function mainCheckout(dir) {
  const dotGit = path.join(dir, '.git');
  let pointer;
  try {
    if (!fs.lstatSync(dotGit, { throwIfNoEntry: false })?.isFile()) return null;
    pointer = fs.readFileSync(dotGit, 'utf8');
  } catch (err) { if (absent(err, dotGit)) return null; throw new Unreadable(dotGit); }
  const match = /^gitdir:\s*(.+?)\s*$/m.exec(pointer);
  if (!match) throw new Unreadable(dotGit);
  const gitDir = path.resolve(dir, match[1]);
  const commondir = path.join(gitDir, 'commondir');
  let common;
  try { common = path.resolve(gitDir, fs.readFileSync(commondir, 'utf8').trim()); }
  catch (err) { if (absent(err, commondir)) return null; throw new Unreadable(commondir); }
  return path.basename(common) === '.git' ? path.dirname(common) : null;
}

function withAncestors(dir, into) {
  for (let d = dir; ; d = path.dirname(d)) {
    into.add(d);
    if (d === path.dirname(d)) return;
  }
}

export function projectFolders(dirs, home = os.homedir()) {
  const starts = new Set();
  for (const dir of dirs) {
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) continue;
    const resolved = path.resolve(dir);
    starts.add(resolved);
    try { starts.add(fs.realpathSync(resolved)); } catch { starts.add(home); }
  }
  const folders = new Set();
  for (const start of starts) withAncestors(start, folders);
  for (const folder of [...folders]) {
    const main = mainCheckout(folder);
    if (main) withAncestors(main, folders);
  }
  return [...folders];
}

export function settingsFiles({ folders, loginDir, user = os.userInfo().username }) {
  const files = [
    { file: path.join(MANAGED.dir, 'managed-settings.json'), managed: true },
  ];
  const dropIns = path.join(MANAGED.dir, 'managed-settings.d');
  try {
    for (const name of fs.readdirSync(dropIns).filter((n) => n.endsWith('.json')).sort()) files.push({ file: path.join(dropIns, name), managed: true });
  } catch (err) { if (!absent(err, dropIns)) throw new Unreadable(dropIns); }
  files.push(
    { file: path.join(MANAGED.prefs, user, PLIST), managed: true, plist: true },
    { file: path.join(MANAGED.prefs, PLIST), managed: true, plist: true },
    { file: path.join(loginDir, 'remote-settings.json'), managed: true },
    { file: path.join(loginDir, 'settings.json') },
    { file: path.join(loginDir, 'settings.local.json') },
  );
  for (const folder of folders) {
    files.push({ file: path.join(folder, '.claude', 'settings.json') }, { file: path.join(folder, '.claude', 'settings.local.json') });
  }
  return files;
}

function readSettings({ file, plist }) {
  let text;
  try {
    if (plist && !fs.lstatSync(file, { throwIfNoEntry: false })) return null;
    text = plist
      ? execFileSync(MANAGED.plutil, ['-convert', 'json', '-o', '-', '--', file], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 5000 })
      : fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (absent(err, file)) return null;
    throw new Unreadable(file);
  }
  let settings;
  try { settings = JSON.parse(text); } catch { throw new Unreadable(file); }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Unreadable(file);
  if (settings.env !== undefined && (!settings.env || typeof settings.env !== 'object' || Array.isArray(settings.env))) throw new Unreadable(file);
  return settings;
}

function problemIn(source) {
  const settings = readSettings(source);
  if (!settings) return null;
  const env = Object.keys(settings.env || {}).filter((name) => SETTINGS_ENV_OVERRIDES.includes(name));
  if (env.length) return `Claude settings ${source.file} set ${env.join(', ')} in env, which overrides the login's sign-in`;
  const keys = AUTH_SETTINGS.filter((key) => Object.hasOwn(settings, key));
  if (keys.length) return `Claude settings ${source.file} set ${keys.join(', ')}, which overrides the login's sign-in`;
  const helpers = source.managed ? MANAGED_HELPERS.filter((key) => Object.hasOwn(settings, key)) : [];
  if (helpers.length) return `managed Claude settings ${source.file} set ${helpers.join(', ')}, whose settings cannot be checked`;
  return null;
}

export function settingsRefusal({ dirs, loginDir, home, user }) {
  try {
    if (!dirs.some((dir) => typeof dir === 'string' && path.isAbsolute(dir))) return 'the launch folder is not known, so its Claude settings cannot be checked';
    for (const source of settingsFiles({ folders: projectFolders(dirs, home), loginDir, user })) {
      const problem = problemIn(source);
      if (problem) return problem;
    }
    return null;
  } catch (err) {
    if (err instanceof Unreadable) return err.message;
    throw err;
  }
}
