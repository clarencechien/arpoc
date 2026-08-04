/**
 * 遙測面板。
 *
 * 決策（handoff §6）：這是 3D 空間裡的 billboard，錨定在火箭底部旁邊，
 * 不是貼在螢幕上的 DOM。使用者繞著火箭走時面板跟著載具留在原地——
 * 螢幕鎖定的 HUD 等於白做了 AR。
 *
 * 文字自帶對比：整塊有半透明深色 scrim，關鍵數字再加 1px 深色描邊，
 * 因為 AR 的背景可能是白牆也可能是雜亂辦公室。
 */

import * as THREE from 'three'
import { COLOR, FONT_LABEL, FONT_TELEMETRY } from '../theme'
import { BOOSTER_ENGINE_RINGS, SHIP_ENGINE_RINGS } from '../scene/rocket'
import type { EngineState } from '../sim/flight'

const W = 512
const H = 680
/** 面板實際寬度（公尺）。火箭 0.6 m，面板約它的 0.4 倍寬。 */
const PANEL_WIDTH = 0.25
const PANEL_HEIGHT = (PANEL_WIDTH * H) / W

export interface PanelState {
  /** 任務代號，例如 FLIGHT 15 */
  mission: string
  /** 待機時為 null */
  missionTime: string | null
  eventLabel: string
  altitudeKm: number
  speedKmh: number
  engines: EngineState
  /** 播放倍率，1 表示實時 */
  rate: number
  /** 待機模式的兩行字 */
  standbyClock: string | null
  standbyCountdown: string | null
  /** SECO 後定格顯示的整點，例如 15:00 */
  holdTime: string | null
}

/**
 * 等寬數字。canvas 2D 沒有 font-variant-numeric，
 * 直接把每個字元畫進固定寬度的格子裡，倒數才不會左右抖。
 */
function drawTabular(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: 'left' | 'right' | 'center',
  outline = false,
): number {
  const cell = ctx.measureText('0').width
  const widths = [...text].map((ch) => (/[0-9]/.test(ch) ? cell : ctx.measureText(ch).width))
  const total = widths.reduce((a, b) => a + b, 0)
  let cursor = align === 'left' ? x : align === 'right' ? x - total : x - total / 2
  const prevAlign = ctx.textAlign
  ctx.textAlign = 'center'
  ;[...text].forEach((ch, i) => {
    const cx = cursor + widths[i] / 2
    if (outline) {
      ctx.save()
      ctx.strokeStyle = 'rgba(10,12,14,0.9)'
      ctx.lineWidth = 3
      ctx.lineJoin = 'round'
      ctx.strokeText(ch, cx, y)
      ctx.restore()
    }
    ctx.fillText(ch, cx, y)
    cursor += widths[i]
  })
  ctx.textAlign = prevAlign
  return total
}

function drawTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
  outline = false,
): void {
  let cursor = x
  const prevAlign = ctx.textAlign
  ctx.textAlign = 'left'
  for (const ch of text) {
    if (outline) {
      ctx.save()
      ctx.strokeStyle = 'rgba(10,12,14,0.9)'
      ctx.lineWidth = 3
      ctx.lineJoin = 'round'
      ctx.strokeText(ch, cursor, y)
      ctx.restore()
    }
    ctx.fillText(ch, cursor, y)
    cursor += ctx.measureText(ch).width + tracking
  }
  ctx.textAlign = prevAlign
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

interface Dot {
  x: number
  y: number
  r: number
  /** 點亮順序：內環先亮 */
  order: number
  /** 是否屬於中央 3 具（MECO 後保留） */
  center: boolean
}

/** 依實際幾何排列引擎點位，回傳的座標是以 (0,0) 為圓心的單位圓內。 */
function engineDots(layout: EngineState['layout']): Dot[] {
  const rings = layout === 'ship6' ? SHIP_ENGINE_RINGS : BOOSTER_ENGINE_RINGS
  const dots: Dot[] = []
  let order = 0
  rings.forEach((ring, ri) => {
    for (let i = 0; i < ring.count; i++) {
      const a = (i / ring.count) * Math.PI * 2 - Math.PI / 2
      dots.push({
        x: Math.cos(a) * ring.radius,
        y: Math.sin(a) * ring.radius,
        r: layout === 'ship6' ? (ri === 1 ? 0.115 : 0.085) : ri === 0 ? 0.075 : ri === 1 ? 0.062 : 0.05,
        order: order++,
        center: ri === 0,
      })
    }
  })
  return dots
}

function drawEngineRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  engines: EngineState,
): void {
  const dots = engineDots(engines.layout)
  const total = dots.length
  const lit = Math.floor(engines.ignitionProgress * total + 0.0001)

  // 幾何參考環
  ctx.strokeStyle = 'rgba(90,97,105,0.35)'
  ctx.lineWidth = 1
  for (const rr of [0.47, 0.82]) {
    ctx.beginPath()
    ctx.arc(cx, cy, radius * rr, 0, Math.PI * 2)
    ctx.stroke()
  }

  for (const d of dots) {
    const x = cx + d.x * radius
    const y = cy + d.y * radius
    const r = d.r * radius

    let on = false
    if (engines.burning) {
      on = engines.centerOnly ? d.center : d.order < lit
    }

    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    if (on) {
      ctx.fillStyle = COLOR.plume
      ctx.fill()
      // 作動中的引擎給一圈細環，密集時仍分得出來
      ctx.strokeStyle = 'rgba(255,122,24,0.45)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(x, y, r * 1.55, 0, Math.PI * 2)
      ctx.stroke()
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0)'
      ctx.strokeStyle = engines.burning || engines.ignitionProgress > 0 ? COLOR.dim : COLOR.cryo
      ctx.globalAlpha = engines.burning || engines.ignitionProgress > 0 ? 1 : 0.55
      ctx.lineWidth = 1.6
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }

  const litCount = engines.burning ? (engines.centerOnly ? 3 : Math.min(lit, total)) : 0
  ctx.font = `600 20px ${FONT_LABEL}`
  ctx.fillStyle = litCount > 0 ? COLOR.plume : COLOR.dim
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  drawTabular(ctx, `${litCount}/${total}`, cx, cy + radius * 1.34, 'center')
}

export interface HudPanel {
  object: THREE.Object3D
  update(state: PanelState): void
  /** billboard：每幀朝向相機，但只繞 Y 軸轉，面板不會躺下 */
  face(camera: THREE.Camera): void
  setOpacity(v: number): void
  dispose(): void
}

