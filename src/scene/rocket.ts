/**
 * 程序化 Starship 幾何（handoff §4）。
 *
 * 刻意不依賴任何第三方 GLB：Starship 的外形就是圓柱 + 鼻錐 + 襟翼，
 * 在 60 cm 的 AR 尺度下,程序化幾何與減面過的掃描模型看不出差別，
 * 而且完全沒有授權風險。要換 GLB 時，只要讓載入結果維持
 * 「booster 與 ship 各自為獨立 Group、原點在底部中心」即可。
 */

import * as THREE from 'three'
import { HEX } from '../theme'
import { BODY_RADIUS, BOOSTER_HEIGHT, SHIP_HEIGHT } from '../sim/flight'

const R = BODY_RADIUS
const RADIAL = 24

/** 33 具 Raptor 的實際排列：中央 3 / 中環 10 / 外環 20。 */
export const BOOSTER_ENGINE_RINGS = [
  { count: 3, radius: 0.16 },
  { count: 10, radius: 0.47 },
  { count: 20, radius: 0.82 },
] as const

/** Ship 的六具：3 具海平面 + 3 具真空（真空的較大、在外圈）。 */
export const SHIP_ENGINE_RINGS = [
  { count: 3, radius: 0.22 },
  { count: 3, radius: 0.62 },
] as const

function steel(color: number = HEX.steel, roughness = 0.35): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.9, roughness })
}

/** 依環形佈局產生引擎噴嘴位置（單位：本體半徑的比例）。 */
export function engineOffsets(
  rings: readonly { count: number; radius: number }[],
): THREE.Vector2[] {
  const out: THREE.Vector2[] = []
  for (const ring of rings) {
    for (let i = 0; i < ring.count; i++) {
      const a = (i / ring.count) * Math.PI * 2 - Math.PI / 2
      out.push(new THREE.Vector2(Math.cos(a) * ring.radius, Math.sin(a) * ring.radius))
    }
  }
  return out
}

export interface RocketParts {
  booster: THREE.Group
  ship: THREE.Group
  hotStageRing: THREE.Group
  /** Ship 上的所有材質，供淡出時統一調 opacity */
  shipMaterials: THREE.Material[]
}

function makeGridFin(): THREE.Mesh {
  const g = new THREE.BoxGeometry(R * 1.5, R * 0.9, R * 0.12)
  return new THREE.Mesh(g, steel(0x9aa2ac, 0.55))
}

function makeFlap(width: number, height: number): THREE.Mesh {
  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.lineTo(width, height * 0.18)
  shape.lineTo(width * 0.94, height)
  shape.lineTo(0, height * 0.88)
  shape.closePath()
  const g = new THREE.ExtrudeGeometry(shape, { depth: R * 0.16, bevelEnabled: false })
  g.center()
  return new THREE.Mesh(g, steel(0xb9c0c9, 0.42))
}

function makeEngines(
  rings: readonly { count: number; radius: number }[],
  bellRadius: number,
  bellLength: number,
): THREE.Group {
  const group = new THREE.Group()
  const mat = steel(0x6f7681, 0.5)
  const geo = new THREE.CylinderGeometry(bellRadius, bellRadius * 0.55, bellLength, 10, 1, true)
  const offsets = engineOffsets(rings)
  const mesh = new THREE.InstancedMesh(geo, mat, offsets.length)
  const m = new THREE.Matrix4()
  offsets.forEach((o, i) => {
    m.makeTranslation(o.x * R, -bellLength / 2, o.y * R)
    mesh.setMatrixAt(i, m)
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.frustumCulled = false
  group.add(mesh)
  return group
}

/** 在圓柱側面加幾道環焊縫，讓不鏽鋼有尺度感。 */
function addWelds(parent: THREE.Group, height: number, count: number, radius = R): void {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x8f979f,
    metalness: 0.9,
    roughness: 0.6,
  })
  const geo = new THREE.TorusGeometry(radius * 1.004, radius * 0.012, 4, RADIAL)
  const mesh = new THREE.InstancedMesh(geo, mat, count)
  const m = new THREE.Matrix4()
  const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2)
  for (let i = 0; i < count; i++) {
    const y = ((i + 1) / (count + 1)) * height
    m.copy(rot).setPosition(0, y, 0)
    mesh.setMatrixAt(i, m)
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.frustumCulled = false
  parent.add(mesh)
}

