/**
 * 程序化 Starship V3（Block 3）幾何。
 *
 * 版本依據：Flight 12 / 13 飛的載具。與 V1/V2 的差別是這個檔案的主要形狀來源：
 *  - 熱分離環**整合在 Booster 上，不再拋離**
 *  - 格柵翼由 4 片改為 3 片，T 字配置、放大約 50%；
 *    對向兩片帶接塔吊點，第三片是方向舵
 *  - Ship 的前襟翼移到更偏背風面、位置更前、尺寸縮小
 *  - 全長 124.4 m
 *
 * 刻意不依賴任何第三方 GLB：形狀來自參數，表面細節來自 materials.ts 生成的
 * normal / roughness map。焊縫與六角瓦是貼圖不是幾何——面數花在輪廓上，
 * 那才是「看起來像不像」的來源。
 *
 * 要換成 GLB 時只需維持：booster 與 ship 各自為獨立 Group、Y 軸向上、
 * 原點在各自底部中心。
 */

import * as THREE from 'three'
import { steelMaterial, structureMaterial, tileMaterial } from './materials'
import { BODY_RADIUS, BOOSTER_HEIGHT, SHIP_HEIGHT } from '../sim/flight'

const R = BODY_RADIUS
/**
 * 圓周分段。AR 裡使用者會走到 30 cm 內看，32 段在輪廓上看得出多邊形；
 * 更嚴重的是環境反射會沿著每個面切一刀，分段的反射帶比輪廓破綻更明顯。
 * 圓柱很便宜，這裡不是效能瓶頸（真正該省的是格柵翼那些 instanced 板）。
 */
const RADIAL = 96

/** 33 具 Raptor 的實際排列：中央 3 / 中環 10 / 外環 20。 */
export const BOOSTER_ENGINE_RINGS = [
  { count: 3, radius: 0.16 },
  { count: 10, radius: 0.47 },
  { count: 20, radius: 0.82 },
] as const

/** Ship 的六具：3 具海平面（內）+ 3 具真空（外，噴嘴大得多）。 */
export const SHIP_ENGINE_RINGS = [
  { count: 3, radius: 0.24 },
  { count: 3, radius: 0.6 },
] as const

/**
 * 迎風面（隔熱瓦）的方位。
 * 不讓它正對預設鏡頭——正對的話整艘船都是黑的，看不出 Starship
 * 「銀色箭體 + 黑色腹面」的識別性。偏開約 106°，側面剛好看得到分界。
 */
const WINDWARD_CENTER = 1.85
/** 單邊弧度；總覆蓋約 117°，與真實隔熱瓦的包覆範圍相當 */
const WINDWARD_HALF = 1.02

export interface RocketParts {
  booster: THREE.Group
  ship: THREE.Group
  /** 淡出時統一調 opacity 用 */
  shipMaterials: THREE.Material[]
  boosterMaterials: THREE.Material[]
}

// ── 共用零件 ─────────────────────────────────────────────

/** 沿著箭體外側的縱向線路管（raceway）。真實載具上很顯眼的一條。 */
function raceway(y0: number, y1: number, azimuth: number, radius = R): THREE.Mesh {
  const len = y1 - y0
  const geo = new THREE.CylinderGeometry(R * 0.09, R * 0.09, len, 8, 1, false, 0, Math.PI)
  geo.rotateY(Math.PI / 2)
  const mesh = new THREE.Mesh(geo, structureMaterial(0x9aa1a9, 0.5))
  mesh.position.set(Math.sin(azimuth) * radius, y0 + len / 2, Math.cos(azimuth) * radius)
  mesh.rotation.y = azimuth
  return mesh
}

interface EngineRing {
  count: number
  radius: number
}

/**
 * 引擎噴嘴。每一環可以有自己的噴嘴尺寸——Ship 的真空版本大得多，
 * 用同一個尺寸畫會完全看不出那是 RVac。
 */
