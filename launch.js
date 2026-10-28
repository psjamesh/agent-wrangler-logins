import { refreshMirror } from './codex-mirror.js';
import { AUTH_OVERRIDES, linkShared, overridesIn, plaintextCredentials } from './claude-config.js';

export const AGENT_LABEL = { claude: 'Claude', codex: 'Codex' };
const PLATFORM_LABEL = { linux: 'Linux', win32: 'Windows', freebsd: 'FreeBSD', openbsd: 'OpenBSD', sunos: 'SunOS', aix: 'AIX' };
const reported = new Set();
const bindingFailures = new WeakMap();

function dispatchLogin(store, spawnedBy, ext) {
  return spawnedBy ? store.loginFor(spawnedBy) : ext?.login || null;
}
function refusal(store, slug, agent, label) {
  const login = store.get(slug);
  if (!login) return `login "${label}" no longer exists`;
  if (!AGENT_LABEL[agent]) return `login "${label}" cannot be used with agent "${agent}"`;
  if (!login[agent].present) return `login "${label}" has no ${AGENT_LABEL[agent]} login`;
  return null;
}
export function platformRefusal(label, platform = process.platform) {
  return platform === 'darwin' ? null : `login "${label}" works only on macOS, not ${PLATFORM_LABEL[platform] || platform}`;
}
function runtimeRefusal(runtime, label) {
  return runtime && runtime !== 'local' ? `login "${label}" runs Claude only on the local runtime, not "${runtime}"` : null;
}
function claudeContext(store, slug, label, reason) {
  const dir = store.claudeDir(slug);
  if (!dir) return { refuse: `login "${label}" has no Claude login` };
  const { unready } = linkShared(dir);
  if (unready.length) return { refuse: `login "${label}": Claude ${unready.join(' and ')} cannot be shared from the default Claude folder` };
  if (reason === 'headless') {
    const set = overridesIn(process.env);
    if (set.length) return { refuse: `login "${label}": the Agent Wrangler server environment sets ${set.join(', ')}` };
  }
  if (plaintextCredentials(dir)) console.warn(`[logins] login "${label}" keeps its Claude credential in a plaintext .credentials.json`);
  return { env: { CLAUDE_CONFIG_DIR: dir }, refuseIfSet: AUTH_OVERRIDES };
}

export function prepare({ agent, spawnedBy, ext, runtime, ownLaunch, host }) {
  let label = 'selected';
  try {
    const store = host.stores.logins;
    const slug = dispatchLogin(store, spawnedBy, ext);
    if (!slug) return;
    label = slug;
    label = store.labelFor(slug);
    const reason = refusal(store, slug, agent, label);
    if (reason) return { abort: reason };
    const platform = platformRefusal(label);
    if (platform) return { abort: platform };
    if (agent === 'claude') {
      const remote = runtimeRefusal(runtime, label);
      if (remote) return { abort: remote };
    } else if (ownLaunch) return { abort: `login "${label}" cannot be used with runtime "${runtime}"` };
  } catch (err) { return { abort: `login "${label}": ${err.message}` }; }
}

export function launchContext({ sid, agent, runtime, reason, parentId, ext, host }) {
  let label = 'selected';
  try {
    const store = host.stores.logins;
    const failed = bindingFailures.get(store)?.get(sid);
    if (failed) return { refuse: failed };
    const slug = store.loginFor(sid)
      || (reason === 'fork' && parentId ? store.loginFor(parentId) : null)
      || (reason === 'headless' ? ext?.login : null);
    if (!slug) return {};
    label = slug;
    label = store.labelFor(slug);
    const denied = refusal(store, slug, agent, label);
    if (denied) return { refuse: denied };
    const platform = platformRefusal(label);
    if (platform) return { refuse: platform };
    if (agent === 'claude') {
      const remote = runtimeRefusal(runtime, label);
      if (remote) return { refuse: remote };
    }
    if (reason === 'fork' && !store.loginFor(sid)) store.bind(sid, slug);
    if (agent === 'claude') return claudeContext(store, slug, label, reason);
    const home = store.codexHome(slug);
    const { kept } = refreshMirror(home);
    for (const name of kept) {
      const key = `${home}/${name}`;
      if (!reported.has(key)) { reported.add(key); console.warn(`[logins] login "${label}" keeps per-home entry "${name}"`); }
    }
    return { env: { CODEX_HOME: home } };
  } catch (err) { return { refuse: `login "${label}": ${err.message}` }; }
}

export function onBeforeDispatch({ sessionId, spawnedBy, ext, host }) {
  const store = host.stores.logins;
  let slug = 'selected';
  try {
    slug = dispatchLogin(store, spawnedBy, ext);
    if (slug) store.bind(sessionId, slug);
    bindingFailures.get(store)?.delete(sessionId);
  } catch (err) {
    if (!bindingFailures.has(store)) bindingFailures.set(store, new Map());
    bindingFailures.get(store).set(sessionId, `login "${slug}": ${err.message}`);
  }
}
export function onFork({ sessionId, parentId, host }) {
  const store = host.stores.logins;
  const slug = store.loginFor(parentId);
  if (slug) store.bind(sessionId, slug);
}
export function onPurge({ sessionId, host }) {
  host.stores.logins.unbind(sessionId);
  bindingFailures.get(host.stores.logins)?.delete(sessionId);
}
