/**
 * 場景組裝與每幀更新。
 *
 * AR 與桌面模式共用同一份場景圖與時間軸（handoff §3），
 * 差別只在相機來源與 anchor 是不是被 hit-test 放到地板上。
 */

import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { buildRocket } from './rocket'
import { buildPad } from './pad'
import { makeDustRing, makePlume, makeSparks } from './effects'
import { createHudPanel, type HudPanel, type PanelState } from '../hud/panel'
import { BODY_RADIUS, BOOSTER_HEIGHT, type FlightState } from '../sim/flight'
import { HEX } from '../theme'

function contactShadowTexture(): THREE.Texture {
  const s = 128
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  grad.addColorStop(0, 'rgba(0,0,0,0.55)')
  grad.addColorStop(0.55, 'rgba(0,0,0,0.22)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, s, s)
  return new THREE.CanvasTexture(c)
}

export interface World {
  scene: THREE.Scene
  /** 整個發射場，AR 模式下會被移到 hit-test 命中的位置 */
  anchor: THREE.Group
  reticle: THREE.Mesh
  panel: HudPanel
  /** 待機時可點擊觸發發射的碰撞代理 */
  hitProxy: THREE.Object3D
  applyFlight(f: FlightState, dt: number, elapsed: number): void
  setPanelState(s: PanelState): void
  facePanel(camera: THREE.Camera): void
  setStandbyGlow(on: boolean): void
  reset(): void
  setEnvironment(renderer: THREE.WebGLRenderer): void
}

export function createWorld(): World {
  const scene = new THREE.Scene()

  const hemi = new THREE.HemisphereLight(0xdfe8f2, 0x2a2f36, 1.6)
  scene.add(hemi)
  const key = new THREE.DirectionalLight(0xffffff, 2.2)
  key.position.set(1.2, 2.4, 1.0)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0x9fb4cc, 0.7)
  fill.position.set(-1.5, 0.8, -1.2)
  scene.add(fill)

  const anchor = new THREE.Group()
  anchor.name = 'launchSite'
  anchor.visible = false
  scene.add(anchor)

  anchor.add(buildPad())

  const { booster, ship, hotStageRing, shipMaterials } = buildRocket()
  const padDeckY = BODY_RADIUS * 1.775 // 發射台桌面高度，火箭站在上面
  const stack = new THREE.Group()
  stack.position.y = padDeckY
  stack.add(booster, ship, hotStageRing)
  anchor.add(stack)

  // 接觸陰影：比 shadow map 便宜得多，AR 裡的作用就是把物件「黏」在地板上
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(BODY_RADIUS * 16, BODY_RADIUS * 16),
    new THREE.MeshBasicMaterial({
      map: contactShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
    }),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.001
  anchor.add(shadow)

  const boosterPlume = makePlume(0.85, 9)
  const shipPlume = makePlume(0.6, 5.5)
  const landingPlume = makePlume(0.5, 4)
  booster.add(boosterPlume.object)
  ship.add(shipPlume.object)
  booster.add(landingPlume.object)

  const dust = makeDustRing()
  anchor.add(dust.object)

  const sparks = makeSparks()
  anchor.add(sparks.object)

  // 面板放在塔架的對側偏前方：繞著載具走的時候它跟著留在原地
  const panel = createHudPanel()
  panel.object.position.set(-BODY_RADIUS * 9, 0, BODY_RADIUS * 4.5)
  anchor.add(panel.object)

  // 待機時點擊火箭即可發射（handoff §7 的測試入口）
  const hitProxy = new THREE.Mesh(
    new THREE.CylinderGeometry(BODY_RADIUS * 3, BODY_RADIUS * 3, 0.75, 8),
    new THREE.MeshBasicMaterial({ visible: false }),
  )
  hitProxy.position.y = 0.34
  anchor.add(hitProxy)

  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.055, 0.075, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: HEX.cryo, transparent: true, opacity: 0.9 }),
  )
  reticle.matrixAutoUpdate = false
  reticle.visible = false
  scene.add(reticle)

  const lamps = anchor.children.filter((c) => c.name === 'padLamp')
  const sparkOrigin = new THREE.Vector3()

  function applyFlight(f: FlightState, dt: number, elapsed: number): void {
    booster.visible = f.booster.visible
    booster.position.set(0, f.booster.y, f.booster.z)
    booster.rotation.x = f.booster.pitch

    ship.position.set(0, f.ship.y, f.ship.z)
    ship.rotation.x = f.ship.pitch
    ship.scale.setScalar(f.ship.scale)
    for (const m of shipMaterials) {
      const mm = m as THREE.MeshStandardMaterial
      if (f.ship.opacity < 0.999) {
        mm.transparent = true
        mm.opacity = f.ship.opacity
      } else if (mm.transparent && mm.opacity >= 0.999) {
        mm.transparent = false
      }
    }

    hotStageRing.position.set(0, f.hotStageRing.y, f.hotStageRing.z)
    hotStageRing.rotation.x = f.hotStageRing.attached ? f.booster.pitch : f.hotStageRing.spin
    hotStageRing.visible = f.hotStageRing.opacity > 0.02

    boosterPlume.setIntensity(f.boosterPlume)
    shipPlume.setIntensity(f.shipPlume)
    landingPlume.setIntensity(f.landingPlume)
    boosterPlume.update(elapsed)
    shipPlume.update(elapsed)
    landingPlume.update(elapsed)

    dust.setProgress(f.dust)

    // 火花只在貼近地面時才有意義
    const nearGround = f.booster.y < BODY_RADIUS * 6
    if (nearGround && (f.boosterPlume > 0.05 || f.landingPlume > 0.05)) {
      sparkOrigin.set(0, padDeckY + f.booster.y, f.booster.z)
      sparks.emit(sparkOrigin, Math.max(f.boosterPlume, f.landingPlume), dt)
    }
    sparks.update(dt)

    // 升空後接觸陰影淡出
    const lift = Math.min(1, f.booster.y / (BODY_RADIUS * 10))
    ;(shadow.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - lift) + 0.05

    for (const l of lamps) {
      const mat = (l as THREE.Mesh).material as THREE.MeshBasicMaterial
      mat.color.setHex(f.engines.burning ? HEX.plume : HEX.cryo)
    }
  }

  return {
    scene,
    anchor,
    reticle,
    panel,
    hitProxy,
    applyFlight,
    setPanelState: (s) => panel.update(s),
    facePanel: (c) => panel.face(c),
    setStandbyGlow(on: boolean) {
      for (const l of lamps) {
        const mat = (l as THREE.Mesh).material as THREE.MeshBasicMaterial
        mat.color.setHex(on ? HEX.cryo : HEX.dim)
      }
    },
    reset() {
      booster.visible = true
      booster.position.set(0, 0, 0)
      booster.rotation.set(0, 0, 0)
      ship.position.set(0, BOOSTER_HEIGHT, 0)
      ship.rotation.set(0, 0, 0)
      ship.scale.setScalar(1)
      hotStageRing.visible = true
      boosterPlume.setIntensity(0)
      shipPlume.setIntensity(0)
      landingPlume.setIntensity(0)
      dust.setProgress(-1)
      for (const m of shipMaterials) {
        const mm = m as THREE.MeshStandardMaterial
        mm.opacity = 1
        mm.transparent = false
      }
    },
    setEnvironment(renderer: THREE.WebGLRenderer) {
      // 不鏽鋼要有東西可以反射，否則 metalness 0.9 會變成一片死黑
      const pmrem = new THREE.PMREMGenerator(renderer)
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
      scene.environmentIntensity = 0.55
      pmrem.dispose()
    },
  }
}
