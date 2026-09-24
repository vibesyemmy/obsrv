# Signing and notarising the macOS build

The repo is wired for this: `hardenedRuntime` is on, the Electron entitlements
are in `build/entitlements.mac.plist`, and CI signs when the secrets exist and
falls back to an unsigned build when they do not. What is left is credentials,
and every one of them has to be created by the account holder — a Developer ID
private key is what lets software ship *as you*, so it is generated in your
keychain and never leaves the machine.

Requires an Apple Developer Program membership ($99/yr). A free account cannot
issue a Developer ID certificate.

## 1. Create the certificate

Xcode → Settings → Accounts → select the Apple ID → Manage Certificates → **+**
→ **Developer ID Application**. This generates the keypair locally and installs
it in your login keychain; the developer portal is not involved.

("Developer ID Installer" is for `.pkg` files. Obsrv ships a `.dmg`, so it is
not needed.)

Confirm it landed:

```
security find-identity -v -p codesigning
```

You want a line reading `Developer ID Application: <your name> (<team id>)`. The
ten-character team id in the parentheses is the same one App Store Connect
shows.

## 2. Create an App Store Connect API key

App Store Connect → Users and Access → Integrations → Keys → **+**, with the
**Developer** role. Note the **Key ID** and the **Issuer ID**, and download the
`.p8` — Apple lets you download it exactly once.

An Apple ID with an app-specific password also works, but the key is preferred:
it survives a password change and carries no second factor to get stuck on.

Keep the `.p8` outside the repo. `~/private_keys/` is the conventional home.

## 3. Build signed, locally, before touching CI

```
export APPLE_API_KEY=~/private_keys/AuthKey_XXXXXXXXXX.p8
export APPLE_API_KEY_ID=XXXXXXXXXX
export APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
npm run dist:signed
```

Notarisation is a round trip to Apple's service — usually 2–15 minutes, and the
build blocks on it. electron-builder staples the ticket to the DMG when it
succeeds, which is what lets the app open on a machine that has never been
online.

### Two things this command will not tell you

Both were confirmed by running it on this machine before any Developer ID
existed, and both fail quietly:

- **electron-builder skips notarisation rather than failing it.** With no
  `APPLE_API_*` in the environment it logs `skipped macOS notarization —
  reason: notarize options were unable to be generated` and exits 0. You get a
  DMG that looks finished and is not notarised.
- **It signs with whatever identity it can find.** On this machine it picked up
  an unrelated local `Restack Dev` certificate and reported success. A signed
  build is not necessarily a *Developer ID* build.

Neither shows up in the exit code, so step 4 is not optional.

## 4. Verify, rather than assume

```
spctl -a -vvv -t install /Applications/Obsrv.app
```

Wanted: `accepted` with `source=Notarized Developer ID`. Also worth running:

```
codesign -dv --verbose=4 /Applications/Obsrv.app
xcrun stapler validate dist/Obsrv-<version>-arm64.dmg
```

A signature that verifies but is not stapled will still show the damaged-app
dialog on a fresh machine, so check the stapler line specifically.

## 5. Only then, CI

Export the identity from Keychain Access — right-click the **private key** under
the Developer ID certificate → Export → `.p12`, with a password. Then add these
repository secrets:

| Secret | Value |
| --- | --- |
| `CSC_LINK` | `base64 -i cert.p12` |
| `CSC_KEY_PASSWORD` | the `.p12` password |
| `APPLE_API_KEY_P8` | `base64 -i AuthKey_XXXXXXXXXX.p8` |
| `APPLE_API_KEY_ID` | the Key ID |
| `APPLE_API_ISSUER` | the Issuer ID |
| `SIGNING_IDENTITY` | the exact `codesign` authority line, e.g. `Developer ID Application: <entity> (<team id>)` |

The release job reads `HAS_SIGNING`, derived from whether `CSC_LINK` and
`APPLE_API_KEY_ID` are both set. Until all of them exist it builds unsigned
exactly as before, so adding them is what switches signing on — there is no
separate flag to flip, and a fork with no secrets still gets a working DMG.