function makeEngines(
  rings: readonly EngineRing[],
  bells: readonly { radius: number; length: number }[],
): THREE.Group {
  const group = new THREE.Group()
  const mat = structureMaterial(0x4e545c, 0.45)
  const throat = structureMaterial(0x14161a, 0.9)

  rings.forEach((ring, ri) => {
    const bell = bells[Math.min(ri, bells.length - 1)]
    const geo = new THREE.CylinderGeometry(bell.radius, bell.radius * 0.42, bell.length, 12, 1, true)
    const mesh = new THREE.InstancedMesh(geo, mat, ring.count)
    // 噴嘴口的暗色圓盤，否則從下面看會直接穿透
    const capGeo = new THREE.CircleGeometry(bell.radius * 0.99, 12)
    capGeo.rotateX(Math.PI / 2)
    const caps = new THREE.InstancedMesh(capGeo, throat, ring.count)

    const m = new THREE.Matrix4()
    for (let i = 0; i < ring.count; i++) {
      const a = (i / ring.count) * Math.PI * 2 - Math.PI / 2
      const x = Math.cos(a) * ring.radius * R
      const z = Math.sin(a) * ring.radius * R
      m.makeTranslation(x, -bell.length / 2, z)
      mesh.setMatrixAt(i, m)
      m.makeTranslation(x, -bell.length + 0.0004, z)
      caps.setMatrixAt(i, m)
    }
    mesh.instanceMatrix.needsUpdate = true
    caps.instanceMatrix.needsUpdate = true
    mesh.frustumCulled = false
    caps.frustumCulled = false
    group.add(mesh, caps)
  })

  return group
}

/**
 * 有倒角的桶段。真實世界沒有數學上的銳邊——每個接合處（裙↔桶、桶↔熱分離段）
 * 的邊緣都必有一條高光，那條高光就是「這是實物」的線索之一。
 * 用 LatheGeometry 在兩端各加一圈極窄的 chamfer（半徑差約 0.6%），
 * computeVertexNormals 會把邊緣法線平均掉，反射帶在邊緣自然收圓。
 *
 * 原點在底部中心、往 +Y 長 h。UV 的 v 重寫成沿高度線性，
 * 否則 Lathe 依點數分配 v，焊縫貼圖會被擠到兩端。
 */
function bodySection(rBottom: number, rTop: number, h: number): THREE.LatheGeometry {
  const c = h * 0.004 // 倒角高度
  const inset = 0.006 // 倒角半徑內縮比例
  const pts = [
    new THREE.Vector2(rBottom * (1 - inset), 0),
    new THREE.Vector2(rBottom, c),
    new THREE.Vector2(rTop, h - c),
    new THREE.Vector2(rTop * (1 - inset), h),
  ]
  const geo = new THREE.LatheGeometry(pts, RADIAL)
  const pos = geo.attributes.position
  const uv = geo.attributes.uv
  for (let i = 0; i < pos.count; i++) uv.setY(i, pos.getY(i) / h)
  uv.needsUpdate = true
  return geo
}

/** 引擎艙頂板，擋住從側面看進箭體內部的視線。 */
function bayPlate(radius: number, y: number): THREE.Mesh {
  const geo = new THREE.CircleGeometry(radius, RADIAL)
  geo.rotateX(Math.PI / 2)
  const mesh = new THREE.Mesh(geo, structureMaterial(0x1c1f23, 0.95))
  mesh.position.y = y
  return mesh
}

// ── Super Heavy V3 ───────────────────────────────────────

/**
 * V3 格柵翼：3 片、T 字配置、比 Block 1/2 大 50%。
 * 用真的格子（縱橫薄板）而不是一塊實心方塊——這是遠看就分得出真假的地方。
 */
