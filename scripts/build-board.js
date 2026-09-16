#!/usr/bin/env node
// Renders docs/board.md from the cards in board/.
//
//   npm run board          write docs/board.md and docs/board.html from board/
//   npm run board:check    fail if any card cannot be read or rendered
//
// The cards ARE the board. One file per card in board/, each with a small
// frontmatter block and its evidence as the body. docs/board.md and
// docs/board.html are generated from them and are NOT committed — they are
// gitignored, built locally when you want to look, and published to Pages from
// `main` on every push.
//
// It did not start that way, and the reason it moved is the point. The board
// used to live in a Claude Artifact with a shared database, and this file
// generated a snapshot of it. Two things were wrong with that, and only one
// was obvious:
//
//   - The snapshot went stale the moment the artifact changed, and nothing
//     noticed. Measured on 2026-09-14: six hours, then ten minutes, then
//     twenty. Every number was a regeneration someone had to remember.
//   - Only one session could write. Three agent sessions were refused on the
//     artifact, and the refusal read as a permission until somebody asked all
//     three what `Artifact action:"list"` returned: three different answers,
//     one of them listing five artifacts the others could not see. They were
//     three accounts, not one account with a sharing gap, so there was no
//     addressee to share with. A board only one participant can write is a
//     board that is accurate only while that participant is awake.
//
// Both problems are gone by construction here rather than by discipline: the
// cards live in the repo, and the repo is writable by everyone who can open a
// pull request, which is everyone.
//
// Claiming a card is now editing its file. That is the whole mechanism.
//
// THE GENERATED VIEWS ARE NOT COMMITTED, AND THAT IS THE SECOND LESSON.
// They were, until 2026-09-15. Every branch that touched any card conflicted
// with every other branch that touched any card, on two files that are DERIVED
// — and every one of those conflicts was resolved the same way: run this
// script. In one night: one session conflicted six times inside a single
// multi-commit rebase, one pull request was rebased three times, and one of
// those rebases pushed conflict markers to main, because the standing rule
// ("regenerate, never hand-resolve") has an exception for cards and the
// exception is the one that got applied by mistake at the tired end of a
// rebase.
//
// A conflict whose resolution is always "recompute it" is not a conflict. It
// is a merge driver nobody wrote, paid for once per branch. Kenya made that
// argument with the count behind it; Opeyemi took the larger of the two fixes.
//
// So: `docs/board.md` and `docs/board.html` are gitignored. `npm run board`
// writes them for you locally. `pages.yml` builds them fresh from `main` on
// every push and publishes them, which is how anyone outside the repo reads
// the board. Nobody ever rebases for a file they did not write.
//
// WHAT `--check` MEANS NOW, because its old meaning is gone. It used to compare
// the committed views against the cards, which is meaningless once nothing is
// committed. It now parses every card and renders both views in memory, and
// fails if any card cannot be read — a missing frontmatter block, a broken
// field, a column nothing knows. The failure names the card. That is a smaller
// promise than the old one and it is the whole of what is left to promise:
// staleness is impossible when there is no stored copy to go stale.
const { readdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join, dirname } = require('node:path')

const ROOT = join(dirname(__dirname))
const CARDS = join(ROOT, 'board')
const OUT = join(ROOT, 'docs', 'board.md')
const OUT_HTML = join(ROOT, 'docs', 'board.html')
const check = process.argv.includes('--check')
// `--stamp <text>` is for a PUBLISHED copy only, and is deliberately absent
// from the committed file. A published page is a snapshot: it cannot be
// CI-checked against the cards, so it has to say which commit it was made
// from, or it goes quietly stale while looking current — the exact failure
// this board moved into the repo to escape. The repo copy needs no stamp,
// because it and the cards land in the same commit.
const stampAt = process.argv.indexOf('--stamp')
const stamp = stampAt === -1 ? '' : (process.argv[stampAt + 1] ?? '')
const htmlAt = process.argv.indexOf('--html')
const htmlOut = htmlAt === -1 ? OUT_HTML : (process.argv[htmlAt + 1] ?? OUT_HTML)
// The committed file and the Pages build are whole documents: served or opened
// on their own they need a charset of their own, and this page is full of
// em-dashes that render as mojibake without one. `--fragment` drops the
// wrapper for the Claude Artifact copy, which supplies its own skeleton and
// rejects a file that brings its own <html>.
const fragment = process.argv.includes('--fragment')
// `--auto` says the page rebuilds itself, which changes what the stamp is
// allowed to claim. A GitHub Pages build is rebuilt on every push to main; a
// hand-published copy is not. The same sentence cannot be true of both, and
// "this page does not update itself" printed on a page that does is exactly
// the quietly-false kind this project keeps finding.
const auto = process.argv.includes('--auto')

