import { test } from 'node:test';
import assert from 'node:assert/strict';
import extension from './index.js';

import { dom } from '../test/dom.js';
const graph = { logins: { logins: [{ slug: 'personal', label: 'Personal', claude: { present: true, plaintext: false, oldToken: false, terminal: false }, codex: { present: false, oldAuth: false, terminal: false } }], sessions: { mapped: 'personal' } } };
function setup() {
  const document = dom(); const sent = []; const contributions = {};
  const messages = new Set(); const connects = new Set();
  const api = { onMessage: (fn) => { messages.add(fn); return () => messages.delete(fn); }, onConnect: (fn) => { connects.add(fn); return () => connects.delete(fn); }, send: (msg) => sent.push(msg), runtimes: () => [{ id: 'cloud', label: 'Cloud', ownLaunch: true }] };
  extension.register({ api, register: (slot, c) => { contributions[slot] = c; } });
  return { document, sent, api, contributions, messages, connects, emit: (msg) => { for (const fn of messages) fn(msg); }, reconnect: () => { for (const fn of connects) fn(); }, make: () => document.createElement('div') };
}
const ctx = { draft: { model: 'codex-model' }, agents: [{ id: 'codex', models: [{ value: 'codex-model' }] }] };
function walk(el, predicate) { return predicate(el) ? el : el.children.map((c) => walk(c, predicate)).find(Boolean); }

test('Login field lists Default, reads selection, blocks provider/runtime, resets, and retains removed selection', () => {
  const { make, api, contributions } = setup(); const el = make(); const c = contributions['dispatch.field'];
  c.mount(el, api); c.update(el, ctx, graph);
  const select = walk(el, (e) => e.tagName === 'SELECT');
  assert.deepEqual(select.children.map((o) => o.textContent), ['Default', 'Personal']);
  select.value = 'personal'; select.listeners.change();
  assert.deepEqual(c.ext(el), { login: 'personal' });
  assert.equal(c.validate(el, ctx), '"Personal" has no Codex login');
  assert.ok(el.textContent.includes('"Personal" has no Codex login'));
  assert.equal(c.validate(el, { draft: { agent: 'claude', runtime: 'cloud' } }), '"Personal" runs Claude only on the local runtime, not "Cloud"');
  assert.equal(c.validate(el, { draft: { agent: 'claude', runtime: 'devcontainer' } }), '"Personal" runs Claude only on the local runtime, not "devcontainer"');
  assert.equal(c.validate(el, { draft: { agent: 'claude', runtime: 'local' } }), null);
  c.update(el, ctx, { logins: { logins: [{ ...graph.logins.logins[0], codex: { present: true, oldAuth: false } }], sessions: {} } });
  assert.equal(c.validate(el, { draft: { agent: 'codex', runtime: 'cloud' } }), '"Personal" runs Codex only on the local runtime, not "Cloud"');
  assert.equal(c.validate(el, { draft: { agent: 'codex', runtime: 'devcontainer' } }), '"Personal" runs Codex only on the local runtime, not "devcontainer"');
  assert.equal(c.validate(el, { draft: { agent: 'codex', runtime: 'local' } }), null);
  assert.equal(c.validate(el, { draft: { agent: 'codex' } }), null);
  c.update(el, { draft: { agent: 'claude' } }, { logins: { logins: [], sessions: {} } });
  assert.match(c.validate(el, { draft: { agent: 'claude' } }), /no longer exists/);
  c.open(el); assert.equal(select.value, ''); assert.deepEqual(c.ext(el), { login: null });
});

