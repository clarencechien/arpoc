/**
 * 程序化材質。
 *
 * 「看起來假」多半不是幾何不夠細，而是表面沒有東西。
 * 一根沒有貼圖的圓柱在任何角度都只有一條漸層，大腦立刻認出那是原始幾何。
 * 這裡在啟動時畫幾張 canvas，轉成 normal / roughness map：
 * 焊縫、桶段接縫、軋延紋理、六角隔熱瓦——都是靠貼圖，不是靠面數。
 *
 * 全部在執行期生成，沒有外部檔案，也不佔下載預算。
 */

import * as THREE from 'three'

/** 由高度圖推法線圖。邊界用環繞取樣，貼在圓柱上不會有接縫。 */
function heightToNormal(src: HTMLCanvasElement, strength: number): THREE.CanvasTexture {
  const w = src.width
  const h = src.height
  const data = src.getContext('2d')!.getImageData(0, 0, w, h).data
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const octx = out.getContext('2d')!
  const img = octx.createImageData(w, h)
  const at = (x: number, y: number) =>
    data[((((y % h) + h) % h) * w + (((x % w) + w) % w)) * 4] / 255

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength
      const len = Math.hypot(dx, dy, 1)
      const i = (y * w + x) * 4
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255
      img.data[i + 2] = (1 / len) * 0.5 * 255 + 127.5
      img.data[i + 3] = 255
    }
  }
  octx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(out)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

function blank(w: number, h: number, fill: string): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = fill
  ctx.fillRect(0, 0, w, h)
  return [c, ctx]
}

// ── 不鏽鋼 ───────────────────────────────────────────────
// v 軸＝箭體高度，所以畫在 canvas 上的水平線就是繞一圈的環焊縫。

const STEEL_W = 256
const STEEL_H = 1024
/** 對應真實 Super Heavy 的桶段數量級 */
const STEEL_RINGS = 18

interface SteelMaps {
  normal: THREE.Texture
  roughness: THREE.Texture
}

let steelMaps: SteelMaps | null = null

function buildSteelMaps(): SteelMaps {
  // 高度圖：環焊縫凸起、桶段之間的接縫凹陷、縱向軋延紋
  const [hc, h] = blank(STEEL_W, STEEL_H, '#808080')
  const ringPitch = STEEL_H / STEEL_RINGS

  for (let i = 0; i <= STEEL_RINGS; i++) {
    const y = i * ringPitch
    // 焊道本身略凸
    h.fillStyle = '#9a9a9a'
    h.fillRect(0, y - 1.5, STEEL_W, 3)
    // 兩側熱影響區略凹，這一凹一凸才看得出是焊接不是畫線
    h.fillStyle = '#6e6e6e'
    h.fillRect(0, y - 3.5, STEEL_W, 2)
    h.fillRect(0, y + 1.5, STEEL_W, 2)
  }

  // 縱向軋延／板材接縫
  for (let i = 0; i < 10; i++) {
    const x = (i / 10) * STEEL_W + 3
    h.fillStyle = '#767676'
    h.fillRect(x, 0, 1.5, STEEL_H)
  }

  // 板材本身的輕微起伏（不鏽鋼薄板一定會有）
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * STEEL_W
    const y = Math.random() * STEEL_H
    const r = 6 + Math.random() * 26
    const g = h.createRadialGradient(x, y, 0, x, y, r)
    const v = 128 + (Math.random() - 0.5) * 22
    g.addColorStop(0, `rgba(${v},${v},${v},0.5)`)
    g.addColorStop(1, 'rgba(128,128,128,0)')
    h.fillStyle = g
    h.beginPath()
    h.arc(x, y, r, 0, Math.PI * 2)
    h.fill()
  }

  // 粗糙度圖：焊縫與熱影響區明顯較霧，板面較亮
  // material.roughness 設 1，實際數值全部由這張圖決定
  const [rc, r] = blank(STEEL_W, STEEL_H, '#4d4d4d') // ≈ 0.30
  for (let i = 0; i <= STEEL_RINGS; i++) {
    const y = i * ringPitch
    r.fillStyle = '#8c8c8c' // ≈ 0.55
    r.fillRect(0, y - 4, STEEL_W, 8)
  }
  for (let i = 0; i < 700; i++) {
    const x = Math.random() * STEEL_W
    const y = Math.random() * STEEL_H
    const rad = 10 + Math.random() * 40
    const g = r.createRadialGradient(x, y, 0, x, y, rad)
    const v = 77 + (Math.random() - 0.5) * 46
    g.addColorStop(0, `rgba(${v},${v},${v},0.45)`)
    g.addColorStop(1, 'rgba(77,77,77,0)')
    r.fillStyle = g
    r.beginPath()
    r.arc(x, y, rad, 0, Math.PI * 2)
    r.fill()
  }
  // 橫向刷紋，讓反射有方向感
  r.globalAlpha = 0.25
  for (let i = 0; i < 260; i++) {
    const y = Math.random() * STEEL_H
    r.strokeStyle = Math.random() > 0.5 ? '#5c5c5c' : '#404040'
    r.lineWidth = 0.6 + Math.random()
    r.beginPath()
    r.moveTo(0, y)
    r.lineTo(STEEL_W, y)
    r.stroke()
  }
  r.globalAlpha = 1

  const roughness = new THREE.CanvasTexture(rc)
  roughness.wrapS = roughness.wrapT = THREE.RepeatWrapping

  return { normal: heightToNormal(hc, 3.2), roughness }
}

