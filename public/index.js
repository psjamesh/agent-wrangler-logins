const KEY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg>';
function node(el, tag, text, className) {
  const child = el.ownerDocument.createElement(tag);
  if (text !== undefined) child.textContent = text;
  if (className) child.className = className;
  return child;
}
function button(el, text, run) {
  const btn = node(el, 'button', text, 'logins-button');
  btn.type = 'button'; btn.addEventListener('click', run); return btn;
}
function agentFor(ctx) {
  return ctx?.draft?.agent || ctx?.agents?.find((a) => a.models?.some((m) => m.value === ctx?.draft?.model))?.id;
}
function message(el, ctx) {
  const state = el.loginField;
  const slug = state.select.value;
  if (!slug) return '';
  const login = state.logins.find((l) => l.slug === slug);
  const label = login?.label || state.labels.get(slug) || slug;
  if (!login || login.removed) return `login "${label}" no longer exists`;
  const agent = agentFor(ctx);
  if (!['claude', 'codex'].includes(agent)) return `Choose a Claude or Codex model for "${label}"`;
  if (!login[agent]?.present) return `"${label}" has no ${agent === 'claude' ? 'Claude' : 'Codex'} login`;
  const runtimeId = ctx?.draft?.runtime;
  const runtime = state.api.runtimes?.().find((r) => r.id === runtimeId);
  if (agent === 'claude' && runtimeId && runtimeId !== 'local') return `"${label}" runs Claude only on the local runtime, not "${runtime?.label || runtimeId}"`;
  if (agent === 'codex' && runtime?.ownLaunch) return `"${label}" cannot be used with runtime "${runtime.label || runtime.id}"`;
  return '';
}
function validate(el, ctx) {
  el.loginField.ctx = ctx;
  const text = message(el, ctx);
  el.loginField.message.textContent = text;
  return text || null;
}
function drawField(el, ctx, graph) {
  const state = el.loginField;
  state.ctx = ctx;
  state.logins = graph?.logins?.logins || [];
  for (const l of state.logins) state.labels.set(l.slug, l.label);
  const selected = state.select.value;
  const options = [{ slug: '', label: 'Default' }, ...state.logins.filter((l) => !l.removed)];
  if (selected && !options.some((l) => l.slug === selected)) options.push({ slug: selected, label: `${state.labels.get(selected) || selected} (removed)` });
  state.select.replaceChildren(...options.map((l) => {
    const option = node(el, 'option', l.label); option.value = l.slug; return option;
  }));
  state.select.value = selected;
  validate(el, ctx);
}
function drawPill(el, session, graph) {
  const slug = graph?.logins?.sessions?.[session?.sessionId];
  const login = graph?.logins?.logins?.find((l) => l.slug === slug);
  el.replaceChildren();
  if (!slug) return;
  const label = login?.label || slug;
  const pill = node(el, 'span', undefined, `card-tag login-pill${login?.removed ? ' login-pill-removed' : ''}`);
  const icon = node(el, 'span', undefined, 'login-pill-icon');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = KEY_ICON;
  pill.append(icon, node(el, 'span', login?.removed ? `${label} (removed)` : label, 'login-pill-label'));
  pill.title = login?.removed ? `Login ${label} was removed; relaunch is refused` : `Login: ${label}`;
  el.appendChild(pill);
}
function drawPanel(el, logins) {
  const state = el.loginPanel;
  logins = (logins || []).filter((l) => !l.removed);
  const signature = JSON.stringify(logins);
  if (state.signature === signature) return;
  state.signature = signature;
  const draftLabel = state.name?.value || '';
  el.replaceChildren();
  el.appendChild(node(el, 'p', 'Choose a login when dispatching. Default uses the CLIs’ own login. Off, every session relaunches on the CLIs’ own login.', 'setting-help'));
  for (const login of logins) {
    const row = node(el, 'section', undefined, 'logins-entry');
    const heading = node(el, 'div', undefined, 'logins-heading');
    heading.append(node(el, 'strong', login.label), button(el, 'Remove', () => state.send({ type: 'logins-remove', slug: login.slug })));
    row.appendChild(heading);
    for (const provider of ['claude', 'codex']) {
      const line = node(el, 'div', undefined, 'logins-provider');
      const status = login[provider];
      const label = provider === 'claude' ? 'Claude' : 'Codex';
      let text = `${label}: ${status.present ? 'logged in' : 'not logged in'}`;
      if (provider === 'claude') text = `${label}: ${status.present ? 'set up · sign-in not verified' : 'not set up'}`;
      else if (status.present && status.email) text += ` as ${status.email}`;
      line.appendChild(node(el, 'span', text));
      const actions = node(el, 'span', undefined, 'logins-actions');
      const send = (type) => () => state.send({ type, slug: login.slug, provider });
      if (status.terminal) actions.appendChild(button(el, 'Reopen terminal', send('logins-login')));
      else if (!status.present || provider === 'claude') actions.appendChild(button(el, 'Log in', send('logins-login')));
      if (status.present) actions.appendChild(button(el, 'Forget', send('logins-forget')));
      line.appendChild(actions);
      row.appendChild(line);
      if (provider === 'claude' && status.plaintext) row.appendChild(node(el, 'div', 'Claude saved this login’s credential in a plaintext .credentials.json file instead of the Keychain. Sessions still run.', 'logins-warning'));
      if (provider === 'claude' && status.oldToken) row.appendChild(node(el, 'div', 'This login’s old claude.token file is no longer used. Logins leaves it on disk.', 'setting-help'));
    }
    el.appendChild(row);
  }
  const add = node(el, 'div', undefined, 'logins-add');
  const name = node(el, 'input'); name.type = 'text'; name.placeholder = 'Login name'; name.setAttribute('aria-label', 'Login name'); name.value = draftLabel;
  state.name = name;
  add.append(name, button(el, 'Add login', () => {
    const label = name.value.trim();
    if (label) { state.send({ type: 'logins-add', label }); name.value = ''; }
  }));
  el.append(add, state.status);
}

