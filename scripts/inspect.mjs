/**
 * 視覺對照工具：固定 6 個機位、固定光照與曝光，輸出成一張 contact sheet。
 *
 *   npm run build && npm run preview &
 *   node scripts/inspect.mjs [outDir]      # 預設 smoke-out/
 *
 * 產出 <outDir>/contact.png（3×2 九宮格）與各機位的單張 view-*.png。
 * 用途：每次改完材質／幾何，直接與真實照片並排比對。
 * 「哪裡不對」用眼睛比對遠比用想的準。
 *
 * 機位透過 main.ts 暴露的 window.__orbital.view() 設定，不靠拖曳——
 * 拖曳會不小心點到火箭把它發射出去，而且每次位置都不一樣。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const OUT = process.argv[2] ?? 'smoke-out'
const BASE = process.env.SMOKE_URL ?? 'http://localhost:4173/arpoc/'
const EXE = process.env.SMOKE_CHROMIUM
mkdirSync(OUT, { recursive: true })

const TILE_W = 700
const TILE_H = 1000

/**
 * 六個機位。座標是場景座標（公尺），原點在發射台中心地面，塔在 +X。
 * 火箭：底部 y≈0.04，Booster 頂 y≈0.40，Ship 頂 y≈0.66。
 */
const VIEWS = [
  { id: 'side', label: '正側', pos: [0.02, 0.36, 1.05], target: [0.02, 0.33, 0] },
  { id: 'quarter', label: '45°', pos: [0.62, 0.42, 0.62], target: [0.03, 0.32, 0] },
  { id: 'engines', label: '引擎特寫', pos: [0.2, 0.09, 0.24], target: [0, 0.06, 0] },
  { id: 'gridfin', label: '格柵翼特寫', pos: [0.16, 0.42, 0.19], target: [0, 0.37, 0] },
  { id: 'flap', label: '襟翼特寫', pos: [0.2, 0.5, 0.15], target: [0, 0.44, 0] },
  { id: 'wide', label: '全景', pos: [0.55, 0.6, 1.6], target: [0.05, 0.3, 0] },
]

const browser = await chromium.launch({
  ...(EXE ? { executablePath: EXE } : {}),
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
})
const page = await browser.newPage({ viewport: { width: TILE_W, height: TILE_H }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.click('#enter-desktop')
await page.waitForTimeout(1500)
// DOM 那層（按鈕、狀態列）不是比對對象
await page.addStyleTag({ content: '#overlay{display:none !important}' })

const tiles = []
for (const v of VIEWS) {
  await page.evaluate(
    ([p, t]) => window.__orbital.view(p[0], p[1], p[2], t[0], t[1], t[2], false),
    [v.pos, v.target],
  )
  await page.waitForTimeout(500)
  const file = join(OUT, `view-${v.id}.png`)
  await page.screenshot({ path: file })
  tiles.push({ ...v, file })
  console.log('view', v.id.padEnd(8), v.label)
}

// 合成 contact sheet：用另一個分頁把六張圖排成 3×2 再截一次
const html = `<!doctype html><meta charset="utf-8">
<style>
  body{margin:0;background:#0a0c0e;color:#f2f3f0;font:14px/1.3 ui-monospace,monospace}
  .grid{display:grid;grid-template-columns:repeat(3,${TILE_W / 2}px);gap:10px;padding:10px}
  figure{margin:0}
  img{display:block;width:${TILE_W / 2}px;height:${TILE_H / 2}px}
  figcaption{padding:4px 2px;letter-spacing:.12em;color:#9aa3ab}
</style>
<div class="grid">
${tiles
  .map(
    (t) =>
      `<figure><img src="data:image/png;base64,${readFileSync(t.file).toString('base64')}"><figcaption>${t.label} · ${t.id}</figcaption></figure>`,
  )
  .join('')}
</div>`
const sheet = await browser.newPage({
  viewport: { width: TILE_W * 1.5 + 40, height: TILE_H + 90 },
  deviceScaleFactor: 1,
})
await sheet.setContent(html)
await sheet.waitForTimeout(200)
const contact = join(OUT, 'contact.png')
await sheet.screenshot({ path: contact, fullPage: true })
writeFileSync(join(OUT, 'contact.html'), html)

await browser.close()
console.log('contact sheet:', contact)
