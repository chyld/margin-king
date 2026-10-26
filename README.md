# Margin

Margin is a small, self-hosted note-taking app for a handful of people (fewer than five). Notes are
plain text with a light formatting syntax: 24 highlight colors, bold, underline, code, links,
collapsible colored sections and pasted screenshots. You can view a note **rendered** or **raw**, and
edit it in either. There's no database: every note is a folder of files on disk. It runs in Docker on
port 5555.

- What Margin does, in full: [`docs/original-readme.md`](docs/original-readme.md) (the specification
  this build follows; its §5 describes an earlier build). Changes and additions the owner made since
  are listed in [architecture §15](docs/architecture.md#15-features-beyond-the-readme-owner-decisions),
  among them **resizing screenshots**: drag the handle on a screenshot's right edge (or tap the image
  first on a touch screen); double-click (double-tap) the handle for the original size.
- How this build works: [`docs/architecture.md`](docs/architecture.md), with the review history in
  [`docs/reviews/`](docs/reviews/).

## Running Margin

### Install

You need Docker with Docker Compose.

```sh
git clone https://github.com/chyld/margin-king.git margin
cd margin
docker compose up -d --build
```

Margin now listens on port **5555** on all network interfaces: open `http://<host>:5555`.

### Users

Users are created on the command line; you're asked for a password (at least 4 characters):

```sh
docker compose exec margin margin-user add alice
docker compose exec margin margin-user list
docker compose exec margin margin-user passwd alice
docker compose exec margin margin-user remove alice   # their notes stay on disk
```

Usernames are 1–32 characters of `a-z`, `0-9`, `_` and `-`. For scripts, set `MARGIN_PASSWORD`
instead of typing the password. Changes take effect immediately, with no restart. Removing a user
also ends their sessions.

`margin-user doctor` checks the data folder and reports problems without changing anything: note
folders Margin skips, leftover temporary files, a leftover lock, and screenshots a note mentions but
that are missing.

### Update

```sh
git pull
docker compose up -d --build
```

### Data and backups

Everything lives in `./data` next to `compose.yaml`. To back up Margin, copy that folder. The
container runs as UID/GID 1000 so the files belong to your user; if your IDs differ:

```sh
MARGIN_UID=$(id -u) MARGIN_GID=$(id -g) docker compose up -d
```

If Margin says the data folder isn't writable, it's owned by another user (for example root);
`sudo chown -R $(id -u):$(id -g) ./data` fixes it.

### Security

Margin uses **plain HTTP**: passwords and the session cookie travel unencrypted. That's fine on a
trusted home network, not on the open internet. To reach Margin from outside, put it behind a
reverse proxy with TLS (Caddy, nginx) or use a VPN such as Tailscale.

Behind a TLS proxy that sends `X-Forwarded-Proto: https`, the session cookie is marked `Secure`.
Cookies belong to a host, not a port, and browsers don't let plain HTTP replace a `Secure` cookie: after
logging in through `https://host`, a plain-HTTP login on `http://host:5555` in the same browser won't
stick until that cookie expires or you log out over HTTPS.

### Development

```sh
npm install
npm run watch                              # rebuild the client on change
DATA_DIR=./dev-data PORT=5556 npm start    # in another terminal
MARGIN_PASSWORD=secret DATA_DIR=./dev-data node cli.js add dev
```

Or `npm run dev` for both at once (data in `./dev-data`, port 5556).

Node 24 or newer runs the TypeScript sources directly; only the client is bundled (esbuild).

```sh
npm run check      # type-check (tsc --noEmit)
npm test           # unit and server tests (node --test)
npm run test:e2e   # browser tests (Playwright, Chromium)
```
