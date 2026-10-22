# Herdr plugins

[Documentation](README.md) · [Project](../README.md)

### Install as a Herdr plugin

This is what [the one command](installation.md#the-one-command) installs; you can also run it yourself, on Linux
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
  install stops and says so ([the one command](installation.md#the-one-command) offers to install Node.js).
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
nothing answers on the port yet. [The one command](installation.md#the-one-command) also installs a login
service (a LaunchAgent on macOS, a `systemd --user` unit with lingering on Linux, pointing at
`~/wherdr/app` with the absolute path of the runtime and your [PATH](installation.md#agent-path)): wherdr then
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

Actions declared by the plugins installed on a machine (`herdr plugin install|link`) appear in
the menus: workspace / tab / pane actions in the agent menu, global actions in the machine menu.
wherdr always passes the agent's pane explicitly. It asks for confirmation before running an
action, except for actions that only show or check something (list, show, status, doctor…).
Actions that open a plugin pane or popup open it in the attached Herdr terminal client, not on the
phone: the menu marks them **Opens in Herdr**. wherdr's own plugin actions (its panel, open in the
browser) are not listed. With a single machine, the machine's actions are in the **…** menu of
its session row, under the agent list header.
