import './style.css'
import { App, SCRUB_STEPS, detectCapabilities, type Capabilities, type UiRefs } from './app'

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`缺少 #${id}`)
  return el as T
}

const ui: UiRefs = {
  overlay: $('overlay'),
  start: $('start'),
  hud: $('hud'),
  status: $('status'),
  scrub: $<HTMLInputElement>('scrub'),
  scrubValue: $('scrub-value'),
  fastClock: $<HTMLInputElement>('fast-clock'),
}

const app = new App($<HTMLCanvasElement>('gl'), ui)

// ── 能力偵測與說明文字 ────────────────────────────────
// 降級模式不是次等公民：iOS Safari 目前沒有 WebXR AR，
// 不做降級等於一半使用者看到白畫面（handoff §3）。

function describe(caps: Capabilities): { text: string; state: string } {
  if (caps.insecureContext) {
    return {
      text: '目前不是 secure context（HTTPS）。\nWebXR 在此不會啟動，只能使用桌面模式。',
      state: 'warn',
    }
  }
  if (caps.arSupported) {
    return {
      text: '偵測到 immersive-ar 支援。\n進入後緩慢移動手機掃描地板，看到光圈就點擊放置。',
      state: 'ok',
    }
  }
  if (caps.isIOS) {
    return {
      text: 'iOS Safari 目前沒有 WebXR AR。\n已自動改用桌面模式：同一套場景與時間軸，用手指拖曳環繞觀看。',
      state: 'warn',
    }
  }
  if (!caps.hasWebXR) {
    return {
      text: '此瀏覽器沒有 WebXR Device API。\n已自動改用桌面模式，功能相同，只是沒有 AR 相機。',
      state: 'warn',
    }
  }
  return {
    text: '此裝置回報不支援 immersive-ar。\n已自動改用桌面模式。',
    state: 'warn',
  }
}

void detectCapabilities().then((caps) => {
  const { text, state } = describe(caps)
  const el = $('caps')
  el.textContent = text
  el.dataset.state = state

  const arBtn = $<HTMLButtonElement>('enter-ar')
  arBtn.disabled = !caps.arSupported
  if (!caps.arSupported) {
    arBtn.textContent = 'AR 不可用'
    $<HTMLButtonElement>('enter-desktop').classList.add('primary')
  }
})

// ── 啟動 ──────────────────────────────────────────────
// 這兩個 handler 內部第一件事就是 audio.unlock()，
// 必須留在使用者手勢的同步呼叫堆疊裡（handoff §7）。

$('enter-ar').addEventListener('click', () => {
  app.setSoundEnabled($<HTMLInputElement>('sound-toggle').checked)
  void app.enter('ar')
})

$('enter-desktop').addEventListener('click', () => {
  app.setSoundEnabled($<HTMLInputElement>('sound-toggle').checked)
  void app.enter('desktop')
})

// ── 進行中的控制項 ───────────────────────────────────

$('exit').addEventListener('click', () => app.exit())

const muteBtn = $('mute')
muteBtn.addEventListener('click', () => {
  const on = app.toggleMute()
  muteBtn.dataset.off = String(!on)
  muteBtn.textContent = on ? '♪' : '✕♪'
})

$('fire').addEventListener('click', () => {
  app.launch()
  app.resume()
})
$('abort').addEventListener('click', () => app.abort())

ui.fastClock.addEventListener('change', () => app.startScheduler(ui.fastClock.checked))

ui.scrub.addEventListener('input', () => {
  app.scrubTo(Number(ui.scrub.value) / SCRUB_STEPS)
})

const dev = $('dev')
const devToggle = $('dev-toggle')
dev.classList.add('hidden')
devToggle.addEventListener('click', () => {
  dev.classList.toggle('hidden')
})
