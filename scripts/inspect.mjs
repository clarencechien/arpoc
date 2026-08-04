/**
 * 模型檢視：進待機後把鏡頭拉近、繞幾個方位角截圖。
 * 用來判斷輪廓與材質，不驗流程（那是 smoke.mjs 的事）。
 *
 *   npm run build && npm run preview &
 *   node scripts/inspect.mjs [outPrefix]
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { chromium } from 'playwright'

const OUT = process.argv[2] ?? 'smoke-out/inspect'
const BASE = process.env.SMOKE_URL ?? 'http://localhost:4173/arpoc/'
const EXE = process.env.SMOKE_CHROMIUM
mkdirSync(dirname(OUT), { recursive: true })

const browser = await chromium.launch({
  ...(EXE ? { executablePath: EXE } : {}),
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 700, height: 1000 }, deviceScaleFactor: 2 })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.click('#enter-desktop')
await page.waitForTimeout(1500)

const cx = 350
const cy = 500

async function drag(dx, dy) {
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(cx + (dx * i) / 8, cy + (dy * i) / 8)
  }
  await page.mouse.up()
  await page.waitForTimeout(500)
}

// 拉近
for (let i = 0; i < 7; i++) {
  await page.mouse.move(cx, cy)
  await page.mouse.wheel(0, -220)
  await page.waitForTimeout(120)
}
await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}-a-front.png` })

for (const [i, dx] of [140, 140, 140, 140].entries()) {
  await drag(dx, 0)
  await page.screenshot({ path: `${OUT}-${'bcde'[i]}-yaw${(i + 1) * 45}.png` })
}

await browser.close()
console.log('written', OUT)
