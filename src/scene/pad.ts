/**
 * 軌道發射台與接塔塔架。
 *
 * 不追求還原 Starbase 的每一根桁架，但幾個特徵不能少，否則就只是「一根柱子旁邊有鷹架」：
 *  - OLM 是六邊形檯面，中央有排氣孔，周圍一圈固定夾具
 *  - 塔架是方形斷面、有斜撐（只有橫桿的話看起來就是鋼筋）
 *  - 兩支接塔臂（chopsticks）與導軌，那是這座塔最好認的部分
 */

import * as THREE from 'three'
import { BODY_RADIUS, STACK_HEIGHT } from '../sim/flight'
import { HEX } from '../theme'
import { steelMaterial, structureMaterial } from './materials'

const R = BODY_RADIUS

function box(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
}

function buildOLM(): THREE.Group {
  const olm = new THREE.Group()
  const structure = structureMaterial(0x5c636c, 0.62)
  const dark = structureMaterial(0x2a2e33, 0.85)

  // 六邊形檯面
  const deckH = R * 0.62
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(R * 2.5, R * 2.65, deckH, 6, 1), structure)
  deck.position.y = R * 1.46
  olm.add(deck)

  // 中央排氣孔：內壁要暗，否則檯面看起來是實心的
  const vent = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 1.18, R * 1.18, deckH * 1.1, 24, 1, true),
    dark,
  )
  vent.position.y = R * 1.46
  olm.add(vent)
  const ventFloor = new THREE.Mesh(new THREE.CircleGeometry(R * 1.18, 24), dark)
  ventFloor.rotation.x = -Math.PI / 2
  ventFloor.position.y = R * 1.2
  olm.add(ventFloor)

  // 20 具固定夾具，沿排氣孔外緣排一圈
  const clampGeo = new THREE.BoxGeometry(R * 0.13, R * 0.3, R * 0.22)
  const clamps = new THREE.InstancedMesh(clampGeo, structureMaterial(0x878e97, 0.5), 20)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const one = new THREE.Vector3(1, 1, 1)
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2
    q.setFromAxisAngle(up, a)
    m.compose(
      new THREE.Vector3(Math.sin(a) * R * 1.32, R * 1.9, Math.cos(a) * R * 1.32),
      q,
      one,
    )
    clamps.setMatrixAt(i, m)
  }
  clamps.instanceMatrix.needsUpdate = true
  olm.add(clamps)

  // 六支腿：真實 OLM 的腿是粗壯的錐形混凝土柱（照片裡幾乎與檯面同寬），
  // 不是細鋼管。顏色偏暖的淺灰，與鋼結構分得開。
  const concreteLeg = new THREE.MeshStandardMaterial({
    color: 0x8b857a,
    metalness: 0.0,
    roughness: 0.95,
    envMapIntensity: 0.5,
  })
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 0.36, R * 0.5, R * 1.15, 16),
      concreteLeg,
    )
    leg.position.set(Math.sin(a) * R * 2.0, R * 0.58, Math.cos(a) * R * 2.0)
    olm.add(leg)

    const a2 = ((i + 1) / 6) * Math.PI * 2 + Math.PI / 6
    const brace = box(R * 0.08, R * 0.08, R * 2.2, structure)
    brace.position.set(
      ((Math.sin(a) + Math.sin(a2)) / 2) * R * 2.15,
      R * 0.35,
      ((Math.cos(a) + Math.cos(a2)) / 2) * R * 2.15,
    )
    brace.lookAt(Math.sin(a2) * R * 2.15, R * 0.75, Math.cos(a2) * R * 2.15)
    olm.add(brace)
  }

  return olm
}

