# What an agent can do to your machine

Obsrv can be driven by an agent — Claude Code, or any MCP client. That is the
point of it: you ask for a page measured on a 1366×768 laptop and something
else drives the window while you watch. It also means a program on your
machine is clicking, typing and navigating in a real browser surface.

This page is the whole surface, stated plainly, so you can decide rather than
trust. **Everything here was read off the code, not from intent** — the file
and line for each claim is named so you can check it yourself.

---

## The short version

- **It is off until you turn it on.** `agentControl` is `false` unless the
  settings file says exactly `true` (`src/shared/settings.ts`).
- **With it off, an MCP tool can still ask** — and you get a bar in the window
  with the choice. It cannot grant itself anything.
- **With it on, an agent drives the window you are looking at**: navigate
  anywhere, click, scroll, capture, open and close tabs.
- **Nothing reaches it from outside your machine.** The server binds
  `127.0.0.1`, the port is random, and every request must carry a 32-byte
  token that never leaves your user account.
- **Turning it off is one click**, and it takes the token with it.

---

## Turning it on and off

The toolbar has an **AGENT** toggle; Settings → Agent control has the same
switch. While it is on, the tab being driven is marked in the tab strip, so
you can see which one an agent is acting on — it acts on whichever tab is in
**front**, resolved per command, which means moving to another tab moves the
agent with you.

Clicking the AGENT chip while it is on is a Stop button: control goes off, the
HTTP server closes, and the token is cleared from memory
(`src/main/controlServer.ts`). An agent mid-command gets nothing further.

### When it is off, and a tool asks anyway

An MCP tool that wants the window raises a **consent bar** inside the app —
the one moment a tool can ask, rather than act. You allow or refuse. The
spec's own test proves that **"Allow for this session" writes nothing to the
settings file**: the permission dies with the app, and the next launch starts
off again. That is asserted against the file on disk rather than against
memory, on purpose (`src/main/ipc.ts`, `testState.persistedSettings`).

---

## What it can do, exactly

While control is on, these are the commands the server accepts — the complete
list, from `CONTROL_COMMANDS`:

**Move around the web:** `navigate`, `back`, `forward`, `reload`, `openTab`,
`closeTab`, `activateTab`, `tabs`

**Act on the page:** `click`, `scroll`, `panTo`, `highlight`

**Measure and capture:** `audit`, `lint`, `inspect`, `status`,
`captureTarget`, `captureVisible`, `captureRaster`

**Change how it renders:** `setPreset`, `setProfile`, `setViewMode`,
`setPanes`, `setOrientation`, `setPixelExact`, `setTextScale`, `setThrottle`,
`setOnionSkin`, `setVision`

**The window itself:** `focusWindow`

Read that list for what it means rather than what it says. `navigate` goes to
**any** address, including one on your own network — `localhost:3000`, an
intranet host, a router's admin page. `click` and `scroll` act on whatever is
loaded, so a page you are signed into is a page the agent can act inside.
`captureTarget` returns a PNG of what is on screen, which is a picture of
anything visible in that tab.

**What it cannot do:** reach your filesystem, run shell commands, read other
applications, or touch any window but Obsrv's own. The commands above are the
entire vocabulary — an unknown command is refused by name, before anything
else happens.

---

## How it is protected

Four gates, listed in the order a request meets them
(`src/main/controlServer.ts`):

1. **Loopback only.** `server.listen(0, '127.0.0.1')` — a random free port,
   bound to the loopback interface. Nothing off your machine can reach it.
2. **Cross-origin requests are refused outright.** Any request carrying an
   `Origin` header gets 403. A browser always sends one; a local node client
   never does. This closes the browser-shaped path even before the token.
3. **`application/json` required.** A `no-cors` "simple request" — the kind a
   malicious web page could send without your knowledge — cannot set that
   content type, so it cannot reach the parser.
4. **A bearer token on every request, `status` included.** 32 random bytes,
   compared in constant time. A wrong or missing token returns a bare
   `forbidden` that reveals nothing — not whether the command exists, not
   what would have been allowed.

### The discovery file

While control is on, Obsrv writes `control.json` into its own application
support directory, mode `0600` (owner read/write only). It holds the port, the
token, the process id and the start time — that is how an MCP client on your
machine finds the running app. **Anything that can read your user account's
files can read that token while control is on**, which is the honest boundary:
this protects you from the network and from web pages, not from other programs
running as you.

Turn control off and the file is rewritten to say so; the token it held stops
working.

---

## What an agent sees of your browsing

The two panes are a real browser. An agent that is driving can read the page
in front of it — that is what `audit`, `lint` and `inspect` do — and capture
it. If you are signed into something in that tab, the agent can measure and
photograph the signed-in view.

The practical rule: **agent control is for the page you are testing.** Turn it
off before you use those tabs for anything else, or use a separate tab and
leave the driven one on the site under test.

---

## What is written, and what leaves

Nothing is uploaded anywhere. The app makes exactly one outbound request of
its own — a daily version check to `api.github.com` — and everything else it
writes is a local file. The full account, including what the log does and does
not record, is in the README's
[**Privacy and files**](../README.md#privacy-and-files) section.

---

## If you would rather not have any of this

The CLI and the MCP server work without the desktop app at all:

```bash
npm i -g getobsrv
obsrv audit https://example.com --preset laptop-768
```

Headless renders spawn their own Electron with a throwaway profile, open no
HTTP server, and expose no control surface. You lose the live window — the
thing you watch — and keep every measurement.
