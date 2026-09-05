/**
 * 軌跡對照：固定一個廣角機位，逐任務秒截圖，排成一張 strip。
 *
 *   npm run build && npm run preview &
 *   node scripts/trajectory.mjs [outDir]     # 預設 smoke-out/
 *
 * 產出 <outDir>/trajectory.png。用來看弧線形狀、機頭是否對著飛行方向、
 * Booster 翻身時序、Ship 返場路徑——這些在會追焦的鏡頭裡看不出來。
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const OUT = process.argv[2] ?? 'smoke-out'
const BASE = process.env.SMOKE_URL ?? 'http://localhost:4173/arpoc/'
const EXE = process.env.SMOKE_CHROMIUM
mkdirSync(OUT, { recursive: true })

const W = 700
const H = 1000

/** 廣角：涵蓋 apogee（y≈1.45、x≈-0.9）與整座發射場 */
const CAMERA = { pos: [0.4, 0.95, 3.7], target: [-0.35, 0.72, 0] }

/** 任務秒。前段密、返場段疏，最後補 Ship 再入。 */
const MISSIONS = [
  -3, 3, 8, 15, 30, 45, 62, 85, 110, 135, 152, 159, 163, 170, 185, 210, 240, 280, 330, 385, 400, 411,
  3300, 3700, 3860, 3940, 3977, 3985, 3996,
]

const browser = await chromium.launch({
  ...(EXE ? { executablePath: EXE } : {}),
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
})
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.click('#enter-desktop')
await page.waitForTimeout(1200)
await page.addStyleTag({ content: '#overlay{display:none !important}' })
await page.evaluate(
  ([p, t]) => window.__orbital.view(p[0], p[1], p[2], t[0], t[1], t[2], false),
  [CAMERA.pos, CAMERA.target],
)

const tiles = []
for (const m of MISSIONS) {
  await page.evaluate((t) => window.__orbital.mission(t), m)
  await page.waitForTimeout(350)
  const file = join(OUT, `traj-${String(m).padStart(5, '0')}.png`)
  await page.screenshot({ path: file })
  tiles.push({ m, file })
}

const fmt = (m) => {
  const s = Math.abs(m)
  const sign = m < 0 ? 'T-' : 'T+'
  return `${sign}${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

const COLS = 8
const tw = Math.round(W / 2.8)
const th = Math.round(H / 2.8)
const html = `<!doctype html><meta charset="utf-8">
<style>
  body{margin:0;background:#0a0c0e;color:#f2f3f0;font:12px/1.3 ui-monospace,monospace}
  .grid{display:grid;grid-template-columns:repeat(${COLS},${tw}px);gap:6px;padding:8px}
  figure{margin:0}
  img{display:block;width:${tw}px;height:${th}px}
  figcaption{padding:3px 2px;letter-spacing:.1em;color:#9aa3ab}
</style>
<div class="grid">
${tiles
  .map(
    (t) =>
      `<figure><img src="data:image/png;base64,${readFileSync(t.file).toString('base64')}"><figcaption>${fmt(t.m)}</figcaption></figure>`,
  )
  .join('')}
</div>`
const rows = Math.ceil(tiles.length / COLS)
const sheet = await browser.newPage({
  viewport: { width: COLS * (tw + 6) + 16, height: rows * (th + 30) + 16 },
  deviceScaleFactor: 1,
})
await sheet.setContent(html)
await sheet.waitForTimeout(200)
const out = join(OUT, 'trajectory.png')
await sheet.screenshot({ path: out, fullPage: true })

await browser.close()
console.log('trajectory strip:', out)
