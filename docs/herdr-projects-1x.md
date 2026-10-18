# Moving from herdr-projects 0.2 to 1.x

wherdr 2.0 reads herdr-projects **1.2.1 or later** only. wherdr 1.3.4 is the last version
that reads herdr-projects 0.2 (its Project panel, `TASKS.md`, threads). This page moves one
machine from 0.2 to 1.x, keeps a backup, and says how to go back. Do it on each machine that
runs herdr-projects.

herdr-projects 1.x is a different program, not a newer 0.2: one work board of tasks, each
handed to an agent in its own space, reviewed when it finishes and merged on your yes. Your
0.2 projects are **not converted**. 1.x sets them aside, whole, in `~/.herdr-projects-legacy`
and never deletes them. Upstream describes what it does in
[older installs](https://github.com/eliasstravik/herdr-projects/blob/main/docs/old-installs.md).

## Before you start

- Herdr 0.9.3 or later (`herdr --version`): the oldest Herdr herdr-projects 1.2.1 was checked on.
- No 0.2 thread you still need running: finish or stop them first. 1.x asks the 0.2 ticker to
  stop, and moves nothing while it still runs.
- Note what each 0.2 project still had to do (its `TASKS.md`): you will tell the 1.x
  Coordinator about it after the move.

## 1. Back up

1.x moves folders and edits a few files outside them (it backs those up itself, beside them,
as `<file>.bak-herdr-projects`). Keep your own copy too:

```sh
cd ~ && for p in .herdr-projects .config/herdr-projects .local/state/herdr/plugins/herdr-projects \
  .config/herdr/config.toml .config/herdr/plugins.json; do [ -e "$p" ] && echo "$p"; done \
  | tar czf ~/herdr-projects-0.2-backup-$(date +%F).tgz -T -
tar tzf ~/herdr-projects-0.2-backup-$(date +%F).tgz | head
```

The archive holds your whole projects (their libraries, uploads and thread records): expect
hundreds of megabytes. Keep it until you are sure you will not go back: it is the only full copy
of Herdr's `config.toml` as it was (see [Going back](#going-back-to-02), step 4).

## 2. Install herdr-projects 1.2.1

```sh
herdr plugin uninstall herdr-projects && herdr plugin install eliasstravik/herdr-projects --ref v1.2.1 --yes
```

Uninstalling removes only Herdr's copy of the plugin; your projects stay where they are.

Then, in the Herdr terminal client, reload its config (`prefix` + `Shift` + `R`) and open the
work board once (the plugin action **Open the work board**). Its first run sets the 0.2 files
aside and says so in one line. Without an attached client, the same from a shell:

```sh
herdr server reload-config && herdr plugin action invoke open --plugin herdr-projects
```

Check where things stand:

```sh
~/.herdr-projects/data/bin/herdr-projects doctor
```

`doctor` lists what it took over and anything left to do (it exits with 1 when something needs
you). Running it again changes nothing.

What the first run changes, besides moving the 0.2 folders:

- **`herdr-projects` leaves your PATH.** The link 0.2 had put there (`~/.local/bin/herdr-projects`)
  is removed, and `doctor` reports it until you add 1.x's launcher folder to your PATH (in
  `~/.profile` or your shell's start-up file):
  `export PATH="$HOME/.herdr-projects/data/bin:$PATH"`.
- **Herdr's config** loses 0.2's tab bar line, its key (`herdr-projects.open-popup`) and **both**
  custom sidebar rows (agents and spaces): Herdr's own sidebar comes back. A
  `[safety."~/.herdr-projects/<project>"]` section is left as it was, though that folder is now in
  `~/.herdr-projects-legacy`: remove it or point it there.
- **Agents' settings** (Claude, Codex…) lose only 0.2's `herdr-projects … hook --agent …` hooks.

Do not run `herdr-projects update` on a machine that still had 0.2 before this step: install
1.2.1 as above.

## 3. Update wherdr

- npm: `npm install -g wherdr@latest`
- Docker: `docker compose pull && docker compose up -d` in wherdr's folder.

Open **Settings › Plugins › herdr-projects**: each machine says **Installed · v1.2.1**. The
**Board** (next to Settings) shows the tasks; write to the Coordinator in its box to add the
work your 0.2 projects still had.

## Going back to 0.2

1. **Stop everything of 1.x first**, so nothing writes while folders move:

   ```sh
   ~/.herdr-projects/data/bin/herdr-projects coordinator stop   # its Coordinator
   herdr plugin disable herdr-projects                           # its hooks and its board key
   pgrep -af herdr-projects                                      # what still runs (board, keeper, page server, jobs)
   ```

   `disable` does not stop what already runs. Close the work board's tab in Herdr: that ends the
   board, but its `keeper` and `keeper-work` keep running. Stop each process `pgrep` still lists by
   its number (`kill <pid>`) and run `pgrep -af herdr-projects` again until it lists nothing.

2. **Uninstall 1.x**: `herdr plugin uninstall herdr-projects`

3. **Put the 0.2 folders back.** 1.x wrote down where it put each one in
   `~/.herdr-projects/moved.json`: `~/.herdr-projects-legacy`, or `-legacy-2`, `-legacy-3`… when an
   older one was already there. Do not guess the names: this lists them, then puts each folder back.
   A folder already at the old place (1.x's own board, or a folder created since) is set aside
   first, as `<name>.from-1x-1` (or the next free number), never moved inside it. Running it a
   second time changes nothing.

   ```sh
   if [ ! -s ~/herdr-projects-restore.tsv ]; then
   python3 - <<'PY' > ~/herdr-projects-restore.tsv.new && mv ~/herdr-projects-restore.tsv.new ~/herdr-projects-restore.tsv
   import json, os
   moved = json.load(open(os.path.expanduser('~/.herdr-projects/moved.json')))
   for v in moved.get('legacy', {}).values():
       print(v['from'] + '\t' + v['to'])
   PY
   fi
   cat ~/herdr-projects-restore.tsv    # each line: old place <tab> where 1.x put it

   restore() {
     dest=$1 src=$2
     [ -e "$src" ] || { echo "not found, skipped: $src"; return 0; }
     if [ -e "$dest" ] || [ -L "$dest" ]; then
       n=1; while [ -e "$dest.from-1x-$n" ] || [ -L "$dest.from-1x-$n" ]; do n=$((n + 1)); done
       mv "$dest" "$dest.from-1x-$n" && echo "set aside: $dest -> $dest.from-1x-$n" || return 1
     fi
     mv "$src" "$dest" && echo "restored: $src -> $dest"
   }
   tab=$(printf '\t')
   while IFS="$tab" read -r from to; do restore "$from" "$to" || break; done < ~/herdr-projects-restore.tsv
   ```

   1.x's own board is now in `~/.herdr-projects.from-1x-<n>`: keep it if you may come back to 1.x.

4. Put back the files 1.x changed.
   - **Herdr's config: restore it from your backup of step 1**, not from
     `config.toml.bak-herdr-projects`. 1.x rewrites that one file at each change it makes to
     Herdr's config (adding its own key, then taking it out again on uninstall), so it only holds the
     state before its last change, without 0.2's lines. Compare, then restore:

     ```sh
     cd ~ && tar xzf ~/herdr-projects-0.2-backup-<date>.tgz -O .config/herdr/config.toml > /tmp/herdr-config-0.2.toml
     diff ~/.config/herdr/config.toml /tmp/herdr-config-0.2.toml
     cp /tmp/herdr-config-0.2.toml ~/.config/herdr/config.toml && herdr server reload-config
     ```

   - **Agents' settings** (Claude, Codex…): 1.x changes them once, so their
     `<file>.bak-herdr-projects` is the file as it was before the move. Compare before restoring,
     since the file may have changed since:
     `diff ~/.claude/settings.json ~/.claude/settings.json.bak-herdr-projects`, then
     `cp ~/.claude/settings.json.bak-herdr-projects ~/.claude/settings.json` (same for
     `~/.codex/hooks.json` and the others `doctor` named).
5. Reinstall 0.2 from the fork wherdr 1.3.4 installs, pinned to `v0.2.36`: the command is in
   wherdr 1.3.4's README and in its **Settings › Plugins › herdr-projects**. `v0.2.36` exists only on
   that fork: upstream's last 0.2 tag is `v0.2.35`, whose `herdr-projects update` would offer 1.x
   again. The install puts the `herdr-projects` link back on your PATH.
6. Go back to wherdr 1.3.4: `npm install -g wherdr@1.3.4`, or with Docker set the image tag in
   `docker-compose.yml` to `1.3.4`, then `docker compose pull && docker compose up -d`.

If anything is missing, the backup from step 1 has everything as it was:
`cd ~ && tar xzf ~/herdr-projects-0.2-backup-<date>.tgz` (with herdr-projects stopped).
