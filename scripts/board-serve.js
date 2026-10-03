#!/usr/bin/env node
'use strict'
// The board, served, repainting itself when main moves — so reading it does not
// mean remembering to regenerate it.
//
// WHY A SERVER AND NOT A SELF-REFRESHING FILE. The page opened over file:// is
// a snapshot: Chrome refuses it a fetch of its own siblings, so the only thing
// such a page can do is reload itself blind on a timer, losing the reader's
// scroll and closing an open card every few seconds. Over http the direction
// reverses — the server knows when the cards changed and says so, and the page
// repaints in place.
//
// WHAT IT WATCHES, AND WHAT IT DOES NOT. origin/main's cards, not the working
// tree's. A card moves for everyone when a PR merges, and a board built from
// one checkout's files shows that checkout's opinion — which is the staleness
// this board went into the repo to escape. Local edits are deliberately
// invisible here: this page answers "where is the work", not "what am I editing".
//
// FAILURE IS NOT ALLOWED TO LOOK LIKE A QUIET WEEK. A fetch that cannot reach
// the network, a rebuild that throws, a poller that died: every one of those
// leaves the last good cards on screen, which is indistinguishable from nothing
// having changed. So the page carries the state of its own feed, and says when
// it last managed to read main.
const { createServer } = require('node:http')
const { execFileSync } = require('node:child_process')
const { mkdtempSync, readFileSync, rmSync, mkdirSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, dirname } = require('node:path')

const ROOT = join(dirname(__dirname))
const argAfter = (flag, fallback) => {
  const at = process.argv.indexOf(flag)
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback)
}
const PORT = Number(argAfter('--port', '4321'))
const REPO = argAfter('--repo', ROOT)
const INTERVAL_MS = Number(argAfter('--interval-ms', '20000'))
const REF = argAfter('--ref', 'origin/main')
const REMOTE = REF.includes('/') ? REF.split('/')[0] : 'origin'
const BRANCH = REF.includes('/') ? REF.slice(REF.indexOf('/') + 1) : REF

const git = args => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// One build of one commit. The cards come out of the commit itself rather than
// out of the working tree, so what is served is what main says even when this
// checkout is mid-edit or on another branch.
function buildAt(sha) {
  const dir = mkdtempSync(join(tmpdir(), 'board-serve-'))
  try {
    mkdirSync(join(dir, 'board'), { recursive: true })
    // git archive writes a tar; -x into the temp dir gives us board/*.md at that sha.
    execFileSync('sh', ['-c', `git -C ${JSON.stringify(REPO)} archive ${sha} board | tar -x -C ${JSON.stringify(dir)}`], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    execFileSync(
      process.execPath,
      [
        join(ROOT, 'scripts', 'build-board.js'),
        '--cards', join(dir, 'board'),
        '--md', join(dir, 'board.md'),
        '--html', join(dir, 'board.html'),
        '--json', join(dir, 'board.json'),
        '--stamp', sha.slice(0, 9),
        // The page may truthfully say it keeps itself current: this process is
        // what makes that true, and `--auto` is the flag that prints it.
        '--auto',
      ],
      { cwd: REPO, stdio: ['ignore', 'ignore', 'pipe'] },
    )
    return { html: readFileSync(join(dir, 'board.html'), 'utf8'), json: readFileSync(join(dir, 'board.json'), 'utf8') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const state = { sha: '', html: '', json: '', builtAt: 0, error: '', fetchedAt: 0 }
const clients = new Set()

function announce() {
  const line = `data: ${JSON.stringify({ sha: state.sha, builtAt: state.builtAt, error: state.error })}\n\n`
  for (const res of clients) res.write(line)
}

// One poll: read main, and rebuild only when its sha is one we have not built.
// Rebuilding on every tick would burn a git archive and a full card parse to
// produce a byte-identical page.
function poll() {
  let moved = false
  try {
    git(['fetch', REMOTE, BRANCH])
    state.fetchedAt = Date.now()
    const sha = git(['rev-parse', REF]).trim()
    if (sha && sha !== state.sha) {
      const built = buildAt(sha)
      state.sha = sha
      state.html = built.html
      state.json = built.json
      state.builtAt = Date.now()
      moved = true
    }
    if (state.error) {
      state.error = ''
      moved = true
    }
  } catch (e) {
    // Keep the last good cards on screen — but say the feed is broken, with the
    // time of the last successful read, so stale cards cannot pass for current.
    const next = String((e && e.message) || e).split('\n')[0].slice(0, 200)
    if (next !== state.error) {
      state.error = next
      moved = true
    }
  }
  if (moved) announce()
}

// The only thing this adds to the committed page. It repaints through the
// page's own paint(), so the live view and the file:// copy draw cards by
// exactly one code path.
const LIVE_CLIENT = `
<script id="board-live">
(() => {
  const feed = document.createElement('p');
  feed.className = 'stamp';
  feed.id = 'feed';
  const stamp = document.getElementById('stamp');
  (stamp && stamp.parentNode ? stamp.parentNode : document.body).insertBefore(feed, stamp ? stamp.nextSibling : null);
  const when = ms => new Date(ms).toTimeString().slice(0, 8);
  let shown = '';
  const say = (text, bad) => { feed.textContent = text; feed.style.color = bad ? 'var(--doing)' : 'var(--dim)'; };
  const es = new EventSource('/events');
  es.onmessage = async ev => {
    let msg = {};
    try { msg = JSON.parse(ev.data); } catch {}
    if (msg.error) { say('Live feed failing: ' + msg.error + ' — cards below are from ' + (msg.builtAt ? when(msg.builtAt) : 'an earlier read'), true); return; }
    if (msg.sha && msg.sha !== shown) {
      const data = await (await fetch('/data.json', { cache: 'no-store' })).json();
      window.__boardPaint(data);
      shown = msg.sha;
    }
    say('Live: repainted ' + when(msg.builtAt || Date.now()) + ' from ' + String(msg.sha || '').slice(0, 9) + '.');
  };
  // A closed EventSource reconnects on its own, but a page that says nothing
  // while disconnected is the silence this server exists to avoid.
  es.onerror = () => say('Live feed disconnected — cards below may be stale. Reconnecting…', true);
})();
</script>
`

const page = () => state.html.replace('</body>', `${LIVE_CLIENT}</body>`)

const server = createServer((req, res) => {
  const path = (req.url || '/').split('?')[0]
  if (path === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    res.write('retry: 2000\n\n')
    res.write(`data: ${JSON.stringify({ sha: state.sha, builtAt: state.builtAt, error: state.error })}\n\n`)
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }
  if (path === '/data.json') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(state.json)
    return
  }
  if (path === '/' || path === '/board.html') {
    if (!state.html) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`board-serve has no build yet${state.error ? `: ${state.error}` : ''}\n`)
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(page())
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('not found\n')
})

poll()
const timer = setInterval(poll, INTERVAL_MS)
timer.unref?.()
server.listen(PORT, '127.0.0.1', () => {
  const { port } = server.address()
  // Printed so a caller that asked for port 0 can find it, and so the line a
  // reader copies is the one that works.
  console.log(`board-serve listening http://127.0.0.1:${port} (${REF}, every ${Math.round(INTERVAL_MS / 1000)}s)`)
})
process.on('SIGINT', () => { clearInterval(timer); server.close(); process.exit(0) })
