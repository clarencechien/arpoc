/**
 * 任務時間軸。
 *
 * 兩種時間必須嚴格分開：
 *  - missionT（任務時間，秒）：HUD 上顯示的 T±，永遠是真實任務時間
 *  - playT（播放時間，秒）：牆上時鐘實際經過的秒數
 *
 * 兩者之間由一組變速區段（RATE_PLAN）連接，rate = 每一播放秒推進幾個任務秒。
 * 區段邊界用 log-rate 的 smoothstep 過渡，避免速率瞬間跳變。
 */

/** 事件標籤：取自 Starship Flight 6 公開任務時間軸（Max-Q 參照 Flight 8）。 */
export interface MissionEvent {
  /** 任務時間（秒） */
  t: number
  /** HUD 事件標籤 */
  label: string
  /** 是否為需要提示音的主要事件 */
  chime?: boolean
}

export const EVENTS: MissionEvent[] = [
  { t: -10, label: 'T-10', chime: true },
  { t: -3, label: 'IGNITION SEQUENCE', chime: false },
  { t: 0, label: 'LIFTOFF', chime: true },
  { t: 62, label: 'MAX-Q', chime: true },
  { t: 152, label: 'MECO', chime: true },
  { t: 159, label: 'HOT-STAGING', chime: true },
  { t: 164, label: 'BOOSTBACK STARTUP', chime: true },
  { t: 218, label: 'BOOSTBACK SHUTDOWN', chime: false },
  { t: 385, label: 'TRANSONIC', chime: false },
  { t: 394, label: 'LANDING BURN', chime: true },
  { t: 411, label: 'CATCH', chime: true },
  { t: 507, label: 'SECO', chime: true },
]

/** 常用時間點，讓其他模組不必用魔術數字。 */
export const T = {
  countdownStart: -10,
  ignition: -3,
  liftoff: 0,
  maxQ: 62,
  meco: 152,
  hotStaging: 159,
  boostbackStart: 164,
  boostbackEnd: 218,
  transonic: 385,
  landingBurn: 394,
  catch: 411,
  seco: 507,
} as const

export const MISSION_START = -10
export const MISSION_END = T.seco

/** SECO 之後 HUD 定格顯示整點的秒數。 */
export const HOLD_SECONDS = 3

interface RateSegment {
  t0: number
  t1: number
  /** 任務秒 / 播放秒 */
  rate: number
}

/**
 * 決策（handoff §5）：戲劇性的段落走 1.0× 實時，其餘壓縮。
 *
 * 註：handoff 表列的速率（T-10→T+70 全段 1.0×）本身就要 80 秒實時，
 * 與同一節宣稱的「總長約 45 秒」互相矛盾。這裡保留了它真正在意的兩段實時
 * ——倒數與熱分離——其餘再壓緊，總長約 50 秒。
 */
const RATE_PLAN: RateSegment[] = [
  { t0: -10, t1: 0, rate: 1.0 }, // 倒數，實時 10.0s
  { t0: 0, t1: 6, rate: 1.0 }, // 點火升空，實時 6.0s
  { t0: 6, t1: 55, rate: 16.0 }, // 爬升 3.1s
  { t0: 55, t1: 68, rate: 4.0 }, // Max-Q 前後放慢 3.3s
  { t0: 68, t1: 151, rate: 26.0 }, // 3.2s
  { t0: 151, t1: 169, rate: 1.0 }, // MECO / 熱分離 / 回推點火，實時 18.0s
  { t0: 169, t1: 380, rate: 60.0 }, // 回推關機、Booster 返場 3.5s
  { t0: 380, t1: 416, rate: 9.0 }, // 穿音速 → 落地點火 → 接塔 4.0s
  { t0: 416, t1: MISSION_END, rate: 60.0 }, // Ship 收尾至 SECO 1.5s
]