export function createHudPanel(): HudPanel {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  texture.minFilter = THREE.LinearFilter

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT), material)
  const group = new THREE.Group()
  group.add(mesh)
  mesh.position.y = PANEL_HEIGHT / 2

  const tmp = new THREE.Vector3()
  const self = new THREE.Vector3()

  function draw(s: PanelState): void {
    ctx.clearRect(0, 0, W, H)

    // scrim：不用純黑，邊緣淡出，避免在白牆前變成一塊突兀的方塊
    const grad = ctx.createLinearGradient(0, 0, 0, H)
    grad.addColorStop(0, 'rgba(10,12,14,0.80)')
    grad.addColorStop(0.5, 'rgba(10,12,14,0.72)')
    grad.addColorStop(1, 'rgba(10,12,14,0.62)')
    ctx.fillStyle = grad
    roundRect(ctx, 4, 4, W - 8, H - 8, 18)
    ctx.fill()
    ctx.strokeStyle = 'rgba(242,243,240,0.14)'
    ctx.lineWidth = 2
    ctx.stroke()

    const pad = 30
    ctx.textBaseline = 'alphabetic'

    // ── 任務代號
    ctx.font = `500 22px ${FONT_LABEL}`
    ctx.fillStyle = COLOR.ink
    ctx.textAlign = 'left'
    drawTracked(ctx, s.mission, pad, 52, 4)

    if (s.rate > 1.05) {
      ctx.font = `500 18px ${FONT_LABEL}`
      ctx.fillStyle = COLOR.dim
      ctx.textAlign = 'right'
      drawTabular(ctx, `${s.rate.toFixed(0)}×`, W - pad, 52, 'right')
    }

    ctx.strokeStyle = 'rgba(242,243,240,0.18)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(pad, 70)
    ctx.lineTo(W - pad, 70)
    ctx.stroke()

    // ── 主時間
    ctx.textAlign = 'left'
    if (s.holdTime) {
      ctx.font = `600 116px ${FONT_TELEMETRY}`
      ctx.fillStyle = COLOR.ink
      drawTabular(ctx, s.holdTime, W / 2, 172, 'center', true)
      ctx.font = `500 18px ${FONT_LABEL}`
      ctx.fillStyle = COLOR.dim
      drawTracked(ctx, 'HOUR MARK', pad, 210, 4)
    } else if (s.missionTime) {
      ctx.font = `600 76px ${FONT_TELEMETRY}`
      ctx.fillStyle = COLOR.ink
      drawTabular(ctx, s.missionTime, pad, 152, 'left', true)
    } else {
      ctx.font = `600 92px ${FONT_TELEMETRY}`
      ctx.fillStyle = COLOR.ink
      drawTabular(ctx, s.standbyClock ?? '--:--', pad, 158, 'left', true)
      ctx.font = `500 18px ${FONT_LABEL}`
      ctx.fillStyle = COLOR.cryo
      drawTracked(ctx, 'NEXT LAUNCH', pad, 196, 4)
      ctx.font = `600 40px ${FONT_TELEMETRY}`
      ctx.fillStyle = COLOR.ink
      drawTabular(ctx, s.standbyCountdown ?? '--:--', W - pad, 200, 'right', true)
    }

    // ── 事件標籤
    const labelY = 250
    const active = s.engines.burning
    ctx.fillStyle = active ? 'rgba(255,122,24,0.16)' : 'rgba(127,212,255,0.10)'
    roundRect(ctx, pad - 10, labelY - 28, W - 2 * (pad - 10), 44, 6)
    ctx.fill()
    ctx.fillStyle = active ? COLOR.plume : COLOR.cryo
    ctx.fillRect(pad - 10, labelY - 28, 4, 44)
    ctx.font = `500 24px ${FONT_LABEL}`
    ctx.fillStyle = COLOR.ink
    ctx.textAlign = 'left'
    drawTracked(ctx, s.eventLabel, pad + 6, labelY + 2, 24 * 0.18, true)

    // ── 遙測數值
    const rows: [string, string, string][] = [
      ['ALTITUDE', s.altitudeKm.toFixed(1), 'km'],
      ['VELOCITY', Math.round(s.speedKmh).toLocaleString('en-US'), 'km/h'],
    ]
    let y = 322
    for (const [label, value, unit] of rows) {
      ctx.font = `500 17px ${FONT_LABEL}`
      ctx.fillStyle = COLOR.dim
      ctx.textAlign = 'left'
      drawTracked(ctx, label, pad, y, 3)

      ctx.font = `600 52px ${FONT_TELEMETRY}`
      ctx.fillStyle = COLOR.ink
      const unitW = 44
      drawTabular(ctx, value, W - pad - unitW, y + 42, 'right', true)

      ctx.font = `500 19px ${FONT_LABEL}`
      ctx.fillStyle = COLOR.dim
      ctx.textAlign = 'right'
      ctx.fillText(unit, W - pad, y + 42)

      ctx.strokeStyle = 'rgba(242,243,240,0.10)'
      ctx.beginPath()
      ctx.moveTo(pad, y + 60)
      ctx.lineTo(W - pad, y + 60)
      ctx.stroke()
      y += 84
    }

    // ── 33 具引擎環形圖
    ctx.font = `500 17px ${FONT_LABEL}`
    ctx.fillStyle = COLOR.dim
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    drawTracked(ctx, s.engines.layout === 'ship6' ? 'SHIP RAPTORS' : 'BOOSTER RAPTORS', pad, 500, 3)
    drawEngineRing(ctx, W / 2, 588, 92, s.engines)

    texture.needsUpdate = true
  }

  return {
    object: group,
    update: draw,
    face(camera: THREE.Camera) {
      camera.getWorldPosition(tmp)
      group.getWorldPosition(self)
      tmp.y = self.y
      if (tmp.distanceToSquared(self) > 1e-6) group.lookAt(tmp)
    },
    setOpacity(v: number) {
      material.opacity = v
      group.visible = v > 0.01
    },
    dispose() {
      texture.dispose()
      material.dispose()
      mesh.geometry.dispose()
    },
  }
}

export { PANEL_WIDTH, PANEL_HEIGHT }
