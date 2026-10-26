/**
 * Runs `cmd` and returns its stdout+stderr combined as one string.
 *
 * `codesign -dv` and `spctl -a -vvv` both print their result to stderr, not
 * stdout. `execFileSync`'s return value is stdout only, so a straight call to
 * it silently drops the payload every caller actually wants: a correctly
 * signed build reads back as `''`, which looks identical to "not signed at
 * all". `spawnSync` is used instead because it hands back stdout and stderr
 * separately rather than only resolving one of them.
 */
const { spawnSync } = require('node:child_process')

function runCaptured(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf8' })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited ${result.status}: ${output.trim()}`)
  }
  return output
}

module.exports = { runCaptured }