function smoothstep(x: number): number {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

/** 在區段邊界用幾何內插（log 空間）過渡速率。 */
function rateAt(t: number): number {
  const n = RATE_PLAN.length
  let i = 0
  for (; i < n; i++) {
    if (t < RATE_PLAN[i].t1 || i === n - 1) break
  }
  const seg = RATE_PLAN[i]
  let logR = Math.log(seg.rate)

  const blendWindow = (a: RateSegment, b: RateSegment) =>
    Math.min(6, 0.25 * Math.min(a.t1 - a.t0, b.t1 - b.t0))

  const prev = RATE_PLAN[i - 1]
  if (prev) {
    const w = blendWindow(prev, seg)
    if (t < seg.t0 + w) {
      const k = smoothstep((t - (seg.t0 - w)) / (2 * w))
      logR = Math.log(prev.rate) * (1 - k) + Math.log(seg.rate) * k
    }
  }
  const next = RATE_PLAN[i + 1]
  if (next) {
    const w = blendWindow(seg, next)
    if (t > seg.t1 - w) {
      const k = smoothstep((t - (seg.t1 - w)) / (2 * w))
      logR = Math.log(seg.rate) * (1 - k) + Math.log(next.rate) * k
    }
  }
  return Math.exp(logR)
}

/**
 * 速率是變動的，解析積分沒必要，直接建一張單調表：
 * mission -> play。反查用二分搜尋。
 */
const STEP = 0.05
const MISSION_TABLE: number[] = []
const PLAY_TABLE: number[] = []
;(function buildTable() {
  let play = 0
  for (let t = MISSION_START; t <= MISSION_END + STEP; t += STEP) {
    MISSION_TABLE.push(t)
    PLAY_TABLE.push(play)
    play += STEP / rateAt(t + STEP / 2)
  }
})()

/** 整段飛行的播放總長（秒），不含 SECO 後的定格。 */
export const PLAY_DURATION = PLAY_TABLE[PLAY_TABLE.length - 1]

/** 播放時間 → 任務時間。 */
export function playToMission(play: number): number {
  if (play <= 0) return MISSION_START
  if (play >= PLAY_DURATION) return MISSION_END
  let lo = 0
  let hi = PLAY_TABLE.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (PLAY_TABLE[mid] <= play) lo = mid
    else hi = mid
  }
  const span = PLAY_TABLE[hi] - PLAY_TABLE[lo]
  const k = span > 0 ? (play - PLAY_TABLE[lo]) / span : 0
  return MISSION_TABLE[lo] + k * (MISSION_TABLE[hi] - MISSION_TABLE[lo])
}

/** 任務時間 → 播放時間（時間軸拖曳用）。 */
export function missionToPlay(mission: number): number {
  const t = Math.min(MISSION_END, Math.max(MISSION_START, mission))
  const idx = Math.min(
    MISSION_TABLE.length - 2,
    Math.max(0, Math.floor((t - MISSION_START) / STEP)),
  )
  const span = MISSION_TABLE[idx + 1] - MISSION_TABLE[idx]
  const k = span > 0 ? (t - MISSION_TABLE[idx]) / span : 0
  return PLAY_TABLE[idx] + k * (PLAY_TABLE[idx + 1] - PLAY_TABLE[idx])
}

/** 目前的播放倍率，用於 HUD 顯示（1.0× / 26×）。 */
export function currentRate(mission: number): number {
  return rateAt(mission)
}

/** 在 missionT 當下應該顯示的事件標籤。 */
export function eventAt(mission: number): MissionEvent {
  let cur = EVENTS[0]
  for (const e of EVENTS) {
    if (mission >= e.t) cur = e
    else break
  }
  return cur
}

/** 回傳跨過 (prev, now] 區間的所有事件，供音效與特效觸發。 */
export function eventsBetween(prev: number, now: number): MissionEvent[] {
  if (now <= prev) return []
  return EVENTS.filter((e) => e.t > prev && e.t <= now)
}

/** 格式化任務時間為 `T+00:01:02`，固定欄寬。 */
export function formatMissionTime(mission: number): string {
  const sign = mission < 0 ? '-' : '+'
  const abs = Math.floor(Math.abs(mission))
  const h = Math.floor(abs / 3600)
  const m = Math.floor((abs % 3600) / 60)
  const s = abs % 60
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `T${sign}${p2(h)}:${p2(m)}:${p2(s)}`
}