**`SIGNING_IDENTITY` is what turns step 4's manual verification into a release
gate.** Once `HAS_SIGNING` is true, CI runs `codesign`/`spctl` against every
`.app` this build produced and `xcrun stapler validate` against every `.dmg`,
and fails the release if the signed identity does not equal `SIGNING_IDENTITY`
exactly, or if Gatekeeper does not report a notarized Developer ID build. It
checks equality, not merely "is signed" — an ad-hoc or wrong-account signature
passes `spctl` too, which is exactly how this project found out it had signed
with the wrong identity in the first place (§3, above). Which entity that
string names — this account or a company account — is a decision to make once,
by setting the secret; the workflow does not choose it and does not default to
one. `HAS_SIGNING` true with `SIGNING_IDENTITY` unset fails the release rather
than skipping the check, so a signed release can't ship without that decision
having been made.

**A local `npm run dist:signed` asserts the same thing.** It runs
`scripts/verifySigningIdentity.js` after electron-builder and fails the build
unless every `.app` it produced names `SIGNING_IDENTITY`, Gatekeeper reports a
notarized Developer ID build, and every `.dmg` is stapled — the same four rules
the release job applies, and a build that produced nothing fails rather than
passing with zero bundles checked.

**Set `SIGNING_IDENTITY` in your shell to use it**, the same exact authority line
the secret carries. Without it the script refuses rather than skipping, because §3
is the case where "it signed" was true and wrong: on a machine holding both a
Developer ID identity and a local one, `CSC_IDENTITY_AUTO_DISCOVERY` has two
candidates and no way to know which was meant.

**The rules are written once, and the release runs the same copy you do.** They
were briefly written twice — here as a script, and as inline `codesign`/`spctl`/
`stapler` steps in `ci.yml` — and the drift that was called a risk arrived
immediately. Chaining the script into `dist:signed` made `ci.yml`'s `Build DMGs`
step run it, but that step's `env:` block did not carry `SIGNING_IDENTITY`, and
the script refuses when it is unset. The first signed release would have built,
notarised, and then failed at the last command of the build, with the workflow's
own copy of the check sitting in the step after the one that failed.

So the shell copy is gone and the tested one stayed. **It was never redundancy.**
Redundancy is two different mechanisms checking the same fact from different
angles; this was two hand-copies of the same shell rules with nothing asserting
that the copies agreed, which is why one of them could be wrong while the other
looked like cover. The single surviving implementation is also the more verified
one — eleven sabotage-tested unit cases against zero automated coverage on the
inline bash — so removing the text removed maintenance surface rather than rigour.
Do not restore the second copy in the name of belt-and-braces.

What guards it now:

- `ci.yml` sets `SIGNING_IDENTITY` on the **release job**, not on a step. The
  defect was a step that needed the variable and did not have it, and per-step
  scoping leaves that available to every step added later. Job level makes the
  omission impossible rather than detectable — and costs nothing, because the
  value is the `codesign` authority line, which every published DMG prints to
  anyone who runs `codesign -dv` on it. `CSC_LINK`, `CSC_KEY_PASSWORD` and the
  App Store Connect key are confidential and stay scoped to the one step that
  needs them.
- A step **before** the build fails with an `::error::` when `HAS_SIGNING` is
  true and `SIGNING_IDENTITY` is empty. The script would refuse anyway, but it
  refuses after a ~20-minute notarised build; this costs seconds.
- `tests/unit/distSignedChainsVerifier.test.ts` asserts that `dist:signed` still
  chains the script, that the script exists, and that it runs **after**
  electron-builder — verifying first would assert against whatever the previous
  build left in `dist/`. With no second copy in the workflow, one deleted line in
  `package.json` would otherwise remove every identity assertion from the release
  and leave a green log.

Certificates expire after five years, API keys do not expire but can be revoked.
When the certificate is replaced, `CSC_LINK` and `CSC_KEY_PASSWORD` are the only
secrets that need updating.

## 6. Afterwards

Once a notarised DMG is published, remove the quarantine workaround
(`xattr -dr com.apple.quarantine`) from the README and the release notes
template — leaving it there teaches users to bypass Gatekeeper for a build that
no longer needs it.
