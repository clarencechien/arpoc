/**
 * 整點排程。
 *
 * 陷阱（handoff §7）：
 *  - 不用單一 setTimeout(msUntilNextHour)。分頁在背景時計時器被節流，
 *    長 timeout 的誤差可以到分鐘級。這裡用自我校正迴圈：每 5 秒醒來比對
 *    Date.now()，逼近整點才切到精確計時。
 *  - 遲到策略：觸發時已晚於整點 90 秒（裝置剛從睡眠喚醒）就跳過這次。
 *    晚了兩分鐘的報時比不報時更讓人困惑。
 */

const COARSE_INTERVAL_MS = 5_000
/** 進入精確計時的門檻 */
const FINE_WINDOW_MS = 12_000
/** 遲到超過這個秒數就跳過 */
export const LATE_TOLERANCE_MS = 90_000

export interface SchedulerOptions {
  /** 整點到了、且沒有遲到太久時呼叫 */
  onFire(hourMark: Date): void
  /** 遲到被跳過時呼叫，供 HUD 顯示 */
  onSkip?(hourMark: Date, lateMs: number): void
  /** 測試用：把「整點」改成每 N 秒一次 */
  intervalMs?: number
}

export class HourlyScheduler {
  private coarseTimer: number | null = null
  private fineTimer: number | null = null
  private nextMark = 0
  private running = false
  private readonly opts: SchedulerOptions
  private readonly period: number

  constructor(opts: SchedulerOptions) {
    this.opts = opts
    this.period = opts.intervalMs ?? 3_600_000
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.nextMark = this.computeNextMark(Date.now())
    this.tick()
  }

  stop(): void {
    this.running = false
    if (this.coarseTimer !== null) clearTimeout(this.coarseTimer)
    if (this.fineTimer !== null) clearTimeout(this.fineTimer)
    this.coarseTimer = this.fineTimer = null
  }

  /** 距離下次觸發的毫秒數，供待機 HUD 倒數。 */
  msUntilNext(now = Date.now()): number {
    return Math.max(0, this.nextMark - now)
  }

  nextMarkDate(): Date {
    return new Date(this.nextMark)
  }

  private computeNextMark(from: number): number {
    if (this.period === 3_600_000) {
      const d = new Date(from)
      d.setMinutes(0, 0, 0)
      d.setHours(d.getHours() + 1)
      return d.getTime()
    }
    return Math.ceil((from + 1) / this.period) * this.period
  }

  private tick = (): void => {
    if (!this.running) return
    const now = Date.now()
    const delta = this.nextMark - now

    if (delta <= 0) {
      const late = -delta
      const mark = new Date(this.nextMark)
      // 先推進，再決定要不要放——避免 onFire 內部拋錯就卡住排程
      this.nextMark = this.computeNextMark(now)
      if (late > LATE_TOLERANCE_MS) this.opts.onSkip?.(mark, late)
      else this.opts.onFire(mark)
      this.coarseTimer = window.setTimeout(this.tick, COARSE_INTERVAL_MS)
      return
    }

    if (delta <= FINE_WINDOW_MS) {
      // 精確段：直接排到整點，並仍保留一個粗略備援
      if (this.fineTimer !== null) clearTimeout(this.fineTimer)
      this.fineTimer = window.setTimeout(this.tick, delta)
      this.coarseTimer = window.setTimeout(this.tick, delta + 1_500)
      return
    }

    this.coarseTimer = window.setTimeout(this.tick, Math.min(COARSE_INTERVAL_MS, delta - FINE_WINDOW_MS))
  }
}

/** `01:23:45` 形式的倒數，固定欄寬。 */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const p2 = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${p2(h)}:${p2(m)}:${p2(s)}` : `${p2(m)}:${p2(s)}`
}

export function formatClock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
