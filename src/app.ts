/**
 * 應用主體：狀態機、播放、排程、輸入。
 *
 * 狀態：
 *   idle    尚未進入任一模式
 *   placing 只有 AR 會經過：等 hit-test 命中並放置發射台
 *   standby 火箭靜置，HUD 顯示現在時刻與距下次發射的倒數
 *   playing 播放發射序列
 *   hold    SECO 後定格顯示整點，3 秒後回到 standby
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createWorld, type World } from './scene/world'
import {
  BOOSTER_HEIGHT,
  STACK_HEIGHT,
  VIS_CEILING,
  flightStateAt,
  type FlightState,
} from './sim/flight'
import { telemetryAt } from './sim/telemetry'
import {
  HOLD_SECONDS,
  MISSION_END,
  MISSION_START,
  PLAY_DURATION,
  currentRate,
  eventAt,
  eventsBetween,
  formatMissionTime,
  playToMission,
  T,
} from './sim/timeline'
import { HourlyScheduler, formatClock, formatCountdown } from './sim/scheduler'
import { Audio } from './audio/audio'
import { ArSession, detectCapabilities, type Capabilities } from './ar/session'
import type { PanelState } from './hud/panel'

type Mode = 'ar' | 'desktop'
type State = 'idle' | 'placing' | 'standby' | 'playing' | 'hold'

const SCRUB_STEPS = 1000

/** prefers-reduced-motion：降級為靜態顯示 + 事件標籤切換，不做飛行動畫。 */
function staticFlight(mission: number): FlightState {
  const f = flightStateAt(mission)
  return {
    ...f,
    booster: { x: 0, y: 0, tilt: 0, visible: true, opacity: 1 },
    ship: {
      x: 0,
      y: BOOSTER_HEIGHT,
      tilt: 0,
      belly: 0,
      heading: 0,
      roll: 0,
      scale: 1,
      opacity: 1,
    },
    boosterPlume: 0,
    shipPlume: 0,
    landingPlume: 0,
    entryGlow: 0,
    dust: -1,
    chopsticks: 0,
    engines: {
      ...f.engines,
      // 環形圖仍然切換狀態（那是資訊），但不做依序點亮的動畫
      ignitionProgress: f.engines.ignitionProgress > 0 ? 1 : 0,
    },
  }
}

export class App {
  private readonly renderer: THREE.WebGLRenderer
  private readonly camera: THREE.PerspectiveCamera
  private readonly world: World
  private readonly audio = new Audio()
  private readonly ar: ArSession
  private controls: OrbitControls | null = null
  private scheduler: HourlyScheduler | null = null

  private state: State = 'idle'
  private placed = false

  private playT = 0
  private prevMission = MISSION_START
  private paused = false
  private holdUntil = 0
  private launchHour = new Date()
  private lastFrameMs = 0
  private lastPanelDraw = 0

  private readonly reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()
  private readonly camOffset = new THREE.Vector3()
  private readonly ui: UiRefs

  constructor(canvas: HTMLCanvasElement, ui: UiRefs) {
    this.ui = ui
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1

    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.01, 40)
    this.camera.position.set(0.32, 0.52, 1.42)

    this.world = createWorld()
    this.world.setEnvironment(this.renderer)
    // 必須在任何 XR session 之前接上：XREstimatedLight 是靠 renderer.xr 的
    // 'sessionstart' 事件啟動的，session 開了以後才建構就永遠不會觸發
    this.world.enableLightEstimation(this.renderer)

    this.ar = new ArSession(this.renderer, {
      onReticle: (m) => this.onReticle(m),
      onSelect: () => this.onSelect(),
      onEnd: () => this.leave(),
    })

