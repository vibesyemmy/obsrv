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
the Developer ID certificate → Export → `.p12`, with a password. Then add four
repository secrets:

| Secret | Value |
| --- | --- |
| `CSC_LINK` | `base64 -i cert.p12` |
| `CSC_KEY_PASSWORD` | the `.p12` password |
| `APPLE_API_KEY_P8` | `base64 -i AuthKey_XXXXXXXXXX.p8` |
| `APPLE_API_KEY_ID` | the Key ID |
| `APPLE_API_ISSUER` | the Issuer ID |

The release job reads `HAS_SIGNING`, derived from whether `CSC_LINK` and
`APPLE_API_KEY_ID` are both set. Until all of them exist it builds unsigned
exactly as before, so adding them is what switches signing on — there is no
separate flag to flip, and a fork with no secrets still gets a working DMG.

Certificates expire after five years, API keys do not expire but can be revoked.
When the certificate is replaced, `CSC_LINK` and `CSC_KEY_PASSWORD` are the only
secrets that need updating.

## 6. Afterwards

Once a notarised DMG is published, remove the quarantine workaround
(`xattr -dr com.apple.quarantine`) from the README and the release notes
template — leaving it there teaches users to bypass Gatekeeper for a build that
no longer needs it.
