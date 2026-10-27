# Logins for Agent Wrangler

Run a session on a stored second Claude or Codex login. Choose **Login** when dispatching; **Default** uses the CLIs’ own login. A card keeps its login across resume, fork and spawned children.

## Install

Requires Agent Wrangler host API **^1.48.0**, Node **20 or later**, and the Claude or Codex CLI.

In **Settings → Extensions → + Add extension**, enter **psjamesh/agent-wrangler-logins**, review the capabilities, install, and enable **Logins**. The package and runtime manifest request:

| Capability | Purpose |
| --- | --- |
| `board:rebuild` | Refresh dispatch choices and card login pills. |
| `board:broadcast` | Share sanitized login metadata across open Settings tabs. |
| `terminals:create` | Open a terminal for you to authenticate with a CLI. |

## Add a login

Open **Settings → Extensions → Logins**, enter a name and choose **Add login**. Each login can hold Claude, Codex, or both.

- **Claude:** choose **Log in**, press Enter in the terminal, and complete `claude setup-token` in your browser. Logins captures the token into a private file. **Paste token** is the fallback. The panel shows the expiry date and warns during the last month of the token’s one-year life. This token supports model requests and local MCP servers; Remote Control and claude.ai connectors are unavailable.
- **Codex:** choose **Log in**, press Enter, and finish the CLI authentication. Codex stores its credentials in the login’s mirror home. Shared configuration and session rollouts remain visible to the board; authentication and private runtime sockets stay separate.

Settings requests metadata when opened and after reconnecting. Adding, forgetting, removing and completing authentication updates every open tab. Only labels, provider presence, Claude capture time and Codex email are delivered to the panel. Errors appear in the panel; reconnect or reopen it to retry a read.

## Run a session

The dispatch dialog opens on **Default** each time. Select a login and a model supported by it. An extension that hosts the standard dispatch fields offers the same **Login** choice and validation.

A login without the chosen provider blocks dispatch. Runtimes that build their own launch command are also blocked because they cannot apply the login environment. Local, devcontainer and runtimes that wrap the standard launch command can use logins.

A login pill identifies mapped cards. Resume and fork retain that login. Every spawned child inherits its parent’s login, including **Default**, regardless of supplied dispatch extension data. A cross-provider child needs both providers in its inherited login.

**Forget** removes a provider credential. **Remove** deletes a login’s credentials. Running sessions continue, but future launches, resumes, forks and headless runs refuse missing or unreadable credentials. Removed login bindings and their labels remain until their cards are purged; archive keeps them. A removed name cannot be reused while it is still bound.

Archive memory review uses the card’s Claude login. A Codex-only login refuses a Claude review, so it is skipped with a named reason. Jobs integration is outside this extension.

## Disable, update and uninstall

Off, every session relaunches on the CLIs’ own login. Running sessions keep their environment until relaunched. Stored credentials and card bindings remain; enabling Logins restores them on the next launch.

Storage lives under `<AW_DATA_DIR>/logins`, or `~/.agent-wrangler/logins` when unset. `AW_DATA_DIR` accepts `~` and `~/…`. Each login owns `login.json`, a mode `0600` `claude.token`, and a `codex-home` directory. Card bindings are in `sessions.json`; removed labels are in `removed.json`. Writes use private temporary files and atomic replacement.

Updating, reinstalling and uninstalling replace only the extension’s install directory. They preserve login storage and bindings. To erase credentials, use **Forget** or **Remove** before uninstalling, or remove the separate storage directory yourself. The extension never changes the CLIs’ default login files. Claude’s launch environment contains its token, visible to other processes running as the same user.

## Development

This package is dependency-free ES modules. Production imports stay inside the package or use Node builtins.

```sh
npm test
npm run docs:check
AW_HOST_CHECKOUT=/absolute/path/to/agent-wrangler npm run test:integration
```

Unit tests need no host checkout and redirect all homes into temporary directories. Integration tests require an explicit host checkout with API 1.48.0 and installed host dependencies; they exercise the real host manifest, session manager, launch hooks, dispatch-field host and archive review. Settings uses existing scoped control replies, broadcasts and reconnect listeners, and needs no host Settings graph changes.

For installed-package acceptance, use an isolated host data directory and existing human-authenticated second logins. Verify a real Codex mirror turn with rollout discovery, status and cost; Claude dispatch/resume/fork; cross-provider spawn refusal then success; provider/runtime validation; disabled Default launches; an extension-owned dispatch host; and selected-login archive review. Renewed authentication requires the human. Never copy credentials into screenshots, configuration, graph data, task notes or test logs.
