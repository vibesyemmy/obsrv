import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DECLINED_NOTE } from '../../src/mcp/lib'

/**
 * `DECLINED_NOTE` sends a user to two things on screen. This checks it is
 * still sending them to what is actually there.
 *
 * **The gap this fills, and it is Idris's, found reviewing `#360`.** That PR
 * replaced a tautology — three tests asserting `notes: [..., DECLINED_NOTE]`,
 * the constant against itself, which no rewording could fail — with a literal
 * pin of the sentence. A strict improvement, and still only half the job: a
 * hardcoded literal catches someone editing the constant's own text, and
 * **cannot** catch someone renaming the Settings section and leaving the
 * constant behind. That second one is the failure the sentence actually has,
 * because the two live in different layers and nothing links them.
 *
 * **Why a test and not a shared constant.** Linking them in the product means
 * `src/mcp` importing renderer strings or the reverse, which buys a real
 * coupling to prevent a typo. A test may reach across layers that the code
 * should not: it reads both sources and asserts they agree, and the layers stay
 * apart. If the label is ever wanted in both places for its own sake, that is a
 * different decision from this one.
 */

const read = (rel: string): string => readFileSync(join(__dirname, '../../src', rel), 'utf8')

/**
 * The Settings section's label, from the list the panel actually renders.
 * `SETTINGS_SECTIONS` is exported, but importing it here would pull the whole
 * renderer module — React and all — into a node-environment unit test, so this
 * reads the source instead. Every extraction below asserts it matched, because
 * a regex that silently stops matching turns this file into a vacuous pass.
 */
function settingsAgentLabel(): string {
  const src = read('renderer/src/components/SettingsPanel.tsx')
  const m = /\{\s*id:\s*'agent',\s*label:\s*'([^']+)'\s*\}/.exec(src)
  expect(m, 'could not find the agent entry in SETTINGS_SECTIONS — this test cannot check anything until the pattern is fixed').toBeTruthy()
  return m![1]!
}

/**
 * The chip's own text, from the button that stops agent control.
 *
 * **Anchored on the class, not on the aria-label (Idris, reviewing this file).**
 * The first version keyed off `aria-label="Stop agent control"`, which is
 * *prose*: an accessibility description reworded in copy passes for reasons
 * this test does not care about. "Disable agent control" would change neither
 * the chip's text nor the sentence's truth, and would break this test's ability
 * to find the button at all — a false alarm costing someone a debugging session
 * over a change that was never wrong.
 *
 * `agent-activity` is a structural identifier: it already ties the chip's
 * activity-highlight styling to this exact button, so renaming it is a
 * deliberate, visible refactor rather than a drive-by copy edit. It occurs
 * **once** in `Toolbar.tsx` — checked, and asserted below, because "unique
 * today" is the sort of fact that stops being true quietly. `stopAgentControl`
 * was the other candidate and occurs twice (the import and the use), so it
 * would need a narrower pattern to say the same thing.
 */
function agentChipText(): string {
  const src = read('renderer/src/components/Toolbar.tsx')
  const anchors = src.match(/agent-activity/g) ?? []
  expect(
    anchors.length,
    `agent-activity occurs ${anchors.length} times in Toolbar.tsx, not once — this test anchors on it being ` +
      'the one button, so pick a narrower pattern before trusting what it says.',
  ).toBe(1)
  const m = /agent-activity[\s\S]{0,300}?>\s*([A-Za-z ]+?)\s*<\/button>/.exec(src)
  expect(m, 'could not find the agent chip button in Toolbar.tsx — fix the pattern before trusting this test').toBeTruthy()
  return m![1]!
}

describe('the note that tells a user where the switch is', () => {
  it('names the Settings section by the label the panel renders', () => {
    const label = settingsAgentLabel()
    expect(label, 'the extraction matched but found nothing').not.toBe('')
    expect(
      DECLINED_NOTE,
      `DECLINED_NOTE points at a Settings section called something other than "${label}", which is what the ` +
        `panel renders. Rename it in src/mcp/lib.ts too, or the note sends people to a menu item that is not there.`,
    ).toContain(`Settings → ${label}`)
  })

  it('names the chip by the text on the chip', () => {
    const chip = agentChipText()
    expect(chip, 'the extraction matched but found nothing').not.toBe('')
    expect(
      DECLINED_NOTE,
      `DECLINED_NOTE names a chip called something other than "${chip}", which is the text on the button.`,
    ).toContain(`the ${chip} chip`)
  })

  it('would notice a rename on the UI side, which is the whole point', () => {
    // The control, inside the test. `#360`'s literal pin cannot fail this way —
    // it compares the constant to a string written beside it, so both halves
    // move together. This one reads the other layer, so a rename there reds it
    // while `src/mcp` is untouched.
    const renamed = settingsAgentLabel().replace('Agent', 'Agent mode')
    expect(DECLINED_NOTE).not.toContain(`Settings → ${renamed}`)
  })
})
