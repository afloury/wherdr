## New

2.6 is the last new version of wherdr 2. It gets you ready for wherdr 3, which installs **beside** wherdr 2 rather than replacing it.

- **Updates stay on wherdr 2.** The update check only offers 2.x versions. When wherdr 3 is published, the Update button never installs it, and wherdr 2 fixes (2.6.1, 2.6.2…) are still offered.
- **A "wherdr 3 is out" card.** Once wherdr 3 is released, Home shows a card instead of the update banner, with links to its release notes and its migration guide, and a Copy button for the command that installs wherdr 3 beside this version. That command shows its plan first and changes nothing until you add `--yes`. wherdr 2 keeps running with its data, so you can compare both and go back at any time.
- **Installs follow the 2.x branch.** The Herdr plugin now updates from the `2.x` branch (**U** in the panel, and the update command, add `--ref 2.x`), and the curl installer installs `2.x` by default (`WHERDR_REF` still picks another branch or tag). If you run wherdr from a git checkout, switch it to the release branch once with `git checkout 2.x` before pulling; the update banner shows that command.
- **SVG diagrams in conversations.** A static `svg` code block shows as a theme-aware preview you can enlarge or copy; unsafe or incomplete content stays plain code. Thanks to [@guileen](https://github.com/guileen).
- **omp context at a glance.** Agent rows and the composer show how much of omp's context is used.

## Improved

- **Tighter security on the tailnet.** Without a passkey, only your own Tailscale devices can open wherdr; another user's device in a team tailnet, or a shared-in or tagged node, is refused until a passkey is set. A locked device learns nothing before unlocking (no passkey names, machine name or server clock). **Lock all devices** now invalidates every session, push subscription and open connection at once.
- **Lighter conversation reads.** While an agent writes, wherdr reads only what was added to its transcript.

## Fixed

- A finished task's Agent tab shows the agent's conversation instead of the shell left behind.
- Conversations reopen at their reading position, are not redrawn when nothing changed, and keep a sent message visible while reads fail for a while.
- A repeated Enter (from a dictation app, for example) no longer sends the same message twice, and a single stray Escape no longer stops the agent.
- Home counters and badges agree on task states, the Board grouping appears right after a reload, and two machines on one Codex account share one quota row.
- Reconnecting after a suspend or a redeploy no longer hangs on a stalled read.

## Update

No migration is required from 2.5.0. Node.js 22 or newer and Herdr 0.9.1 or newer remain required. Git checkouts: run `git checkout 2.x` once before your next `git pull`.

[Full changelog](https://github.com/afloury/wherdr/blob/v2.6.0/CHANGELOG.md)
