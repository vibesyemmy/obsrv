#!/usr/bin/env node
// Renders docs/board.md from the cards in board/.
//
//   npm run board          rewrite docs/board.md from board/
//   npm run board:check    fail if docs/board.md is not what board/ produces
//
// The cards ARE the board. One file per card in board/, each with a small
// frontmatter block and its evidence as the body; docs/board.md is generated
// from them and committed beside them.
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
// Both problems are gone by construction here rather than by discipline. The
// cards and the generated file live in the same commit, so `--check` in CI
// fails on a stale snapshot instead of trusting anyone to remember; and the
// repo is writable by everyone who can open a pull request, which is everyone.
//
// Claiming a card is now editing its file. That is the whole mechanism.
//
// WHEN docs/board.md CONFLICTS ON A REBASE, REGENERATE IT — NEVER HAND-RESOLVE.
// It will conflict on any branch that touches a card while main moves, because
// two people generated the same file from different card sets. Resolving the
// markers by hand produces a board that matches neither side and belongs to
// nobody: the one artefact here with no source is the generated one. Take
// either side, run `npm run board`, and let the cards decide. `--check` is
// what stops a hand-resolved file reaching main, and it runs on pull requests
// as well as pushes, which is the half that matters — a check that only ran on
// main would tell you the board was broken after it was broken. First hit by
// Kenya rebasing c3, who regenerated rather than merging and was right to.
const { readdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join, dirname } = require('node:path')

const ROOT = join(dirname(__dirname))
const CARDS = join(ROOT, 'board')
const OUT = join(ROOT, 'docs', 'board.md')
const check = process.argv.includes('--check')

const COLUMNS = [
  { id: 'next', name: 'Next', blurb: 'Picked, not claimed — start here.' },
  { id: 'doing', name: 'Doing', blurb: 'Claimed. Someone is on it.' },
  { id: 'review', name: 'Review', blurb: 'Finished, waiting on the maintainer to merge.' },
  { id: 'backlog', name: 'Backlog', blurb: 'Not started, not yet picked.' },
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
  return card
}

const cards = readdirSync(CARDS)
  .filter(n => n.endsWith('.md'))
  .map(n => parseCard(n.replace(/\.md$/, ''), readFileSync(join(CARDS, n), 'utf8')))
  .sort((a, b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id))

const esc = s => String(s ?? '').replace(/\r/g, '')
const open = cards.filter(c => c.column !== 'done')
const byKind = k => open.filter(c => c.kind === k).length
const unclaimed = open.filter(c => !c.owner).length

const out = []
out.push('# The Obsrv board')
out.push('')
out.push(`*${cards.length} cards, ${open.length} open, ${unclaimed} of those unclaimed.*`)
out.push('')
out.push('**This file is generated. The board is [`board/`](../board), one file per')
out.push('card — edit those.** `npm run board` regenerates this; CI runs')
out.push('`npm run board:check` and fails if the two disagree, so this cannot go')
out.push('quietly stale the way a snapshot of somewhere else can.')
out.push('')
out.push('## If you want to pick something up')
out.push('')
out.push('Cards in **Next** are the ones worth starting. Each carries the criterion it')
out.push('closes, an owner when it has one, and the file, commit or document that')
out.push('defines *done* — enough to begin without having been in the conversation that')
out.push('produced it.')
out.push('')
out.push('**Claim it by editing its file** — set `owner:` and `column: doing` in')
out.push('`board/<id>.md`, run `npm run board`, and open a pull request with both')
out.push('changes. That is the whole mechanism; there is no separate board to update')
out.push('and no one you have to ask to update it for you. An unowned card in Next or')
out.push('Backlog is free; a card with an owner is being worked on, and a card in')
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

if (!check) {
  writeFileSync(OUT, rendered)
  console.error(`board: ${cards.length} cards → docs/board.md`)
  process.exit(0)
}

// --check is the part that makes staleness impossible rather than merely
// discouraged. A generated file nobody compares is a generated file that
// starts lying the first time someone edits a card and forgets the command.
let current = ''
try {
  current = readFileSync(OUT, 'utf8')
} catch {
  console.error('board: docs/board.md does not exist. Run `npm run board`.')
  process.exit(1)
}
if (current === rendered) {
  console.error(`board: docs/board.md matches board/ (${cards.length} cards)`)
  process.exit(0)
}
const a = current.split('\n')
const b = rendered.split('\n')
const at = a.findIndex((l, i) => l !== b[i])
console.error('board: docs/board.md does NOT match board/. Run `npm run board` and commit the result.')
console.error(`  first difference at line ${at + 1}:`)
console.error(`    committed: ${JSON.stringify(a[at] ?? '<end of file>')}`)
console.error(`    board/:    ${JSON.stringify(b[at] ?? '<end of file>')}`)
process.exit(1)
