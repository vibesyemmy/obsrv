#!/usr/bin/env node
// What is true right now, read from where it lives, with the time it was read.
//
//   npm run status
//
// Why this exists (2026-10-03): the team kept reporting facts that had moved.
// A PR head had changed since someone read it; "a merge needs your own click"
// was a day stale; a PASS recorded in the room was "not in my record" because
// the person answering had lost it at a context break; a count was quoted from
// a run for a head that had since been replaced. What we remember lives in a
// conversation that goes stale and gets cut. What is true lives in GitHub, in
// the repo and in the room's own database. So a status line should be COPIED
// from this command's output, with its source and time, and not recalled.
//
// What it prints, each section with its source and the time it was read:
//   main                  the full head of `main`
//   open PRs              full head and merge state of each
//   CI per head           the latest `ci.yml` run whose OWN headSha equals the
//                         head, with its attempt, or "no run for this head"
//   runs in flight        what is queued or running, and whether it is a push to
//                         main or a head an open PR still has
//   PASS ledger           every PASS verdict in the room's record for each open
//                         PR, newest first, against the head it names
//
// What it does NOT do, on purpose:
//   - It is EVIDENCE and not a verdict. There is no "ready" flag anywhere:
//     whether a head may land is a decision with an owner, and a tool that
//     prints a green light gets read as one.
//   - It does nothing. Every command it runs is a read (`gh pr list`,
//     `gh run list`, `gh api` GET, `sqlite3 -readonly`).
//   - It never prints a number it did not read. A section it cannot read says
//     `NOT READ: <why>` and the exit code is 1, so a missing section can never
//     be mistaken for an empty one. The ledger needs `OBSRV_ROOM_DB` AND
//     `OBSRV_ROOM_ID` (a room's id, or `all`); without them that section says
//     `NOT CONFIGURED`, which is a different fact from "no PASS found" and is
//     printed as loudly. **`NOT CONFIGURED` exits 0**, because the caller chose it, so
//     a script that reads only the exit code cannot tell a run with the ledger from
//     a run without it: read the text, or check that both variables are set.
//     The room is required because a PR number is only meaningful in the room that
//     is about this repository: a PASS for "#12" in another room's talk would become
//     a row. `all` is there for a database that holds only this room's talk.
//
// The PASS ledger parses message TEXT, so it prints the evidence and the
// message id to re-read, and a PASS in a format it does not know shows as
// missing, not as wrong. The formats it knows are pinned by real messages in
// tests/fixtures/status/pass-messages.json.
'use strict'

const { execFileSync } = require('node:child_process')

// ───────────────────────────── the PASS parser ─────────────────────────────