/** 方形斷面塔架：立柱 + 每層橫桿 + 交錯的斜撐。 */
function buildTower(height: number): THREE.Group {
  const tower = new THREE.Group()
  const structure = structureMaterial(0x555c65, 0.6)
  const half = R * 1.05
  const levels = 13
  const levelH = height / levels

  for (const [x, z] of [
    [-half, -half],
    [half, -half],
    [-half, half],
    [half, half],
  ]) {
    const col = box(R * 0.19, height, R * 0.19, structure)
    col.position.set(x, height / 2, z)
    tower.add(col)
  }

  const barGeo = new THREE.BoxGeometry(half * 2, R * 0.09, R * 0.09)
  const diagLen = Math.hypot(half * 2, levelH)
  const diagGeo = new THREE.BoxGeometry(diagLen, R * 0.065, R * 0.065)
  const bars = new THREE.InstancedMesh(barGeo, structure, levels * 4 + 8)
  const diags = new THREE.InstancedMesh(diagGeo, structure, levels * 4 + 8)

  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const one = new THREE.Vector3(1, 1, 1)
  const up = new THREE.Vector3(0, 1, 0)
  const fwd = new THREE.Vector3(0, 0, 1)
  let bi = 0
  let di = 0

  // 四個面，各自的橫桿與斜撐
  const faces: [pos: THREE.Vector3, yaw: number][] = [
    [new THREE.Vector3(0, 0, -half), 0],
    [new THREE.Vector3(0, 0, half), 0],
    [new THREE.Vector3(-half, 0, 0), Math.PI / 2],
    [new THREE.Vector3(half, 0, 0), Math.PI / 2],
  ]

  for (let level = 1; level <= levels; level++) {
    const y = level * levelH
    faces.forEach(([pos, yaw], fi) => {
      if (y < height) {
        q.setFromAxisAngle(up, yaw)
        m.compose(new THREE.Vector3(pos.x, y, pos.z), q, one)
        bars.setMatrixAt(bi++, m)
      }
      // 斜撐左右交錯，看起來才像桁架而不是梯子
      const tilt = (level + fi) % 2 === 0 ? 1 : -1
      const angle = Math.atan2(levelH, half * 2) * tilt
      q.setFromAxisAngle(up, yaw)
      const tiltQ = new THREE.Quaternion().setFromAxisAngle(fwd, angle)
      m.compose(new THREE.Vector3(pos.x, y - levelH / 2, pos.z), q.multiply(tiltQ), one)
      diags.setMatrixAt(di++, m)
    })
  }
  bars.count = bi
  diags.count = di
  bars.instanceMatrix.needsUpdate = true
  diags.instanceMatrix.needsUpdate = true
  tower.add(bars, diags)

  return tower
}

/**
 * 接塔臂（chopsticks）：兩支臂各自繞根部樞軸開合。
 * setChopsticks(0)＝張開等待，(1)＝閉合夾住。
 */
interface Chopsticks {
  group: THREE.Group
  set(closed01: number): void
}

function buildChopsticks(y: number): Chopsticks {
  const group = new THREE.Group()
  const mat = structureMaterial(0x7a828b, 0.55)
  const armLen = R * 3.6
  const pivots: { pivot: THREE.Group; sign: number }[] = []

  for (const s of [-1, 1]) {
    // 樞軸放在臂根（塔側），臂沿 -Z 伸出
    const pivot = new THREE.Group()
    pivot.position.set(s * R * 1.35, y, 0)

    const arm = new THREE.Group()
    const beam = box(R * 0.3, R * 0.28, armLen, mat)
    beam.position.z = -armLen / 2
    arm.add(beam)
    // 臂內側的承載軌條（火箭吊點就掛在這上面）
    const rail = box(R * 0.1, R * 0.12, armLen * 0.88, structureMaterial(0xa2a9b2, 0.4))
    rail.position.set(-s * R * 0.18, R * 0.18, -armLen / 2)
    arm.add(rail)
    pivot.add(arm)
    group.add(pivot)
    pivots.push({ pivot, sign: s })
  }

  // 臂根的載具（沿塔滑動的結構）
  const carriage = box(R * 3.6, R * 0.55, R * 0.6, mat)
  carriage.position.set(0, y, R * 0.5)
  group.add(carriage)

  return {
    group,
    set(closed01: number) {
      const k = Math.min(1, Math.max(0, closed01))
      for (const { pivot, sign } of pivots) {
        // 張開 ±0.34 rad，閉合到 ±0.045（留一點縫，臂是夾不是壓）
        pivot.rotation.y = sign * (0.34 - 0.295 * k)
      }
    },
  }
}

