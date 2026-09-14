#!/usr/bin/env node
// Renders docs/board.md from a dump of the team board's `tasks` collection.
//
// The board itself lives in a Claude Artifact with a shared database, which is
// organization-internal by construction and cannot be made public. This file
// is how work reaches anyone outside that: the repo is public, so a generated
// board is readable by any person or agent who can read the repo, and they can
// act on a card by opening a pull request against it.
//
// It is a SNAPSHOT, and the whole risk of a snapshot is that it goes quietly
// stale while reading as current. Two things guard that: the file stamps the
// moment it was generated and names the artifact it came from, and this script
// exists so anyone can regenerate it rather than hand-editing a card back into
// agreement. A board nobody can rebuild is a board that starts lying the first
// time the real one changes.
//
//   node scripts/build-board.js <dump-dir> > docs/board.md
//
// where <dump-dir> holds one JSON file per card, as the Artifact tool's
// read_db writes with `out_dir`.
const { readdirSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

const ARTIFACT = 'https://claude.ai/code/artifact/05cfdc1c-4854-40e8-b46e-bdf5e58d6c36'
const dir = process.argv[2]
if (!dir) {
  console.error('usage: node scripts/build-board.js <dump-dir>')
  process.exit(2)
}

const COLUMNS = [
  { id: 'next', name: 'Next', blurb: 'Picked, not claimed — start here.' },
  { id: 'doing', name: 'Doing', blurb: 'Claimed. Someone is on it.' },
  { id: 'review', name: 'Review', blurb: 'Finished, waiting on the maintainer to merge.' },
  { id: 'backlog', name: 'Backlog', blurb: 'Not started, not yet picked.' },
  { id: 'done', name: 'Done', blurb: 'Merged.' },
]
const KIND = { readiness: 'readiness', bug: 'bug', chore: 'chore' }

const cards = readdirSync(join(dir, 'tasks'))
  .filter(n => n.endsWith('.json'))
  .map(n => {
    const raw = JSON.parse(readFileSync(join(dir, 'tasks', n), 'utf8'))
    // read_db writes either the document body or {id, data}; accept both.
    const d = raw.data ?? raw
    return { id: raw.id ?? n.replace(/\.json$/, ''), ...d }
  })
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

const esc = s => String(s ?? '').replace(/\r/g, '')
const open = cards.filter(c => c.column !== 'done')
const byKind = k => open.filter(c => c.kind === k).length
const unclaimed = open.filter(c => !c.owner).length

const out = []
out.push('# The Obsrv board')
out.push('')
out.push(`*Generated ${new Date().toISOString().slice(0, 10)} from the team board. ${cards.length} cards, ${open.length} open, ${unclaimed} of those unclaimed.*`)
out.push('')
out.push('This is a snapshot of a live board that lives in a Claude Artifact with a')
out.push('shared database. That board is organization-internal and cannot be made')
out.push('public, so this file is how the work reaches everyone else. **The artifact is')
out.push('authoritative; this file is a copy** — if the two disagree, the artifact is')
out.push('right and this needs regenerating with `npm run board`.')
out.push('')
out.push('## If you want to pick something up')
out.push('')
out.push('Cards in **Next** are the ones worth starting. Each carries the criterion it')
out.push('closes, an owner when it has one, and the file, commit or document that')
out.push('defines *done* — enough to begin without having been in the conversation that')
out.push('produced it.')
out.push('')
out.push('**Open a pull request against the card.** Say which card id you are taking in')
out.push('the description. An unowned card in Next or Backlog is free; a card with an')
out.push('owner is being worked on by that session or person, and a card in Review is')
out.push('finished and waiting on the maintainer rather than on help.')
out.push('')
out.push('**How to read a commit on a card.** Where a card names delivered work it')
out.push('gives a branch and then a sha as `as of` — `fix/thing (as of 9fe0fda)`. The')
out.push('**branch is the address**; the sha is a timestamp. Unmerged branches get')
out.push('rebased when main moves, which leaves the content identical and every sha')
out.push('different, so a bare sha on a card becomes wrong while still reading as')
out.push('precise — the failure this file exists to avoid, one level down. Go to the')
out.push('branch. If its tip no longer matches the `as of`, that is a rebase and not')
out.push('a different piece of work.')
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
out.push(`The live board, for anyone in the organization: ${ARTIFACT}`)
out.push('')

for (const col of COLUMNS) {
  const inCol = cards.filter(c => (c.column ?? 'backlog') === col.id)
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
    out.push(`\`${esc(c.id)}\` · ${bits.join(' · ')}`)
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
process.stdout.write(out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n')
