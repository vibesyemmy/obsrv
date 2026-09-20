#!/usr/bin/env node
// Answers one question before a local e2e run: may I run this spec on someone's desk?
//
// Written because I got it wrong (Henry, 2026-09-20). Chasing a flaky in #388 I
// ran `live-drive.spec.ts` three times on Opeyemi's machine, having checked
// `docs/e2e-flakes.md` first. That is the wrong file: it answers "is this test
// unreliable". The file that answers "does this test take the desk" is
// `board/bug-e2e-takes-the-desk.md`, which records live-drive.spec as fronting
// the app — "fronts alone too ... Unexplained". Two records, two questions, and
// I conflated them while being careful about something else.
//
// The rule this serves: a spec with a RECORDED ACTIVATION is not desk-safe
// whatever its label, and specs that take the desk on purpose need their own yes.
//
// What it cannot tell you: whether a spec with no record will front. Absence of
// a record is absence of a record. It says so rather than answering "safe".
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const DESK_CARD = 'board/bug-e2e-takes-the-desk.md'
const FLAKES = 'docs/e2e-flakes.md'

const read = (p) => {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

const spec = process.argv[2]
if (spec === undefined) {
  console.error('usage: node scripts/desk-safe.js <tests/e2e/NAME.spec.ts>')
  process.exit(2)
}

const name = basename(spec).replace(/\.spec\.ts$/, '')
const lines = (text) =>
  text
    .split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => l.includes(name))

const activations = lines(read(DESK_CARD))
const flakes = lines(read(FLAKES))
const src = read(spec)
const gated = /OBSRV_E2E_FRONT|OBSRV_TEST_TAKES_THE_DESK/.test(src)

console.log(`spec: ${spec}`)
console.log(`\nrecorded activations (${DESK_CARD}): ${activations.length}`)
for (const [n, l] of activations.slice(0, 6)) console.log(`  :${n}  ${l.trim().slice(0, 110)}`)
console.log(`\nflake record (${FLAKES}): ${flakes.length} mention(s)`)
for (const [n, l] of flakes.slice(0, 3)) console.log(`  :${n}  ${l.trim().slice(0, 110)}`)
console.log(`\ndesk gates in the file (OBSRV_E2E_FRONT / OBSRV_TEST_TAKES_THE_DESK): ${gated ? 'present' : 'none'}`)

console.log('')
if (activations.length > 0) {
  console.log('VERDICT: NOT desk-safe by the standing rule — this spec has a recorded activation.')
  console.log('         Running it on someone\'s machine needs their yes, given in the session that runs it.')
  process.exit(1)
}
console.log('VERDICT: no recorded activation for this spec.')
console.log('         That is not a promise it will not front — it is the absence of a record.')
if (gated) console.log('         It also contains desk-taking tests behind a gate; those need their own yes.')
process.exit(0)
