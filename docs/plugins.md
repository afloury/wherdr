# Plugins

[Documentation](README.md) · [Project](../README.md)

In v3 (herdr-core), only [wherdr plugins](#wherdr-plugins), which run in the wherdr page, are
available. The wherdr Herdr plugin (its installer, panel and key) and the actions of Herdr
plugins are **v2 only**: they need Herdr.

### Install as a Herdr plugin

> [!NOTE]
> **v2 only.** This section installs wherdr v2 next to Herdr. It does not install v3.

This is what [the one command](https://github.com/afloury/wherdr/blob/main/docs/installation.md) installs; you can also run it yourself, on Linux
and macOS, with Herdr ≥ 0.9.1 (no checks for Herdr or Node.js first). In three lines:

1. Run `herdr plugin install afloury/wherdr`: it installs wherdr, starts it
   (`✓ wherdr is running → http://localhost:7683`) and, at the first install on a computer with a
   screen, opens the setup guide in your browser (`open` on macOS, `xdg-open` on Linux with a
   display; a headless server, or `WHERDR_NO_BROWSER=1` in the environment of the install, just
   prints `http://localhost:7683/#/setup`). Updates open nothing.
2. In Herdr, press **prefix+i** (`ctrl+b` then `i` with the default prefix): the **wherdr** panel,
   with the state, **O** Open wherdr and **P** Set up my phone. The install prints the key it
   chose (see [Panel key](plugins.md#panel-key)).
3. **P** opens Settings › Phone in the browser: **Make wherdr reachable from my phone** publishes
   it on your tailnet, then the QR code shows once the address answers. Scan it with the iPhone,
   then Share → Add to Home Screen.

Herdr shows the manifest and the commands it will run, then the plugin installs wherdr in
`~/wherdr` and starts it, unless something already answers on the port. If wherdr cannot start,
the install still succeeds and says why; press **S** in the panel once it is fixed. It runs
wherdr natively:

- **Node.js 22**, on Linux and macOS: the plugin downloads the prebuilt package of its version
  from GitHub Releases and verifies its SHA-256 checksum, copies it to `~/wherdr/app` and runs it
  from there (detached, or by the login service), with its pid and log (`wherdr.log`) in
  `~/wherdr`. Herdr builds plugins in a temporary folder and then moves them, so the server never
  runs from the plugin folder. Bun works too when Node.js 22 is missing. Without either, the
  install stops and says so ([the one command](https://github.com/afloury/wherdr/blob/main/docs/installation.md) offers to install Node.js).
The **wherdr** panel (a Herdr popup) shows ● running / ○ stopped, the local address, the phone
address (with its QR code once it answers), and two main keys: **O** Open wherdr, **P** Set up my
phone (Settings › Phone in the browser). The other keys stay as a fallback: **S** start, **X**
stop, **R** restart, **L** log (Ctrl+C to go back), **U** update (reinstalls the plugin), **A** auto-start at login on/off, **Q** quit.

#### Panel key

Herdr plugins have no menu of their own: an action runs from a key or from the command line. The
install therefore appends one marked block to Herdr's `config.toml` (`HERDR_CONFIG_PATH`, or
`~/.config/herdr/config.toml`):

```toml
# wherdr: key that opens the wherdr panel (remove this block to unbind it)
[[keys.command]]
key = "prefix+i"
type = "plugin_action"
command = "afloury.wherdr.panel"
description = "wherdr"
# end wherdr
```

It takes the first key of `prefix+i`, `prefix+u`, `prefix+y`, `prefix+m`, `prefix+alt+w` that
neither Herdr's default keymap nor your config already binds, and prints
`Press prefix+i in Herdr to open the wherdr panel.` Your own lines are never changed. Nothing is
added when a key already runs the panel, when every candidate is taken, or when
`herdr config check` would reject the result. The install then runs `herdr server reload-config`:
keys apply without restarting Herdr. Pick another key by editing the block, or bind the panel
yourself (`command = "afloury.wherdr.panel"`) before installing.

Without a key: `herdr plugin action invoke panel --plugin afloury.wherdr`. The plugin's actions:

| Action | What it does |
|---|---|
| `panel` | The **wherdr** panel (a popup) |
| `open` | Opens wherdr in the browser (its tailnet address when published and answering) |

Up to 1.2.0 the panel action was called `wherdr`: change a key bound to `afloury.wherdr.wherdr` to
`afloury.wherdr.panel` (Herdr has no action aliases; the install warns about such a key and
leaves it alone). Remove the block with `sh scripts/herdr-plugin.sh key uninstall` in the plugin
folder (`~/.config/herdr/plugins/github/wherdr-…`), or delete the lines from `# wherdr:` to `# end wherdr`.

Auto-start: the plugin's startup hook starts wherdr each time the Herdr server starts, when
nothing answers on the port yet. [The one command](https://github.com/afloury/wherdr/blob/main/docs/installation.md) also installs a login
service (a LaunchAgent on macOS, a `systemd --user` unit with lingering on Linux, pointing at
`~/wherdr/app` with the absolute path of the runtime and your [PATH](https://github.com/afloury/wherdr/blob/main/docs/installation.md)): wherdr then
runs from boot and is restarted if it crashes. Key **A** in the panel turns it on or off;
`herdr plugin install` alone does not add it, since it changes your login session.

Herdr runs the plugin's commands with the environment of its server, whose `PATH` often lacks the
folders of version managers (n, nvm, fnm, Volta, asdf). The install therefore saves the absolute
path of the runtime in `~/wherdr/plugin.env` (`WHERDR_RUNTIME=/path/to/node`); if that binary
disappears, **Start** looks in the usual places (`~/.n/bin`, `~/.nvm`, `~/.volta/bin`, fnm,
`~/.asdf/shims`, Homebrew, `/usr/local/bin`, `~/.bun/bin`) and saves what it finds. Set
`WHERDR_RUNTIME` there by hand for anything else. **Start** only reports success once the
process is alive and the port answers; otherwise it prints the last lines of `wherdr.log`.

When something already answers on the port (a wherdr started with systemd or by hand),
the plugin starts nothing and never stops it: **Stop** only stops what the plugin started. The
output of the install and of the startup hook is in the plugin logs:
`herdr plugin log list --plugin afloury.wherdr`.

**Uninstall.** Herdr has no uninstall hook, so remove wherdr in this order: in the panel, **A**
(if the login service is on) and **X**; in the plugin folder, `sh scripts/herdr-plugin.sh key
uninstall` (the panel key) and `sh scripts/herdr-plugin.sh skill uninstall`; then
`herdr plugin uninstall afloury.wherdr && rm -rf ~/wherdr` (`~/wherdr/data` holds your passkeys
and push keys).

## Herdr plugins

> [!NOTE]
> **v2 only.** Herdr plugin actions need Herdr; they are not shown with herdr-core.

Actions declared by the plugins installed on a machine (`herdr plugin install|link`) appear in
the menus: workspace / tab / pane actions in the agent menu, global actions in the machine menu.
wherdr always passes the agent's pane explicitly. It asks for confirmation before running an
action, except for actions that only show or check something (list, show, status, doctor…).
Actions that open a plugin pane or popup open it in the attached Herdr terminal client, not on the
phone: the menu marks them **Opens in Herdr**. wherdr's own plugin actions (its panel, open in the
browser) are not listed. With a single machine, the machine's actions are in the **…** menu of
its session row, under the agent list header.

## wherdr plugins

wherdr plugins are small JavaScript bundles that run in the wherdr page, Obsidian style. They are
**optional and none is installed by default**: with an empty (or missing) plugins folder, wherdr
behaves exactly as without the feature. There is no install from GitHub yet; you copy the plugin
yourself. A plugin has full access to the page, so only install code you trust.

### Install

Put one folder per plugin in `plugins/` of wherdr's data directory (`DATA_DIR`, `./data` by
default), then reload the page:

```
data/plugins/my-plugin/manifest.json
data/plugins/my-plugin/index.js
```

```json
{ "name": "My plugin", "version": "1.0.0", "description": "What it does.", "main": "index.js" }
```

The folder name is the plugin id (`a-z`, `0-9`, `.`, `_`, `-`). `main` is optional (default
`index.js`): a plain file name of a prebuilt ES module in the same folder (no build step in wherdr,
no sub-folders). **Settings › Plugins** lists the installed plugins with a switch each; the choice
is kept per device.

### Build and install a plugin (step by step)

A plugin is two files in one folder: `manifest.json` and a prebuilt ES module. The complete
working example is [`examples/plugins/hello-mic/`](../examples/plugins/hello-mic/): a microphone
button next to Send that inserts a fixed sample text (no audio). A larger, experimental one is
[`examples/plugins/mini-board/`](../examples/plugins/mini-board/): a task board whose coordinator
agent starts worker agents (herdr-core only). To follow the steps without
writing code, install it as is.

1. **Write** `src/index.ts` (or plain `index.js`). Export an object `{ activate(wherdr), deactivate() }`
   (or a function) as described in [The module](#the-module). Find your zone with its
   `data-wherdr` marker, and attach to it again when it reappears (use a `MutationObserver` and/or
   `wherdr.onNavigate`). Undo everything in `deactivate()`.
2. **Build** one ES module with no external imports (the example uses esbuild, installed with the repo's
   dependencies; any bundler works): `npx esbuild src/index.ts --bundle --format=esm --target=es2020 --outfile=index.js`.
   For the example: `npm run build:example-plugin` from the repo root.
3. **Install**: copy `manifest.json` and `index.js` (not the sources) to
   `<DATA_DIR>/plugins/<id>/`, e.g. `mkdir -p data/plugins/hello-mic && cp examples/plugins/hello-mic/{manifest.json,index.js} data/plugins/hello-mic/`.
   Reload the page: no restart needed.
4. **Check**: Settings › Plugins lists it as "On". If it says "Disabled after an error", the message is
   the exception; fix it and flip the switch.
5. **Remove**: delete the folder and reload; wherdr is back to exactly how it was.

### The module

The default export is a function, or an object with `activate` (and optionally `deactivate`),
called once with the `wherdr` object:

```js
export default function (wherdr) {
  const off = wherdr.onNavigate((path) => console.log('now at', path))
  const button = document.createElement('button')
  button.textContent = 'Fix'
  button.onclick = () => wherdr.draft.insert('Please fix the failing test.')
  document.querySelector('[data-wherdr="composer-actions"]')?.append(button)
}
```

| API | Meaning |
|---|---|
| `wherdr.apiVersion` | `1`. Additions keep the number; a breaking change raises it. |
| `wherdr.draft.insert(text)` | Appends `text` to the draft of the open conversation (nothing is sent). No-op when no conversation is open. |
| `wherdr.currentAgent()` | `{ id, agent, name, machine }` of the open conversation, or `null` (`agent` is `claude`, `codex`, `omp`… or `null` for a terminal). |
| `wherdr.onNavigate(cb)` | `cb(path)` after each page change (`/`, `/settings?section=plugins`…). Returns the function that unsubscribes. |
| `wherdr.agents`, `wherdr.state`, `wherdr.files` | Agents, state and project files: [below](#agents-state-and-project-files-herdr-core). |

### Agents, state and project files (herdr-core)

> [!NOTE]
> **Experimental additions** (apiVersion stays `1`). `agents.start` labels and `files` need
> herdr-core (v3); the example that uses them is
> [`examples/plugins/mini-board/`](../examples/plugins/mini-board/).

| API | Meaning |
|---|---|
| `wherdr.agents.start({ machine, folder, agent, name, firstMessage, labels })` | Starts an agent (`claude`, `codex`…) in `folder` (absolute, under the machine's home) through the same path as the New sheet. `machine`: `''` (this one, the default) or the `machine` of an agent below. `labels`: at most 8, keys `wherdr.*` only (placement labels stay wherdr's). `firstMessage` is sent once the agent is ready. Resolves to `{ id, name, firstMessage }` (`firstMessage`: `sent`, `queued` behind a dialog, `skipped` or `null`). |
| `wherdr.agents.open(id)` | Opens the agent's conversation. |
| `wherdr.state.agents()` | The agents now: `[{ id, name, agent, status, labels, folder, machine }]`. `labels` holds the terminal's `wherdr.*` labels only. |
| `wherdr.state.subscribe(cb)` | `cb(agents)` at once, then after each change of that list. Returns the function that unsubscribes. A throw disables the plugin, like `onNavigate`. |
| `wherdr.files.read(machine, path)` | Text of a file, or `null` when it does not exist (1 MB max). |
| `wherdr.files.write(machine, path, text)` | Writes the file (replaced in one step; missing folders are created; 200 KB max). |

`files` only reach a **project folder**: a Git repository strictly below the machine's home. The
path is absolute; hidden folders are refused (so `~/.ssh`, `~/.config`, `.git`…), except `.wherdr`
for plugin data; so are wherdr's `DATA_DIR` and symbolic links. The checks run on the machine on
the real path (`machine.exec`). These calls go through the usual lock and network checks; their
routes are `/api/agents` and `/api/plugin-files/read|write` (exact entries in
`shared/coreRoutes/plugins.ts`). There is still no server part for plugins.

### Failures are isolated

A plugin that throws while loading or activating, does not answer within 8 seconds, has no valid
default export, or whose `onNavigate` callback throws, is **disabled**: its listeners are removed
and Settings › Plugins shows it as "Disabled after an error" with the message. The other plugins
and the app keep working. The switch tries it again. Errors thrown by your own DOM listeners
(like the button above) are yours to catch.

### Markers: `data-wherdr`

Key zones carry a stable `data-wherdr` attribute. **These values are a public contract**: they are
not renamed or removed within a major version; the markup inside a zone is not part of it.

| Marker | Zone |
|---|---|
| `composer` | The whole message box of a conversation. |
| `composer-field` | The text field. |
| `composer-actions` | An empty slot in the field's footer, just before Send: append your buttons to it. |
| `conversation` | The conversation view (the messages). |
| `home-list` | The home screen with the list of agents. |
| `settings` | The Settings page. |
| `settings-plugins` | The wherdr plugins block of Settings › Plugins. |

Plugins run before or after a zone is created (zones come and go with navigation): look up the
marker on each `onNavigate`, or observe the document, rather than once at load.

### Not yet

Install from GitHub, a server part for plugins, and signing or permissions. A plugin's CSS is its
own business: use wherdr's theme variables (`var(--line)`, `var(--dim)`…) to blend in.
