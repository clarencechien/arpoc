/**
 * 給 PMREM 吃的程序化天空。
 *
 * 金屬（metalness ≈ 0.9）的 diffuse 幾乎為零，外殼的長相完全由
 * scene.environment 決定——燈光對它幾乎沒有貢獻。原本用的 RoomEnvironment
 * 是一個小攝影棚方盒，低對比、無方向，反射出來就是一片均勻的灰，
 * 大腦讀到的是「灰色塑膠圓柱」。
 *
 * 真實 Starship 在戶外的識別特徵是：鏡面上映著**亮天空 / 暗地面 /
 * 中間一條硬邊地平線**，外加一顆過曝的太陽。那條沿著圓柱滑動的分界線
 * 才是「不鏽鋼」的視覺簽名。這個 scene 就只做這件事。
 *
 * 只在啟動時被 PMREMGenerator.fromScene() 渲染一次，之後就丟掉。
 */

import * as THREE from 'three'

/** 與 world.ts 的 key light 同方向，讓高光、投影、太陽反射三者同源。 */
export const SUN_DIRECTION = new THREE.Vector3(1.2, 2.4, 1.0).normalize()

/** PMREM 的 cube camera far 預設 100，球半徑必須落在裡面。 */
const SKY_RADIUS = 40

function skyTexture(): THREE.CanvasTexture {
  const W = 1024
  const H = 512
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!

  // 等距柱狀投影：v=0 天頂、v=1 天底。
  // 地平線刻意放在 0.56 而不是 0.5：鏡頭（無論桌面模式或手機 AR）都在 60 cm 模型
  // 的上方往下看，垂直圓柱反射到的是「略低於水平」那一帶。真實照片是從地面往上拍，
  // 整根都映著天；讓天空多蓋約 11° 是在補這個尺度差，不是物理錯誤。
  const horizon = H * 0.56

  // 天空：天頂深藍 → 靠近地平線變亮變暖（大氣散射）
  const sky = g.createLinearGradient(0, 0, 0, horizon)
  // 飽和度刻意比真實天空低一階：這張圖同時是所有非金屬的漫射光源，
  // 太藍會把混凝土與塔架整個染藍。金屬反射靠的是明暗對比，不是藍。
  sky.addColorStop(0.0, '#2b568f')
  sky.addColorStop(0.35, '#5a84b4')
  sky.addColorStop(0.7, '#9fbad4')
  sky.addColorStop(0.93, '#d3dfea')
  sky.addColorStop(1.0, '#efe6d6') // 地平線霧霾，偏暖偏亮
  g.fillStyle = sky
  g.fillRect(0, 0, W, horizon)

  // 地面：地平線附近被霧霾帶亮，往天底變暗。與天空之間**不做平滑混合**——
  // 這條硬邊在鏡面上的反射就是識別點
  const ground = g.createLinearGradient(0, horizon, 0, H)
  ground.addColorStop(0.0, '#948a7b') // 地平線附近的霧霾帶，被陽光打亮
  ground.addColorStop(0.1, '#6a6155')
  ground.addColorStop(0.45, '#443f38')
  ground.addColorStop(1.0, '#2a2723')
  g.fillStyle = ground
  g.fillRect(0, horizon, W, H - horizon)

  // 地平線本身：一條極窄的更亮帶（遠處被陽光打亮的地表／海面）
  g.fillStyle = 'rgba(255, 240, 215, 0.55)'
  g.fillRect(0, horizon - 2, W, 2)

  // 幾片軟雲：讓反射不是純漸層，有一點結構。低 alpha，不搶戲。
  const clouds: [x: number, y: number, rx: number, ry: number, a: number][] = [
    [0.12, 0.3, 0.11, 0.035, 0.5],
    [0.3, 0.22, 0.07, 0.025, 0.4],
    [0.55, 0.34, 0.14, 0.04, 0.55],
    [0.78, 0.26, 0.09, 0.03, 0.45],
    [0.92, 0.38, 0.1, 0.028, 0.4],
    [0.42, 0.42, 0.18, 0.02, 0.35],
  ]
  for (const [x, y, rx, ry, a] of clouds) {
    const cx = x * W
    const cy = y * horizon
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, rx * W)
    grad.addColorStop(0, `rgba(255,255,255,${a})`)
    grad.addColorStop(0.6, `rgba(255,255,255,${a * 0.5})`)
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.save()
    g.translate(cx, cy)
    g.scale(1, ry / rx)
    g.beginPath()
    g.arc(0, 0, rx * W, 0, Math.PI * 2)
    g.fill()
    g.restore()
  }

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class SkyEnvironment extends THREE.Scene {
  private readonly disposables: { dispose(): void }[] = []

  constructor() {
    super()

    const tex = skyTexture()
    // color 乘進貼圖：把天空整體推進 >1 的範圍一點，PMREM 是半浮點，吃得住。
    // 這是「亮天空」的來源；沒有它反射會像陰天。
    const skyMat = new THREE.MeshBasicMaterial({
      map: tex,
      side: THREE.BackSide,
      color: new THREE.Color().setScalar(1.35),
    })
    // 不要用 scale(-1,1,1) 去修等距柱狀貼圖的左右鏡射：負縮放會翻轉三角形繞向，
    // 與 BackSide 疊在一起等於從球內看全部被剔除，cube camera 會拍到一片黑。
    // 天空左右鏡射沒有任何人看得出來，太陽是獨立物件不受影響。
    const skyGeo = new THREE.SphereGeometry(SKY_RADIUS, 48, 32)
    const skyMesh = new THREE.Mesh(skyGeo, skyMat)
    this.add(skyMesh)

    // 太陽：小球、極高 emissive。位置與 key light 同方向。
    // 這顆是鏡面上那點過曝高光的來源，也讓 PMREM 的高頻 mip 有內容。
    const sunMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(48, 45, 38),
    })
    const sun = new THREE.Mesh(new THREE.SphereGeometry(1.6, 24, 16), sunMat)
    sun.position.copy(SUN_DIRECTION).multiplyScalar(SKY_RADIUS * 0.9)
    this.add(sun)

    // 太陽周圍一圈較弱的光暈，讓 roughness 高一點的表面也吃得到方向性
    const haloMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(6, 5.6, 4.8),
      transparent: true,
      opacity: 0.6,
    })
    const halo = new THREE.Mesh(new THREE.SphereGeometry(5.5, 24, 16), haloMat)
    halo.position.copy(sun.position)
    this.add(halo)

    this.disposables.push(tex, skyMat, skyGeo, sunMat, sun.geometry, haloMat, halo.geometry)
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
  }
}
