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
| `sessions:read` | Read a card's folder and worktree, so a resume or fork can check the Claude settings that apply there. |

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

A Claude launch on a login is refused, naming the variable, when any of these is set in the pane's environment, even to an empty string: `CLAUDE_SECURESTORAGE_CONFIG_DIR`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_OAUTH_REFRESH_TOKEN`, `CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR`, `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`, `CLAUDE_CODE_USE_ANTHROPIC_AWS`, `CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD`, `CLAUDE_CODE_USE_MANTLE`, `CLAUDE_CODE_USE_GATEWAY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_BEDROCK_BASE_URL`, `ANTHROPIC_VERTEX_BASE_URL`, `ANTHROPIC_FOUNDRY_BASE_URL`, `ANTHROPIC_FOUNDRY_RESOURCE`, `ANTHROPIC_AWS_BASE_URL`, `ANTHROPIC_GOOGLE_CLOUD_BASE_URL`, `ANTHROPIC_BEDROCK_MANTLE_BASE_URL`, `CLAUDE_CODE_API_BASE_URL`, `ANTHROPIC_PROFILE`, `ANTHROPIC_CONFIG_DIR`, `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`, `CLAUDE_CODE_CUSTOM_OAUTH_URL`, `CLAUDE_CODE_HOST_AUTH_ENV_VAR` and `CLAUDE_CODE_MANAGED_SETTINGS_PATH`. Each of these supplies its own credential, sends requests elsewhere, or reads settings from somewhere Logins does not check. `CLAUDE_SECURESTORAGE_CONFIG_DIR` and `CLAUDE_CODE_CUSTOM_OAUTH_URL` also pick the Keychain entry, so they could put two logins, or a login and Default, on the same credential.

The check runs in the pane after your shell starts, so shell startup files count. Headless runs, such as archive memory review, check the Agent Wrangler server's environment instead. A variable another enabled extension adds to the launch environment is set after this check, so the check does not see it.

### Claude settings checked at launch

Before each Claude dispatch, resume, fork or headless run on a login, Logins reads every Claude settings file that could apply to it. It refuses the launch, naming the file and the setting, when a file sets any of these, even to an empty value:

- an `env` entry for a variable under [Refused overrides](#refused-overrides), or for `CLAUDE_CONFIG_DIR`;
- `apiKeyHelper`, `awsAuthRefresh`, `awsCredentialExport` or `gcpAuthRefresh`;
- in a managed source, `policyHelper` or `policyHelpers`, because what the helper returns can't be read in advance.

| Source | Files read |
| --- | --- |
| Managed | `/Library/Application Support/ClaudeCode/managed-settings.json` and `managed-settings.d/*.json`; `com.anthropic.claudecode.plist` in `/Library/Managed Preferences/` and in its folder for your user name; `remote-settings.json` in the login's Claude folder |
| Login user | `settings.json` and `settings.local.json` in the login's Claude folder |
| Project and local | `.claude/settings.json` and `.claude/settings.local.json` in the launch folder |
| Ancestors | The same two files in every folder above the launch folder, up to `/` |
| Worktree | The same two files in the card's worktree folder and repository root, and in the main checkout of any git worktree found on the way up, with every folder above them |

The launch folder is the dispatch's folder for a new card, the card's folder for a resume, and the parent card's folder for a fork. If that folder no longer exists, your home folder is checked too, because Agent Wrangler starts there instead. Headless runs start in the server's temporary folder, so that is the folder checked. A launch whose folder isn't known is refused.

Ancestors include your home folder, so a launch from anywhere under it reads `~/.claude/settings.json` and `~/.claude/settings.local.json`. A refused setting in your default Claude settings therefore refuses login launches from those folders. Move it into the projects that need it, or launch from outside your home folder.

A file that exists but can't be used refuses the launch, naming the file. This covers a missing read permission on the file or a folder above it, invalid JSON, settings or `env` that aren't an object, a broken symlink and a plist that `plutil` can't convert. Logins never treats such a file as clean. Only a file that doesn't exist counts as absent.

Logins checks the files once, as the launch starts. It can't see:

- settings that an organisation's server sends to Claude after it starts;
- what an administrator's policy helper returns;
- a file changed after the check;
- a source that a later Claude version adds.

A launch that passes the check is not proof of which account Claude uses.

**Update or renew:** choose **Forget** for the provider, then **Log in** again. This replaces only that provider's sign-in and keeps the login's name and card bindings. Forgetting Claude deletes the login's Claude folder, and the next **Log in** creates a new one with a new Keychain entry. The old Keychain entry is not deleted; to remove it, run `claude auth logout` in the dialog before choosing **Forget**. Codex refreshes its credentials automatically during use.

Settings requests metadata when opened and after reconnecting. Adding, forgetting, removing and finishing setup updates every open tab. Only labels, provider status, Codex email and warnings are delivered to the panel. Errors appear in the panel; reconnect or reopen it to retry a read.

## Run a session

In the dispatch dialog, expand **Advanced options** to find **Login**, which opens on **Default** each time. Select a login and a model supported by it. An extension that hosts the standard dispatch fields offers the same **Login** choice and validation.

A login without the chosen provider blocks dispatch. A Claude login runs only on the local runtime: dispatch, resume and fork on any other runtime, including devcontainer, are refused. For Codex, runtimes that build their own launch command are blocked because they cannot apply the login environment; local, devcontainer and runtimes that wrap the standard launch command can use Codex logins.

A login pill, with a key icon and an amber wash, names a mapped card’s login. A removed login’s pill turns grey with a dashed outline and reads **(removed)**. Resume and fork retain that login. Every spawned child inherits its parent’s login, including **Default**, regardless of supplied dispatch extension data. A cross-provider child needs both providers in its inherited login.

**Forget** removes a provider credential. **Remove** deletes a login’s credentials. Running sessions continue, but future launches, resumes, forks and headless runs refuse missing or unreadable credentials. Removed login bindings and their labels remain until their cards are purged; archive keeps them. A removed name cannot be reused while it is still bound.

Archive memory review uses the card’s Claude login. A Codex-only login refuses a Claude review, so it is skipped with a named reason. Jobs integration is outside this extension.

## Acceptance on an installed package

Run these on macOS after installing or updating Logins from **Settings → Extensions**. Use two Claude test accounts, A and B, that are not your everyday account. Don't record tokens, credentials or Keychain contents while you work. A terminal that exits is not proof of a sign-in: check the account with `/status` in the session.

Before you start, run `claude auth status` in a plain terminal and note Default's account. Also note the modification time of `~/.claude/settings.json` with `ls -l`.

| Check | Do | Expect |
| --- | --- | --- |
| Isolated, stable login | Add **Test A**, choose **Log in** for Claude, finish onboarding and sign in as A. Note its `claude-<id>` folder under `~/.agent-wrangler/logins/test-a/`. Dispatch a Claude session on **Test A**, then restart Agent Wrangler and dispatch another. | Both sessions show account A in `/status`, the second without signing in again. The `claude-<id>` folder name doesn't change. |
| Separation | Add **Test B** and sign it in as B. Run a session on each login at the same time. Then choose **Forget** for Claude on **Test B** and dispatch on **Test A** again. | Each session shows its own account. After forgetting B, **Test A** still shows A and B's launches are refused. |
| Default preserved | Dispatch a **Default** session. Run `claude auth status` in a plain terminal and `ls -l ~/.claude/settings.json`. | The session and the terminal both show Default's account from the start. The settings file's modification time is unchanged. |
| Locked Keychain | Lock the login keychain in Keychain Access, then resume a **Test A** card. | macOS asks to unlock it, or Claude says it isn't signed in. The session never uses account B or Default's account. After unlocking, a resume shows A. |
| Plaintext fallback | Create an empty `.credentials.json` in **Test B**'s `claude-<id>` folder, then dispatch on **Test B**. Delete the file afterwards. | The panel warns about a plaintext credential. The server log shows `keeps its Claude credential in a plaintext .credentials.json`, and the launch still runs. |
| Resume and fork | On a **Test A** card, send a message, suspend and resume the card, then fork it. Fork a **Default** card too. | The resumed card and its fork keep the **Test A** pill and show A in `/status`. The **Default** fork has no pill and shows Default's account. |
| Settings refusal | In a test project, add `{"env":{"ANTHROPIC_BASE_URL":"http://127.0.0.1:9"}}` to `.claude/settings.local.json` and dispatch on **Test A** there. | The dispatch is refused, naming that file and `ANTHROPIC_BASE_URL`. A **Default** dispatch there is not affected by Logins. |

To clean up, run `claude auth logout` in each test login's dialog, then **Remove** the logins.

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

Unit tests need no host checkout and redirect all homes and managed settings paths into temporary directories. Integration tests require an explicit host checkout with API 1.51.0 and installed host dependencies; they exercise the real host manifest, session manager, launch hooks, dispatch-field host and archive review. Settings uses existing scoped control replies, broadcasts and reconnect listeners, and needs no host Settings graph changes.

Real sign-in, Keychain behaviour and account separation need a human with a test account. Never copy credentials into screenshots, configuration, graph data, task notes or test logs.
