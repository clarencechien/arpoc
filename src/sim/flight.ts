/**
 * 把任務時間換成可以直接餵給場景圖的姿態。
 *
 * 座標約定：下靶場方向是 -X（塔架在 +X）。預設鏡頭在 +Z 看向原點，
 * 所以上升弧線在畫面上是往左「畫出一條曲線」，而不是朝縱深消失。
 *
 * 「高度」是視覺高度（公尺，場景座標），不是遙測高度。
 * 真實 152 km 換算 1:200 也有 760 公尺，用飽和曲線壓進約 1.45 m。
 *
 * 返場剖面（依真實飛行 + Flight 14 預定的 Ship 接塔）：
 *  - Booster 熱分離後**立刻**翻身（真實動作在分離後幾秒內完成），
 *    回推燃燒時引擎朝前；之後整段下降都是引擎朝下，「不會」到落地前才轉正
 *  - Booster 落地點火 → 筷子夾住（Flight 5/7/8 已多次實做）
 *  - Ship 繞行後再入：腹部朝下滑降 → 落地翻轉 → 落地點火 → 筷子夾住
 *    （真實尚未實施；Flight 13 已完成垂直濺落驗證，Flight 14 預定首次接塔）
 */

import { T } from './timeline'
import { telemetryAt } from './telemetry'

/** 完整堆疊高度（公尺）：Starship V3 的 124.4 m，1:200。 */
export const STACK_HEIGHT = 0.622
/** Super Heavy V3：72.3 m */
export const BOOSTER_HEIGHT = 0.3615
/** Ship V3：52.1 m */
export const SHIP_HEIGHT = STACK_HEIGHT - BOOSTER_HEIGHT
/** 直徑 9 m */
export const BODY_RADIUS = 0.0225

/** 視覺上升的上限（公尺）。 */
export const VIS_CEILING = 1.45
const VIS_K = 26

/** 筷子接點的世界座標（相對發射台原點）。塔在 +X。 */
export const CATCH_X = BODY_RADIUS * 2.55
/** Booster 懸掛時底部離地高度（吊點在格柵翼下方） */
export const BOOSTER_HANG_Y = 0.2
/** Ship 懸掛時底部離地高度（吊點在前襟翼下方） */
export const SHIP_HANG_Y = 0.3

/** 隔熱瓦迎風面的方位角（rocket.ts 的 WINDWARD_CENTER），腹部朝下時要用。 */
export const WINDWARD_AZIMUTH = 1.85

function visualAltitude(altKm: number): number {
  return VIS_CEILING * (1 - Math.exp(-altKm / VIS_K))
}

/** 下靶場位移：往 -X 畫出弧線。 */
function ascentX(altKm: number): number {
  return -1.05 * (1 - Math.exp(-altKm / 40))
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

function smootherstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k
}

export interface EngineState {
  /** 0..1，環形圖點亮比例（由內環往外數） */
  ignitionProgress: number
  layout: 'booster33' | 'ship6'
  /** 只剩中央 3 具 */
  centerOnly: boolean
  burning: boolean
}

export interface FlightState {
  mission: number
  /** Booster 底部中心（相對發射台原點）。tilt 是繞 Z 的傾角，正值＝鼻朝 -X。 */
  booster: { x: number; y: number; tilt: number; visible: boolean; opacity: number }
  /**
   * Ship 底部中心。姿態分解為：
   *  tilt   繞 Z 的上升傾角（與 Booster 同義）
   *  belly  0=直立，π/2=腹部朝下水平滑降
   *  heading belly 滑降時鼻的朝向（繞 Y）
   *  roll   讓隔熱瓦面在 belly 時轉到朝下（繞自身軸）
   */
  ship: {
    x: number
    y: number
    tilt: number
    belly: number
    heading: number
    roll: number
    scale: number
    opacity: number
  }
  boosterPlume: number
  shipPlume: number
  /** Booster 落地點火（獨立小噴焰） */
  landingPlume: number
  /** 再入電漿光暈 0..1 */
  entryGlow: number
  /** 0..1 地面塵埃環的擴張進度，-1 表示不顯示 */
  dust: number
  /** 筷子閉合程度 0=張開 1=夾住 */
  chopsticks: number
  engines: EngineState
  separated: boolean
}

/** Booster 分離後的視覺高度：慣性上衝 → 下降 → 落地點火收斂到懸掛高度。 */
function boosterAltitude(mission: number): number {
  const sepAlt = visualAltitude(telemetryAt(T.hotStaging).altitude)
  if (mission <= T.hotStaging) return sepAlt
  const apogee = sepAlt * 1.06
  if (mission < T.boostbackEnd) {
    return lerp(sepAlt, apogee, smoothstep(T.hotStaging, T.boostbackEnd, mission))
  }
  const k = clamp01((mission - T.boostbackEnd) / (T.catch - T.boostbackEnd))
  const fall = Math.min(1, k * k * (2.6 - 1.6 * k))
  return lerp(apogee, BOOSTER_HANG_Y, fall)
}

