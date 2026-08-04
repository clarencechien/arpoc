/** 發射台與塔架。低面數，只是為了給火箭一個「站在地上」的依據。 */

import * as THREE from 'three'
import { BODY_RADIUS, STACK_HEIGHT } from '../sim/flight'
import { HEX } from '../theme'

const R = BODY_RADIUS

export function buildPad(): THREE.Group {
  const pad = new THREE.Group()
  pad.name = 'pad'

  const concrete = new THREE.MeshStandardMaterial({
    color: 0x3a3f45,
    metalness: 0.05,
    roughness: 0.95,
  })
  const structure = new THREE.MeshStandardMaterial({
    color: 0x585f68,
    metalness: 0.7,
    roughness: 0.5,
  })

  // 軌道發射台：環狀桌面 + 六支腿
  const table = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 2.4, R * 2.6, R * 0.55, 6, 1),
    structure,
  )
  table.position.y = R * 1.5
  pad.add(table)

  const vent = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 1.15, R * 1.15, R * 0.6, 20, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x111417, roughness: 1, side: THREE.DoubleSide }),
  )
  vent.position.y = R * 1.5
  pad.add(vent)

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 0.16, R * 0.2, R * 1.5, 6),
      structure,
    )
    leg.position.set(Math.cos(a) * R * 2.1, R * 0.75, Math.sin(a) * R * 2.1)
    pad.add(leg)
  }

  const apron = new THREE.Mesh(new THREE.CylinderGeometry(R * 5.5, R * 5.8, R * 0.14, 28), concrete)
  apron.position.y = R * 0.07
  apron.receiveShadow = true
  pad.add(apron)

  // 塔架（Mechazilla）：四根立柱 + 橫桁 + 兩支接塔臂
  const tower = new THREE.Group()
  const towerH = STACK_HEIGHT * 1.18
  const half = R * 0.9
  for (const [x, z] of [
    [-half, -half],
    [half, -half],
    [-half, half],
    [half, half],
  ]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(R * 0.16, towerH, R * 0.16), structure)
    col.position.set(x, towerH / 2, z)
    tower.add(col)
  }
  const braceGeo = new THREE.BoxGeometry(half * 2, R * 0.07, R * 0.07)
  const braces = new THREE.InstancedMesh(braceGeo, structure, 24)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3(1, 1, 1)
  let idx = 0
  for (let level = 1; level <= 12; level++) {
    const y = (level / 13) * towerH
    for (const rot of [0, Math.PI / 2]) {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot)
      m.compose(new THREE.Vector3(0, y, rot === 0 ? -half : 0), q, s)
      if (rot !== 0) m.setPosition(-half, y, 0)
      braces.setMatrixAt(idx++, m)
    }
  }
  braces.count = idx
  braces.instanceMatrix.needsUpdate = true
  tower.add(braces)

  for (const s2 of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(R * 2.6, R * 0.22, R * 0.34), structure)
    arm.position.set(s2 * R * 1.6, towerH * 0.72, 0)
    tower.add(arm)
  }

  tower.position.set(R * 3.6, 0, 0)
  pad.add(tower)

  // 待機時的冰藍指示燈，呼應 --cryo 的「預備狀態」語意
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(R * 0.08, 8, 6),
      new THREE.MeshBasicMaterial({ color: HEX.cryo }),
    )
    lamp.position.set(Math.cos(a) * R * 5.0, R * 0.18, Math.sin(a) * R * 5.0)
    lamp.name = 'padLamp'
    pad.add(lamp)
  }

  return pad
}
