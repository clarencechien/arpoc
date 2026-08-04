/**
 * 把任務時間換成可以直接餵給場景圖的姿態。
 *
 * 這裡的「高度」是視覺高度（公尺，場景座標），不是遙測高度。
 * 真實 152 km 換算成 1:200 也有 760 公尺，AR 裡沒人看得到，
 * 所以用一條飽和曲線壓縮：低空接近線性、高空趨近上限，
 * 讓火箭停在使用者抬頭就看得到的錐形範圍內，再靠縮小暗示距離。
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

/** 視覺上升的上限（公尺）。抬頭看得到，又不會穿出天花板。 */
export const VIS_CEILING = 1.25
/** 飽和常數（km）。越大，低空爬升越像線性。 */
const VIS_K = 26

function visualAltitude(altKm: number): number {
  return VIS_CEILING * (1 - Math.exp(-altKm / VIS_K))
}

/**
 * 下靶場位移，用來配合重力轉彎的傾角。
 * 往 -Z（背向使用者放置時的正面）飛，載具才會越飛越遠而不是撲向鏡頭。
 */
function downrange(altKm: number): number {
  return -0.8 * (1 - Math.exp(-altKm / 42))
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

function smoothstep(a: number, b: number, x: number): number {
  return clamp01((x - a) / (b - a)) ** 2 * (3 - 2 * clamp01((x - a) / (b - a)))
}

function smootherstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

export interface EngineState {
  /** 0..1，環形圖點亮進度（點火時由內環往外依序） */
  ignitionProgress: number
  /** 分離後改用 Ship 的六具引擎佈局 */
  layout: 'booster33' | 'ship6'
  /** MECO 後只剩中央 3 具 */
  centerOnly: boolean
  /** 是否在燃燒（決定橘色出現與否） */
  burning: boolean
}

export interface FlightState {
  mission: number
  /** Booster 底部中心的世界位置（相對發射台原點） */
  booster: { y: number; z: number; pitch: number; visible: boolean }
  /** Ship 底部中心 */
  ship: { y: number; z: number; pitch: number; scale: number; opacity: number }
  /** 0..1 排氣強度 */
  boosterPlume: number
  shipPlume: number
  /** 落地點火 */
  landingPlume: number
  /** 0..1 地面塵埃環的擴張進度，-1 表示不顯示 */
  dust: number
  engines: EngineState
  /** 已經分離 */
  separated: boolean
}

/** Booster 在分離後的視覺高度：滑行 → 回推 → 下降 → 落地。 */
function boosterAltitude(mission: number): number {
  const sepAlt = visualAltitude(telemetryAt(T.hotStaging).altitude)
  if (mission <= T.hotStaging) return sepAlt
  // 分離後還被慣性推高一小段（真實剖面 booster 頂點在回推之後）
  const apogee = sepAlt * 1.06
  if (mission < T.boostbackEnd) {
    return sepAlt + (apogee - sepAlt) * smoothstep(T.hotStaging, T.boostbackEnd, mission)
  }
  // 下降：先慢後快，落地點火前再拉平
  const k = clamp01((mission - T.boostbackEnd) / (T.catch - T.boostbackEnd))
  const fall = k * k * (2.6 - 1.6 * k) // 起步慢、中段快、尾段收斂到 1
  return apogee * (1 - Math.min(1, fall))
}

export function flightStateAt(mission: number): FlightState {
  const tele = telemetryAt(mission)
  const separated = mission >= T.hotStaging

  const stackY = visualAltitude(tele.altitude)
  const stackZ = downrange(tele.altitude)
  // 重力轉彎：T+20 開始，到 MECO 前後約 38°。
  // 負角度＝朝 -Z 傾倒，與 downrange() 的方向一致。
  const pitch = smootherstep(18, T.meco, mission) * (-38 * Math.PI) / 180

  const bAlt = separated ? boosterAltitude(mission) : stackY
  const bZ = separated
    ? stackZ * (1 - smootherstep(T.boostbackStart, T.catch, mission))
    : stackZ
  // 回推：翻轉 180°（引擎朝前），落地前轉回垂直
  const flip = smootherstep(T.boostbackStart, T.boostbackStart + 22, mission)
  const upright = smootherstep(T.landingBurn - 8, T.catch, mission)
  const bPitch = pitch * (1 - upright) + Math.PI * flip * (1 - upright)

  const shipY = separated
    ? stackY + BOOSTER_HEIGHT * Math.cos(pitch) + 0.06 * (mission - T.hotStaging)
    : stackY + BOOSTER_HEIGHT * Math.cos(pitch)
  const shipZ = separated
    ? stackZ + BOOSTER_HEIGHT * Math.sin(pitch) - 0.05 * (mission - T.hotStaging)
    : stackZ + BOOSTER_HEIGHT * Math.sin(pitch)
  // 分離後縮小 + 淡出，暗示飛遠了（而不是憑空消失）
  const away = smootherstep(T.hotStaging, T.seco, mission)
  const shipScale = 1 - 0.62 * away
  const shipOpacity = mission > T.seco - 40 ? 1 - smootherstep(T.seco - 40, T.seco + 6, mission) * 0.85 : 1

  // 引擎狀態。
  // V3 的燃料輸送管改設計後 33 具是同時點火的，不再像 V1 那樣分批，
  // 所以這道由內往外的波只走 0.7 秒——保留環形圖的識別性，但不誤導成分批點火。
  const ignitionProgress = clamp01((mission - T.ignition) / 0.7)
  const boosterBurning = mission >= T.ignition && mission < T.meco
  const shipBurning = mission >= T.hotStaging && mission < T.seco
  const landingBurning = mission >= T.landingBurn && mission < T.catch
  const boostbackBurning = mission >= T.boostbackStart && mission < T.boostbackEnd

  let boosterPlume = 0
  if (mission >= T.ignition && mission < T.meco) {
    // 點火瞬間衝到滿，MECO 前 1.5 秒收掉
    boosterPlume = smoothstep(T.ignition, T.ignition + 1.6, mission)
    boosterPlume *= 1 - smoothstep(T.meco - 1.2, T.meco, mission)
  } else if (boostbackBurning) {
    boosterPlume = 0.55 * smoothstep(T.boostbackStart, T.boostbackStart + 1, mission)
    boosterPlume *= 1 - smoothstep(T.boostbackEnd - 1.5, T.boostbackEnd, mission)
  }

  const shipPlume = shipBurning
    ? smoothstep(T.hotStaging, T.hotStaging + 0.8, mission) *
      (1 - smoothstep(T.seco - 1.5, T.seco, mission))
    : 0

  const landingPlume = landingBurning
    ? smoothstep(T.landingBurn, T.landingBurn + 0.8, mission) *
      (1 - smoothstep(T.catch - 1.2, T.catch, mission))
    : 0

  // 點火前 0.5 秒的地面塵埃環（handoff §6：這個「前兆」讓升空有重量）
  const dustStart = T.ignition - 0.5
  const dust = mission >= dustStart && mission < dustStart + 4
    ? (mission - dustStart) / 4
    : -1

  return {
    mission,
    booster: { y: bAlt, z: bZ, pitch: bPitch, visible: mission < T.catch + 6 },
    ship: { y: shipY, z: shipZ, pitch: pitch * (1 - 0.55 * away), scale: shipScale, opacity: shipOpacity },
    boosterPlume,
    shipPlume,
    landingPlume,
    dust,
    engines: {
      ignitionProgress,
      layout: mission >= T.hotStaging ? 'ship6' : 'booster33',
      centerOnly: mission >= T.meco && mission < T.hotStaging,
      burning: boosterBurning || shipBurning || landingBurning || boostbackBurning,
    },
    separated,
  }
}
