const DAY = 86400000;
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
  const runtime = state.api.runtimes?.().find((r) => r.id === ctx?.draft?.runtime);
  if (runtime?.ownLaunch) return `"${label}" cannot be used with runtime "${runtime.label || runtime.id}"`;
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
  const pill = node(el, 'span', login?.label || slug, 'card-tag login-pill');
  if (login?.removed) pill.title = 'This login was removed; relaunch is refused';
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
      let soon = false;
      if (provider === 'codex' && status.present && status.email) text += ` as ${status.email}`;
      if (provider === 'claude' && status.present && status.capturedAt) {
        const expiry = Number(status.capturedAt) + 365 * DAY;
        soon = expiry - Date.now() < 30 * DAY;
        text += ` · expires ${new Date(expiry).toLocaleDateString()}${expiry <= Date.now() ? ' · expired' : soon ? ' · expires soon' : ''}`;
      }
      line.appendChild(node(el, 'span', text, soon ? 'logins-expiry-warning' : ''));
      line.appendChild(button(el, status.present ? 'Forget' : 'Log in', () => state.send({ type: status.present ? 'logins-forget' : 'logins-login', slug: login.slug, provider })));
      row.appendChild(line);
      if (provider === 'claude' && !status.present) {
        const paste = node(el, 'div', undefined, 'logins-paste');
        const input = node(el, 'input'); input.type = 'password'; input.autocomplete = 'off'; input.placeholder = 'Claude setup-token'; input.setAttribute('aria-label', `Claude setup-token for ${login.label}`);
        paste.append(input, button(el, 'Paste token', () => {
          const token = input.value; input.value = '';
          state.send({ type: 'logins-set-claude-token', slug: login.slug, token });
        }));
        row.appendChild(paste);
        const help = node(el, 'div', 'Or run ', 'setting-help logins-paste-help');
        help.append(node(el, 'code', 'claude setup-token'), node(el, 'span', ' in a terminal, finish signing in in your browser, then paste the token it prints.'));
        row.appendChild(help);
      }
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
