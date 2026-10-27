import fs from 'node:fs';
import path from 'node:path';
import { refreshMirror } from './codex-mirror.js';
import { captureCommand, watchCapture, TOKEN_RE, shellQuote } from './claude-token.js';

const captures = new WeakMap();
function stopCapture(store, slug) {
  captures.get(store)?.get(slug)?.();
  captures.get(store)?.delete(slug);
  fs.rmSync(path.join(store.dir(slug), 'claude-capture.txt'), { force: true });
  fs.rmSync(path.join(store.dir(slug), 'claude-scratch'), { recursive: true, force: true });
}
export function stopCaptures(store) {
  for (const slug of captures.get(store)?.keys() || []) stopCapture(store, slug);
  captures.delete(store);
}

export const loginsAddHandler = {
  type: 'logins-add',
  async handler({ label, reqId }, host) { host.stores.logins.add(label); await publish(host, reqId); },
};
export const loginsRemoveHandler = {
  type: 'logins-remove',
  async handler({ slug, reqId }, host) {
    const store = host.stores.logins;
    stopCapture(store, slug);
    store.remove(slug);
    await publish(host, reqId);
  },
};
export const loginsForgetHandler = {
  type: 'logins-forget',
  async handler({ slug, provider, reqId }, host) {
    const store = host.stores.logins;
    if (provider === 'claude') stopCapture(store, slug);
    store.forget(slug, provider);
    await publish(host, reqId);
  },
};
export const loginsLoginHandler = {
  type: 'logins-login',
  async handler({ slug, provider, reqId }, host) {
    const store = host.stores.logins;
    if (!store.get(slug)) throw new Error(`login "${store.labelFor(slug)}" no longer exists`);
    let command;
    if (provider === 'codex') {
      refreshMirror(store.codexHome(slug));
      command = `CODEX_HOME=${shellQuote(store.codexHome(slug))} codex login`;
    } else if (provider === 'claude') {
      stopCapture(store, slug);
      const capture = path.join(store.dir(slug), 'claude-capture.txt');
      fs.writeFileSync(capture, '', { mode: 0o600 });
      fs.chmodSync(capture, 0o600);
      if (!captures.has(store)) captures.set(store, new Map());
      captures.get(store).set(slug, watchCapture({
        loginDir: store.dir(slug),
        onError: (err) => { captures.get(store)?.delete(slug); host.broadcast({ kind: 'logins-error', error: err.message }); },
        onToken: async (token) => { store.setClaudeToken(slug, token); captures.get(store)?.delete(slug); await publish(host, reqId); },
      }));
      command = captureCommand({ loginDir: store.dir(slug) });
    } else throw new Error('Invalid login provider');
    try { await host.terminals.create({ cwd: store.dir(slug), command }); }
    catch (err) { if (provider === 'claude') stopCapture(store, slug); throw err; }
    await publish(host, reqId);
  },
};
export const loginsSetClaudeTokenHandler = {
  type: 'logins-set-claude-token',
  async handler({ slug, token, reqId }, host) {
    const value = typeof token === 'string' ? token.trim() : '';
    if (value.match(TOKEN_RE)?.[0] !== value || !value) throw new Error('That does not look like a Claude setup-token');
    host.stores.logins.setClaudeToken(slug, value);
    stopCapture(host.stores.logins, slug);
    await publish(host, reqId);
  },
};
const MUTATIONS = [loginsAddHandler, loginsRemoveHandler, loginsForgetHandler, loginsLoginHandler, loginsSetClaudeTokenHandler];

export function metadata(host, reqId) {
  return { kind: 'logins', ...(reqId === undefined ? {} : { reqId }), logins: host.stores.logins.list() };
}
export async function publish(host, reqId) {
  host.broadcast(metadata(host, reqId));
  await host.rebuild();
}
export const HANDLERS = [
  { type: 'logins-get', handler(msg, host, reply) {
    try { reply(metadata(host, msg.reqId)); }
    catch { reply({ kind: 'logins-error', reqId: msg.reqId, error: 'Could not load logins. Reconnect and try again.' }); }
  } },
  ...MUTATIONS.map(({ type, handler }) => ({ type, async handler(msg, host, reply) {
    try {
      await handler(msg, host);
      reply(metadata(host, msg.reqId));
    } catch (err) {
      reply({ kind: 'logins-error', reqId: msg.reqId, error: err.message });
    }
  } })),
];
