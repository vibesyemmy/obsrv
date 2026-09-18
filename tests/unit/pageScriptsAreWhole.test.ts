import { describe, expect, it } from 'vitest'
import { AUDIT_SCRIPT } from '../../src/shared/audit'
import { INSPECT_SCRIPT } from '../../src/shared/inspect'
import { LINT_SCRIPT } from '../../src/shared/lint'
import { SCROLL_HOST_SCRIPT, SHADOW_TREE_SCRIPT, WALK_STEP_SCRIPT } from '../../src/shared/scrollHost'
import { STUCK_CHROME_SCRIPT } from '../../src/shared/stuckChrome'

/**
 * Every name a shipped page script CALLS is declared inside that same string,
 * or is something a browser already has.
 *
 * **The hole this fills** (`chore-page-script-guard-holes`, item 1).
 * `pageScriptsAreSelfContained.test.ts` reads the BUILT bundles and catches a
 * *namespaced* call — `emptyDocument.shadowContains(...)`, the shape `#293`
 * shipped and four `cli-snap-tiled` tests caught on CI. It cannot catch the
 * other half: a **bare** call to a helper that was never added to the
 * concatenation. Adding a function to `scrollHost.ts`, calling it from
 * `findScroller`, and forgetting the `.toString()` line compiles, type-checks,
 * passes that guard, and throws in the page. It is now the likelier of the two,
 * because the import shape is the one `#293` designed out.
 *
 * **Why this reads the STRINGS and the other reads the BUNDLE**, and both stay.
 * A script's completeness is a property of the string — every name it uses has
 * to be in it. The namespacing is a property of the build, and only the build
 * shows it. Reading the bundle for completeness is what forced that test's
 * exclusion list: in a whole bundle, `t.lintPage(...)` from main is
 * indistinguishable from a script reaching through a namespace. **Here there is
 * no exclusion list at all**, because `t.lintPage(...)` is in none of these
 * strings.
 */

const SCRIPTS: ReadonlyArray<readonly [string, string]> = [
  ['SHADOW_TREE_SCRIPT', SHADOW_TREE_SCRIPT],
  ['SCROLL_HOST_SCRIPT', SCROLL_HOST_SCRIPT],
  ['WALK_STEP_SCRIPT', WALK_STEP_SCRIPT],
  ['STUCK_CHROME_SCRIPT', STUCK_CHROME_SCRIPT],
  ['AUDIT_SCRIPT', AUDIT_SCRIPT],
  ['LINT_SCRIPT', LINT_SCRIPT],
  ['INSPECT_SCRIPT', INSPECT_SCRIPT],
]

/** Words that are followed by `(` and are not calls. */
const KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'typeof',
  'instanceof',
  'function',
  'new',
  'delete',
  'void',
  'in',
  'of',
  'do',
  'else',
  'await',
  'yield',
  'case',
  'throw',
  // `async (a) => …` reads as a call to `async` otherwise.
  'async',
])

/**
 * What a page already has. **Grown by running this against the seven strings,
 * never guessed** — the card said so before the work, because an allowlist
 * written from imagination is a list of the names you happened to think of, and
 * the ones you forget become failures you then "fix" by adding them, which is
 * the same as having no check.
 */
const BROWSER_GLOBALS = new Set([
  'Array',
  'Boolean',
  'Element',
  'Error',
  'Infinity',
  'JSON',
  'Map',
  'Math',
  'Node',
  'Number',
  'Object',
  'Promise',
  'Set',
  'ShadowRoot',
  'String',
  'DOMRect',
  'Image',
  'URL',
  'document',
  'getComputedStyle',
  'isFinite',
  'isNaN',
  'parseFloat',
  'parseInt',
  'requestAnimationFrame',
  'setTimeout',
  'window',
])

