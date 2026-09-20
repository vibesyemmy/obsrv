---
title: "The plugin tag can be pushed before npm has that version — documented twice, skipped twice, in one release"
column: doing
owner: "Dogu"
waiting: ""
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
