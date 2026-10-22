# Phone access and private networks

[Documentation](README.md) · [Project](../README.md)

### Recommended: always-on server + Tailscale

Your agents keep running when your laptop is closed, and you follow them from your phone.
wherdr stays on your private network: it is **never published on the Internet**.

**1. Herdr on the server.** Install [Herdr](https://herdr.dev) (≥ 0.9.1) and start it
(`herdr` or `herdr server`), with the integrations of the agents you use
(`herdr integration install claude|codex`).

**2. wherdr.** Run [the one command](installation.md#the-one-command) on the server, as your user (over SSH, it
prints the address and the phone steps instead of opening a browser). wherdr runs as a service
that starts with the machine and keeps running when you log out.

**3. Private HTTPS with Tailscale.** Install [Tailscale](https://tailscale.com) on the server,
your phone and your computers, on the same tailnet, with
[MagicDNS and HTTPS certificates](https://tailscale.com/kb/1153/enabling-https) enabled. Then,
on the server:

```sh
tailscale serve --bg --https=7683 http://127.0.0.1:7683
# → https://<machine>.<tailnet>.ts.net:7683/   (e.g. https://server.example.ts.net:7683/)
```

Tailscale Serve listens on HTTPS port 7683 of your tailnet name, with a valid certificate, and
forwards to wherdr's local HTTP port. Only devices of your tailnet can reach it.

**wherdr enables that address by itself**, on a server without a screen too: at startup, every
30 seconds, and when an address it does not know yet is opened, it reads what `tailscale serve`
publishes on this machine (the `tailscale` command) and adopts the HTTPS address that points to
its own port (allowed host and `APP_URL`, saved in `data/app-url.json`; an HTTPS `APP_URL` in the
environment or `~/wherdr/wherdr.env` wins). An address removed from `tailscale serve` is refused
again. Nothing a request says can enable an address: only Tailscale's own state on the machine
does, and an address that `tailscale funnel` opens to the Internet is never adopted.

**Settings › Phone** on the server (`http://localhost:7683/#/settings?section=phone`) shows the
state and the QR code and publishes wherdr itself: one button, asked first. From a terminal,
**P** in the wherdr panel, `wherdr phone` (npm, Homebrew) or the [one command](installation.md#the-one-command)
run again checks the same thing, and `curl -fsS http://127.0.0.1:7683/api/phone` prints the state
as JSON.

If the phone shows **"This address isn't enabled yet"** (403), the address it opened is not one
`tailscale serve` publishes for wherdr's port on that machine: the page gives the command to run
there.

**Why HTTPS matters.** Browsers only allow three things on `https://` (or on `localhost` itself):

- **installing the app** on the home screen (PWA) on iPhone and Android;
- **push notifications** (on iOS, only in the installed app);
- **passkeys** for the lock screen (Face ID, Touch ID, Windows Hello, Android).

**4. On the phone:** open the address, [install the app](phone.md#install-it-as-an-app), then
Settings → **Enable notifications**. **On the computer:** use the same address in a browser; the
desktop layout can replace the Herdr terminal client for daily work.

**5. Passkey lock** (optional): Settings → Security → **Enable passkey lock**. The
first passkey asks for a bootstrap token, printed in the server log (`~/wherdr/wherdr.log`,
**L** in the wherdr panel); it changes on each restart and is only needed for that first passkey. Add a passkey on each of
your devices after that (see [New device](security.md#new-device)). Without one, every device of your
tailnet can control your agents: enough when the tailnet is yours alone, a passkey adds a lock
on each device when someone else shares the tailnet or your devices.

**6. More machines** (optional): register your other computers in Herdr over SSH
(`herdr machine add`, see [Several machines (SSH)](machines.md#several-machines-ssh)). Their agents show
in wherdr in their own section, and everything works the same on them. The machine menu also has
**Keep awake**, which stops a Mac (`caffeinate`) or a Linux machine (`systemd-inhibit`) from
sleeping for an hour, four hours, the evening or until turned off.

> [!CAUTION]
> Never publish wherdr on the Internet: no port forwarding on your router, no public reverse
> proxy, no ngrok, no `tailscale funnel`, no Cloudflare Tunnel without Cloudflare Access. Use
> `tailscale serve`, which stays inside your tailnet. See [Security](security.md#security).

### Other private networks

Tailscale is the built-in path (one click in **Settings › Phone**), not a requirement. wherdr
works with any private network that gives it an **HTTPS address with a valid certificate**:

- **HTTPS with a certificate your phone trusts.** The installed app (PWA), push notifications
  and passkeys only work on `https://`. A self-signed certificate or plain `http://` on your
  LAN is not enough, and is never a supported way to reach wherdr.
- **`APP_URL` set to that address** (the environment of `wherdr` / `npm start`), then restart wherdr. Its hostname is allowed automatically and it enables Web
  Push. Add `HERDR_WEB_ALLOWED_HOSTS` only if you also open wherdr under another name. The
  automatic adoption and the address check in **Settings › Phone** only know the `*.ts.net`
  addresses of `tailscale serve`; an HTTPS `APP_URL` in the environment always wins.
- **Never exposed without authentication.** wherdr keeps listening on `127.0.0.1`; only the
  proxy listens on the private network. Turn on the passkey lock as soon as another device can
  reach it.

**Headscale, NetBird, ZeroTier, WireGuard: the same recipe.** Join the server and the phone to
the network, give the server a DNS name that points to its **private** address, and put a reverse
proxy in front of wherdr that listens on that private address only. Let's Encrypt cannot reach a
private address, so the certificate comes from the
[DNS challenge](https://caddyserver.com/docs/automatic-https#dns-challenge). With
[Caddy](https://caddyserver.com) built with your DNS provider's
[module](https://github.com/caddy-dns) (here [Cloudflare DNS](https://github.com/caddy-dns/cloudflare)),
a `Caddyfile` like this ([`bind`](https://caddyserver.com/docs/caddyfile/directives/bind),
[`tls`](https://caddyserver.com/docs/caddyfile/directives/tls)):

```caddy
wherdr.example.com {
	bind 100.64.0.10                 # the server's address on the private network only
	tls {
		dns cloudflare {env.CF_API_TOKEN}
	}
	reverse_proxy 127.0.0.1:7683
}
```

Point `wherdr.example.com` (an `A` record in your DNS zone) to that private address: from
anywhere else it leads nowhere. Then set `APP_URL=https://wherdr.example.com/` and restart
wherdr. Caddy is a relay on this computer ([Network access](security.md#network-access)): keep it bound to
the private address and turn the passkey lock on. Caddy passes each client's address on: with
Headscale or NetBird (`100.64.0.0/10`) wherdr accepts it as is; for another range (ZeroTier,
WireGuard), also set `WHERDR_TRUSTED_NETWORKS` to it, such as `10.147.17.0/24`. To join each
device:

| Network | Join a device (official docs) | Server's private address |
| --- | --- | --- |
| [Headscale](https://headscale.net/stable/usage/getting-started/) | Tailscale clients: `tailscale up --login-server <YOUR_HEADSCALE_URL>` | `tailscale ip -4` |
| [NetBird](https://docs.netbird.io/get-started/cli) | `netbird up` (`--management-url` when self-hosted) | `netbird status` |
| [ZeroTier](https://docs.zerotier.com/start) | `zerotier-cli join <network ID>`, then authorize the device in the network's members | The members list of your network |
| [WireGuard](https://www.wireguard.com/quickstart/) | `wg-quick up wg0` with a peer per device | The `Address` of the server's interface |

Headscale does not support `tailscale serve` with HTTPS yet
([features](https://headscale.net/stable/about/features/),
[#1921](https://github.com/juanfont/headscale/issues/1921)): `tailscale cert` and Serve need
certificates that only Tailscale's own control server provisions. Use the reverse proxy above
instead of step 3.

**Cloudflare Tunnel + Cloudflare Access: only with Access.**

> [!WARNING]
> A Cloudflare Tunnel puts wherdr **on the Internet**: anyone can reach its address, and
> Cloudflare terminates TLS, so it sees all traffic. **Cloudflare Access is mandatory**, created
> *before* the route: without it, whoever finds the address controls your agents. Keep the
> passkey lock on as well. Prefer a private network when you can.

1. In Cloudflare One, create the Access application first:
   [Self-hosted and private › Add public hostname](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
   `wherdr.example.com`, with an **Allow** policy for your own e-mail only (Access applications
   deny everyone else by default).
2. [Create a tunnel](https://developers.cloudflare.com/tunnel/setup/) and run `cloudflared` on the
   server, then add a **published application** route: hostname `wherdr.example.com`, service
   `http://localhost:7683`.
3. Set `APP_URL=https://wherdr.example.com/` and `WHERDR_TRUSTED_NETWORKS=any` (the tunnel brings
   clients from the Internet, which wherdr refuses otherwise; it then shows a warning), and
   restart wherdr.

Installing the app and notifications behind Access are not tested by the project: the phone must
first sign in to Access in the browser.
