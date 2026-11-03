# Machines

[Documentation](README.md) · [Project](../README.md)

## Several machines (SSH)

With herdr-core, other machines are **core machines**: hc reaches them over SSH and runs their
terminals there (`hc machine add`). wherdr shows what `machine.list` returns; it opens no SSH
connection of its own.

- **On the home screen**, each machine is a tab of the machine bar, online or offline, with its
  count of rows ([Machines as tabs](home.md#machines-as-tabs)). When a machine goes offline, its
  last terminals stay visible, marked offline, until core reaches it again.
- **New** starts a terminal or an agent on any online machine (`terminal.run` with `on`). Home,
  folders, Git detection and installed agents of that machine come from `machine.exec`; folders
  must stay under the machine's home.
- **Conversations, files and quotas** of a core machine are read through `machine.exec` on that
  machine ([herdr-core](core.md#conversations), [Files](files.md), [quotas](quotas.md)).

**Settings › Agents › Machines** shows the core's version and uptime, this machine, and each core
machine with its state (connected, connecting…, offline) and last error:

- **Add machine**: an **SSH target** (`user@host`, a `~/.ssh/config` host, or `user@host:port`
  with herdr-core 0.1.17 or newer) and an optional **Name** (a-z, 0-9, `-`, `_`, `.`, 32 at most),
  like `hc machine add`. The target must already accept this host's SSH login with a key, and
  herdr-core must be installed there: wherdr never asks for a password, never installs core on
  the machine and never accepts a `via` command.
- **Reconnect** an offline machine (`machine.connect`).
- **Rename** (`machine.rename`).
- **Forget** (`machine.rm`): its terminals keep running there, and the machine can be added again
  later.

## v2 only: machines registered in Herdr

Everything below applies to wherdr v2 on Herdr, where wherdr opens its own SSH connection to
each machine registered with `herdr machine add`.


wherdr also shows the agents of the **SSH machines registered in Herdr** — the ones the Herdr
terminal client shows in its sidebar. It opens one SSH master connection per machine, forwards
the remote Herdr socket through it, and reads transcripts and files over the same connection.

Requirements on the remote machine: the **same Herdr version** (`herdr --version`), its server
running, and key-based SSH access from the server. Example, on the server:

```sh
ssh-keygen -t ed25519 -f ~/.ssh/wherdr_ed25519 -N ''
cat >> ~/.ssh/config <<'CFG'
Host laptop
  HostName laptop
  User alice
  IdentityFile ~/.ssh/wherdr_ed25519
  IdentitiesOnly yes
CFG
ssh-copy-id -i ~/.ssh/wherdr_ed25519 laptop
ssh laptop true                            # accept the host key once
herdr machine add laptop --label Laptop    # see `herdr machine --help`
```

wherdr picks it up within 30 seconds; `herdr machine rename|disable|remove` work the same way.
Machines can also be renamed from the app (machine menu → Options).
With Herdr 0.9.2 or later, **Options → Connection status** checks the saved profile
with `herdr machine status --json`: reachable, authentication required, error or disabled.
It also gives a `herdr machine reconnect <profile-id>` command to run interactively
on the wherdr host. **Retry connection** restarts wherdr's own SSH connection;
Herdr's approved SSH connection and wherdr's connection are separate, so key-based
SSH access is still required for wherdr. Older Herdr keeps automatic retries and
manual **Retry connection**, without the native diagnostic.

The terminal view uses `terminal.mouse` on Herdr 0.9.2+ (both CLI and server): clicks,
touch taps, drags and movement are encoded by Herdr for the application's mouse mode.
Use **Shift + drag** to select text, and Ctrl/⌘+click to open links. Older or unknown
versions keep the existing terminal keyboard, selection and scrolling behavior.

### Windows remote machines


The wherdr host must support Unix sockets and OpenSSH multiplexing (for example,
Linux/WSL or macOS). On the **remote Windows machine**, install Git Bash and set
it as the OpenSSH server's default shell. In an elevated PowerShell:

```powershell
New-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell -Value 'C:\Program Files\Git\bin\bash.exe' -PropertyType String -Force
Restart-Service sshd
```

Reconnect SSH after changing the shell. Adjust the path if Git is installed
elsewhere. wherdr's bootstrap and file commands require a POSIX shell; with
cmd.exe or PowerShell as the default, they fail before Herdr is discovered.
With `cmd.exe` as the default shell, the error comes back localized and can be
unreadable (for example GBK-encoded Chinese). When the probe does not answer
as a POSIX shell, wherdr shows “Remote SSH shell must support POSIX commands”
and points to this section; the same hint covers other failures before the
probe runs.

Herdr must be available in this non-interactive shell (`ssh laptop 'command -v herdr'`) and its server must already be running. Windows remotes require Herdr
0.9.3 or later with `remote-api-bridge` support.

Since 2.0.0 (#144), wherdr reaches a Windows machine through a relay instead of
`ssh -L` to the socket path, so Herdr sockets under `C:\…` work. It selects a stdio relay for
socket paths containing a drive letter or backslashes, rather than putting the
Windows path into `ssh -L`. It uses Herdr's native `remote-api-bridge` for API
requests and `remote-client-bridge` for notifications, over the same SSH master.
No additional relay program or TCP listening port is needed. Linux and macOS
POSIX socket paths continue to use `ssh -L`.