    window.addEventListener('resize', this.onResize)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    this.renderer.setAnimationLoop(this.frame)
    this.world.panel.setOpacity(1)
  }

  // ── 進入／離開 ────────────────────────────────────────

  /** 必須從使用者手勢直接呼叫：AudioContext 只有在手勢裡 resume 才會啟動。 */
  async enter(mode: Mode): Promise<void> {
    this.audio.unlock()
    this.ui.start.classList.add('hidden')
    this.ui.hud.classList.remove('hidden')

    if (mode === 'ar') {
      this.state = 'placing'
      this.placed = false
      this.world.anchor.visible = false
      this.setStatus('緩慢移動手機掃描地板…', 'idle')
      try {
        await this.ar.start(this.ui.overlay)
      } catch (err) {
        this.setStatus(`無法啟動 AR：${(err as Error).message}。已切換到桌面模式。`, 'idle')
        this.enterDesktopScene()
      }
    } else {
      this.enterDesktopScene()
    }
    this.startScheduler(this.ui.fastClock.checked)
  }

  private enterDesktopScene(): void {
    this.placed = true
    this.world.anchor.visible = true
    this.world.anchor.position.set(0, 0, 0)
    if (!this.controls) {
      const c = new OrbitControls(this.camera, this.renderer.domElement)
      c.enableDamping = true
      c.dampingFactor = 0.08
      c.minDistance = 0.35
      c.maxDistance = 6
      c.maxPolarAngle = Math.PI * 0.52
      c.target.set(-0.09, STACK_HEIGHT * 0.43, 0.02)
      this.controls = c
    }
    this.controls.enabled = true
    this.toStandby()
    this.setStatus('待機中。點擊火箭即可手動發射。', 'idle')
  }

  private leave(): void {
    this.scheduler?.stop()
    this.scheduler = null
    this.state = 'idle'
    this.placed = false
    this.world.anchor.visible = false
    this.world.reticle.visible = false
    this.audio.setRumble(0)
    if (this.controls) this.controls.enabled = false
    this.ui.hud.classList.add('hidden')
    this.ui.start.classList.remove('hidden')
  }

  exit(): void {
    if (this.ar.active) void this.ar.end()
    else this.leave()
  }

  // ── 排程 ──────────────────────────────────────────────

  startScheduler(fast: boolean): void {
    this.scheduler?.stop()
    this.scheduler = new HourlyScheduler({
      intervalMs: fast ? 60_000 : undefined,
      onFire: (mark) => {
        if (this.state === 'standby') this.launch(mark)
      },
      onSkip: (mark, lateMs) => {
        // 遲到太久就跳過，不補放（handoff §7）
        this.setStatus(
          `已跳過 ${formatClock(mark)} 的報時（遲到 ${Math.round(lateMs / 1000)} 秒）`,
          'idle',
        )
      },
    })
    this.scheduler.start()
  }

  // ── 播放控制 ─────────────────────────────────────────

  launch(hourMark: Date = new Date()): void {
    if (!this.placed) return
    this.launchHour = hourMark
    this.playT = 0
    this.prevMission = MISSION_START
    this.paused = false
    this.state = 'playing'
    this.world.reset()
    this.audio.beep(660, 0.12, 0.14)
  }

  abort(): void {
    if (this.state !== 'playing' && this.state !== 'hold') return
    this.audio.setRumble(0)
    this.world.reset()
    this.toStandby()
    this.setStatus('已中止。回到待機。', 'idle')
  }

  private toStandby(): void {
    this.state = 'standby'
    this.paused = false
    this.playT = 0
    this.prevMission = MISSION_START
    this.world.reset()
    this.world.applyFlight(staticFlight(MISSION_START), 0, 0)
    this.world.setStandbyGlow(true)
    this.ui.scrub.value = '0'
  }

  /** 時間軸拖曳：直接跳到指定播放時間並暫停。 */
  scrubTo(fraction: number): void {
    if (!this.placed) return
    if (this.state === 'standby' || this.state === 'hold') {
      this.state = 'playing'
      this.launchHour = new Date()
      this.world.reset()
    }
    this.paused = true
    this.playT = fraction * PLAY_DURATION
    const mission = playToMission(this.playT)
    this.prevMission = mission // 拖曳不觸發事件音
    this.ui.scrubValue.textContent = formatMissionTime(mission)
    this.setStatus(eventAt(mission).label, mission >= T.ignition && mission < T.seco ? 'burn' : 'idle')
  }

  resume(): void {
    if (this.state === 'playing') this.paused = false
  }

  /** 回傳切換後「音效是否開啟」。 */
  toggleMute(): boolean {
    const enabled = this.audio.muted
    this.audio.setEnabled(enabled)
    return enabled
  }

  setSoundEnabled(on: boolean): void {
    this.audio.setEnabled(on)
  }

  // ── 輸入 ──────────────────────────────────────────────

  private onReticle(matrix: THREE.Matrix4 | null): void {
    if (this.placed) {
      this.world.reticle.visible = false
      return
    }
    if (!matrix) {
      this.world.reticle.visible = false
      return
    }
    this.world.reticle.visible = true
    this.world.reticle.matrix.copy(matrix)
  }

  private onSelect(): void {
    if (!this.placed) {
      if (!this.world.reticle.visible) return
      this.world.anchor.position.setFromMatrixPosition(this.world.reticle.matrix)
      // 讓發射台正面朝向使用者當下的位置
      const cam = this.activeCamera()
      const camPos = new THREE.Vector3()
      cam.getWorldPosition(camPos)
      this.world.anchor.rotation.y = Math.atan2(
        camPos.x - this.world.anchor.position.x,
        camPos.z - this.world.anchor.position.z,
      )
      this.world.anchor.visible = true
      this.world.reticle.visible = false
      this.placed = true
      this.toStandby()
      this.setStatus('待機中。點擊火箭即可手動發射。', 'idle')
      return
    }
    if (this.state !== 'standby') return
    // 視線中心朝前打一條射線，命中火箭才發射
    const cam = this.activeCamera()
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), cam)
    if (this.raycaster.intersectObject(this.world.hitProxy, true).length > 0) this.launch()
  }

  private onPointerDown = (ev: PointerEvent): void => {
    if (this.ar.active || this.state !== 'standby') return
    this.pointer.set(
      (ev.clientX / window.innerWidth) * 2 - 1,
      -(ev.clientY / window.innerHeight) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.pointer, this.camera)
    if (this.raycaster.intersectObject(this.world.hitProxy, true).length > 0) this.launch()
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  private activeCamera(): THREE.Camera {
    return this.renderer.xr.isPresenting ? this.renderer.xr.getCamera() : this.camera
  }

  // ── 主迴圈 ────────────────────────────────────────────

  private frame = (timeMs: number, xrFrame?: XRFrame): void => {
    const dt = this.lastFrameMs ? Math.min(0.1, (timeMs - this.lastFrameMs) / 1000) : 0
    this.lastFrameMs = timeMs
    const elapsed = timeMs / 1000

    if (this.ar.active) this.ar.updateHitTest(xrFrame ?? null)
    this.controls?.update()

    if (this.state === 'playing') this.advance(dt)
    else if (this.state === 'hold' && timeMs >= this.holdUntil) {
      this.toStandby()
      this.setStatus('待機中。點擊火箭即可手動發射。', 'idle')
    }

    if (this.placed) {
      const mission = this.currentMission()
      const flight = this.reduceMotion ? staticFlight(mission) : flightStateAt(mission)
      this.world.applyFlight(flight, dt, elapsed)
      this.frameVehicle(flight, dt)
      this.audio.setRumble(
        Math.max(flight.boosterPlume, flight.shipPlume * 0.55, flight.landingPlume * 0.7),
      )
      if (timeMs - this.lastPanelDraw > 48) {
        this.lastPanelDraw = timeMs
        this.world.setPanelState(this.panelState(mission, flight))
      }
      this.world.facePanel(this.activeCamera())
    }

    this.renderer.render(this.world.scene, this.camera)
  }

  /**
   * 桌面模式的取景。
   *
   * AR 不做這件事——那裡是使用者自己抬頭。桌面模式沒有這個動作，
   * 火箭一升空就出畫，所以隨著高度把鏡頭往後拉、目標點往上抬，
   * 讓載具與錨定在發射台旁的遙測面板同時留在畫面裡。
   */
  private frameVehicle(flight: FlightState, dt: number): void {
    const c = this.controls
    if (!c || !c.enabled || this.renderer.xr.isPresenting) return
    // 主角依階段切換：上升＝堆疊、Booster 返場＝Booster、
    // 接塔後回到地面、Ship 再入＝Ship
    let subject: number
    if (flight.mission < T.boostbackStart) {
      subject = Math.max(flight.booster.y, flight.ship.y - BOOSTER_HEIGHT)
    } else if (flight.mission < T.catch + 40) {
      subject = flight.booster.y
    } else if (flight.mission < T.entry - 80) {
      subject = 0
    } else {
      subject = flight.ship.y
    }
    const climb = Math.min(1, subject / VIS_CEILING)
    const k = 1 - Math.exp(-dt * 1.6) // 與幀率無關的平滑

    c.target.y += (0.26 + 0.52 * climb - c.target.y) * k

    const dir = this.camOffset.subVectors(this.camera.position, c.target)
    const dist = dir.length()
    if (dist > 1e-4) {
      const want = 1.35 + 1.85 * climb
      this.camera.position.copy(c.target).addScaledVector(dir.divideScalar(dist), dist + (want - dist) * k)
    }
  }

  private currentMission(): number {
    if (this.state === 'playing') return playToMission(this.playT)
    if (this.state === 'hold') return MISSION_END
    return MISSION_START
  }

  private advance(dt: number): void {
    if (!this.paused) this.playT += dt
    const mission = playToMission(this.playT)

    for (const e of eventsBetween(this.prevMission, mission)) {
      if (e.chime) this.audio.beep(e.t === T.liftoff ? 523 : 784, 0.11, 0.14)
      this.setStatus(e.label, mission >= T.ignition && mission < T.seco ? 'burn' : 'idle')
    }
    // 倒數的每一秒各給一聲
    if (mission < 0) {
      const prevSec = Math.ceil(this.prevMission)
      const nowSec = Math.ceil(mission)
      if (nowSec > prevSec) this.audio.beep(1320, 0.05, 0.1)
    }
    this.prevMission = mission

    this.ui.scrub.value = String(Math.round((this.playT / PLAY_DURATION) * SCRUB_STEPS))
    this.ui.scrubValue.textContent = formatMissionTime(mission)

    if (this.playT >= PLAY_DURATION) {
      this.state = 'hold'
      this.holdUntil = performance.now() + HOLD_SECONDS * 1000
      this.audio.setRumble(0)
      this.audio.hourChime()
      this.setStatus(`${formatClock(this.launchHour)} 整`, 'idle')
    }
  }

  private panelState(mission: number, flight: FlightState): PanelState {
    const tele = telemetryAt(mission)
    const playing = this.state === 'playing'
    const holding = this.state === 'hold'
    const now = new Date()
    const hourLabel = holding || playing ? this.launchHour : now

    return {
      mission: `FLIGHT ${String(hourLabel.getHours()).padStart(2, '0')}`,
      missionTime: playing ? formatMissionTime(mission) : null,
      eventLabel: playing || holding ? eventAt(mission).label : 'STANDBY',
      altitudeKm: playing || holding ? tele.altitude : 0,
      speedKmh: playing || holding ? tele.speed : 0,
      engines: flight.engines,
      rate: playing && !this.paused ? currentRate(mission) : 1,
      standbyClock: playing || holding ? null : formatClock(now),
      standbyCountdown:
        playing || holding ? null : formatCountdown(this.scheduler?.msUntilNext(now.getTime()) ?? 0),
      holdTime: holding ? `${formatClock(this.launchHour)}` : null,
    }
  }

  private setStatus(text: string, kind: 'idle' | 'burn'): void {
    this.ui.status.textContent = text
    this.ui.status.dataset.state = kind
  }
}

export interface UiRefs {
  overlay: HTMLElement
  start: HTMLElement
  hud: HTMLElement
  status: HTMLElement
  scrub: HTMLInputElement
  scrubValue: HTMLElement
  fastClock: HTMLInputElement
}

export { detectCapabilities, SCRUB_STEPS }
export type { Capabilities }