// Left to right is the order work actually travels: raised, picked, claimed,
// finished, merged. Backlog leads because that is where a card starts — it was
// fourth until 2026-09-14, which put the beginning of the pipeline after its
// middle and made the columns read as a priority list rather than a flow.
const COLUMNS = [
  { id: 'backlog', name: 'Backlog', blurb: 'Raised, not yet picked.' },
  { id: 'next', name: 'Next', blurb: 'Picked, not claimed — start here.' },
  { id: 'doing', name: 'Doing', blurb: 'Claimed: moving, or waiting on someone or something named.' },
  { id: 'review', name: 'Review', blurb: 'Finished, waiting on the maintainer to merge.' },
  { id: 'done', name: 'Done', blurb: 'Merged.' },
]
const KIND = { readiness: 'readiness', bug: 'bug', chore: 'chore' }

// Frontmatter is read forgivingly, because these files are hand-edited. A
// value is JSON when it starts with a quote and plain text otherwise, so both
// `owner: "Kenya"` and `owner: Kenya` work and neither is a trap for whoever
// claims a card by typing their name into it.
function parseCard(id, text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  if (!m) throw new Error(`board/${id}.md has no frontmatter block`)
  const card = { id, evidence: text.slice(m[0].length).trim() }
  for (const line of m[1].split('\n')) {
    if (!line.trim()) continue
    const at = line.indexOf(':')
    if (at === -1) throw new Error(`board/${id}.md: frontmatter line is not "key: value" — ${line}`)
    const key = line.slice(0, at).trim()
    const raw = line.slice(at + 1).trim()
    card[key] = raw.startsWith('"') ? JSON.parse(raw) : raw
  }
  if (!card.title) throw new Error(`board/${id}.md has no title`)
  const col = card.column ?? 'backlog'
  if (!COLUMNS.some(c => c.id === col)) {
    throw new Error(`board/${id}.md: column "${col}" is not one of ${COLUMNS.map(c => c.id).join(', ')}`)
  }
  card.column = col
  card.order = Number(card.order ?? 0)
  // A Doing card must say whether it is moving or waiting, and on whom
  // (chore-waiting-field). `waiting: ""` is moving. Anything else is
  // `who: what` — a room name, or `event` for a suite result or a recurrence —
  // so the reader chases the named person rather than the owner, and the board
  // can count what waits on each. Absent is refused rather than read as moving:
  // an absent field fits "nothing is waiting" and "nobody filled it in" equally,
  // and on 2026-09-16 Opeyemi read six Doing cards and could not tell working
  // from waiting from finished-and-in-CI.
  if (col === 'doing') {
    if (card.waiting === undefined) {
      throw new Error(`board/${id}.md: a Doing card needs a waiting: line — "" if it is moving, or "who: what" it waits on`)
    }
    if (card.waiting !== '' && !/^[^:]{1,40}: \S/.test(card.waiting)) {
      throw new Error(`board/${id}.md: waiting: names who or what first, as "who: what" — got ${JSON.stringify(card.waiting)}`)
    }
  } else if (card.waiting !== undefined) {
    // Off Doing, nothing renders it and nothing waits: a `waiting` line on a
    // finished card is a record kept where nobody reads it. Refused, so the
    // close that moves a card out of Doing is the edit that removes it.
    throw new Error(`board/${id}.md: waiting: belongs on a Doing card, and this one is "${col}" — delete the line when a card leaves Doing`)
  }
  return card
}