export interface SteelOptions {
  color?: number
  /** 貼圖重複次數 [繞一圈, 沿高度] */
  repeat?: [number, number]
  /** 額外壓暗粗糙度（例如格柵翼比箭體霧） */
  roughnessScale?: number
  metalness?: number
  normalScale?: number
}

/**
 * 不鏽鋼。所有箭體外殼都用這個，靠 repeat 調整焊縫密度。
 * 貼圖是共用的，只有 material 是新的——省記憶體也省上傳頻寬。
 */
export function steelMaterial(opts: SteelOptions = {}): THREE.MeshStandardMaterial {
  if (!steelMaps) steelMaps = buildSteelMaps()
  const [ru, rv] = opts.repeat ?? [1, 1]

  // 每個 material 需要自己的 repeat，所以複製 texture 物件（共用底層 image）
  const normal = steelMaps.normal.clone()
  const roughness = steelMaps.roughness.clone()
  for (const t of [normal, roughness]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(ru, rv)
    t.needsUpdate = true
  }

  const m = new THREE.MeshStandardMaterial({
    color: opts.color ?? 0xb9c0c8,
    metalness: opts.metalness ?? 0.92,
    roughness: opts.roughnessScale ?? 1,
    roughnessMap: roughness,
    normalMap: normal,
  })
  m.normalScale.setScalar(opts.normalScale ?? 0.55)
  return m
}

// ── 六角隔熱瓦 ────────────────────────────────────────────

interface TileMaps {
  color: THREE.Texture
  normal: THREE.Texture
  roughness: THREE.Texture
}

let tileMaps: TileMaps | null = null

/** 畫一格 pointy-top 六角形。 */
function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

function buildTileMaps(): TileMaps {
  // 讓 canvas 尺寸剛好是六角網格的整數週期，貼圖才能無縫重複
  const COLS = 12
  const dx = 512 / COLS
  const r = dx / Math.sqrt(3)
  const rowPitch = r * 1.5
  const ROWS = 14 // 偶數，錯位圖案才會週期性重複
  const W = 512
  const H = Math.round(rowPitch * ROWS)

  const [cc, c] = blank(W, H, '#0d0f11')
  const [hc, h] = blank(W, H, '#5a5a5a')
  const [rc, rg] = blank(W, H, '#d9d9d9') // 隔熱瓦很霧

  const draw = (fn: (cx: number, cy: number) => void) => {
    for (let row = -1; row <= ROWS; row++) {
      const cy = row * rowPitch
      const offset = row % 2 === 0 ? 0 : dx / 2
      for (let col = -1; col <= COLS; col++) {
        fn(col * dx + offset, cy)
      }
    }
  }

  // 顏色：每一片略有差異——真實的隔熱瓦本來就不是同一個黑
  draw((cx, cy) => {
    const v = 20 + Math.random() * 16
    c.fillStyle = `rgb(${v},${v + 1},${v + 3})`
    hexPath(c, cx, cy, r * 0.955)
    c.fill()
  })

  // 高度：瓦面平、縫隙凹
  draw((cx, cy) => {
    h.fillStyle = '#8e8e8e'
    hexPath(h, cx, cy, r * 0.93)
    h.fill()
  })

  // 粗糙度：瓦面極霧，縫隙略亮（陰影裡的碳布）
  draw((cx, cy) => {
    const v = 232 + Math.random() * 20
    rg.fillStyle = `rgb(${v},${v},${v})`
    hexPath(rg, cx, cy, r * 0.95)
    rg.fill()
  })

  const color = new THREE.CanvasTexture(cc)
  color.colorSpace = THREE.SRGBColorSpace
  const roughness = new THREE.CanvasTexture(rc)
  for (const t of [color, roughness]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
  }
  return { color, normal: heightToNormal(hc, 2.4), roughness }
}

/** 迎風面的黑色六角隔熱瓦。 */
export function tileMaterial(repeat: [number, number]): THREE.MeshStandardMaterial {
  if (!tileMaps) tileMaps = buildTileMaps()
  const maps = {
    map: tileMaps.color.clone(),
    normalMap: tileMaps.normal.clone(),
    roughnessMap: tileMaps.roughness.clone(),
  }
  for (const t of Object.values(maps)) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(repeat[0], repeat[1])
    t.needsUpdate = true
  }
  maps.map.colorSpace = THREE.SRGBColorSpace

  const m = new THREE.MeshStandardMaterial({
    ...maps,
    color: 0xffffff,
    metalness: 0.0,
    roughness: 1,
    side: THREE.DoubleSide,
  })
  m.normalScale.setScalar(0.7)
  return m
}

/** 引擎艙、格柵翼那類非外殼的深色結構件。 */
export function structureMaterial(color = 0x6d747d, roughness = 0.55): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.8, roughness })
}
