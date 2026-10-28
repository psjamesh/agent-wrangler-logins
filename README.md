# Logins for Agent Wrangler

Run a session on a stored second Claude or Codex login. Choose **Login** under **Advanced options** when dispatching; **Default** uses the CLIs’ own login. A card keeps its login across resume, fork and spawned children.

## Install

Requires macOS, Agent Wrangler host API **^1.51.0**, Node **20 or later**, and the Claude or Codex CLI. On any other platform, **Log in** and every launch on a login are refused, naming the platform; **Default** launches are unaffected.

In **Settings → Extensions → + Add extension**, enter **psjamesh/agent-wrangler-logins**, review the capabilities, install, and enable **Logins**. The package and runtime manifest request:

| Capability | Purpose |
| --- | --- |
| `board:rebuild` | Refresh dispatch choices and card login pills. |
| `board:broadcast` | Share sanitized login metadata across open Settings tabs. |
| `terminals:create` | Open a terminal dialog for you to sign in with a CLI. |

## Add a login

Open **Settings → Extensions → Logins**, enter a name and choose **Add login**. Each login can hold Claude, Codex, or both.

**Log in** opens a terminal dialog over Settings with the sign-in command typed but not run. Press Enter to run it. Closing the dialog leaves the terminal running, and **Reopen terminal** shows it again. A terminal that exits is not taken as a successful sign-in.

- **Claude:** **Log in** gives the login its own Claude config folder and starts `claude` there with `CLAUDE_CONFIG_DIR` set. Finish Claude's first-run steps and its browser sign-in in the dialog. Claude stores and refreshes the credential itself, in a Keychain entry tied to that folder. Logins never reads it. The command first checks the shell for the variables listed under [Refused overrides](#refused-overrides) and stops, naming them, if any is set. To sign in again later, choose **Log in** and run `/login`.
- **Codex:** choose **Log in**, press Enter, and finish `codex login`. Codex stores its credentials in the login's mirror home. Shared configuration and session rollouts remain visible to the board; authentication and private runtime sockets stay separate.

The panel shows a Claude login as **set up · sign-in not verified**. Logins does not check which account Claude signed in to.

If the Keychain can't be written, Claude falls back to a plaintext `.credentials.json` in the login's folder. The panel warns when that file exists, and each launch on that login logs a warning. The launch still runs. Logins can't stop Claude writing that file, and it only notices it at the next check.

A login set up with an earlier version of Logins may have a `claude.token` file. It is no longer used, the panel says so, and Logins leaves it on disk.

### What a Claude login shares

| Item | Handling |
| --- | --- |
| `projects/`, `sessions/`, `skills/`, `agents/`, `commands/`, `CLAUDE.md` | Linked from the default Claude folder |
| `settings.json` | Per login, copied once at setup from the default file's `hooks`, `permissions`, `model`, `statusLine`, `enabledPlugins` and `extraKnownMarketplaces`. Never `env` or `apiKeyHelper`. Later changes to either file are not copied across. |
| User-scope MCP servers | Not copied |
| `plugins/`, `daemon/`, `jobs/` | Per login. Plugins installed in the default Claude folder are not shared. |
| `.claude.json`, `.credentials.json`, policy and other account state | Never shared |

The default Claude folder is `CLAUDE_CONFIG_DIR` for the Agent Wrangler server, or `~/.claude`. Logins itself never creates, changes or deletes anything in it. Sessions on a login do write into it through the links: transcripts, session files, and any edits to `CLAUDE.md`. If `projects/` or `sessions/` is missing there, or the login's link has been replaced, launches on the login are refused, because the board could not see the session. If the default `settings.json` can't be read, **Log in** stops rather than set up a login without it.

### Refused overrides

A Claude launch on a login is refused, naming the variable, when any of these is set in the pane's environment, even to an empty string: `CLAUDE_SECURESTORAGE_CONFIG_DIR`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_OAUTH_REFRESH_TOKEN`, `CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR`, `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`, `CLAUDE_CODE_USE_ANTHROPIC_AWS`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_BEDROCK_BASE_URL`, `ANTHROPIC_VERTEX_BASE_URL`, `ANTHROPIC_FOUNDRY_BASE_URL`, `ANTHROPIC_FOUNDRY_RESOURCE`, `ANTHROPIC_PROFILE`, `ANTHROPIC_CONFIG_DIR`, `ANTHROPIC_FEDERATION_RULE_ID` and `ANTHROPIC_ORGANIZATION_ID`. Each of these either supplies its own credential or sends requests elsewhere. `CLAUDE_SECURESTORAGE_CONFIG_DIR` also picks the Keychain entry, so it could put two logins, or a login and Default, on the same credential.

