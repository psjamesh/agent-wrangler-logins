import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { dataDir, writeJsonAtomic } from './persistence.js';
import { linkShared, seedSettings, plaintextCredentials } from './claude-config.js';
import { refreshMirror } from './codex-mirror.js';

const FOLDER = { claude: 'Claude config folder', codex: 'Codex home' };

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return fallback; throw new Error('Cannot read login data'); }
}

export class LoginStore {
  constructor(root = path.join(dataDir(), 'logins')) { this.root = root; }

  slugFor(label) {
    const slug = String(label ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!slug) throw new Error('A login needs a name');
    return slug;
  }

  dir(slug) {
    if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('Invalid login');
    return path.join(this.root, slug);
  }

  oldCodexHome(slug) { return path.join(this.dir(slug), 'codex-home'); }
  claudeTokenPath(slug) { return path.join(this.dir(slug), 'claude.token'); }
  claudeDir(slug) { return this._ownDir(slug, 'claude'); }
  codexDir(slug) { return this._ownDir(slug, 'codex'); }
  _ownDir(slug, provider) {
    const name = readJson(path.join(this.dir(slug), 'login.json'), {})[`${provider}Dir`];
    if (name == null) return null;
    if (typeof name !== 'string' || !new RegExp(`^${provider}-[0-9a-f]{16}$`).test(name)) throw new Error('Invalid login metadata');
    const entry = path.join(this.dir(slug), name);
    const stat = fs.lstatSync(entry, { throwIfNoEntry: false });
    if (!stat) return null;
    if (!stat.isDirectory()) throw new Error(`${FOLDER[provider]} is not a directory`);
    return fs.realpathSync(entry);
  }
  _makeDir(slug, provider, setUp) {
    if (!this.get(slug)) throw new Error(`login "${this.labelFor(slug)}" no longer exists`);
    const existing = this._ownDir(slug, provider);
    if (existing) return existing;
    const name = `${provider}-${randomBytes(8).toString('hex')}`;
    const created = path.join(this.dir(slug), name);
    fs.mkdirSync(created, { mode: 0o700 });
    try {
      setUp(created);
      const metaPath = path.join(this.dir(slug), 'login.json');
      writeJsonAtomic(metaPath, { ...readJson(metaPath, {}), [`${provider}Dir`]: name });
    } catch (err) { fs.rmSync(created, { recursive: true, force: true }); throw err; }
    return fs.realpathSync(created);
  }
  setUpClaude(slug) {
    const dir = this._makeDir(slug, 'claude', seedSettings);
    const links = linkShared(dir);
    if (links.unready.length) throw new Error(`Claude ${links.unready.join(' and ')} cannot be shared from the default Claude folder`);
    return dir;
  }
  setUpCodex(slug) {
    const dir = this._makeDir(slug, 'codex', refreshMirror);
    refreshMirror(dir);
    return dir;
  }
  _sessions() {
    const sessions = readJson(path.join(this.root, 'sessions.json'), {});
    if (!sessions || Array.isArray(sessions) || typeof sessions !== 'object' || Object.values(sessions).some((slug) => typeof slug !== 'string')) throw new Error('Invalid login bindings');
    return sessions;
  }
  _removed() {
    const removed = readJson(path.join(this.root, 'removed.json'), {});
    if (!removed || Array.isArray(removed) || typeof removed !== 'object' || Object.values(removed).some((label) => typeof label !== 'string')) throw new Error('Invalid login labels');
    return removed;
  }
  labelFor(slug) { return this.get(slug)?.label || this._removed()[slug] || slug; }

  add(label) {
    const slug = this.slugFor(label);
    const dir = this.dir(slug);
    if (fs.existsSync(dir) || Object.hasOwn(this._removed(), slug)) throw new Error(`A login called "${label}" already exists`);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeJsonAtomic(path.join(dir, 'login.json'), { label: String(label).trim(), createdAt: Date.now() });
    return { slug, label: String(label).trim() };
  }

  get(slug) {
    const meta = readJson(path.join(this.dir(slug), 'login.json'), null);
    if (!meta) return null;
    if (typeof meta.label !== 'string') throw new Error('Invalid login metadata');
    const claudeDir = this.claudeDir(slug);
    const claude = { present: !!claudeDir, plaintext: !!claudeDir && plaintextCredentials(claudeDir), oldToken: fs.existsSync(this.claudeTokenPath(slug)) };
    const codex = { present: !!this.codexDir(slug), oldAuth: fs.existsSync(path.join(this.oldCodexHome(slug), 'auth.json')) };
    return { slug, label: meta.label, claude, codex };
  }

  list() {
    let entries;
    try { entries = fs.readdirSync(this.root, { withFileTypes: true }); }
    catch (err) { if (err.code === 'ENOENT') return []; throw new Error('Cannot read login data'); }
    return entries.filter((e) => e.isDirectory()).map((e) => this.get(e.name)).filter(Boolean);
  }

  forget(slug, provider) {
    if (!this.get(slug)) throw new Error(`login "${this.labelFor(slug)}" no longer exists`);
    if (!FOLDER[provider]) throw new Error('Invalid login provider');
    const file = path.join(this.dir(slug), 'login.json');
    const meta = readJson(file, {});
    const dir = this._ownDir(slug, provider);
    delete meta[`${provider}Dir`];
    writeJsonAtomic(file, meta);
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }

  remove(slug) {
    const label = this.labelFor(slug);
    const sessions = this._sessions();
    if (Object.values(sessions).includes(slug)) writeJsonAtomic(path.join(this.root, 'removed.json'), { ...this._removed(), [slug]: label });
    fs.rmSync(this.dir(slug), { recursive: true, force: true });
  }

  bind(cardId, slug) {
    this.dir(slug);
    writeJsonAtomic(path.join(this.root, 'sessions.json'), { ...this._sessions(), [cardId]: slug });
  }
  loginFor(cardId) { return Object.hasOwn(this._sessions(), cardId) ? this._sessions()[cardId] : null; }
  unbind(cardId) {
    const sessions = this._sessions();
    delete sessions[cardId];
    writeJsonAtomic(path.join(this.root, 'sessions.json'), sessions);
    const removed = this._removed();
    for (const slug of Object.keys(removed)) if (!Object.values(sessions).includes(slug)) delete removed[slug];
    writeJsonAtomic(path.join(this.root, 'removed.json'), removed);
  }
  snapshot() {
    const sessions = this._sessions();
    const logins = this.list();
    for (const [slug, label] of Object.entries(this._removed())) logins.push({ slug, label, removed: true });
    return { logins, sessions };
  }
}