function makeGridFin(width: number, height: number, chord: number): THREE.Group {
  const fin = new THREE.Group()
  const mat = structureMaterial(0x8c939b, 0.62)
  // 格板厚度要撐得住 60 cm 尺度下的取樣，太薄會糊成一塊實心方塊
  const wall = R * 0.075

  const cellsX = 4
  const cellsZ = 2

  // 縱向隔板（沿 x 分格）。用同一塊 BoxGeometry 壓扁成薄板，省一組頂點。
  const xPlateGeo = new THREE.BoxGeometry(width, height, chord)
  const xPlates = new THREE.InstancedMesh(xPlateGeo, mat, cellsX + 1)
  for (let i = 0; i <= cellsX; i++) {
    const x = -width / 2 + (i / cellsX) * width
    const m = new THREE.Matrix4().makeScale(wall / width, 1, 1)
    m.setPosition(x, 0, 0)
    xPlates.setMatrixAt(i, m)
  }
  xPlates.instanceMatrix.needsUpdate = true

  // 徑向隔板（沿 z 分格）
  const zPlateGeo = new THREE.BoxGeometry(width, height, chord)
  const zPlates = new THREE.InstancedMesh(zPlateGeo, mat, cellsZ + 1)
  for (let i = 0; i <= cellsZ; i++) {
    const z = -chord / 2 + (i / cellsZ) * chord
    const m = new THREE.Matrix4().makeScale(1, 1, wall / chord)
    m.setPosition(0, 0, z)
    zPlates.setMatrixAt(i, m)
  }
  zPlates.instanceMatrix.needsUpdate = true

  // 外框：只有四周的直立框板，**沒有上下蓋板**。格子的開口軸是 Y（氣流方向），
  // 上下一封就變成實心方塊——第一張 contact sheet 抓到的正是這個。
  const frame = new THREE.Group()
  for (const sx of [-1, 1]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(wall * 2.2, height * 1.02, chord * 1.02), mat)
    bar.position.set((sx * width) / 2, 0, 0)
    frame.add(bar)
  }
  for (const sz of [-1, 1]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(width * 1.02, height * 1.02, wall * 2.2), mat)
    bar.position.set(0, 0, (sz * chord) / 2)
    frame.add(bar)
  }

  fin.add(xPlates, zPlates, frame)
  return fin
}

function buildBooster(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'booster'

  const H = BOOSTER_HEIGHT
  const skirtH = H * 0.055
  // 熱分離段是箭體的一部分，不再是可拋離的環
  const hotStageH = H * 0.062
  const barrelY0 = skirtH
  const barrelY1 = H - hotStageH
  const barrelH = barrelY1 - barrelY0

  // 引擎裙：外徑略大、顏色略深，是箭體最下面那一圈
  const skirt = new THREE.Mesh(
    bodySection(R * 1.012, R * 1.008, skirtH),
    steelMaterial({ color: 0x9198a0, repeat: [2, 0.35], normalScale: 0.8, ao: 0.9 }),
  )
  group.add(skirt)
  group.add(bayPlate(R * 0.99, skirtH * 0.35))

  // 主箭體
  const barrel = new THREE.Mesh(
    bodySection(R, R, barrelH),
    steelMaterial({ color: 0xb4bbc3, repeat: [2, 1.35], ao: 0.55 }),
  )
  barrel.position.y = barrelY0
  group.add(barrel)

  // 熱分離段：略微外擴的短段 + 一圈排氣開口。V3 起這一段不拋離。
  const hotStage = new THREE.Mesh(
    bodySection(R * 1.0, R * 1.015, hotStageH),
    steelMaterial({ color: 0x8f959d, repeat: [2, 0.3], roughnessScale: 1.25 }),
  )
  hotStage.position.y = barrelY1
  group.add(hotStage)

  const ventGeo = new THREE.BoxGeometry(R * 0.16, hotStageH * 0.52, R * 0.05)
  const vents = new THREE.InstancedMesh(ventGeo, structureMaterial(0x0e1013, 0.95), 18)
  {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3(1, 1, 1)
    const up = new THREE.Vector3(0, 1, 0)
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2
      q.setFromAxisAngle(up, a)
      m.compose(
        new THREE.Vector3(
          Math.sin(a) * R * 1.005,
          barrelY1 + hotStageH * 0.5,
          Math.cos(a) * R * 1.005,
        ),
        q,
        s,
      )
      vents.setMatrixAt(i, m)
    }
    vents.instanceMatrix.needsUpdate = true
  }
  group.add(vents)

  // 頂端封板，避免從上方看穿
  group.add(bayPlate(R * 0.99, H - 0.0006))

  // 3 片格柵翼，T 字配置：對向兩片帶吊點，第三片作方向舵
  // 翼的局部座標：X＝切線向（翼展）、Y＝箭體軸向（格子開口方向）、Z＝徑向朝外（弦長）
  const finW = R * 1.5
  const finH = H * 0.05
  const finC = R * 0.85
  const finY = barrelY1 - H * 0.058
  for (const a of [0, Math.PI, Math.PI / 2]) {
    const fin = makeGridFin(finW, finH, finC)
    fin.position.set(Math.sin(a) * (R + finC * 0.52), finY, Math.cos(a) * (R + finC * 0.52))
    fin.rotation.y = a
    group.add(fin)

    // 根部整流罩：貼著箭體的薄殼，不是一顆方塊
    const root = new THREE.Mesh(
      new THREE.BoxGeometry(R * 0.62, finH * 1.5, R * 0.22),
      structureMaterial(0x9aa1a9, 0.55),
    )
    root.position.set(Math.sin(a) * R * 1.05, finY, Math.cos(a) * R * 1.05)
    root.rotation.y = a
    group.add(root)
  }

  // 接塔吊點：只在對向那兩片翼的下方
  for (const a of [0, Math.PI]) {
    const pin = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 0.075, R * 0.075, R * 0.36, 10),
      structureMaterial(0xb6bcc4, 0.4),
    )
    pin.rotation.z = Math.PI / 2
    pin.position.set(Math.sin(a) * R * 1.06, finY - finH * 1.5, Math.cos(a) * R * 1.06)
    pin.rotation.y = a
    group.add(pin)
  }

  group.add(raceway(skirtH, barrelY1 - H * 0.02, Math.PI * 1.35))

  return group
}