/** Who or what a Doing card waits on: the part of `waiting` before its first colon. */
const waitingOn = c => (c.column === 'doing' && c.waiting ? c.waiting.slice(0, c.waiting.indexOf(':')).trim() : '')

const cards = readdirSync(CARDS)
  .filter(n => n.endsWith('.md'))
  .map(n => parseCard(n.replace(/\.md$/, ''), readFileSync(join(CARDS, n), 'utf8')))
  .sort((a, b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id))

const esc = s => String(s ?? '').replace(/\r/g, '')
const open = cards.filter(c => c.column !== 'done')
const byKind = k => open.filter(c => c.kind === k).length
const unclaimed = open.filter(c => !c.owner).length
const doing = cards.filter(c => c.column === 'doing')
const moving = doing.filter(c => !c.waiting).length
// Who the Doing column is waiting on, most-waited-on first: the batch a person
// would want in front of them, and the chase the card exists to redirect.
const waitingBy = Object.entries(
  doing.filter(c => c.waiting).reduce((acc, c) => ((acc[waitingOn(c)] ??= []).push(c.id), acc), {}),
).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
const doingSummary =
  `${doing.length} in Doing: ${moving} moving` +
  (waitingBy.length ? `, waiting on ${waitingBy.map(([who, ids]) => `${who} ${ids.length}`).join(', ')}` : '')

const out = []
out.push('# The Obsrv board')
out.push('')
out.push(`*${cards.length} cards, ${open.length} open, ${unclaimed} of those unclaimed. ${doingSummary}.*`)
out.push('')
out.push('**This file is generated. The board is [`board/`](../board), one file per')
out.push('card — edit those.** `npm run board` regenerates this locally, and the')
out.push('published board is rebuilt from `main` on every push. CI runs')
out.push('`npm run board:check`, which refuses a card it cannot read — including a')
out.push('Doing card that does not say whether it is moving or waiting.')
out.push('')
out.push('## If you want to pick something up')
out.push('')
out.push('Cards in **Next** are the ones worth starting. Each carries the criterion it')
out.push('closes, an owner when it has one, and the file, commit or document that')
out.push('defines *done* — enough to begin without having been in the conversation that')
out.push('produced it.')
out.push('')
out.push('**Claim it by editing its file** — set `owner:`, `column: doing` and')
out.push('`waiting: ""` in `board/<id>.md`, and open a pull request with only the card;')
out.push('it merges before the work starts. When the work stops on someone or')
out.push('something, say so: `waiting: "Opeyemi: a time for run 19"`, or')
out.push('`waiting: "event: #48\'s suite"`. An unowned card in Next or Backlog is free;')
out.push('a Doing card is moving unless it names what it waits on, and a card in')
out.push('Review is finished and waiting on the maintainer rather than on help.')
out.push('')
out.push('**How to read a commit on a card.** Where a card names delivered work it')
out.push('gives a branch and then a sha as `as of` — `fix/thing (as of 9fe0fda)`. The')
out.push('**branch is the address**; the sha is a timestamp. Unmerged branches get')
out.push('rebased when main moves, which leaves the content identical and every sha')
out.push('different, so a bare sha on a card becomes wrong while still reading as')
out.push('precise. Go to the branch. If its tip no longer matches the `as of`, that is')
out.push('a rebase and not a different piece of work.')
out.push('')
out.push('Two things worth knowing before you start, both of which this project has')
out.push('learned the hard way and written down:')
out.push('')
out.push('- [`docs/readiness.md`](readiness.md) is the definition of done for anything')
out.push('  labelled with a criterion (`A1`…`E2`). The board tracks work; readiness')
out.push('  states what would make the work finished.')
out.push('- [`docs/limitations.md`](limitations.md) lists the things that look like bugs')
out.push('  and are not. Worth two minutes before filing one.')
out.push('')