/** Markdown that wraps a verdict line: bold, code spans, italics, quotes. */
const stripMarkdown = s => s.replace(/[*`"“”]/g, '')

/** A line as the verdict tests see it: no markdown, no leading list marker, no leading @mentions. */
function normaliseLine(raw) {
  return stripMarkdown(raw)
    .replace(/^[\s>•-]+/, '')
    .replace(/^(?:@\w+\s*)+/, '')
    .trim()
}

/**
 * Whether a line is a verdict, and for which PR.
 *
 * Three shapes are in the real record, and all of them survive being wrapped in
 * markdown because the line is normalised first:
 *   `PASS: #543 at <sha>`       the verb first, then the PR
 *   `#542: PASS at <sha>`       the PR first, a colon or dash, then the verb
 *   `... #538 ... **PASS** ...` a bold PASS in the middle of a sentence, which
 *                               belongs to the nearest PR reference before it
 *
 * What is NOT a verdict, and must not become a row: "not a PASS yet", "Verdict
 * stays: not PASS", "The PASS at <sha> is superseded", "What this PASS does not
 * say". None of them STARTS with the verb or with a PR reference followed by it.
 *
 * Returns `{ pr, after }` where `after` is the offset in the NORMALISED line at
 * which to start looking for the SHA, or null.
 */
function verdictOnLine(raw) {
  const n = normaliseLine(raw)
  let m = /^PASS\b[\s:—–-]*#(\d+)/.exec(n)
  if (m) return { pr: Number(m[1]), after: m[0].length, line: n }
  // The separator is REQUIRED here: "#544: PASS" and "#539 — PASS." are verdicts,
  // while "#544 PASS at <sha> noted, thank you" is someone acknowledging one.
  m = /^#(\d+)\s*[:—–-]\s*PASS\b/.exec(n)
  if (m) return { pr: Number(m[1]), after: m[0].length, line: n }
  const bold = raw.indexOf('**PASS**')
  if (bold !== -1) {
    const before = stripMarkdown(raw.slice(0, bold))
    const refs = [...before.matchAll(/#(\d+)/g)]
    if (refs.length === 0) return null
    const pr = Number(refs[refs.length - 1][1])
    // Offset of the same position in the normalised line: its text after the verb.
    const tail = stripMarkdown(raw.slice(bold + '**PASS**'.length))
    const at = n.lastIndexOf(tail.trim())
    return { pr, after: at === -1 ? 0 : at, line: n }
  }
  return null
}

/**
 * The first SHA-looking token in `text`, or null.
 *
 * "Looks like a SHA" is narrower than "is made of hex digits", and each of the
 * restrictions below is there because a real or plausible line breaks without it:
 *   - at least seven characters, as `git` abbreviates;
 *   - at least one DIGIT: `defaced`, `acceded` and `effaced` are English words
 *     made only of a-f, and seven letters passes a length test;
 *   - an all-digit token counts only up to nine digits, or at the full 40: a CI run
 *     id such as 37123672372 is eleven digits and is all hex, and it is not a
 *     commit, while a real seven-digit abbreviation like 6849985 is;
 *   - not preceded by `#` or a word character, and not followed by one: a
 *     message or PR reference (`#3144`) and a longer word are not tokens;
 *   - lowercase, as `git` prints it.
 * A token followed by an ellipsis is a truncated display of a longer SHA.
 */
function firstSha(text) {
  for (const m of text.matchAll(/(?<![#\w])([0-9a-f]{7,40})(?!\w)(…|\.\.\.)?/g)) {
    const sha = m[1]
    if (!/\d/.test(sha)) continue
    if (/^\d+$/.test(sha) && sha.length > 9 && sha.length !== 40) continue
    return { sha, truncated: m[2] !== undefined }
  }
  return null
}

/**
 * Every PASS verdict in one message: ONE ROW PER VERDICT LINE, each with its own
 * PR and its own SHA.
 *
 * A message can hold several (`#3161` re-passes two PRs, each in its own
 * paragraph), and a message that recaps other people's PASSes names many PRs and
 * SHAs without containing a verdict at all. So the unit is the verdict LINE:
 * the SHA is searched from the verb onward on that line, then on the lines that
 * follow in the same paragraph, and stops at a blank line or at the next verdict.
 * "Any SHA in the message" would read a recap's list of six heads as the head of
 * the one PR passed.
 */
function verdictsInMessage(body) {
  const lines = body.split('\n')
  const found = lines.map(verdictOnLine)
  const rows = []
  lines.forEach((raw, i) => {
    const v = found[i]
    if (!v) return
    let region = v.line.slice(v.after)
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '' || found[j]) break
      region += '\n' + normaliseLine(lines[j])
      if (firstSha(region)) break
    }
    const token = firstSha(region)
    rows.push({ pr: v.pr, sha: token ? token.sha : null, truncated: token ? token.truncated : false, line: v.line.slice(0, 110) })
  })
  return rows
}

/**
 * Compare the SHA a verdict names to the head it should name.
 *
 * A full 40-character SHA is compared IN FULL, so one wrong character is STALE:
 * a prefix compare would pass it. A shorter SHA can only be a prefix, and is
 * reported as one with how many characters it had, because 8 matching characters
 * are weaker evidence than 40 and the reader should see which this was.
 */
function compareSha(named, head) {
  if (named === null) return 'NO SHA'
  if (named.length === 40) return named === head ? 'MATCH' : 'STALE'
  return head.startsWith(named) ? `MATCH (prefix of ${named.length})` : 'STALE'
}

/**
 * The ledger rows for the open PRs, newest message first, from messages
 * `{ seq, author, at, body }`. A PASS for a PR that is not open is counted, not listed.
 *
 * @param {Array<{seq:number, author:string, at:number, body:string}>} messages
 * @param {Map<number,string>} heads PR number -> full head SHA
 */
function passLedger(messages, heads) {
  const byPr = new Map([...heads.keys()].map(pr => [pr, []]))
  let notOpen = 0
  for (const m of [...messages].sort((a, b) => b.seq - a.seq)) {
    for (const v of verdictsInMessage(m.body)) {
      const head = heads.get(v.pr)
      if (head === undefined) {
        notOpen++
        continue
      }
      byPr.get(v.pr).push({ seq: m.seq, author: m.author, at: m.at, sha: v.sha, truncated: v.truncated, status: compareSha(v.sha, head), line: v.line })
    }
  }
  return { byPr, notOpen }
}

// ───────────────────────────── the sections ─────────────────────────────

const clock = d => `${d.toISOString().slice(11, 16)}Z`
const isoMinute = ms => `${new Date(ms).toISOString().slice(0, 16)}Z`

function header(title, source, at) {
  return `== ${title}  (${source}, as of ${clock(at)})`
}

function notRead(title, source, at, why) {
  return { text: `${header(title, source, at)}\nNOT READ: ${why}`, ok: false }
}

function mainSection(sha, source, at) {
  return { text: `${header('main', source, at)}\n${sha}`, ok: true }
}

/** @param {Array<{number:number, headRefOid:string, mergeStateStatus:string, mergeable:string, headRefName:string, isDraft?:boolean}>} prs */
function prSection(prs, source, at) {
  const title = 'open PRs'
  if (prs.length === 0) return { text: `${header(title, source, at)}\n(none open)`, ok: true }
  const rows = [...prs]
    .sort((a, b) => a.number - b.number)
    .map(p => `#${p.number}  ${p.headRefOid}  ${p.mergeStateStatus}/${p.mergeable}${p.isDraft ? '  DRAFT' : ''}  ${p.headRefName}`)
  return { text: `${header(title, source, at)}\n${rows.join('\n')}`, ok: true }
}

/**
 * For each open PR's head, the latest `ci.yml` run whose OWN `headSha` equals it.
 *
 * Compared in full, never by prefix or by branch: a run for the branch's previous
 * head is a run for a different commit, and quoting its result for this one is
 * the mistake this command exists to stop. A rerun keeps its run id and raises
 * `attempt`, so the attempt is part of what is printed.
 */
function ciSection(prs, runs, source, at, windowSize) {
  const title = 'CI per open head'
  const lines = [...prs]
    .sort((a, b) => a.number - b.number)
    .map(p => {
      const mine = runs.filter(r => r.headSha === p.headRefOid).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.attempt - a.attempt))
      if (mine.length === 0) return `#${p.number}  no run for this head in the last ${windowSize} runs`
      const r = mine[0]
      const outcome = r.status === 'completed' ? `completed/${r.conclusion}` : r.status
      const more = mine.length > 1 ? `  (+${mine.length - 1} earlier run${mine.length > 2 ? 's' : ''} for this head)` : ''
      return `#${p.number}  run ${r.databaseId} attempt ${r.attempt}  ${r.event}  ${outcome}  updated ${isoMinute(Date.parse(r.updatedAt))}${more}`
    })
  return { text: `${header(title, source, at)}\n${lines.join('\n') || '(no open PRs)'}`, ok: true }
}

const IN_FLIGHT = new Set(['queued', 'in_progress', 'pending', 'waiting', 'requested'])

function inFlightSection(prs, runs, source, at) {
  const title = 'runs in flight'
  const heads = new Set(prs.map(p => p.headRefOid))
  const live = runs.filter(r => IN_FLIGHT.has(r.status))
  if (live.length === 0) return { text: `${header(title, source, at)}\n(none)`, ok: true }
  // Three different things, and calling them all "superseded" was wrong the first time this ran for real: after
  // a merge, the runs in flight are the suites of the commits now on main, which supersede nothing.
  const what = r =>
    r.event === 'push' && r.headBranch === 'main'
      ? 'a push to main (the suite for a commit now on main)'
      : heads.has(r.headSha)
        ? 'an open PR head'
        : "NOT an open PR's head now (the PR was merged, closed or has a newer head)"
  const lines = live.map(r => `run ${r.databaseId} attempt ${r.attempt}  ${r.status}  ${r.headBranch}  ${r.headSha}  ${what(r)}`)
  return { text: `${header(title, source, at)}\n${lines.join('\n')}`, ok: true }
}

function ledgerSection(prs, ledger, source, at) {
  const title = 'PASS ledger'
  const out = []
  for (const p of [...prs].sort((a, b) => a.number - b.number)) {
    const rows = ledger.byPr.get(p.number) ?? []
    out.push(`#${p.number}  head ${p.headRefOid}`)
    if (rows.length === 0) out.push('    no PASS verdict found in the room record (a format this parser does not know would also show here)')
    for (const r of rows) {
      const named = r.sha === null ? '(names no SHA)' : `${r.sha}${r.truncated ? '…' : ''}`
      out.push(`    #${r.seq}  ${r.author}  ${isoMinute(r.at)}  ${r.status}  ${named}`)
    }
  }
  if (ledger.notOpen > 0) out.push(`(${ledger.notOpen} further PASS verdict${ledger.notOpen === 1 ? '' : 's'} name PRs that are not open)`)
  out.push('Evidence, not a verdict: re-read the message at its id before relying on a row.')
  return { text: `${header(title, source, at)}\n${out.join('\n')}`, ok: true }
}

// ───────────────────────────── reading ─────────────────────────────

/** The room database, read-only, through the `sqlite3` CLI (node:sqlite needs Node 22.5; engines says >=20). */
function readRoomMessages(run, env) {
  const db = env.OBSRV_ROOM_DB
  const room = env.OBSRV_ROOM_ID
  const everyRoom = room === 'all'
  if (!everyRoom && !/^[0-9a-zA-Z-]{4,80}$/.test(room ?? '')) throw new Error('OBSRV_ROOM_ID is not a plausible room id')
  // GLOB is case-sensitive; LIKE would also fetch every "passed" and "compass".
  const where = `m.body GLOB '*PASS*'${everyRoom ? '' : ` AND m.room_id = '${room}'`}`
  const sql = `SELECT m.seq AS seq, p.name AS author, m.created_at AS at, m.body AS body FROM messages m JOIN participants p ON p.id = m.participant_id WHERE ${where} ORDER BY m.seq`
  const out = run('sqlite3', ['-readonly', '-json', db, sql])
  return out.trim() === '' ? [] : JSON.parse(out)
}

/**
 * Builds the report. `run(cmd, args)` returns stdout or throws; `env` and `now`
 * are injected so the whole report is testable with no network and no clock.
 *
 * @returns {{ text: string, ok: boolean }}
 */
function buildReport(run, env, now) {
  const sections = []
  const attempt = (title, source, read) => {
    const at = now()
    try {
      sections.push(read(at))
    } catch (e) {
      sections.push(notRead(title, source, at, e instanceof Error ? e.message.split('\n')[0] : String(e)))
    }
  }

  let prs = null
  attempt('main', 'gh api repos/{owner}/{repo}/git/ref/heads/main', at => {
    const sha = run('gh', ['api', 'repos/{owner}/{repo}/git/ref/heads/main', '--jq', '.object.sha']).trim()
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`expected a 40-character SHA, got ${JSON.stringify(sha.slice(0, 60))}`)
    return mainSection(sha, 'gh api repos/{owner}/{repo}/git/ref/heads/main', at)
  })

  const prSource = 'gh pr list --state open'
  attempt('open PRs', prSource, at => {
    prs = JSON.parse(run('gh', ['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,headRefOid,mergeStateStatus,mergeable,headRefName,isDraft']))
    return prSection(prs, prSource, at)
  })

  const WINDOW = 100
  const runSource = `gh run list --workflow ci.yml --limit ${WINDOW}`
  let runs = null
  const readRuns = () => {
    if (runs === null) runs = JSON.parse(run('gh', ['run', 'list', '--workflow', 'ci.yml', '--limit', String(WINDOW), '--json', 'databaseId,attempt,headSha,headBranch,status,conclusion,event,createdAt,updatedAt']))
    return runs
  }

  for (const [title, build] of [
    ['CI per open head', (at, p, r) => ciSection(p, r, runSource, at, WINDOW)],
    ['runs in flight', (at, p, r) => inFlightSection(p, r, runSource, at)],
  ]) {
    attempt(title, runSource, at => {
      if (prs === null) throw new Error('the open PR list was not read, so there are no heads to match')
      return build(at, prs, readRuns())
    })
  }

  if (!env.OBSRV_ROOM_DB) {
    sections.push({
      text: `${header('PASS ledger', 'the room database', now())}\nNOT CONFIGURED: set OBSRV_ROOM_DB to the room database file, and OBSRV_ROOM_ID to the room's id. This is NOT "no PASS found".`,
      ok: true,
    })
  } else if (!env.OBSRV_ROOM_ID) {
    sections.push({
      text: `${header('PASS ledger', 'the room database', now())}\nNOT CONFIGURED: set OBSRV_ROOM_ID to the id of the room that talks about this repository, or to "all" to read every room in the database (a PR number in another room's PASS would become a row). This is NOT "no PASS found".`,
      ok: true,
    })
  } else {
    attempt('PASS ledger', `sqlite3 -readonly ${env.OBSRV_ROOM_ID === 'all' ? '(all rooms)' : `(room ${env.OBSRV_ROOM_ID})`}`, at => {
      if (prs === null) throw new Error('the open PR list was not read, so there are no heads to compare')
      const heads = new Map(prs.map(p => [p.number, p.headRefOid]))
      return ledgerSection(prs, passLedger(readRoomMessages(run, env), heads), `room database${env.OBSRV_ROOM_ID === 'all' ? ', all rooms' : `, room ${env.OBSRV_ROOM_ID}`}`, at)
    })
  }

  return { text: sections.map(s => s.text).join('\n\n') + '\n', ok: sections.every(s => s.ok) }
}

/**
 * Runs a command and returns its stdout. A failure is reported as the command's own first line of stderr
 * (`unable to open database file`, `HTTP 401`), not as Node's `Command failed: <the whole command line>`, which
 * for the ledger is a 300-character SQL statement that says nothing about what went wrong.
 */
function defaultRun(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    const err = e && typeof e === 'object' ? e : {}
    const said = String(err.stderr ?? '').trim().split('\n')[0]
    throw new Error(said || (err.code === 'ENOENT' ? `${cmd} is not installed or not on PATH` : String(err.message ?? e).split('\n')[0]))
  }
}

module.exports = { defaultRun, normaliseLine, verdictOnLine, firstSha, verdictsInMessage, compareSha, passLedger, mainSection, prSection, ciSection, inFlightSection, ledgerSection, readRoomMessages, buildReport }

if (require.main === module) {
  const { text, ok } = buildReport(defaultRun, process.env, () => new Date())
  process.stdout.write(text)
  process.exit(ok ? 0 : 1)
}