/** 儲罐區（tank farm）：發射場的第二個地標，也把場景撐大。 */
function buildTankFarm(): THREE.Group {
  const farm = new THREE.Group()
  const tankMat = steelMaterial({ color: 0xc8cdd4, repeat: [2, 0.5], normalScale: 0.4 })
  const white = structureMaterial(0xd8dce1, 0.5)

  // 立式儲罐一排（LOX / CH4 / 水）
  const vGeo = new THREE.CylinderGeometry(R * 0.55, R * 0.55, R * 2.6, 14)
  const vTanks = new THREE.InstancedMesh(vGeo, tankMat, 6)
  const capGeo = new THREE.SphereGeometry(R * 0.55, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)
  const caps = new THREE.InstancedMesh(capGeo, tankMat, 6)
  const m = new THREE.Matrix4()
  for (let i = 0; i < 6; i++) {
    const z = (i - 2.5) * R * 1.45
    m.makeTranslation(0, R * 1.3, z)
    vTanks.setMatrixAt(i, m)
    m.makeTranslation(0, R * 2.6, z)
    caps.setMatrixAt(i, m)
  }
  vTanks.instanceMatrix.needsUpdate = true
  caps.instanceMatrix.needsUpdate = true
  farm.add(vTanks, caps)

  // 兩具臥式儲罐
  for (const [zi, hz] of [[-1, -R * 4.9], [1, R * 4.9]] as const) {
    void zi
    const h = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.5, R * 0.5, R * 2.4, 12), white)
    h.rotation.x = Math.PI / 2
    h.position.set(R * 1.4, R * 0.55, hz)
    farm.add(h)
  }

  // 防溢堤
  const bund = new THREE.Mesh(
    new THREE.BoxGeometry(R * 3.6, R * 0.22, R * 11),
    new THREE.MeshStandardMaterial({ color: 0x4a4f56, roughness: 0.95 }),
  )
  bund.position.y = R * 0.11
  farm.add(bund)

  return farm
}

export interface Pad {
  group: THREE.Group
  setChopsticks(closed01: number): void
}

export function buildPad(): Pad {
  const pad = new THREE.Group()
  pad.name = 'pad'

  const concrete = new THREE.MeshStandardMaterial({
    color: 0x3d4249,
    metalness: 0.02,
    roughness: 0.96,
    envMapIntensity: 0.5, // 混凝土不該把天空整片吃進來
  })

  // 混凝土坪：加大到約 45 cm 直徑，整個發射場站在上面
  const apron = new THREE.Mesh(new THREE.CylinderGeometry(R * 10, R * 10.4, R * 0.16, 40), concrete)
  apron.position.y = R * 0.08
  pad.add(apron)

  // 通往儲罐區的道路
  const road = new THREE.Mesh(
    new THREE.BoxGeometry(R * 5.5, R * 0.02, R * 1.4),
    new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: 1 }),
  )
  road.position.set(R * 5.2, R * 0.17, R * 2.6)
  pad.add(road)

  pad.add(buildOLM())

  const towerH = STACK_HEIGHT * 1.16
  const tower = buildTower(towerH)
  const chopsticks = buildChopsticks(towerH * 0.7)
  tower.add(chopsticks.group)
  tower.position.set(R * 4.0, 0, 0)
  // 塔架在 +X，接塔臂沿局部 -Z 伸出；轉 90° 才會指向發射台
  tower.rotation.y = Math.PI / 2
  pad.add(tower)
  chopsticks.set(0)

  const farm = buildTankFarm()
  farm.position.set(R * 7.6, 0, R * 1.2)
  pad.add(farm)

  // 塔頂的避雷針，讓輪廓有個收尾
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 0.07, R * 0.13, towerH * 0.12, 8),
    steelMaterial({ color: 0x8d949d, repeat: [1, 0.1] }),
  )
  mast.position.set(R * 4.0, towerH * 1.06, 0)
  pad.add(mast)

  // 待機時的冰藍指示燈，呼應 --cryo 的「預備狀態」語意
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(R * 0.09, 8, 6),
      new THREE.MeshBasicMaterial({ color: HEX.cryo }),
    )
    lamp.position.set(Math.cos(a) * R * 9.2, R * 0.22, Math.sin(a) * R * 9.2)
    lamp.name = 'padLamp'
    pad.add(lamp)
  }

  return { group: pad, setChopsticks: (k) => chopsticks.set(k) }
}