/**
 * Booster 傾角時序（重點修正）：
 * 翻身在分離後 1 秒開始、約 12 秒完成（落在 1× 實時窗內，看得到），
 * 回推結束後很快轉回垂直，之後整段下降都維持引擎朝下。
 */
function boosterTilt(mission: number, ascentTilt: number): number {
  if (mission < T.hotStaging + 1) return ascentTilt
  // 翻身：鼻從 -X 側翻過頭頂到 +X 側（引擎朝前準備回推）
  const flip = smootherstep(T.hotStaging + 1, T.hotStaging + 13, mission)
  // 回推結束後轉回垂直：T+230 前完成，絕不拖到落地
  const settle = smootherstep(T.boostbackEnd - 10, 230, mission)
  const boostbackTilt = -1.55 // 約 -89°，鼻朝 +X 水平
  return lerp(lerp(ascentTilt, boostbackTilt, flip), 0, settle)
}

export function flightStateAt(mission: number): FlightState {
  const tele = telemetryAt(mission)
  const separated = mission >= T.hotStaging

  const stackY = visualAltitude(tele.altitude)
  const stackX = ascentX(tele.altitude)
  // 重力轉彎：T+15 開始，到 MECO 約 40°
  const ascentTilt = smootherstep(15, T.meco, mission) * (40 * Math.PI) / 180

  // ── Booster ────────────────────────────────────────────
  const bY = separated ? boosterAltitude(mission) : stackY
  const sepX = ascentX(telemetryAt(T.hotStaging).altitude)
  const bX = separated
    ? lerp(sepX, CATCH_X, smootherstep(T.boostbackStart + 6, T.landingBurn + 10, mission))
    : stackX
  const bTilt = separated ? boosterTilt(mission, ascentTilt) : ascentTilt
  // 接塔後懸掛一段時間，再入畫面前淡出（真實流程：吊離運回，這裡用淡出表達）
  const bOpacity = 1 - smoothstep(700, 1100, mission)
  const bVisible = mission < 1100

  // ── Ship ───────────────────────────────────────────────
  let sX: number
  let sY: number
  let sTilt = 0
  let sBelly = 0
  let sHeading = 0
  let sRoll = 0
  let sScale = 1
  let sOpacity = 1

  if (!separated) {
    sX = stackX + BOOSTER_HEIGHT * Math.sin(-ascentTilt)
    sY = stackY + BOOSTER_HEIGHT * Math.cos(ascentTilt)
    sTilt = ascentTilt
  } else if (mission < T.seco + 60) {
    // 分離後繼續爬升、縮小、淡出（飛遠了）
    const away = smootherstep(T.hotStaging, T.seco, mission)
    sX = sepX - 0.35 * away
    sY = lerp(visualAltitude(telemetryAt(T.hotStaging).altitude) + BOOSTER_HEIGHT, VIS_CEILING, away)
    sTilt = ascentTilt * (1 - away)
    sScale = 1 - 0.62 * away
    sOpacity = 1 - smoothstep(T.seco - 60, T.seco + 50, mission)
  } else if (mission < T.entry - 60) {
    // 軌道滑行：不在畫面裡
    sX = -1.3
    sY = VIS_CEILING
    sOpacity = 0
  } else {
    // 再入返場：從高處腹部朝下滑降，翻轉，落地點火，接塔
    const appear = smoothstep(T.entry - 40, T.entry + 30, mission)
    sOpacity = appear
    sScale = lerp(0.45, 1, smootherstep(T.entry, T.shipTransonic, mission))

    const descend = smootherstep(T.entry - 20, T.landingFlip, mission)
    sY = lerp(VIS_CEILING, 0.52, descend)
    sX = lerp(-1.25, CATCH_X - 0.12, smootherstep(T.entry, T.landingFlip, mission))

    // 腹部朝下滑降：belly=π/2、隔熱瓦轉到朝下、鼻朝行進方向（+X）
    const bellyIn = smoothstep(T.entry - 20, T.entry + 40, mission)
    // 落地翻轉：約 4 個任務秒完成（真實約 2–5 秒），是整段的視覺高潮
    const flip = smootherstep(T.landingFlip, T.landingFlip + 4, mission)
    sBelly = (Math.PI / 2) * bellyIn * (1 - flip)
    sHeading = (Math.PI / 2) * bellyIn * (1 - flip)
    sRoll = -WINDWARD_AZIMUTH * bellyIn * (1 - flip)

    // 翻轉後的最終垂直下降到懸掛高度
    const settle = smootherstep(T.landingFlip + 2, T.shipCatch, mission)
    sY = lerp(sY, SHIP_HANG_Y, settle)
    sX = lerp(sX, CATCH_X, settle)
  }

  // ── 引擎與噴焰 ─────────────────────────────────────────
  const boosterAscentBurn = mission >= T.ignition && mission < T.meco
  const boostbackBurn = mission >= T.boostbackStart && mission < T.boostbackEnd
  const boosterLandingBurn = mission >= T.landingBurn && mission < T.catch
  const shipAscentBurn = mission >= T.hotStaging && mission < T.seco
  const shipLandingBurn = mission >= T.landingFlip + 1 && mission < T.shipCatch

  let boosterPlume = 0
  if (boosterAscentBurn) {
    boosterPlume =
      smoothstep(T.ignition, T.ignition + 1.6, mission) *
      (1 - smoothstep(T.meco - 1.2, T.meco, mission))
  } else if (boostbackBurn) {
    boosterPlume =
      0.6 * smoothstep(T.boostbackStart, T.boostbackStart + 1, mission) *
      (1 - smoothstep(T.boostbackEnd - 1.5, T.boostbackEnd, mission))
  }

  let shipPlume = 0
  if (shipAscentBurn) {
    shipPlume =
      smoothstep(T.hotStaging, T.hotStaging + 0.8, mission) *
      (1 - smoothstep(T.seco - 1.5, T.seco, mission))
  } else if (shipLandingBurn) {
    shipPlume =
      0.7 * smoothstep(T.landingFlip + 1, T.landingFlip + 2.5, mission) *
      (1 - smoothstep(T.shipCatch - 1.5, T.shipCatch, mission))
  }

  const landingPlume = boosterLandingBurn
    ? 0.8 *
      smoothstep(T.landingBurn, T.landingBurn + 0.8, mission) *
      (1 - smoothstep(T.catch - 1, T.catch, mission))
    : 0

  const entryGlow =
    smoothstep(T.entry - 15, T.entry + 25, mission) *
    (1 - smoothstep(T.entry + 200, T.shipTransonic, mission))

  const dustStart = T.ignition - 0.5
  const dust =
    mission >= dustStart && mission < dustStart + 4 ? (mission - dustStart) / 4 : -1

  // ── 筷子 ───────────────────────────────────────────────
  // Booster 接塔時閉合，吊離後張開，Ship 接塔時再閉合
  const chopsticks =
    smoothstep(T.catch - 3, T.catch, mission) * (1 - smoothstep(900, 1100, mission)) +
    smoothstep(T.shipCatch - 3, T.shipCatch, mission)

  // ── 環形圖 ─────────────────────────────────────────────
  // 焦點跟著「正在做事的載具」：Booster 返場期間顯示 booster33，
  // 接塔後切到 ship6（此時 Ship 還在燒到 SECO），落地點火 3/6。
  const boosterFocus = mission < T.catch + 20
  let ignitionProgress = 0
  let centerOnly = false
  let burning = false
  if (boosterFocus) {
    if (boosterAscentBurn) {
      // V3 是同時點火（新燃料輸送管），波只走 0.7 秒保留視覺效果
      ignitionProgress = clamp01((mission - T.ignition) / 0.7)
      burning = true
      centerOnly = mission >= T.meco
    } else if (mission >= T.meco && mission < T.hotStaging) {
      centerOnly = true
      burning = true
      ignitionProgress = 1
    } else if (boostbackBurn) {
      ignitionProgress = 13 / 33
      burning = true
    } else if (boosterLandingBurn) {
      burning = true
      if (mission > T.catch - 2.5) {
        centerOnly = true
        ignitionProgress = 1
      } else {
        ignitionProgress = 13 / 33
      }
    }
  } else {
    if (shipAscentBurn) {
      ignitionProgress = 1
      burning = true
    } else if (shipLandingBurn) {
      ignitionProgress = 0.5
      burning = true
    }
  }

  return {
    mission,
    booster: { x: bX, y: bY, tilt: bTilt, visible: bVisible, opacity: bOpacity },
    ship: {
      x: sX,
      y: sY,
      tilt: sTilt,
      belly: sBelly,
      heading: sHeading,
      roll: sRoll,
      scale: sScale,
      opacity: sOpacity,
    },
    boosterPlume,
    shipPlume,
    landingPlume,
    entryGlow,
    dust,
    chopsticks: Math.min(1, chopsticks),
    engines: {
      ignitionProgress,
      layout: boosterFocus ? 'booster33' : 'ship6',
      centerOnly,
      burning,
    },
    separated,
  }
}
