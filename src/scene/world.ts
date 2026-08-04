/**
 * 場景組裝與每幀更新。
 *
 * AR 與桌面模式共用同一份場景圖與時間軸（handoff §3），
 * 差別只在相機來源與 anchor 是不是被 hit-test 放到地板上。
 */

import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { XREstimatedLight } from 'three/examples/jsm/webxr/XREstimatedLight.js'
import { buildRocket } from './rocket'
import { buildPad } from './pad'
import { makeDustRing, makePlume, makeSparks } from './effects'
import { createHudPanel, type HudPanel, type PanelState } from '../hud/panel'
import { BODY_RADIUS, BOOSTER_HEIGHT, SHIP_HEIGHT, type FlightState } from '../sim/flight'
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
  /** 必須在任何 XR session 開始之前呼叫；裝置支援的話改用現場光照 */
  enableLightEstimation(renderer: THREE.WebGLRenderer): void
}

export function createWorld(): World {
  const scene = new THREE.Scene()

  // 棚拍光。AR 模式下如果裝置支援 light-estimation，這一組會被現場光照取代。
  const studioLights = new THREE.Group()
  const hemi = new THREE.HemisphereLight(0xdfe8f2, 0x2a2f36, 1.6)
  const key = new THREE.DirectionalLight(0xffffff, 2.2)
  key.position.set(1.2, 2.4, 1.0)
  const fill = new THREE.DirectionalLight(0x9fb4cc, 0.7)
  fill.position.set(-1.5, 0.8, -1.2)
  studioLights.add(hemi, key, fill)
  scene.add(studioLights)

  const anchor = new THREE.Group()
  anchor.name = 'launchSite'
  anchor.visible = false
  scene.add(anchor)

  const pad = buildPad()
  anchor.add(pad.group)

  const { booster, ship, shipMaterials, boosterMaterials } = buildRocket()
  const padDeckY = BODY_RADIUS * 1.775 // 發射台桌面高度，火箭站在上面
  const stack = new THREE.Group()
  stack.position.y = padDeckY
  stack.add(booster, ship)
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

  const boosterPlume = makePlume(1.25, 15)
  const shipPlume = makePlume(0.8, 8)
  const landingPlume = makePlume(0.7, 5.5)
  booster.add(boosterPlume.object)
  ship.add(shipPlume.object)
  booster.add(landingPlume.object)

  const dust = makeDustRing()
  anchor.add(dust.object)

  const sparks = makeSparks()
  anchor.add(sparks.object)

  // 再入電漿光暈：包著 Ship 的拉長橢球，additive、不寫深度
  const entryGlow = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({
      color: 0xff8a3d,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
    }),
  )
  entryGlow.scale.set(BODY_RADIUS * 2.6, SHIP_HEIGHT * 0.72, BODY_RADIUS * 2.6)
  entryGlow.position.y = SHIP_HEIGHT / 2
  entryGlow.visible = false
  ship.add(entryGlow)

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

  const lamps: THREE.Mesh[] = []
  anchor.traverse((o) => {
    if (o.name === 'padLamp') lamps.push(o as THREE.Mesh)
  })
  const sparkOrigin = new THREE.Vector3()

  const qHeading = new THREE.Quaternion()
  const qBelly = new THREE.Quaternion()
  const qRoll = new THREE.Quaternion()
  const qTilt = new THREE.Quaternion()
  const X_AXIS = new THREE.Vector3(1, 0, 0)
  const Y_AXIS = new THREE.Vector3(0, 1, 0)
  const Z_AXIS = new THREE.Vector3(0, 0, 1)

  function fadeMaterials(list: THREE.Material[], opacity: number): void {
    for (const m of list) {
      const mm = m as THREE.MeshStandardMaterial
      if (opacity < 0.999) {
        mm.transparent = true
        mm.opacity = opacity
      } else if (mm.transparent && mm.opacity >= 0.999) {
        mm.transparent = false
        mm.opacity = 1
      }
    }
  }

  function applyFlight(f: FlightState, dt: number, elapsed: number): void {
    booster.visible = f.booster.visible && f.booster.opacity > 0.01
    booster.position.set(f.booster.x, f.booster.y, 0)
    booster.rotation.set(0, 0, f.booster.tilt)
    fadeMaterials(boosterMaterials, f.booster.opacity)

    ship.visible = f.ship.opacity > 0.01
    ship.position.set(f.ship.x, f.ship.y, 0)
    // 姿態合成：heading（繞世界 Y）→ belly（壓平）→ roll（瓦面轉朝下）→ tilt（上升弧）
    qHeading.setFromAxisAngle(Y_AXIS, f.ship.heading)
    qBelly.setFromAxisAngle(X_AXIS, f.ship.belly)
    qRoll.setFromAxisAngle(Y_AXIS, f.ship.roll)
    qTilt.setFromAxisAngle(Z_AXIS, f.ship.tilt)
    ship.quaternion.copy(qHeading).multiply(qBelly).multiply(qRoll).multiply(qTilt)
    ship.scale.setScalar(f.ship.scale)
    fadeMaterials(shipMaterials, f.ship.opacity)

    const glowMat = entryGlow.material as THREE.MeshBasicMaterial
    glowMat.opacity = f.entryGlow * 0.55
    entryGlow.visible = f.entryGlow > 0.02

    pad.setChopsticks(f.chopsticks)

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
      sparkOrigin.set(f.booster.x, padDeckY + f.booster.y, 0)
      sparks.emit(sparkOrigin, Math.max(f.boosterPlume, f.landingPlume), dt)
    }
    sparks.update(dt)

    // 升空後接觸陰影淡出
    const lift = Math.min(1, f.booster.y / (BODY_RADIUS * 10))
    ;(shadow.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - lift) + 0.05

    for (const l of lamps) {
      ;(l.material as THREE.MeshBasicMaterial).color.setHex(
        f.engines.burning ? HEX.plume : HEX.cryo,
      )
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
        ;(l.material as THREE.MeshBasicMaterial).color.setHex(on ? HEX.cryo : HEX.dim)
      }
    },
    reset() {
      booster.visible = true
      booster.position.set(0, 0, 0)
      booster.rotation.set(0, 0, 0)
      ship.visible = true
      ship.position.set(0, BOOSTER_HEIGHT, 0)
      ship.quaternion.identity()
      ship.scale.setScalar(1)
      pad.setChopsticks(0)
      ;(entryGlow.material as THREE.MeshBasicMaterial).opacity = 0
      entryGlow.visible = false
      fadeMaterials(boosterMaterials, 1)
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
    /**
     * WebXR light estimation。
     *
     * AR 裡最容易「看起來是貼上去的」的原因不是模型不夠細，是光對不上：
     * 房間是暖色頂光，物件卻頂著一組棚拍白光。裝置支援的話直接換成
     * 現場估計出來的方向光 + 反射環境貼圖，不鏽鋼會反射真實房間。
     * 不支援就維持棚拍光，不影響其他功能。
     */
    enableLightEstimation(renderer: THREE.WebGLRenderer) {
      // three 的 XREstimatedLight 內部沒有對 requestLightProbe() 掛 catch。
      // 裝置沒授予 light-estimation 時它會 reject，功能上無害但會噴一則
      // unhandled rejection，這裡精準地吞掉那一種。
      window.addEventListener('unhandledrejection', (e) => {
        const reason = e.reason as { name?: string } | undefined
        if (reason?.name === 'NotSupportedError') e.preventDefault()
      })

      const xrLight = new XREstimatedLight(renderer, true)
      let studioEnv: THREE.Texture | null = null
      xrLight.addEventListener('estimationstart', () => {
        scene.add(xrLight)
        studioLights.visible = false
        if (xrLight.environment) {
          studioEnv = scene.environment
          scene.environment = xrLight.environment
          scene.environmentIntensity = 1
        }
      })
      xrLight.addEventListener('estimationend', () => {
        scene.remove(xrLight)
        studioLights.visible = true
        if (studioEnv) {
          scene.environment = studioEnv
          scene.environmentIntensity = 0.55
          studioEnv = null
        }
      })
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
