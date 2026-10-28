import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LoginStore } from './login-store.js';
import { HANDLERS, metadata, publish } from './handlers.js';
import { prepare, launchContext, onBeforeDispatch, onFork, onPurge } from './launch.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const watchers = new WeakMap();

export default {
  id: 'logins', label: 'Logins',
  help: 'Run a session on a stored second Claude or Codex login, chosen in the dispatch dialog. Off, every session relaunches on the CLIs’ own login; stored logins are kept.',
  description: 'Dispatch a session on another Claude or Codex login while the rest of the board keeps Default.',
  author: 'psjamesh', defaultEnabled: false, dir,
  requires: ['board:rebuild', 'board:broadcast', 'terminals:create'],
  engines: { wranglerApi: '^1.51.0' },
  stores: { logins: () => new LoginStore() },
  handlers: HANDLERS,
  hooks: { 'session.prepare': prepare, 'session.launchContext': launchContext },
  session: { onBeforeDispatch, onFork, onPurge },
  graph: ({ host }) => ({ logins: host.stores.logins.snapshot() }),
  activate({ host }) {
    const store = host.stores.logins;
    fs.mkdirSync(store.root, { recursive: true, mode: 0o700 });
    watchers.get(store)?.();
    let timer;
    let active = true;
    let previous;
    const notify = async () => {
      if (!active) return;
      try {
        const signature = JSON.stringify(await metadata(host));
        if (signature === previous) return;
        await publish(host);
        previous = signature;
      } catch {
        host.broadcast({ kind: 'logins-error', error: 'Could not refresh logins. Reconnect and try again.' });
      }
    };
    const watcher = fs.watch(store.root, { persistent: false }, () => {
      clearTimeout(timer);
      timer = setTimeout(notify, 100);
      timer.unref?.();
    });
    watcher.on('error', () => {
      if (active) host.broadcast({ kind: 'logins-error', error: 'Login updates stopped. Reconnect and try again.' });
    });
    const poll = setInterval(notify, 1000);
    poll.unref?.();
    watchers.set(store, () => { active = false; watcher.close(); clearTimeout(timer); clearInterval(poll); });
  },
  deactivate({ host }) {
    const store = host?.stores?.logins;
    if (!store) return;
    watchers.get(store)?.();
    watchers.delete(store);
  },
  client: 'public/index.js', styles: 'public/styles.css',
};
