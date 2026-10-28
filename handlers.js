import { refreshMirror } from './codex-mirror.js';
import { loginCommand } from './claude-config.js';
import { shellQuote } from './persistence.js';
import { AGENT_LABEL, platformRefusal } from './launch.js';

const terminals = new WeakMap();
function terminalsFor(store) {
  if (!terminals.has(store)) terminals.set(store, new Map());
  return terminals.get(store);
}

export const loginsAddHandler = {
  type: 'logins-add',
  async handler({ label, reqId }, host) { host.stores.logins.add(label); await publish(host, reqId); },
};
export const loginsRemoveHandler = {
  type: 'logins-remove',
  async handler({ slug, reqId }, host) { host.stores.logins.remove(slug); await publish(host, reqId); },
};
export const loginsForgetHandler = {
  type: 'logins-forget',
  async handler({ slug, provider, reqId }, host) { host.stores.logins.forget(slug, provider); await publish(host, reqId); },
};
export const loginsLoginHandler = {
  type: 'logins-login',
  async handler({ slug, provider, reqId }, host) {
    const store = host.stores.logins;
    const login = store.get(slug);
    if (!login) throw new Error(`login "${store.labelFor(slug)}" no longer exists`);
    const platform = platformRefusal(login.label);
    if (platform) throw new Error(platform);
    let command;
    if (provider === 'codex') {
      refreshMirror(store.codexHome(slug));
      command = `CODEX_HOME=${shellQuote(store.codexHome(slug))} codex login`;
    } else if (provider === 'claude') command = loginCommand(store.setUpClaude(slug));
    else throw new Error('Invalid login provider');
    const { terminalId } = await host.terminals.create({
      cwd: store.dir(slug), command, presentation: 'dialog', title: `${AGENT_LABEL[provider]} login: ${login.label}`, key: `${provider}:${slug}`,
    });
    terminalsFor(store).set(`${provider}:${slug}`, terminalId);
    await publish(host, reqId);
  },
};
const MUTATIONS = [loginsAddHandler, loginsRemoveHandler, loginsForgetHandler, loginsLoginHandler];

async function withTerminals(host, logins) {
  const open = terminalsFor(host.stores.logins);
  const alive = async (key) => {
    const id = open.get(key);
    if (!id) return false;
    try { if (await host.terminals.alive(id)) return true; } catch {}
    open.delete(key);
    return false;
  };
  return Promise.all(logins.map(async (login) => ({
    ...login,
    claude: { ...login.claude, terminal: await alive(`claude:${login.slug}`) },
    codex: { ...login.codex, terminal: await alive(`codex:${login.slug}`) },
  })));
}
export async function metadata(host, reqId) {
  return { kind: 'logins', ...(reqId === undefined ? {} : { reqId }), logins: await withTerminals(host, host.stores.logins.list()) };
}
export async function publish(host, reqId) {
  host.broadcast(await metadata(host, reqId));
  await host.rebuild();
}
export const HANDLERS = [
  { type: 'logins-get', async handler(msg, host, reply) {
    try { reply(await metadata(host, msg.reqId)); }
    catch { reply({ kind: 'logins-error', reqId: msg.reqId, error: 'Could not load logins. Reconnect and try again.' }); }
  } },
  ...MUTATIONS.map(({ type, handler }) => ({ type, async handler(msg, host, reply) {
    try {
      await handler(msg, host);
      reply(await metadata(host, msg.reqId));
    } catch (err) {
      reply({ kind: 'logins-error', reqId: msg.reqId, error: err.message });
    }
  } })),
];
