import { chromium } from 'playwright'
const EXE = process.env.SMOKE_CHROMIUM
const browser = await chromium.launch({
  ...(EXE ? { executablePath: EXE } : {}),
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
})
const page = await browser.newPage({
  viewport: { width: 430, height: 900 },
  reducedMotion: 'reduce',
})
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
await page.goto(process.env.SMOKE_URL ?? 'http://localhost:4173/arpoc/', { waitUntil: 'networkidle' })
await page.click('#enter-desktop')
await page.waitForTimeout(1200)
await page.click('#dev-toggle')
await page.click('#fire')
await page.waitForTimeout(14000)
await page.screenshot({ path: process.argv[2] ?? 'smoke-out/reduced.png' })
console.log('status :', await page.textContent('#status'))
console.log('T      :', await page.textContent('#scrub-value'))
console.log('errors :', errs.length ? errs.join('\n') : '(none)')
await browser.close()