for (const col of COLUMNS) {
  const inCol = cards.filter(c => c.column === col.id)
  if (inCol.length === 0) continue
  out.push('---')
  out.push('')
  out.push(`## ${col.name} — ${inCol.length}`)
  out.push('')
  out.push(`*${col.blurb}*`)
  out.push('')
  for (const c of inCol) {
    const bits = []
    if (c.criterion) bits.push(`**${esc(c.criterion)}**`)
    if (c.kind && KIND[c.kind]) bits.push(KIND[c.kind])
    bits.push(c.owner ? `owner: ${esc(c.owner)}` : '*unclaimed*')
    if (c.column === 'doing') bits.push(c.waiting ? `**waiting on ${esc(c.waiting)}**` : 'moving')
    out.push(`### ${esc(c.title)}`)
    out.push('')
    out.push(`[\`${esc(c.id)}\`](../board/${esc(c.id)}.md) · ${bits.join(' · ')}`)
    if (c.evidence) {
      out.push('')
      // The evidence is prose with hard breaks, and some of it is bulleted.
      // Reflow the prose so markdown can wrap it, but keep a line that starts
      // a bullet on its own line — running two bullets together loses the
      // thing a bullet list is for, which is that these are separate facts.
      for (const para of esc(c.evidence).split('\n\n')) {
        const lines = para.split('\n')
        const bulleted = lines.some(l => /^\s*[•\-*]\s/.test(l))
        if (bulleted) {
          for (const l of lines) {
            const t = l.trim()
            if (t) out.push(t.replace(/^[•*]\s*/, '- '))
          }
          out.push('')
        } else {
          out.push(para.replace(/\n/g, ' ').trim(), '')
        }
      }
    } else {
      out.push('')
    }
  }
}

out.push('---')
out.push('')
out.push(`*Regenerate with \`npm run board\`. Counts above: ${byKind('readiness')} readiness, ${byKind('bug')} bugs, ${byKind('chore')} chores, among the open cards.*`)
const rendered = out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n'