test('pill draws mapped and removed labels; panel offers native login, Reopen and warnings with no token entry', () => {
  const { make, api, sent, contributions, emit } = setup(); const pill = make();
  contributions['card.pill'].mount(pill, api);
  contributions['card.pill'].update(pill, { sessionId: 'mapped' }, graph);
  assert.equal(pill.textContent, 'Personal');
  const tag = pill.children[0];
  assert.equal(tag.className, 'card-tag login-pill'); assert.equal(tag.title, 'Login: Personal');
  assert.match(tag.children[0].innerHTML, /^<svg /); assert.equal(tag.children[0]['aria-hidden'], 'true');
  contributions['card.pill'].update(pill, { sessionId: 'mapped' }, { logins: { logins: [{ slug: 'personal', label: 'Personal', removed: true }], sessions: { mapped: 'personal' } } });
  assert.equal(pill.textContent, 'Personal (removed)');
  assert.equal(pill.children[0].className, 'card-tag login-pill login-pill-removed');
  assert.match(pill.children[0].title, /removed; relaunch is refused/);
  contributions['card.pill'].update(pill, { sessionId: 'default' }, graph);
  assert.equal(pill.textContent, '');
  const panel = make(); contributions['settings.panel'].mount(panel, api); emit({ kind: 'logins', logins: graph.logins.logins });
  assert.ok(panel.textContent.includes('Claude: set up · sign-in not verified'));
  assert.ok(panel.textContent.includes('Codex: not set up'));
  assert.equal(walk(panel, (e) => e.tagName === 'INPUT' && e.type === 'password'), undefined);
  assert.ok(!/setup-token|Paste token|expires/.test(panel.textContent));
  const buttons = () => { const out = []; const visit = (e) => { if (e.tagName === 'BUTTON') out.push(e.textContent); e.children.forEach(visit); }; visit(panel); return out; };
  assert.deepEqual(buttons(), ['Remove', 'Log in', 'Forget', 'Log in', 'Add login']);
  walk(panel, (e) => e.tagName === 'BUTTON' && e.textContent === 'Log in').listeners.click();
  assert.deepEqual({ ...sent.at(-1), reqId: undefined }, { type: 'logins-login', slug: 'personal', provider: 'claude', reqId: undefined });
  const login = graph.logins.logins[0];
  emit({ kind: 'logins', logins: [{ ...login, claude: { present: true, plaintext: true, oldToken: true, terminal: true }, codex: { present: false, oldAuth: true, terminal: true } }] });
  assert.deepEqual(buttons(), ['Remove', 'Reopen terminal', 'Forget', 'Reopen terminal', 'Add login']);
  assert.ok(panel.textContent.includes('old codex-home/auth.json file is no longer used'));
  assert.ok(panel.textContent.includes('plaintext .credentials.json'));
  assert.ok(panel.textContent.includes('old claude.token file is no longer used'));
  emit({ kind: 'logins', logins: [{ ...login, codex: { present: true, oldAuth: false, terminal: false } }] });
  assert.ok(panel.textContent.includes('Codex: set up · sign-in not verified'));
  assert.ok(!panel.textContent.includes('codex-home'));
  assert.deepEqual(buttons(), ['Remove', 'Log in', 'Forget', 'Log in', 'Forget', 'Add login']);
  const codexRow = walk(panel, (e) => e.className === 'logins-provider' && e.textContent.startsWith('Codex'));
  walk(codexRow, (e) => e.tagName === 'BUTTON' && e.textContent === 'Log in').listeners.click();
  assert.deepEqual({ ...sent.at(-1), reqId: undefined }, { type: 'logins-login', slug: 'personal', provider: 'codex', reqId: undefined });
  emit({ kind: 'logins', logins: [{ ...login, claude: { present: false, plaintext: false, oldToken: false, terminal: false } }] });
  assert.ok(panel.textContent.includes('Claude: not set up'));
  assert.deepEqual(buttons(), ['Remove', 'Log in', 'Log in', 'Add login']);
  const input = walk(panel, (e) => e.placeholder === 'Login name'); input.value = 'Another';
  walk(panel, (e) => e.tagName === 'BUTTON' && e.textContent === 'Add login').listeners.click();
  assert.equal(sent.at(-1).type, 'logins-add'); assert.equal(sent.at(-1).label, 'Another');
  contributions['settings.panel'].unmount(panel);
});

test('Settings requests initial state, uses scoped metadata without graph updates, remounts and reconnects', () => {
  const { make, api, sent, contributions, emit, reconnect, messages, connects } = setup();
  const c = contributions['settings.panel']; const el = make();
  c.mount(el, api);
  assert.equal(sent.at(-1).type, 'logins-get');
  emit({ kind: 'logins', reqId: sent.at(-1).reqId, logins: graph.logins.logins });
  assert.ok(el.textContent.includes('Personal'));
  c.update?.(el, null, { logins: { logins: [{ label: 'Wrong graph' }] } });
  assert.ok(!el.textContent.includes('Wrong graph'));
  reconnect(); assert.equal(sent.at(-1).type, 'logins-get');
  emit({ kind: 'logins', reqId: sent.at(-1).reqId, logins: [{ ...graph.logins.logins[0], label: 'Updated' }] });
  assert.ok(el.textContent.includes('Updated'));
  c.unmount(el); assert.equal(messages.size, 0); assert.equal(connects.size, 0);
  const before = el.textContent;
  emit({ kind: 'logins', logins: [] }); assert.equal(el.textContent, before);
  c.mount(el, api); assert.equal(sent.at(-1).type, 'logins-get');
  emit({ kind: 'logins', reqId: sent.at(-1).reqId, logins: [] });
  assert.ok(!el.textContent.includes('Updated')); c.unmount(el);
});

test('two Settings tabs receive live authentication metadata; errors are scoped and recoverable', () => {
  const tabs = [setup(), setup()];
  for (const tab of tabs) { tab.el = tab.make(); tab.contributions['settings.panel'].mount(tab.el, tab.api); }
  const logins = [{ ...graph.logins.logins[0], codex: { present: true, oldAuth: false } }];
  for (const tab of tabs) tab.emit({ kind: 'logins', reqId: tab.sent.at(-1).reqId, logins });
  for (const tab of tabs) assert.ok(tab.el.textContent.includes('Codex: set up · sign-in not verified'));
  const tab = tabs[0];
  walk(tab.el, (e) => e.textContent === 'Remove' && e.tagName === 'BUTTON').listeners.click();
  const request = tab.sent.at(-1);
  for (const other of tabs) other.emit({ kind: 'logins-error', reqId: request.reqId, error: 'Cannot remove login' });
  assert.ok(tab.el.textContent.includes('Cannot remove login'));
  assert.ok(!tabs[1].el.textContent.includes('Cannot remove login'));
  tab.reconnect();
  tab.emit({ kind: 'logins', reqId: tab.sent.at(-1).reqId, logins });
  assert.ok(!tab.el.textContent.includes('Cannot remove login'));
  for (const other of tabs) other.contributions['settings.panel'].unmount(other.el);
});
