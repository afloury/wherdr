# Setting up wherdr — a guide for coding agents

> If your fetch tool summarizes, read the raw file with `curl -fsSL https://wherdr.dev/agent.md`.

You are helping your user install **wherdr**: a self-hosted web app and phone PWA to drive the
coding agents running in [Herdr](https://herdr.dev). It runs on **one** machine, where Herdr
runs, as the same user, on `127.0.0.1:7683` only. Details: https://github.com/afloury/wherdr#readme.

## Rules

1. **Security first.** wherdr is a remote shell on that machine. Never expose it: no port
   forwarding, no public proxy, no ngrok, no `tailscale funnel`, no plain HTTP on the local
   network. Other devices use `tailscale serve` only (private HTTPS inside the user's tailnet).
   Another private network: https://github.com/afloury/wherdr#other-private-networks.
2. **Detect before you ask.** Never offer to install what is already there.
3. **Ask before** installing anything (wherdr, Tailscale, Node.js, Docker) and before any `sudo`.
4. Do not edit `~/.claude`, `~/.codex`, Herdr's config or wherdr's files (`plugin.env`, `.env`).
   Never run wherdr as root.
5. Run every command on the machine where Herdr runs; if you are not on it, ask the user to
   start you there.

## 1. Detect

```sh
herdr --version          # Herdr ≥ 0.9.1, or send the user to https://herdr.dev
herdr status server      # its server must be running
herdr plugin list        # afloury.wherdr: wherdr is installed; herdr-projects: see Extras
curl -fsS http://127.0.0.1:7683/manifest.webmanifest   # answers: wherdr already runs
brew list wherdr         # a Homebrew install
node --version           # Node.js 22, needed by the install
tailscale status         # Tailscale connected?
tailscale serve status   # an https://….ts.net address proxying to port 7683: already published
```

A command that fails only means "not there". Then ask only what you could not find out:
**phone, or this computer only?** Computer only: do step 2, give `http://localhost:7683` and
stop; no Tailscale, and no passkey on localhost if a phone may come later (see step 4).

## 2. Install

Skip it when wherdr already answers. Otherwise:

```sh
curl -fsSL https://wherdr.dev/install | sh
```

It installs the Herdr plugin into `~/wherdr`, starts wherdr and opens its setup guide in the
browser, without sudo. It needs Node.js 22 (or Docker on Linux). Another port:
`curl -fsSL https://wherdr.dev/install | WHERDR_PORT=7684 sh`, then use it instead of 7683 below.

**Check:** `curl -fsS http://127.0.0.1:7683` returns HTML.

**Startup: nothing to add.** The plugin starts wherdr with Herdr. A Homebrew install uses
`brew services start wherdr`. `wherdr service install` is for an npm install only.

## 3. Phone (Tailscale)

1. Tailscale on this machine and on the phone, same account. In the Tailscale admin console
   (DNS page) the user enables [HTTPS certificates](https://tailscale.com/kb/1153/enabling-https).
2. Publish, unless step 1 showed it is already published:

   ```sh
   tailscale serve --bg --https=7683 http://127.0.0.1:7683
   ```

3. Let wherdr adopt the address: it checks it and sets `APP_URL` itself.

   ```sh
   curl -fsS http://127.0.0.1:7683/api/phone
   ```

   Done when the JSON says `"reach":"ok"`; its `url` is the phone address. `"pending"`: wait,
   the first HTTPS certificate takes up to a minute. Same thing in the app: Settings › Phone
   (`wherdr phone` with an npm or Homebrew install).

## 4. Finish on the phone address

From now on use `https://<machine>.<tailnet>.ts.net:7683/`, not localhost: **a passkey only
works on the address it was created on.**

1. Open that address for the user, or give them the link.
2. **Passkey lock** (required as soon as another device reaches wherdr): on that address,
   Settings › Security › **Enable passkey lock**. It asks for a bootstrap token: the last
   `First passkey: bootstrap token` line of `~/wherdr/wherdr.log` (`wherdr logs` with Homebrew,
   `docker compose logs` with Docker). Give the token to the user.
3. **On the phone**: open the address in Safari (Share › Add to Home Screen, then open wherdr
   from the Home Screen) or in Chrome on Android (menu › Install app), unlock it with the
   passkey, then Settings › **Enable notifications**.

**Check:** the phone lists the agents. Then tell the user, in a few lines: the address, that the
lock is on, and how to update (run the install command again).

## Extras (only if asked)

- **Only a terminal, no conversation**: `herdr integration install claude|codex|omp`.
- **Agents on other computers**: Herdr only on them, registered with `herdr machine add`:
  https://github.com/afloury/wherdr#several-machines-ssh.
- **herdr-projects** (parallel threads): when `herdr plugin list` does not show it, follow
  its README: https://github.com/eliasstravik/herdr-projects.
- **Something fails**: the **L** key (log) of the wherdr panel in Herdr, and
  https://github.com/afloury/wherdr#troubleshooting.