// ── Ship V3 ──────────────────────────────────────────────

/** 鼻錐外形：底部與圓柱相切（有肩線），頂端收成圓頭。 */
function noseProfile(baseY: number, height: number, radius: number, steps: number): THREE.Vector2[] {
  const pts: THREE.Vector2[] = []
  // 真實鼻錐的頭部是圓的（曲率半徑約 0.6 m），不是尖的
  const tipR = radius * 0.13
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const r = radius * Math.pow(1 - Math.pow(t, 2.6), 0.55)
    pts.push(new THREE.Vector2(Math.max(r, tipR), baseY + height * t))
  }
  // 半球頂，收在 ogive 收斂到的同一個半徑上，不會出現尖刺
  for (let i = 1; i <= 4; i++) {
    const k = (i / 4) * (Math.PI / 2)
    pts.push(new THREE.Vector2(tipR * Math.cos(k), baseY + height + tipR * Math.sin(k)))
  }
  return pts
}

/** 襟翼：後掠前緣 + 略帶錐度的梯形，接一段鉸鏈整流罩。 */
function makeFlap(
  span: number,
  root: number,
  tip: number,
  material: THREE.Material,
): THREE.Group {
  const shape = new THREE.Shape()
  shape.moveTo(0, -root / 2)
  shape.lineTo(span, -tip / 2 - span * 0.12)
  shape.lineTo(span, tip / 2 - span * 0.12)
  shape.lineTo(0, root / 2)
  shape.closePath()
  // 外緣加小倒角：襟翼邊緣在側逆光下會有一條細高光，沒有它就是一片紙板
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: R * 0.16,
    bevelEnabled: true,
    bevelThickness: R * 0.018,
    bevelSize: R * 0.018,
    bevelSegments: 2,
  })
  // shape 的 x＝翼展、y＝弦長、擠出方向＝厚度。
  // 繞 Y 轉 -90° 之後：翼展→+Z（徑向朝外）、弦長→Y（箭體軸向）、厚度→X（切線向）。
  geo.rotateY(-Math.PI / 2)
  geo.translate(0, 0, R * 0.08)

  const group = new THREE.Group()
  group.add(new THREE.Mesh(geo, material))

  // 鉸鏈軸是切線向的
  const hinge = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 0.1, R * 0.1, root * 0.95, 10),
    structureMaterial(0x7d848c, 0.5),
  )
  hinge.rotation.z = Math.PI / 2
  group.add(hinge)

  // 根部整流罩：貼著鉸鏈的半圓殼，蓋住翼與箭體的接縫
  const fairing = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 0.16, R * 0.16, root * 1.1, 10, 1, false, 0, Math.PI),
    structureMaterial(0x22262b, 0.9),
  )
  fairing.rotation.z = Math.PI / 2
  fairing.position.z = -R * 0.02
  group.add(fairing)
  return group
}

