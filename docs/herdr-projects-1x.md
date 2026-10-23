# Moving from herdr-projects 0.2 to 1.x

wherdr 2.0 reads herdr-projects **1.2.1 or later** only. wherdr 1.3.4 is the last version
that reads herdr-projects 0.2 (its Project panel, `TASKS.md`, threads). This page moves one
machine from 0.2 to 1.x, keeps a backup, and says how to go back. Do it on each machine that
runs herdr-projects.

wherdr 2.0 runs only **natively**, as a service of your user. A wherdr 1.x running in Docker
moves first: [Moving from Docker to the native service](#moving-from-docker-to-the-native-service), below.

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
cd ~ && if [ -s ~/herdr-projects-0.2-backup.path ]; then
  echo "backup already made, kept: $(cat ~/herdr-projects-0.2-backup.path)"
else
  backup="$HOME/herdr-projects-0.2-backup-$(date +%Y%m%d-%H%M%S).tgz"
  files=$(for p in .herdr-projects .config/herdr-projects .local/state/herdr/plugins/herdr-projects \
    .config/herdr/config.toml .config/herdr/plugins.json; do [ -e "$p" ] && echo "$p"; done)
  if ! printf '%s\n' "$files" | grep -q herdr-projects; then
    echo "NO 0.2 FILES FOUND in $HOME: nothing backed up, check you are the user who runs Herdr"
  elif [ ! -e "$backup" ] && printf '%s\n' "$files" | tar czf "$backup" -T - \
    && tar tzf "$backup" > /dev/null; then
    echo "$backup" > ~/herdr-projects-0.2-backup.path && echo "backup ok: $backup"
    printf '%s\n' "$files" | grep -qx .config/herdr/config.toml \
      || echo "no Herdr config.toml to keep: step 5 of Going back has nothing to restore"
  else
    echo "BACKUP FAILED: do not go on"
  fi
fi
```

Go on only after `backup ok` (or `backup already made`). The archive has a new name each time
and is never overwritten. `~/herdr-projects-0.2-backup.path` keeps the path of the **first**
one: running this again, for example after an install that stopped halfway, keeps that first
backup instead of saving files 1.x has already changed. The steps of
[Going back](#going-back-to-02) read the path from that file.

The archive holds your whole projects (their libraries, uploads and thread records): expect
hundreds of megabytes. Keep it, and its `.path` file, until you are sure you will not go back:
it is the only full copy of Herdr's `config.toml` as it was (see
[Going back](#going-back-to-02), step 5).

## 2. Install herdr-projects 1.2.21

```sh
herdr plugin uninstall herdr-projects && herdr plugin install eliasstravik/herdr-projects --ref v1.2.21 --yes
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

Installing a new version does not change a wherdr that is already running: restart it too.

- The installer (Herdr plugin, the recommended setup): `curl -fsSL https://wherdr.dev/install | sh`
  again, or **U** in the **wherdr** panel. It fetches the GitHub release package directly, and
  wherdr restarts on the new version.
- npm: `npm install -g wherdr@latest && wherdr restart` (npm may hold a new release for up to two
  days).
- Homebrew: `brew upgrade wherdr && brew services restart wherdr`
- A 1.x Docker install: there is no 2.0 image; move to the native service first
  ([Moving from Docker to the native service](#moving-from-docker-to-the-native-service)).

Check the version wherdr now serves in **Settings › About**: 2.0 or later. Still 1.3.4 means the
old process is still running: restart it.

Open **Settings › Plugins › herdr-projects**: each machine says **Installed · v1.2.21**. The
**Board** (next to Settings) shows the tasks; write to the Coordinator in its box to add the
work your 0.2 projects still had.

## Push when a task needs you

herdr-projects tells you when a task needs you, is ready to approve, or failed, through its
`board.notify` setting: it can run a command for each event. Point it at Herdr's own
notifications, which wherdr already sends to your phone. Run once on each machine with
herdr-projects:

```sh
~/.herdr-projects/data/bin/herdr-projects set board.notify 'herdr notification show --body="$HERDR_PROJECTS_TITLE" --sound request -- "$HERDR_PROJECTS_ID · $HERDR_PROJECTS_EVENT"'
```

The push names the task and the event, and a tap opens the task on wherdr's Board. Back to
none: `herdr-projects set board.notify none`. Settings › Plugins › herdr-projects shows the
same command.

## Going back to 0.2

1. **Bring 1.x's agents to rest first**, so none keeps changing a repo while folders move.
   Stopping the Coordinator is not enough: each task has its own agent (and its reviewer), and
   machine and project coordinators are stopped apart. A Coordinator belongs to one Herdr
   session while the plugin and its files are shared, so do this in each Herdr session where you
   used 1.x's board.

   ```sh
   hp=~/.herdr-projects/data/bin/herdr-projects
   $hp list --all --json      # every task, with its id and state
   ```

   Let each task that is working finish, or stop it with `$hp stop <id>`. Then stop the
   coordinators you used:

   ```sh
   $hp coordinator stop                     # the Coordinator of this session
   $hp coordinator --machine stop           # the machine coordinator
   $hp coordinator --project <repo> stop    # each project coordinator (one per repo)
   herdr agent list                         # every agent of this Herdr session and its status
   ```

   Go on when none of the agents 1.x started (its tasks' agents and reviewers, its coordinators)
   is still working. Leave the agents you started yourself alone.

2. **Take out 1.x's extras, then stop what still runs.** Herdr has no uninstall hook, so 1.x
   cleans up outside its folders only when asked: its how-to files for agents, its blocks in
   Herdr's config, and the herdr web UI's shared link if you pointed it at the board. Run this
   while 1.x is still installed:

   ```sh
   ~/.herdr-projects/data/bin/herdr-projects remove-extras && echo "extras removed"
   herdr plugin disable herdr-projects     # its hooks and its board key
   ```

   Go on only after `extras removed`. `disable` does not stop what already runs. Close the work
   board's tab in Herdr: that ends the board, but its `keeper` and `keeper-work` keep running. List
   your processes that name herdr-projects:

   ```sh
   ps -U "$(id -u)" -o pid=,args= | grep '[h]erdr-projects'
   ```

   This is a list to read, not a list to stop. Stop with `kill <pid>` only a line whose program
   is 1.x's in **your** HOME: `~/.config/herdr/plugins/…/herdr-projects-…/bin/herdr-projects-<system>`
   or `~/.herdr-projects/data/bin/herdr-projects`, such as its `keeper`, `keeper-work`, `board`
   and page server. Leave any other line: another HOME or install, a 0.2 program
   (`…/target/release/herdr-projects`), or a command that only mentions the name. Run the list
   again: none of the processes you stopped may still be there.

3. **Uninstall 1.x**: `herdr plugin uninstall herdr-projects`

4. **Put the 0.2 folders back.** 1.x wrote down where it put each one in
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

5. Put back the files 1.x changed.
   - **Herdr's config: restore it from your own backup** (step 1 of the move), not from
     `config.toml.bak-herdr-projects`. 1.x rewrites that one file at each change it makes to
     Herdr's config (adding its own key, then taking it out again on uninstall), so it only holds the
     state before its last change, without 0.2's lines. If step 1 said there was no `config.toml`
     to keep, skip this: 0.2 had none.

     First take the file out of the archive, into a new private folder, and have Herdr check it.
     Nothing is replaced yet:

     ```sh
     ok= && backup=$(cat ~/herdr-projects-0.2-backup.path) && tmp=$(mktemp -d) \
       && tar xzf "$backup" -C "$tmp" .config/herdr/config.toml \
       && [ -s "$tmp/.config/herdr/config.toml" ] \
       && XDG_CONFIG_HOME="$tmp/.config" herdr config check \
       && ok=1 && echo "checked: $tmp/.config/herdr/config.toml" || echo "STOP: nothing restored"
     diff ~/.config/herdr/config.toml "$tmp/.config/herdr/config.toml"   # what the restore changes
     ```

     Only after `checked`, in the same shell, keep the current file beside it and restore:

     ```sh
     [ "$ok" = 1 ] && cp ~/.config/herdr/config.toml ~/.config/herdr/config.toml.before-0.2-restore \
       && cp "$tmp/.config/herdr/config.toml" ~/.config/herdr/config.toml && herdr server reload-config
     ```

   - **Agents' settings** (Claude, Codex…): 1.x changes them once, so their
     `<file>.bak-herdr-projects` is the file as it was before the move. Compare before restoring,
     since the file may have changed since:
     `diff ~/.claude/settings.json ~/.claude/settings.json.bak-herdr-projects`, then
     `cp ~/.claude/settings.json.bak-herdr-projects ~/.claude/settings.json` (same for
     `~/.codex/hooks.json` and the others `doctor` named).
6. Reinstall 0.2 from the fork wherdr 1.3.4 installs, pinned to `v0.2.36`: the command is in
   wherdr 1.3.4's README and in its **Settings › Plugins › herdr-projects**. `v0.2.36` exists only on
   that fork: upstream's last 0.2 tag is `v0.2.35`, whose `herdr-projects update` would offer 1.x
   again. The install puts the `herdr-projects` link back on your PATH.
7. Go back to wherdr 1.3.4, and restart it:
   - The installer (Herdr plugin): `curl -fsSL https://wherdr.dev/install | WHERDR_REF=v1.3.4 sh`
     (wherdr restarts on that version).
   - npm: `npm install -g wherdr@1.3.4 && wherdr restart`
   - Homebrew installs only the newest version: for 1.3.4, `brew services stop wherdr && brew uninstall wherdr`,
     then use npm as above.

   **Settings › About** must say 1.3.4: 2.0 there means the old process still runs.

If anything is missing, the backup from step 1 of the move has everything as it was:
`cd ~ && tar xzf "$(cat ~/herdr-projects-0.2-backup.path)"` (with herdr-projects stopped).

## Moving from Docker to the native service

wherdr 2.0 has no Docker image: it runs only natively, as your user, where the Board can act.
Published 1.x images stay on GHCR as they are, for those who stay on 1.x. The
native service keeps the same port (7683) and the same data (passkeys, push subscriptions, the
phone address and the other settings all live in wherdr's `data/` folder), so the address your
devices open, the passkeys and the notifications keep working.

Run every command on the machine where wherdr runs, as the user who runs Herdr.

1. Find the compose folder and back up its files:

   ```sh
   OLD="$(docker inspect wherdr --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}')"
   tar czf ~/wherdr-docker-backup-$(date +%F).tgz -C "$OLD" data .env docker-compose.yml
   ```

   In `"$OLD/.env"`, keep aside the settings you changed yourself (`APP_URL`, `HOST_LABEL`,
   `WHERDR_TRUSTED_NETWORKS`, `WHERDR_UPDATE_CHECK`, `HERDR_WEB_*`). Leave out the container's
   own (`HOST_HOME`, `PUID`, `PGID`, `WHERDR_IMAGE`, `WHERDR_DOCKER_LOOPBACK_ONLY`,
   `WHERDR_TASKS_FROM_FILES`, `HERDR_WEB_HOST_OPEN_*`); `PORT` becomes the installer's `WHERDR_PORT`.
2. Stop the container: `cd "$OLD" && docker compose down`. Its files and image stay, for the way back.
3. Put the data where the native service reads it, `~/wherdr/data`. Nothing to do when `$OLD`
   is `~/wherdr` (the installer's folder); otherwise copy it (refused when the target exists:
   look at what it holds first):

   ```sh
   mkdir -p ~/wherdr && [ ! -e ~/wherdr/data ] && cp -a "$OLD/data" ~/wherdr/data
   ```

   Write the settings kept at step 1, one `KEY=VALUE` per line, in `~/wherdr/wherdr.env`.
4. Install the native service: `curl -fsSL https://wherdr.dev/install | sh`. It installs the
   Herdr plugin, offers Node.js 22 if it is missing, starts wherdr on port 7683 and installs its
   login service (`systemd --user` with lingering on Linux, a LaunchAgent on macOS). A plugin
   install left in Docker mode (`WHERDR_MODE=docker` in `~/wherdr/plugin.env`) switches to
   native on its next update, and says so.
5. Check: `curl -fsS http://127.0.0.1:7683/api/health` gives `"name":"wherdr"` and the version.
   Open wherdr on the same address as before: it unlocks with the same passkey.

To go back to 1.x in Docker: in the wherdr panel (**prefix+i**) press **A** (login service off),
then **X** (stop); `herdr plugin disable <owner>.wherdr`; copy back what changed since
(`cp -a ~/wherdr/data/. "$OLD/data/"` when the data was copied); then
`cd "$OLD" && docker compose up -d`. The backup of step 1 has the folder as it was.