function buildBooster(): { group: THREE.Group; ring: THREE.Group } {
  const group = new THREE.Group()
  group.name = 'booster'

  const bodyH = BOOSTER_HEIGHT * 0.94
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, bodyH, RADIAL, 1), steel())
  body.position.y = bodyH / 2
  group.add(body)
  addWelds(group, bodyH, 9)

  // 引擎裙（略收）
  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R * 0.97, BOOSTER_HEIGHT * 0.08, RADIAL, 1),
    steel(0x9aa2ac, 0.5),
  )
  skirt.position.y = BOOSTER_HEIGHT * 0.04
  group.add(skirt)

  const engines = makeEngines(BOOSTER_ENGINE_RINGS, R * 0.075, R * 0.5)
  engines.position.y = 0
  group.add(engines)

  // 四片格柵翼，靠近頂端
  for (let i = 0; i < 4; i++) {
    const fin = makeGridFin()
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4
    fin.position.set(Math.cos(a) * R * 1.5, bodyH * 0.9, Math.sin(a) * R * 1.5)
    fin.rotation.y = -a
    group.add(fin)
  }

  // 熱分離環：獨立 Group，T+220 會被拋離
  const ring = new THREE.Group()
  ring.name = 'hotStageRing'
  const ringMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, BOOSTER_HEIGHT * 0.055, RADIAL, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x7e858e,
      metalness: 0.85,
      roughness: 0.55,
      side: THREE.DoubleSide,
    }),
  )
  ringMesh.position.y = BOOSTER_HEIGHT * 0.0275
  ring.add(ringMesh)

  return { group, ring }
}

function buildShip(): { group: THREE.Group; materials: THREE.Material[] } {
  const group = new THREE.Group()
  group.name = 'ship'
  const materials: THREE.Material[] = []
  const track = <M extends THREE.Material>(m: M): M => {
    materials.push(m)
    return m
  }

  const barrelH = SHIP_HEIGHT * 0.66
  const noseH = SHIP_HEIGHT * 0.34

  const barrelMat = track(steel())
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(R, R, barrelH, RADIAL, 1), barrelMat)
  barrel.position.y = barrelH / 2
  group.add(barrel)

  // 鼻錐用 LatheGeometry，比純圓錐有肩線
  const pts: THREE.Vector2[] = []
  const N = 14
  for (let i = 0; i <= N; i++) {
    const k = i / N
    pts.push(new THREE.Vector2(R * Math.cos((k * Math.PI) / 2) ** 0.55, barrelH + noseH * k))
  }
  const noseMat = track(steel(0xd0d6dd, 0.3))
  group.add(new THREE.Mesh(new THREE.LatheGeometry(pts, RADIAL), noseMat))

  addWelds(group, barrelH, 6)

  // 隔熱瓦：迎風面貼一片深色殼（薄圓柱的一半）
  const tileMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x1b1e22,
      metalness: 0.1,
      roughness: 0.95,
      side: THREE.DoubleSide,
    }),
  )
  const tiles = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 1.02, R * 1.02, barrelH * 0.96, RADIAL, 1, true, -0.9, 1.8),
    tileMat,
  )
  tiles.position.y = barrelH / 2
  group.add(tiles)

  // 兩片前襟翼、兩片後襟翼
  const fwd = makeFlap(R * 1.3, SHIP_HEIGHT * 0.15)
  const aft = makeFlap(R * 1.6, SHIP_HEIGHT * 0.19)
  for (const [mesh, y, sign] of [
    [fwd, barrelH * 0.94, 1],
    [aft, barrelH * 0.18, 1],
  ] as const) {
    for (const s of [1, -1]) {
      const m = mesh.clone()
      materials.push(m.material as THREE.Material)
      m.position.set(s * R * 1.15, y, -R * 0.35 * sign)
      m.rotation.set(0, 0, s * 0.35)
      group.add(m)
    }
  }

  const engines = makeEngines(SHIP_ENGINE_RINGS, R * 0.115, R * 0.62)
  group.add(engines)

  return { group, materials }
}

export function buildRocket(): RocketParts {
  const { group: booster, ring } = buildBooster()
  const { group: ship, materials } = buildShip()
  return { booster, ship, hotStageRing: ring, shipMaterials: materials }
}
