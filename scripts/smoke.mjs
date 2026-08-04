/**
 * 桌面模式的煙霧測試：跑完整條時間軸並逐段截圖。
 *
 *   npm run build && npm run preview &
 *   npm run smoke
 *
 * AR 路徑無法在無頭瀏覽器裡測——那必須在實機上跑（見 README 驗收清單）。
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { chromium } from 'playwright'

const OUT = process.argv[2] ?? 'smoke-out/shot'
const BASE = process.env.SMOKE_URL ?? 'http://localhost:4173/arpoc/'
const EXE = process.env.SMOKE_CHROMIUM // 未設定就用 playwright 自帶的 chromium
mkdirSync(dirname(OUT), { recursive: true })

const browser = await chromium.launch({
  ...(EXE ? { executablePath: EXE } : {}),
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 })

const errors = []
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`)
})
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}-01-start.png` })

await page.click('#enter-desktop')
await page.waitForTimeout(2500)
await page.screenshot({ path: `${OUT}-02-standby.png` })

// 打開測試面板，手動發射
await page.click('#dev-toggle')
await page.waitForTimeout(300)
await page.click('#fire')

// 直接拖到尾段，驗證 SECO 與整點定格
async function scrubTo(frac, name) {
  await page.$eval('#scrub', (el, v) => {
    el.value = String(v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, Math.round(frac * 1000))
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${OUT}-${name}.png` })
  console.log(name.padEnd(14), '|', String(await page.textContent('#status')).slice(0, 42).padEnd(42), '|', await page.textContent('#scrub-value'))
}

const stamps = [
  [2000, '03-countdown'],
  [9000, '04-liftoff'],
  [6000, '05-climb'],
  [12000, '06-hotstage'],
  [8000, '07-late'],
  [10000, '08-hold'],
]
for (const [wait, name] of stamps) {
  await page.waitForTimeout(wait)
  await page.screenshot({ path: `${OUT}-${name}.png` })
  const st = await page.textContent('#status')
  const sv = await page.textContent('#scrub-value')
  console.log(name.padEnd(14), '|', String(st).slice(0, 42).padEnd(42), '|', sv)
}

await scrubTo(0.66, '09-boostback')
await scrubTo(0.90, '10-transonic')
await scrubTo(0.955, '11-catch')
await scrubTo(1.0, '12-seco')

console.log('\n--- console ---')
console.log(errors.length ? errors.join('\n') : '(clean)')
await browser.close()

if (errors.some((e) => e.includes('pageerror'))) process.exit(1)
