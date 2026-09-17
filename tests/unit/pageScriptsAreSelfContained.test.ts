import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A page-side function is shipped as SOURCE and evaluated in a page. So every
 * name it calls has to be defined beside it in the script it ships in — and
 * that is a property of the BUILT bundle, not of the TypeScript.
 *
 * **The failure this exists for, measured:** `#293` made the stuck-chrome probe
 * call the shared `shadowContains`. In the source that is an import; in
 * `out/main/cli.js` the bundler wrote `emptyDocument.shadowContains(el, anchor)`
 * — a namespace no page has. The probe threw, every stuck bar went unfound, and
 * four `cli-snap-tiled` tests caught it **on CI** (run `35226322138`). The
 * browser tests could not: they call the function, not the string it ships as.
 * `walkStep` carries a comment about the same trap from the other direction
 * (`capture.rootScrolls()`, when the function moved to a module of its own).
 *
 * This is the cheap half of that catch: a dotted call to any page-side helper,
 * anywhere in the built output, is that mistake. It reads the build, so it
 * needs one — as `publicShape.test.ts` does, and for the same reason.
 */

const ROOT = join(__dirname, '..', '..')

/** Everything a serialised page function calls by bare name. */
const PAGE_HELPERS = [
  // shared/scrollHost
  'rootScrolls',
  'overflowHidden',
  'inDialog',
  'framesInViewport',
  'canScroll',
  'findScroller',
  'clipTest',
  'scrollOffset',
  'shadowParent',
  'shadowContains',
  'shadowElements',
  'shadowElementFromPoint',
  'shadowStackFrom',
  'walkStep',
]

/**
 * NOT in the list, deliberately. `isVisible` is Electron's own
 * (`win.isVisible()`), and `auditPage`, `lintPage`, `inspectTarget` and
 * `installStuckChrome` each ship as source and are also METHODS on
 * `TargetSource` — `t.lintPage(...)` is main asking the target to run it, not a
 * page script reaching through a namespace. Including them made this fire 13
 * times on legitimate calls, which is the shape of check that gets deleted
 * rather than read. Every helper above has no method or API of the same name,
 * which is what makes a dotted call to one unambiguous.
 */

/** The bundles that carry a `*_SCRIPT` string into a page. */
const BUNDLES = ['out/main/cli.js', 'out/main/index.js', 'out/preload/sync.js']

describe('the scripts that ship into a page', () => {
  it('call their helpers by bare name in the BUILT bundle, never through a namespace', () => {
    const missing = BUNDLES.filter(b => !existsSync(join(ROOT, b)))
    expect(missing, `${missing.join(', ')} missing — run \`npm run build\` first; this reads the build, not the sources`).toEqual([])

    const dotted = new RegExp(`\\.(${PAGE_HELPERS.join('|')})\\(`, 'g')
    const found: string[] = []
    for (const bundle of BUNDLES) {
      const text = readFileSync(join(ROOT, bundle), 'utf8')
      for (const hit of text.match(dotted) ?? []) found.push(`${bundle}: ${hit}`)
    }
    // A page has no `emptyDocument`, no `capture`, no chunk object of any name.
    // If this fires, the fix is to write the helper beside the function that
    // ships — not to add the namespace to the page.
    expect(found, found.join('\n')).toEqual([])
  })
})