The check runs in the pane after your shell starts, so shell startup files count. Headless runs, such as archive memory review, check the Agent Wrangler server's environment instead. Claude settings files are not checked yet.

**Update or renew:** choose **Forget** for the provider, then **Log in** again. This replaces only that provider's sign-in and keeps the login's name and card bindings. Forgetting Claude deletes the login's Claude folder, and the next **Log in** creates a new one with a new Keychain entry. The old Keychain entry is not deleted; to remove it, run `claude auth logout` in the dialog before choosing **Forget**. Codex refreshes its credentials automatically during use.

Settings requests metadata when opened and after reconnecting. Adding, forgetting, removing and finishing setup updates every open tab. Only labels, provider status, Codex email and warnings are delivered to the panel. Errors appear in the panel; reconnect or reopen it to retry a read.

## Run a session

In the dispatch dialog, expand **Advanced options** to find **Login**, which opens on **Default** each time. Select a login and a model supported by it. An extension that hosts the standard dispatch fields offers the same **Login** choice and validation.

A login without the chosen provider blocks dispatch. A Claude login runs only on the local runtime: dispatch, resume and fork on any other runtime, including devcontainer, are refused. For Codex, runtimes that build their own launch command are blocked because they cannot apply the login environment; local, devcontainer and runtimes that wrap the standard launch command can use Codex logins.

A login pill, with a key icon and an amber wash, names a mapped card’s login. A removed login’s pill turns grey with a dashed outline and reads **(removed)**. Resume and fork retain that login. Every spawned child inherits its parent’s login, including **Default**, regardless of supplied dispatch extension data. A cross-provider child needs both providers in its inherited login.

**Forget** removes a provider credential. **Remove** deletes a login’s credentials. Running sessions continue, but future launches, resumes, forks and headless runs refuse missing or unreadable credentials. Removed login bindings and their labels remain until their cards are purged; archive keeps them. A removed name cannot be reused while it is still bound.

Archive memory review uses the card’s Claude login. A Codex-only login refuses a Claude review, so it is skipped with a named reason. Jobs integration is outside this extension.

## Disable, update and uninstall

Off, every session relaunches on the CLIs’ own login. Running sessions keep their environment until relaunched. Stored credentials and card bindings remain; enabling Logins restores them on the next launch.

Storage lives under `<AW_DATA_DIR>/logins`, or `~/.agent-wrangler/logins` when unset. `AW_DATA_DIR` accepts `~` and `~/…`. Each login owns `login.json`, a mode `0700` `claude-<id>` Claude config folder and a `codex-home` directory. Claude's Keychain entry is tied to the folder's resolved path, so moving the data directory signs the login out. Card bindings are in `sessions.json`; removed labels are in `removed.json`. Writes use private temporary files and atomic replacement.

Updating, reinstalling and uninstalling replace only the extension’s install directory. They preserve login storage and bindings. To erase credentials, use **Forget** or **Remove** before uninstalling, or remove the separate storage directory yourself. The extension never changes the CLIs’ default login files. A launch passes only folder paths, never a credential. Programs running as the same user can still read every login's credentials, so a login is not a security boundary.

## Development

This package is dependency-free ES modules. Production imports stay inside the package or use Node builtins.

```sh
npm test
npm run docs:check
AW_HOST_CHECKOUT=/absolute/path/to/agent-wrangler npm run test:integration
```

Unit tests need no host checkout and redirect all homes into temporary directories. Integration tests require an explicit host checkout with API 1.51.0 and installed host dependencies; they exercise the real host manifest, session manager, launch hooks, dispatch-field host and archive review. Settings uses existing scoped control replies, broadcasts and reconnect listeners, and needs no host Settings graph changes.

Real sign-in, Keychain behaviour and account separation need a human with a test account. Never copy credentials into screenshots, configuration, graph data, task notes or test logs.
