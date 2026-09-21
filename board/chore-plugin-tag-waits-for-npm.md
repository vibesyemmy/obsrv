---
title: "The plugin tag can be pushed before npm has that version — documented twice, skipped twice, in one release"
column: done
owner: "Dogu"
kind: chore
order: 100
---

FILED AND BUILT 2026-09-20 by Dogu, from Henry's #1398 proposal, on Kenya's and Idris's #397 review
of the signing-identity CI check the same evening.

**Both halves of this release's ordering were already written down, in the same `README.md` section,
and both were skipped anyway:**

- *"Publish via a packed tarball, never bare `npm publish`… this shipped a broken 0.4.0."*
  0.62.0's first `npm publish` hit `ENOENT` — `npm run release:pack` had never been run for this
  bump. Kenya caught and fixed it before Opeyemi's OTP step.
- *"push `plugin-v<version>` only once npm has that version: the marketplace catalog points at the
  plugin tag, and a plugin fetched before the publish starts an MCP that npm cannot install."*
  Not hit this release, but the same shape — a rule with the exact failure named, sitting in prose,
  with nothing to stop it happening.

**Henry's own read, and the reason this is a card rather than a reminder:** *"prose did not hold
here, twice, in one section, in one release."* Writing the rule down again accomplishes nothing;
it is already written down.

## What this builds

One new step in the existing `plugin-tag` job (`ci.yml`, tags-only), not a new job and not
`tested-on-main` — the plugin tag is the specific artifact the README says not to push early, so
the check belongs where that artifact is validated:

```yaml
- name: npm already serves this version
  run: |
    version=$(node -p "require('./package.json').version")
    published=$(npm view getobsrv version 2>/dev/null || true)
    if [ "$published" != "$version" ]; then
      echo "::error::npm serves '${published:-nothing}', this tag is v$version. README.md: push plugin-v<version> only once npm has that version — a plugin fetched before the publish starts an MCP that npm cannot install. Run npm publish first, then push the plugin tag."
      exit 1
    fi
    echo "npm serves $version, matching this tag"
```

Same version source `build-plugin-branch.js --check` (the step right before it) already trusts —
`package.json`'s own `version` field — so there is one source of truth for what "this version"
means across both checks in the job, not two ways to derive it that could disagree.

**The failure message names the actual consequence, per Henry's ask, not a generic mismatch:**
*"a plugin fetched before the publish starts an MCP that npm cannot install"* — whoever trips this
needs to know the marketplace catalog is what breaks, not just that two numbers disagreed.

## Verified, without triggering a real tag push

- YAML parses clean (`npx js-yaml .github/workflows/ci.yml`).
- The shell logic itself, extracted and run directly against the real registry: **match** (current
  `package.json` 0.62.0 against the real published 0.62.0) reports match, exit 0. **Mismatch**
  (simulated `version=0.63.0` against the real 0.62.0 registry) reports the exact error text above,
  exit 1. **Unreachable/never-published** (`published=""`) reports `'nothing'` rather than crashing
  on an empty-string comparison, exit 1.
- Not verified: an actual tag push through this job — that only happens on a real release cut, and
  this one is timed months from now at the earliest. The next real cut is the test.

## A collision, named rather than smoothed over

Kenya claimed this card about a minute before this one was posted — genuine timing race, not a
disagreement, caught by Wren. Henry broke the tie towards this build (posted plan before touching
the file; the reliability lane is Dogu's; Kenya was mid-fix on `#396`). A brief cross-post handed
Kenya the already-drafted step in case it helped, then a correction when Henry's ruling turned out
to have landed a message earlier — both sides stood down cleanly once the collision was named.

## Closed 2026-09-21 — the condition this card called "months from now" arrived in six hours

The card's own "Not verified" line said the live-tag-push arm would have to wait for the next real
release cut, timed months out. That cut was the same night's `0.62.1` patch (built for
`bug-uninstall-confirm-unenforced`, an unrelated data-loss fix). On the `v0.62.1` tag run
(`35572139926`), the `plugin-tag` job's *"npm already serves this version"* step (`ci.yml:366`) ran
for real and passed — first live exercise of this check outside the extracted-shell tests above.

**Stating both halves, per Henry's #1548 ask, because answering one half only would be worse than
leaving the card open:**

- **The live pass.** `35572139926` had npm genuinely serving `0.62.1` when the `v0.62.1` tag went up
  — the ordering was correct, so this run shows the check runs on a real tag and does not
  false-positive against a correctly-ordered release. That is new evidence; the extracted-shell test
  above never exercised the job itself, only its logic in isolation.
- **The refusal is still not live-demonstrated.** A passing check on a correctly-ordered release does
  not show it refuses a wrong-ordered one — that arm remains the out-of-band verification in
  "Verified, without triggering a real tag push" above (simulated `version=0.63.0` against the real
  registry, exit 1, exact error text). Nothing in `35572139926` or any run since has forced the
  mismatch path live.

Henry, Idris and Kenya independently confirmed the same run and step-level result (`#1548`, `#1551`,
`#1552`) before this was written up.

**Correction, 2026-09-21 — "the only way is to publish a bad version" overclaimed, per Idris's #1573
live test.** This card originally said the refusal arm's only path to live evidence was actually
publishing a version behind its tag. Idris tested rather than took that on reasoning: `ci.yml:366`'s
step has no `--registry` pin, so `npm view getobsrv version` resolves through ambient npm config.
**The read is tested. The refusal is inferred. Splitting them, because this is a correction of an
overclaim and blurring the line here would be the wrong place to blur it** (Henry's read of the first
wording; details from Idris, who ran it):

- **Tested.** A real local HTTP server (`python3`, port 4874) served a fake `getobsrv` packument at
  `9.9.9`. `npm view getobsrv version --registry http://127.0.0.1:4874 --loglevel verbose` returned
  `9.9.9`, with a logged `npm http fetch GET 200 … (cache miss)` — **a real network round-trip, not a
  simulation.** So the step's read genuinely is not pinned to the public registry.
- **Inferred, not run.** Nobody executed `ci.yml:366`'s own shell — `published=$(npm view …)`, the
  `if [ "$published" != "$version" ]`, the `::error`, the `exit 1` — against that server. The refusal
  is read off a trivial comparison, exactly as the out-of-band arm above already does.

So the honest statement is **"untested, and reachable via a registry substitution nobody has built the
harness for"** — not "unreachable by construction", and not "we pointed a fake registry at it and
watched it refuse". The harness is real work nobody has asked for yet.
