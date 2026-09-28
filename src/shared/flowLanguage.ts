/**
 * Plain language resolved into flow steps: the interpretation layer for the
 * QA-flow-report feature (`board/epics/qa-flow-reports.md`). A QA engineer
 * writes "go to example.com, audit, scroll down" and gets back the step list
 * `validateFlow` already validates, rather than a coordinate recording that
 * breaks on any DOM change and looks like a product bug when it does.
 *
 * Pure, on purpose: no app, no report, no MCP surface. The resolved step list
 * is the durable artifact — what runs, re-runs and diffs — so this module is
 * checkable without anything live, exactly as `flow.ts` is.
 *
 * Two rules the whole design hangs off:
 *
 * 1. **`validateFlow` has the last word.** Every step this module emits goes
 *    through it before being returned, and the `Flow` handed back *is* its
 *    output. A resolver that drifts from the shared vocabulary then fails
 *    loudly here instead of shipping an invalid flow to the runner.
 * 2. **A clause resolves into a payload the live control commands actually
 *    accept, or it is refused with a named reason.** The resolver never
 *    guesses. `click` takes CSS-pixel coordinates (`parseClick`), not a
 *    description, so "log in" cannot become a step at all — and says so, per
 *    clause, rather than resolving into a plausible-looking selector click the
 *    runner would take a 400 on. The card's discipline: name the mechanism a
 *    sentence is keying off, not just the conclusion.
 */

import { presetApplyError } from './control'
import { validateFlow, type Flow, type FlowStep } from './flow'
import { parseInspectRequest } from './ipcPayloads'
import { urlSchemeError } from './url'

/**
 * What one clause was resolved into, correlated with `flow.steps` by index.
 * `clause` is carried here rather than left to the caller to reconstruct: the
 * splitter drops blank clauses, so an index alone could not be mapped back to
 * the engineer's own text.
 */
export interface ClauseResolution {
  /** The clause as written, whitespace collapsed and sentence punctuation trimmed. */
  clause: string
  /** The words the rule actually matched on — taken from the match, never written
   *  out beside the pattern, so the trace cannot claim a phrase the regex did
   *  not match. This is the readout that separates "Obsrv misunderstood step 2"
   *  from "step 2 is broken". */
  keyedOn: string
}

export interface FlowClauseRejection {
  /** -1 names the whole input (nothing resolvable in it at all); every other
   *  value indexes the clause list this module produced. Same convention as
   *  `FlowStepRejection` deliberately, so a caller reads one rule, not two. */
  index: number
  clause: string
  reason: string
}

export type ResolveFlowTextResult =
  | { ok: true; flow: Flow; resolutions: ClauseResolution[] }
  | { ok: false; rejections: FlowClauseRejection[] }

/**
 * Clause boundaries. ` and ` / ` then ` are matched with literal surrounding
 * whitespace rather than `\b`, because a word-boundary form splits a URL path
 * (`example.com/and/more`) and a URL never contains a space.
 */
const CLAUSE_SEPARATOR = /[,;\n]|\s+(?:and then|and|then)\s+/i

/**
 * A rule's outcome: a step, or a named reason this clause cannot become one.
 * Tagged on `ok` for the same reason `validateFlow` is — a step's passthrough
 * fields are unvalidated, and `reason` is a plausible one for a QA step to
 * carry (annotating why the step exists), so `'reason' in outcome` would
 * misread such a step as a refusal. `ok`/`step`/`reason` are this module's
 * keys; the engineer's are only ever inside `step`.
 */
type RuleOutcome = { ok: true; step: FlowStep } | { ok: false; reason: string }

interface Rule {
  pattern: RegExp
  resolve: (groups: Record<string, string | undefined>) => RuleOutcome
}

/**
 * A bare word would otherwise normalise to a host ("go to sleep" →
 * `https://sleep`), which is a navigation nobody asked for dressed as one they
 * did. A scheme, a dot, or a leading slash is the cheapest evidence that the
 * token was meant as an address.
 */
const looksLikeUrl = (token: string): boolean => token.startsWith('/') || /[.:]/.test(token)

/**
 * `parseInspectRequest` checks a selector's length, not its syntax, so a prose
 * description ("the login button") passes it and would be sent to the page as a
 * selector that matches nothing — an "absent" finding caused by the resolver,
 * indistinguishable from an absent element. A selector either starts with
 * selector punctuation or is a single bare tag name.
 */
