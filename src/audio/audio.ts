/**
 * 全部用 WebAudio 合成，不引入任何錄音檔——沒有授權問題，也不用等下載。
 *
 * 陷阱（handoff §7）：AudioContext 需要使用者手勢才能啟動。
 * unlock() 必須在「進入 AR / 進入桌面模式」那一次點擊的同步呼叫堆疊裡執行，
 * 不能拖到要播放時才發現沒聲音。
 */

export class Audio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private rumbleGain: GainNode | null = null
  private rumbleSource: AudioBufferSourceNode | null = null
  private subOsc: OscillatorNode | null = null
  private subGain: GainNode | null = null
  private enabled = true

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running'
  }

  get muted(): boolean {
    return !this.enabled
  }

  /** 必須在使用者手勢中同步呼叫。 */
  unlock(): void {
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.enabled ? 0.9 : 0
      this.master.connect(this.ctx.destination)
      this.buildRumble()
    }
    void this.ctx.resume()
  }

  setEnabled(on: boolean): void {
    this.enabled = on
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05)
    }
  }

  /** 棕噪音 + 低頻正弦，一路常駐，只調 gain。 */
  private buildRumble(): void {
    const ctx = this.ctx!
    const seconds = 4
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1
      last = (last + 0.021 * white) / 1.021
      data[i] = last * 4.2
    }
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.loop = true

    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 260
    lp.Q.value = 0.6

    const g = ctx.createGain()
    g.gain.value = 0
    src.connect(lp).connect(g).connect(this.master!)
    src.start()

    const sub = ctx.createOscillator()
    sub.type = 'sine'
    sub.frequency.value = 38
    const subG = ctx.createGain()
    subG.gain.value = 0
    sub.connect(subG).connect(this.master!)
    sub.start()

    this.rumbleSource = src
    this.rumbleGain = g
    this.subOsc = sub
    this.subGain = subG
  }

  /** intensity 0..1，直接綁引擎推力。 */
  setRumble(intensity: number): void {
    if (!this.ctx || !this.rumbleGain || !this.subGain) return
    const t = this.ctx.currentTime
    const v = Math.max(0, Math.min(1, intensity))
    this.rumbleGain.gain.setTargetAtTime(v * 0.55, t, 0.08)
    this.subGain.gain.setTargetAtTime(v * 0.22, t, 0.08)
    if (this.subOsc) this.subOsc.frequency.setTargetAtTime(34 + v * 14, t, 0.2)
  }

  /** 事件提示音：短、乾、不帶尾巴。 */
  beep(freq = 880, duration = 0.09, gain = 0.16): void {
    if (!this.ctx || !this.master) return
    const t = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.value = freq
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gain, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration)
    osc.connect(g).connect(this.master)
    osc.start(t)
    osc.stop(t + duration + 0.02)
  }

  /** 整點報時：三短一長。 */
  hourChime(): void {
    if (!this.ctx) return
    for (let i = 0; i < 3; i++) {
      setTimeout(() => this.beep(1046, 0.07, 0.12), i * 160)
    }
    setTimeout(() => this.beep(1568, 0.28, 0.16), 520)
  }

  dispose(): void {
    this.rumbleSource?.stop()
    this.subOsc?.stop()
    void this.ctx?.close()
    this.ctx = null
  }
}
