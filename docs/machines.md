# Machines and SSH

[Documentation](README.md) · [Project](../README.md)

- **Several machines**: agents of the SSH machines registered in Herdr (`herdr machine add`)
  appear in their own section; everything works the same on a remote agent.
## Several machines (SSH)

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