// The same cards as a Kanban page, for seeing state at a glance rather than
// reading 51 cards. Read-only on purpose: moving a card is editing its file,
// and a page you could drag cards in would put card state in two places that
// disagree — which is what this board was moved into the repo to stop.
function renderHtml(stampText) {
  const data = COLUMNS.map(col => ({
    ...col,
    cards: cards
      .filter(c => c.column === col.id)
      .map(c => ({
        id: c.id, title: c.title, owner: c.owner ?? '', criterion: c.criterion ?? '', kind: c.kind ?? '', evidence: c.evidence ?? '',
        // null off the Doing column: a `waiting` left behind on a finished card is history, not state.
        waiting: c.column === 'doing' ? (c.waiting ?? '') : null,
      })),
  })).filter(c => c.cards.length > 0)
  // `</script>` inside a card's prose would end the tag early; the escape is
  // invisible to JSON.parse and keeps the page from breaking on a card that
  // happens to quote some HTML.
  const json = JSON.stringify({ columns: data, open: open.length, unclaimed, total: cards.length, doingSummary, stamp: stampText, auto })
    .replace(/</g, '\\u003c')
  const head = fragment
    ? ''
    : `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="description" content="The open work on Obsrv, generated from the card files in the repository.">
`
  const tail = fragment ? '' : '\n</body>\n</html>\n'
  const bodyOpen = fragment ? '' : '</head>\n<body>\n'
  return `${head}<title>Obsrv Board</title>
<style>
  ${fragment ? '' : 'body { margin: 0; } img { max-width: 100%; } [hidden] { display: none !important; }'}
  :root {
    --bg: #f6f7f9; --panel: #fff; --card: #fff; --ink: #14171a; --dim: #5b6570;
    --line: #e2e6ea; --accent: #2f6df6; --shadow: 0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.1);
    --next: #2f6df6; --doing: #b4690e; --review: #7a3ec8; --backlog: #5b6570; --done: #1a7f4b;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #14171a; --panel: #1b1f24; --card: #20252b; --ink: #e8ecf1; --dim: #96a1ad;
      --line: #2b323a; --shadow: none;
      --next: #7da6ff; --doing: #e8b06a; --review: #c39bf0; --backlog: #96a1ad; --done: #5cc98d;
    }
  }
  :root[data-theme="dark"] {
    --bg: #14171a; --panel: #1b1f24; --card: #20252b; --ink: #e8ecf1; --dim: #96a1ad;
    --line: #2b323a; --shadow: none;
    --next: #7da6ff; --doing: #e8b06a; --review: #c39bf0; --backlog: #96a1ad; --done: #5cc98d;
  }
  body { background: var(--bg); color: var(--ink); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  .wrap { padding: 20px 16px 40px; max-width: 1600px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; letter-spacing: -.01em; }
  .sub { color: var(--dim); margin: 0 0 4px; }
  .stamp { color: var(--dim); font-size: 12px; margin: 0 0 18px; }
  .stamp b { color: var(--ink); font-weight: 600; }
  .cols { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(270px, 1fr); gap: 14px; overflow-x: auto; padding-bottom: 8px; }
  @media (max-width: 860px) { .cols { grid-auto-flow: row; grid-auto-columns: auto; } }
  .col { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px; min-width: 0; }
  .colhead { display: flex; align-items: baseline; gap: 8px; margin-bottom: 2px; }
  .colhead h2 { font-size: 13px; margin: 0; text-transform: uppercase; letter-spacing: .06em; }
  .n { font-size: 12px; color: var(--dim); }
  .blurb { color: var(--dim); font-size: 12px; margin: 0 0 10px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 10px 11px; margin-bottom: 8px; box-shadow: var(--shadow); cursor: pointer; }
  .card:hover { border-color: var(--accent); }
  .card h3 { font-size: 13.5px; margin: 0 0 6px; font-weight: 600; line-height: 1.35; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 11px; }
  .tag { border: 1px solid var(--line); border-radius: 999px; padding: 1px 7px; color: var(--dim); }
  .tag.crit { border-color: currentColor; font-weight: 600; }
  .owner { color: var(--dim); }
  .owner.none { font-style: italic; opacity: .75; }
  .wait { margin-top: 6px; font-size: 11.5px; line-height: 1.35; }
  .wait.on { color: var(--doing); font-weight: 600; }
  .wait.moving { color: var(--dim); }
  .id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--dim); }
  dialog { border: 1px solid var(--line); border-radius: 12px; background: var(--panel); color: var(--ink); max-width: 760px; width: calc(100% - 32px); padding: 0; }
  dialog::backdrop { background: rgba(0,0,0,.45); }
  .dhead { padding: 16px 18px 10px; border-bottom: 1px solid var(--line); }
  .dhead h3 { margin: 0 0 8px; font-size: 16px; }
  .dbody { padding: 14px 18px 18px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; max-height: 60vh; overflow-y: auto; }
  .dbody code, .dbody :not(pre) > code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .close { position: sticky; bottom: 0; display: block; width: 100%; padding: 11px; border: 0; border-top: 1px solid var(--line); background: var(--panel); color: var(--accent); font: inherit; font-weight: 600; cursor: pointer; border-radius: 0 0 12px 12px; }
  .empty { color: var(--dim); font-style: italic; font-size: 12px; }
</style>
${bodyOpen}<div class="wrap">
  <h1>The Obsrv board</h1>
  <p class="sub" id="sub"></p>
  <p class="stamp" id="stamp"></p>
  <div class="cols" id="cols"></div>
</div>
<dialog id="dlg">
  <div class="dhead"><h3 id="dtitle"></h3><div class="meta" id="dmeta"></div></div>
  <div class="dbody" id="dbody"></div>
  <button class="close" id="dclose">Close</button>
</dialog>
<script>
const DATA = JSON.parse(${JSON.stringify(json)});
const COLOR = { next: 'var(--next)', doing: 'var(--doing)', review: 'var(--review)', backlog: 'var(--backlog)', done: 'var(--done)' };
document.getElementById('sub').textContent =
  DATA.total + ' cards · ' + DATA.open + ' open · ' + DATA.unclaimed + ' unclaimed · ' + DATA.doingSummary;
const st = document.getElementById('stamp');
if (DATA.stamp) {
  const where = '<b>' + DATA.stamp.replace(/[<>&]/g, '') + '</b>';
  st.innerHTML = DATA.auto
    ? 'Built from ' + where + ' and rebuilt on every push to main. The cards in <code>board/</code> are the source.'
    : 'Snapshot of ' + where + ' — this page does not update itself. The cards in <code>board/</code> are the source; if they disagree, the repo is right.';
} else { st.remove(); }
const cols = document.getElementById('cols');
for (const col of DATA.columns) {
  const d = document.createElement('div');
  d.className = 'col';
  const head = document.createElement('div');
  head.className = 'colhead';
  const h = document.createElement('h2');
  h.textContent = col.name; h.style.color = COLOR[col.id] || 'var(--ink)';
  const n = document.createElement('span'); n.className = 'n'; n.textContent = col.cards.length;
  head.append(h, n);
  const b = document.createElement('p'); b.className = 'blurb'; b.textContent = col.blurb;
  d.append(head, b);
  for (const c of col.cards) {
    const el = document.createElement('div');
    el.className = 'card';
    const t = document.createElement('h3'); t.textContent = c.title;
    const m = document.createElement('div'); m.className = 'meta';
    if (c.criterion) { const s = document.createElement('span'); s.className = 'tag crit'; s.style.color = COLOR[col.id]; s.textContent = c.criterion; m.append(s); }
    if (c.kind) { const s = document.createElement('span'); s.className = 'tag'; s.textContent = c.kind; m.append(s); }
    const o = document.createElement('span');
    o.className = 'owner' + (c.owner ? '' : ' none');
    o.textContent = c.owner || 'unclaimed';
    const id = document.createElement('span'); id.className = 'id'; id.textContent = c.id;
    m.append(o, id);
    el.append(t, m);
    if (c.waiting !== null) {
      const w = document.createElement('div');
      w.className = 'wait ' + (c.waiting ? 'on' : 'moving');
      w.textContent = c.waiting ? 'Waiting on ' + c.waiting : 'Moving';
      el.append(w);
    }
    el.addEventListener('click', () => open_(c, col));
    d.append(el);
  }
  cols.append(d);
}
const dlg = document.getElementById('dlg');
function open_(c, col) {
  document.getElementById('dtitle').textContent = c.title;
  const meta = document.getElementById('dmeta');
  meta.textContent = '';
  const bits = [c.id, col.name, c.criterion, c.kind, c.owner || 'unclaimed',
    c.waiting === null ? '' : c.waiting ? 'waiting on ' + c.waiting : 'moving'].filter(Boolean);
  for (const b of bits) { const s = document.createElement('span'); s.className = 'tag'; s.textContent = b; meta.append(s); }
  document.getElementById('dbody').textContent = c.evidence || 'No evidence recorded on this card.';
  dlg.showModal();
}
document.getElementById('dclose').addEventListener('click', () => dlg.close());
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
</script>${tail}`
}

if (!check) {
  writeFileSync(OUT, rendered)
  writeFileSync(htmlOut, renderHtml(stamp))
  console.error(`board: ${cards.length} cards → docs/board.md${htmlOut === OUT_HTML ? ' + docs/board.html' : ` + ${htmlOut}`}`)
  process.exit(0)
}

// --check renders both views and throws away the result. Nothing is compared
// against a stored copy, because there is no stored copy: the views are
// gitignored and built on demand. What is left to catch is a card that cannot
// be rendered at all, and that is worth catching here rather than in the Pages
// deploy, where the failure would be a broken publish instead of a refused
// push.
//
// Reaching this line already means every card parsed — `parseCard` throws on a
// card with no frontmatter block, naming the file — and that both views
// rendered without throwing. Watched refusing on 2026-09-15 with a planted
// card carrying no frontmatter: exit 1, and the message named the card.
//
// It is deliberately a small promise. The old --check could be defeated by
// forgetting to commit; this one cannot be defeated by forgetting anything,
// because the only copy anyone reads is built from the cards every time.
renderHtml('')
console.error(`board: ${cards.length} cards render (nothing is compared — the views are not committed)`)
process.exit(0)
