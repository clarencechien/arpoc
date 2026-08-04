/**
 * 遙測曲線。
 *
 * 不做真實物理（handoff §5）：用預先擬合的曲線，對齊關鍵點：
 *   Max-Q  T+62   約 12 km / 1,400 km/h
 *   MECO   T+152  約 65 km / 5,800 km/h
 *   再入之後照 Flight 6 的 Ship 濺落剖面遞減回 0
 * 其餘節點是為了讓曲線形狀看起來合理而放的。
 */

import { T } from './timeline'

type Anchor = [t: number, v: number]

/** 高度 km */
const ALTITUDE: Anchor[] = [
  [-10, 0],
  [0, 0],
  [10, 0.35],
  [30, 3.0],
  [T.maxQ, 12.0],
  [100, 32.0],
  [T.meco, 65.0],
  [T.hotStaging, 68.0],
  [230, 92.0],
  [320, 122.0],
  [420, 143.0],
  [T.seco, 152.0],
  [900, 186.0],
  [2400, 190.0],
  [T.entry, 120.0],
  [3300, 62.0],
  [T.shipTransonic, 18.0],
  [3900, 4.2],
  [T.landingFlip, 0.7],
  [T.shipCatch, 0.0],
]

/** 速度 km/h（對地） */
const SPEED: Anchor[] = [
  [-10, 0],
  [0, 0],
  [10, 120],
  [30, 500],
  [T.maxQ, 1400],
  [100, 2900],
  [T.meco, 5800],
  [T.hotStaging, 5900],
  [230, 10500],
  [320, 16200],
  [420, 21800],
  [T.seco, 26600],
  [900, 26850],
  [2400, 26900],
  [T.entry, 26400],
  [3300, 8500],
  [T.shipTransonic, 1150],
  [3900, 420],
  [T.landingFlip, 290],
  [T.shipCatch, 0],
]

function smootherstep(x: number): number {
  const t = Math.min(1, Math.max(0, x))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/** 逐段 smootherstep 內插：節點間單調，接點一階連續。 */
function sample(anchors: Anchor[], t: number): number {
  if (t <= anchors[0][0]) return anchors[0][1]
  const last = anchors[anchors.length - 1]
  if (t >= last[0]) return last[1]
  for (let i = 0; i < anchors.length - 1; i++) {
    const [t0, v0] = anchors[i]
    const [t1, v1] = anchors[i + 1]
    if (t >= t0 && t <= t1) {
      return v0 + (v1 - v0) * smootherstep((t - t0) / (t1 - t0))
    }
  }
  return last[1]
}

export interface Telemetry {
  /** km */
  altitude: number
  /** km/h */
  speed: number
}

export function telemetryAt(mission: number): Telemetry {
  return {
    altitude: sample(ALTITUDE, mission),
    speed: sample(SPEED, mission),
  }
}

/** MECO 時的高度，供視覺高度映射與 Booster 下降曲線共用。 */
export const MECO_ALTITUDE = sample(ALTITUDE, T.meco)
