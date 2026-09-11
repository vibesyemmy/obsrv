#!/usr/bin/env node
// npm run lane — point the dev lane at this checkout, build it, and run its
// app, so the obsrv-dev tools test this checkout's code: no publish, no
// install, no plugin update, no session restart (README, "Developing: the
// dev lane").
//
//   npm run lane                  point, build, and (re)launch the dev app
//   npm run lane -- --no-build    point and relaunch, without building
//   npm run lane -- --no-app      point and build; a running dev app is relaunched by the next live call
//   npm run lane -- --status      where the lane points, and how fresh its builds and its app are
'use strict'

const { spawn, spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join, resolve } = require('node:path')
const lane = require('./devLane.js')

const root = resolve(__dirname, '..')
const flags = new Set(process.argv.slice(2))
const say = line => process.stdout.write(`${line}\n`)
const clock = ms => (ms > 0 ? new Date(ms).toLocaleTimeString() : 'never')
const sleep = ms => new Promise(r => setTimeout(r, ms))
function fail(line) {
  process.stderr.write(`lane: ${line}\n`)
  process.exit(1)
}

function status() {
  const target = lane.laneTarget()
  const co = lane.laneCheckout()
  say(`lane: ${target === null ? 'not pointed at anything yet (npm run lane in a checkout points it)' : co === null ? `${target} — gone` : co}`)
  if (co !== null) say(`  ${lane.laneLabel(co)} · server built ${clock(lane.serverStamp(co))} · app built ${clock(lane.appStamp(co))}`)
  const app = lane.runningApp()
  say(
    `dev app: ${
      app === null
        ? 'not running (the first live obsrv-dev call launches it)'
        : `pid ${app.pid}, up since ${clock(Date.parse(app.startedAt))}` +
          (co !== null && lane.isStale(app.startedAt, co) ? ' — older than the build; the next live call relaunches it' : '')
    }`,
  )
  const proxy = join(lane.binDir(), 'dev-mcp.js')
  say(`proxy: ${existsSync(proxy) ? proxy : 'not installed yet (npm run lane installs it)'}`)
}

async function relaunch() {
  const running = lane.runningApp()
  if (running !== null) {
    say(`stopping the dev app (pid ${running.pid})`)
    await lane.stopApp(running.pid)
  }
  const { resolveElectron } = require(join(root, 'bin', 'electronPath.js'))
  const electron = resolveElectron()
  if (electron.error) fail(`this checkout cannot run its app: ${electron.error}`)
  const spec = lane.appLaunch(root)
  if (!existsSync(spec.entry)) fail(`no app build at ${spec.entry} — run without --no-build`)
  const env = { ...process.env, ...spec.env }
  delete env.ELECTRON_RUN_AS_NODE
  spawn(electron.path, [spec.entry, ...spec.args], { detached: true, stdio: 'ignore', env }).unref()
  for (let i = 0; i < 80; i++) {
    const app = lane.runningApp()
    if (app !== null && (running === null || app.pid !== running.pid)) {
      say(`dev app up (pid ${app.pid}) on ${lane.profileDir()}, agent control on`)
      return
    }
    await sleep(250)
  }
  say('the dev app was launched but has not answered yet; the first live obsrv-dev call will find it')
}

async function main() {
  if (flags.has('--status')) return status()
  if (!existsSync(join(root, 'bin', 'obsrv-mcp.js'))) fail(`${root} is not an Obsrv checkout`)
  const firstTime = !existsSync(join(lane.binDir(), 'dev-mcp.js'))
  lane.pointLaneAt(root)
  const proxy = lane.installProxy()
  say(`lane → ${root} (${lane.laneLabel(root)})`)
  if (!flags.has('--no-build')) {
    const built = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' })
    if (built.status !== 0) fail('the build failed; the lane points here, and runs the next build that succeeds')
  }
  if (!flags.has('--no-app')) await relaunch()
  say('obsrv-dev follows the lane: its next tool call runs this build, headless and live, on the same session.')
  if (firstTime) {
    say('')
    say('One-time setup: register obsrv-dev to the lane, then restart the session once:')
    say('  claude mcp remove obsrv-dev -s local')
    say(`  claude mcp add --scope local --transport stdio obsrv-dev -- node ${proxy}`)
  }
}

main().catch(e => fail(e && e.message ? e.message : String(e)))