/**
 * The script with its string literals and comments blanked out.
 *
 * **Measured need, not caution.** The first run of this test reported
 * `AUDIT_SCRIPT` calling `not`, which comes from its target selector —
 * `input:not([type="hidden"])` and `[tabindex]:not([tabindex="-1"])`. Nothing
 * calls anything there; a regex over raw source cannot tell code from the text
 * inside quotes. Adding `not` to the globals list would have made the test pass
 * and made it wrong, and the next selector with a function-shaped word in it
 * would have done the same again.
 *
 * **Known hole, measured and left open (Idris, reviewing `#349`).** A template
 * literal is blanked whole, interpolations included, so a call appearing only
 * inside `${...}` is invisible here. It is a real gap and it does not bite
 * today: a second scanner that keeps interpolated code live was run against
 * all seven shipped strings and reported exactly what this one does, which is
 * nothing. It is written down rather than fixed because the fix is a
 * nesting-aware scanner, which is a lot of parser to carry for a case no
 * script currently has. **If a page script ever grows a call inside an
 * interpolation, this test will pass while the script throws in the page** —
 * so a reader who arrives because of exactly that should start by narrowing
 * the blanking to the quote characters and leaving `${...}` as code.
 */
function codeOnly(script: string): string {
  let out = ''
  let i = 0
  while (i < script.length) {
    const c = script[i]!
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      i++
      while (i < script.length && script[i] !== quote) i += script[i] === '\\' ? 2 : 1
      i++
      out += '""'
      continue
    }
    if (c === '/' && script[i + 1] === '/') {
      while (i < script.length && script[i] !== '\n') i++
      continue
    }
    if (c === '/' && script[i + 1] === '*') {
      i += 2
      while (i < script.length && !(script[i] === '*' && script[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += c
    i++
  }
  return out
}

/** Names the string itself declares: functions, consts, lets, and parameters of the above. */
function declaredIn(script: string): Set<string> {
  const names = new Set<string>()
  for (const m of script.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]!)
  for (const m of script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]!)
  // Object-method shorthand — `mark() { … }` inside a returned object — is a
  // DEFINITION that looks exactly like a call to a regex. `installStuckChrome`
  // returns four of them (`mark`, `settle`, `hide`, `restore`), and reading
  // them as calls is what the first run of this test did. They are declarations
  // and belong here.
  for (const m of script.matchAll(/(?:^|[,{])\s*([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/gm)) names.add(m[1]!)
  // `const f = (a) => …` is covered by the const rule; arrow params are not
  // called, so they do not need collecting.
  return names
}

/** Every bare call in the string — `foo(`, but never `x.foo(`. */
function calledIn(script: string): Set<string> {
  const names = new Set<string>()
  for (const m of script.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[2]!
    if (!KEYWORDS.has(name)) names.add(name)
  }
  return names
}

describe('the scripts that ship into a page', () => {
  it.each(SCRIPTS)('%s calls nothing it does not carry', (name, raw) => {
    const script = codeOnly(raw)
    const declared = declaredIn(script)
    const missing = [...calledIn(script)].filter(n => !declared.has(n) && !BROWSER_GLOBALS.has(n)).sort()
    expect(
      missing,
      `${name} calls ${missing.join(', ')} and does not define them. Either the helper is missing from the ` +
        `concatenation — add its \`.toString()\` — or it is a browser global this list has not met yet, in which ` +
        `case add it to BROWSER_GLOBALS and say in the commit which script needed it.`,
    ).toEqual([])
  })

  it('would notice a helper dropped from the concatenation', () => {
    // The control, inside the test: remove a function's source from the string
    // and the check must fail naming it. Without this the test could be
    // vacuous — matching nothing and passing — and nobody would know.
    const withoutShadowParent = codeOnly(SCROLL_HOST_SCRIPT)
      .split('\n')
      .filter(line => !line.startsWith('function shadowParent'))
      .join('\n')
    const declared = declaredIn(withoutShadowParent)
    const missing = [...calledIn(withoutShadowParent)].filter(n => !declared.has(n) && !BROWSER_GLOBALS.has(n))
    expect(missing, 'removing shadowParent from the concatenation should be caught').toContain('shadowParent')
  })
})