function buildShip(): { group: THREE.Group } {
  const group = new THREE.Group()
  group.name = 'ship'
  const track = <M extends THREE.Material>(m: M): M => m

  const H = SHIP_HEIGHT
  const skirtH = H * 0.055
  const noseH = H * 0.265
  const barrelY0 = skirtH
  const barrelY1 = H - noseH
  const barrelH = barrelY1 - barrelY0

  const skinMat = track(steelMaterial({ color: 0xb4bbc3, repeat: [2, 1.0], ao: 0.55 }))
  const noseMat = track(steelMaterial({ color: 0xbcc3cb, repeat: [2, 0.55], normalScale: 0.4 }))
  const tileSkin = track(tileMaterial([2.6, 4.5]))
  const tileNose = track(tileMaterial([2.6, 1.7]))
  const flapMat = track(tileMaterial([1.1, 0.8]))

  const skirt = new THREE.Mesh(
    bodySection(R * 1.01, R * 1.006, skirtH),
    track(steelMaterial({ color: 0x959ca4, repeat: [2, 0.3], normalScale: 0.8, ao: 0.9 })),
  )
  group.add(skirt)
  group.add(bayPlate(R * 0.99, skirtH * 0.4))

  const barrel = new THREE.Mesh(bodySection(R, R, barrelH), skinMat)
  barrel.position.y = barrelY0
  group.add(barrel)

  const nosePts = noseProfile(barrelY1, noseH, R, 18)
  group.add(new THREE.Mesh(new THREE.LatheGeometry(nosePts, RADIAL), noseMat))

  // 迎風面六角瓦：桶身與鼻錐各一片薄殼，貼在本體外側一點點
  const tiles = new THREE.Mesh(
    new THREE.CylinderGeometry(
      R * 1.012,
      R * 1.012,
      barrelH + skirtH * 0.8,
      RADIAL,
      1,
      true,
      WINDWARD_CENTER - WINDWARD_HALF,
      WINDWARD_HALF * 2,
    ),
    tileSkin,
  )
  tiles.position.y = barrelY0 + barrelH / 2 - skirtH * 0.1
  group.add(tiles)

  const noseTilePts = noseProfile(barrelY1, noseH, R * 1.012, 18)
  group.add(
    new THREE.Mesh(
      new THREE.LatheGeometry(
        noseTilePts,
        RADIAL,
        WINDWARD_CENTER - WINDWARD_HALF * 0.92,
        WINDWARD_HALF * 1.84,
      ),
      tileNose,
    ),
  )

  // V3 的前襟翼往背風面挪、位置更前、尺寸縮小（Musk：舊的太大太重且在 180°）
  for (const s of [1, -1]) {
    const a = WINDWARD_CENTER + s * 1.15
    const flap = makeFlap(R * 1.0, H * 0.10, H * 0.062, flapMat)
    flap.position.set(Math.sin(a) * R * 0.99, barrelY1 - H * 0.045, Math.cos(a) * R * 0.99)
    flap.rotation.y = a
    flap.rotation.x = -0.22 // 略微後掠，貼著箭體
    group.add(flap)
  }

  // 後襟翼：跨在迎風面兩側、靠近底部，是最好認的輪廓
  for (const s of [1, -1]) {
    const a = WINDWARD_CENTER + s * 0.92
    const flap = makeFlap(R * 1.45, H * 0.165, H * 0.105, flapMat)
    flap.position.set(Math.sin(a) * R * 0.99, barrelY0 + H * 0.1, Math.cos(a) * R * 0.99)
    flap.rotation.y = a
    flap.rotation.x = -0.14
    group.add(flap)
  }

  // 背風面的酬載艙門接縫
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(R * 0.9, barrelH * 0.3, R * 0.03),
    track(structureMaterial(0x9aa1a9, 0.55)),
  )
  door.position.set(0, barrelY1 - barrelH * 0.24, -R * 1.005)
  group.add(door)

  group.add(raceway(barrelY0, barrelY1 - H * 0.02, Math.PI * 1.55))

  // 3 具海平面 + 3 具真空。真空版本的噴嘴大得多，那是辨識點。
  group.add(
    makeEngines(SHIP_ENGINE_RINGS, [
      { radius: R * 0.115, length: R * 0.5 },
      { radius: R * 0.205, length: R * 0.92 },
    ]),
  )

  return { group }
}

function collectMaterials(root: THREE.Object3D): THREE.Material[] {
  const set = new Set<THREE.Material>()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.material) {
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) set.add(m)
    }
  })
  return [...set]
}

export function buildRocket(): RocketParts {
  const booster = buildBooster()
  booster.add(makeEngines(BOOSTER_ENGINE_RINGS, [{ radius: R * 0.082, length: R * 0.42 }]))
  const { group: ship } = buildShip()
  return {
    booster,
    ship,
    // traverse 收集比逐一 track 可靠：clone 出來的襟翼材質也會被抓到
    shipMaterials: collectMaterials(ship),
    boosterMaterials: collectMaterials(booster),
  }
}