export default {
  register(reg) {
    reg.register('dispatch.field', {
      id: 'login', at: 'advanced',
      mount(el, api, ctx) {
        const label = node(el, 'label', 'Login', 'logins-field-label');
        const select = node(el, 'select'); select.setAttribute('aria-label', 'Login');
        label.appendChild(select);
        const status = node(el, 'span', '', 'logins-field-message'); status.setAttribute('role', 'status');
        el.className += ' logins-field'; el.append(label, status);
        el.loginField = { api, select, message: status, logins: [], labels: new Map(), ctx };
        select.addEventListener('change', () => validate(el, el.loginField.ctx));
        drawField(el, ctx, null);
      },
      update: drawField,
      validate,
      ext: (el) => ({ login: el.loginField.select.value || null }),
      open(el) { el.loginField.select.value = ''; validate(el, el.loginField.ctx); },
    });
    reg.register('card.pill', {
      id: 'login', label: 'Login', mount() {}, update: drawPill,
    });
    reg.register('settings.panel', {
      id: 'logins',
      mount(el, api) {
        el.replaceChildren();
        el.className += ' logins-panel';
        const status = node(el, 'p', '', 'logins-status'); status.setAttribute('role', 'status');
        const pending = new Map();
        const state = { api, status, logins: [], pending, active: true };
        el.loginPanel = state;
        state.send = (payload) => {
          const reqId = crypto.randomUUID();
          const timer = setTimeout(() => {
            pending.delete(reqId);
            status.textContent = 'Login request timed out. Reconnect and try again.';
          }, 10000);
          pending.set(reqId, timer);
          try { api.send({ ...payload, reqId }); }
          catch { clearTimeout(timer); pending.delete(reqId); status.textContent = 'Could not send login request. Reconnect and try again.'; }
        };
        state.offMessage = api.onMessage((msg) => {
          if (!state.active) return;
          const requested = pending.has(msg.reqId);
          if (requested) { clearTimeout(pending.get(msg.reqId)); pending.delete(msg.reqId); }
          if (msg.kind === 'logins' && Array.isArray(msg.logins)) {
            state.logins = msg.logins;
            status.textContent = '';
            drawPanel(el, state.logins);
          } else if (msg.kind === 'logins-error' && (requested || !msg.reqId)) {
            status.textContent = msg.error || 'Could not update logins.';
          }
        });
        const refresh = () => state.send({ type: 'logins-get' });
        state.offConnect = api.onConnect(refresh);
        drawPanel(el, []);
        refresh();
      },
      unmount(el) {
        const state = el.loginPanel;
        if (!state) return;
        state.active = false;
        state.offMessage?.(); state.offConnect?.();
        for (const timer of state.pending.values()) clearTimeout(timer);
        state.pending.clear();
        delete el.loginPanel;
      },
    });
  },
};
