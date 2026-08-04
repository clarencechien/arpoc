/** 設計 tokens（handoff §6）。CSS 端在 style.css 有一份對應的 custom properties。 */
export const COLOR = {
  /** 遙測文字，略暖的白 */
  ink: '#F2F3F0',
  /** scrim，不用純黑 */
  void: '#0A0C0E',
  /** Raptor 排氣橘。紀律：只用於「作動中」狀態 */
  plume: '#FF7A18',
  /** 低溫管路的冰藍。只用於待機／預備狀態 */
  cryo: '#7FD4FF',
  /** 未啟用、已關機 */
  dim: '#5A6169',
} as const

export const HEX = {
  ink: 0xf2f3f0,
  void: 0x0a0c0e,
  plume: 0xff7a18,
  cryo: 0x7fd4ff,
  dim: 0x5a6169,
  steel: 0xc6ccd4,
} as const

export const FONT_TELEMETRY = "'Saira Condensed', 'Arial Narrow', 'Helvetica Neue', sans-serif"
export const FONT_LABEL = "'IBM Plex Mono', 'SFMono-Regular', Menlo, monospace"