const looksLikeSelector = (s: string): boolean => /^[.#[]/.test(s) || /^[a-z][a-z0-9-]*$/i.test(s)

/** `scroll`'s own page vocabulary (`SCROLL_PAGES`), reached by the words an engineer writes. */
const SCROLL_WHERE: Record<string, 'next' | 'prev' | 'top' | 'bottom'> = {
  down: 'next',
  up: 'prev',
  'to the top': 'top',
  'to top': 'top',
  'to the bottom': 'bottom',
  'to bottom': 'bottom',
}

/**
 * First match wins, so the order is load-bearing: the resolvable forms come
 * first, the named refusals after them, and the broadest pattern (a preset id)
 * last among the matchers.
 */
const RULES: Rule[] = [
  {
    pattern: /^(?<key>go to|goto|open|visit|load|navigate to)\s+(?<url>\S+)$/i,
    resolve: ({ url }) => {
      const token = url!
      if (!looksLikeUrl(token)) {
        return { ok: false, reason: `"${token}" is not a URL — a navigation needs a host, a scheme or a path (example.com, https://example.com, /tmp/page.html)` }
      }
      // The same allowlist the control server and the MCP tools apply, reused
      // rather than restated: one table decides what obsrv may load.
      const bad = urlSchemeError(token)
      if (bad) return { ok: false, reason: bad }
      return { ok: true, step: { action: 'navigate', url: token } }
    },
  },
  { pattern: /^(?<key>go back|back)$/i, resolve: () => ({ ok: true, step: { action: 'back' } }) },
  { pattern: /^(?<key>go forward|forward)$/i, resolve: () => ({ ok: true, step: { action: 'forward' } }) },
  { pattern: /^(?<key>reload|refresh)(?: the page)?$/i, resolve: () => ({ ok: true, step: { action: 'reload' } }) },
  {
    pattern: /^(?<key>scroll)\s+(?<where>down|up|to the top|to top|to the bottom|to bottom)$/i,
    resolve: ({ where }) => ({ ok: true, step: { action: 'scroll', page: SCROLL_WHERE[where!.toLowerCase()]! } }),
  },
  {
    // Refused rather than defaulted: "scroll" alone fits both "one screenful
    // down" and "back to the top", and picking one silently would put a step in
    // the flow the engineer never wrote.
    pattern: /^(?<key>scroll)$/i,
    resolve: () => ({ ok: false, reason: 'scroll needs a direction — "scroll down", "scroll up", "scroll to the top" or "scroll to the bottom"' }),
  },
  { pattern: /^(?<key>audit|run (?:an|the) audit)(?: the page)?$/i, resolve: () => ({ ok: true, step: { action: 'audit' } }) },
  { pattern: /^(?<key>lint|run (?:a|the) lint)(?: the page)?$/i, resolve: () => ({ ok: true, step: { action: 'lint' } }) },
  { pattern: /^(?<key>capture|screenshot|take a screenshot)(?: the page)?$/i, resolve: () => ({ ok: true, step: { action: 'captureVisible' } }) },
  {
    pattern: /^(?<key>inspect)\s+(?<selector>.+)$/i,
    resolve: ({ selector }) => {
      const s = selector!
      if (!looksLikeSelector(s)) {
        return { ok: false, reason: `"${s}" is a description, not a CSS selector — inspect takes a selector (".total", "#cart", "button") or a point, and nothing in a sentence can supply a point` }
      }
      const parsed = parseInspectRequest({ selector: s })
      if (typeof parsed === 'string') return { ok: false, reason: parsed }
      return { ok: true, step: { action: 'inspect', selector: s } }
    },
  },
  {
    pattern: /^(?:(?<key>on|switch to|set the preset to|use)\s+)(?:the\s+)?(?<id>[a-z0-9-]+)(?:\s+preset)?$/i,
    resolve: ({ id }) => {
      // `presetApplyError` names the valid ids and refuses `custom` for its own
      // reason; restating either here would give a second answer to drift from.
      const bad = presetApplyError(id)
      if (bad) return { ok: false, reason: bad }
      return { ok: true, step: { action: 'setPreset', id: id! } }
    },
  },
  {
    /**
     * The named refusal this slice exists to be honest about. Every verb here
     * is an interaction stated by intent, and the live vocabulary has no way to
     * express one: `parseClick` requires `{x, y}` in CSS-viewport pixels, which
     * only the rendered page can supply. `validateFlow` would happily accept
     * `{action: 'click', target: '.checkout'}` — its own test uses that shape —
     * but the control server answers it 400, so emitting it would move the
     * failure from here, where it names the cause, to mid-flow, where it looks
     * like the page.
     */
    pattern: /\b(?<key>clicks?|taps?|presses|press|types?|fills?|enters?|selects?|log ?in|logs ?in|sign ?in|signs ?in|sign ?up|log ?out|add to (?:the )?cart|adds? an item|check ?out|submits?|submit|searches for|search for|chooses?|choose)\b/i,
    resolve: ({ key }) => ({
      ok: false,
      reason: `"${key}" states an interaction, and obsrv's control vocabulary cannot express one from a description: click takes CSS-viewport coordinates ({x, y}), which only the rendered page can supply. Drive the interaction with obsrv_drive and give this flow the steps around it`,
    }),
  },
]

/** The forms a clause may take, quoted in the reason for anything that matched none of them. */
const KNOWN_FORMS =
  'go to <url>, back, forward, reload, scroll <down|up|to the top|to the bottom>, audit, lint, capture, inspect <css selector>, on <preset-id>'

/** Collapses whitespace and drops the sentence-final punctuation a written
 *  instruction ends with, so "reload the page." matches the same rule as "reload". */
const tidy = (clause: string): string => clause.trim().replace(/\s+/g, ' ').replace(/[.!?]+$/, '').trim()

function splitClauses(input: string): string[] {
  return input
    .split(CLAUSE_SEPARATOR)
    .map(tidy)
    .filter(c => c.length > 0)
}

type ClauseOutcome = { ok: true; step: FlowStep; resolution: ClauseResolution } | { ok: false; reason: string }

function resolveClause(clause: string): ClauseOutcome {
  for (const rule of RULES) {
    const match = rule.pattern.exec(clause)
    if (!match) continue
    const groups: Record<string, string | undefined> = match.groups ?? {}
    const outcome = rule.resolve(groups)
    if (!outcome.ok) return outcome
    // `keyedOn` comes from the match, so it names what the regex actually read
    // rather than what the rule claims to read. A named `key` group where the
    // rule has one, the whole match where the phrase *is* the rule.
    return { ok: true, step: outcome.step, resolution: { clause, keyedOn: groups['key'] ?? match[0] } }
  }
  return { ok: false, reason: `no sentence form matches it — obsrv resolves: ${KNOWN_FORMS}` }
}

/**
 * Resolves a plain-language flow description into a validated step list, or
 * refuses it with a reason per clause. Collects every rejection rather than
 * stopping at the first, as `validateFlow` does, so an engineer fixes the whole
 * sentence in one pass.
 */
export function resolveFlowText(input: string): ResolveFlowTextResult {
  const clauses = splitClauses(input)
  if (clauses.length === 0) {
    // Not an empty flow. `validateFlow([])` is a legitimate flow that
    // deliberately does nothing, so returning one here would make "you gave me
    // no instructions" indistinguishable from "these instructions ask for
    // nothing" — one silence fitting two opposite facts.
    return { ok: false, rejections: [{ index: -1, clause: input, reason: 'a flow description must contain at least one clause; this one is blank' }] }
  }

  const steps: FlowStep[] = []
  const resolutions: ClauseResolution[] = []
  const rejections: FlowClauseRejection[] = []
  clauses.forEach((clause, index) => {
    const outcome = resolveClause(clause)
    if (!outcome.ok) {
      rejections.push({ index, clause, reason: `clause ${index} ("${clause}"): ${outcome.reason}` })
      return
    }
    steps.push(outcome.step)
    resolutions.push(outcome.resolution)
  })
  if (rejections.length > 0) return { ok: false, rejections }

  // The shared validator, not this module, decides whether the output is a
  // flow: the `Flow` returned is its own, so "what comes out is what
  // `validateFlow` accepts" holds by construction rather than by agreement.
  // This branch is unreachable while the rules stay inside the vocabulary — it
  // is here so a rule that leaves it fails loudly at the seam it broke.
  const validated = validateFlow(steps)
  if (!validated.ok) {
    return {
      ok: false,
      rejections: validated.rejections.map(r => ({
        index: r.index,
        clause: clauses[r.index] ?? input,
        reason: `the resolver produced a step the shared flow validator rejects — this is a resolver defect, not a bad description: ${r.reason}`,
      })),
    }
  }
  return { ok: true, flow: validated.flow, resolutions }
}
