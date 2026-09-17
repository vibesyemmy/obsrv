// RC PROBE: the first launch of the candidate DMG's app: every window, the main one read.
import { _electron as electron } from 'playwright'
const exe = process.argv[2]
const t0 = Date.now()
const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`
const app = await electron.launch({ executablePath: exe, args: [], timeout: 120_000 })
await new Promise(r => setTimeout(r, 12000))
let main = null
for (const w of app.windows()) if (w.url().includes('renderer/index.html') && !w.url().includes('overlay')) main = w
if (main) {
  await main.screenshot({ path: 'rc-app-first-window.png' }).catch(e => console.log(`screenshot failed: ${e.message.split('\n')[0]}`))
  console.log(`${stamp()} main window visible text:\n${await main.evaluate(() => document.body.innerText)}`)
} else console.log('no main renderer window')
console.log(`${stamp()} version: ${await app.evaluate(({ app: a }) => `${a.getName()} ${a.getVersion()} userData=${a.getPath('userData')}`)}`)
await app.close()
