/**
 * 把任務時間換成可以直接餵給場景圖的姿態。
 *
 * ## 軌跡的做法（重寫）
 *
 * 先在**真實座標**（下靶場 km、高度 km）上用公開資料的錨點鋪出一條連續路徑，
 * 姿態由路徑的速度方向決定（上升段火箭大致沿速度向量飛，攻角很小）；
 * 最後才壓縮到場景座標。原本是「高度與下靶場各自套一條飽和曲線、傾角另外手調」，
 * 三者互不相干，看起來就假：機頭不對著飛行方向、弧線形狀隨壓縮亂變。
 *
 * 壓縮只壓「離發射台的距離」r，方向角完全保留：
 *   visual = dir(x, y) × A·ln(1 + r/K)
 * 地面觀察者看到的就是角度——弧線的形狀因此是對的，只是被拉近了。
 * 近場斜率約 0.18 m/km；apogee 附近的 115 km 壓到 1.45 m。
 *
 * ## 資料出處
 *  - 上升事件時間／高度／速度：Flight 6 公開時間軸（見 timeline.ts）
 *  - Booster 返場：SpaceX 對 Flight 7 的說明——apogee 約 90 km、下靶場 >60 km、
 *    回推後滑行，落地點火啟動時離目標 <40 m；回推 13 具、落地 13→3 具
 *  - Booster 熱分離後**幾秒內**翻身，回推時引擎朝前；之後整段下降引擎朝下
 *  - Ship 再入：Flight 6 的濺落時序；腹部朝下滑降、翻轉、三具引擎落地點火
 *    （接塔為 Flight 14 預定動作，Flight 13 已驗證垂直濺落）
 *  - 下靶場距離由速度與飛行路徑角推得（MECO 時約 46 km、路徑角約 26°）
 *
 * 座標約定：下靶場方向是 -X（塔架在 +X）。預設鏡頭在 +Z 看向原點。
 */

import { T } from './timeline'

/** 完整堆疊高度（公尺）：Starship V3 的 124.4 m，1:200。 */
export const STACK_HEIGHT = 0.622
/** Super Heavy V3：72.3 m */
export const BOOSTER_HEIGHT = 0.3615
/** Ship V3：52.1 m */
export const SHIP_HEIGHT = STACK_HEIGHT - BOOSTER_HEIGHT
/** 直徑 9 m */
export const BODY_RADIUS = 0.0225

/** 視覺距離的上限（公尺）：Booster apogee（r≈115 km）落在這裡。 */
export const VIS_CEILING = 1.45
/** 距離壓縮常數（km）：越小近場越線性、遠場越擠 */
const VIS_K = 2.0
const VIS_R_REF = 115
const VIS_A = VIS_CEILING / Math.log(1 + VIS_R_REF / VIS_K)
/** Ship 分離後會飛出 apogee 半徑之外，超過就夾住（反正已在淡出） */
const VIS_MAX = VIS_CEILING * 1.2

/** 筷子接點的世界座標（相對發射台原點）。塔在 +X。 */
export const CATCH_X = BODY_RADIUS * 2.55
/** Booster 懸掛時底部離地高度（吊點在格柵翼下方） */
export const BOOSTER_HANG_Y = 0.2
/** Ship 懸掛時底部離地高度（吊點在前襟翼下方） */
export const SHIP_HANG_Y = 0.3

/** 隔熱瓦迎風面的方位角（rocket.ts 的 WINDWARD_CENTER），腹部朝下時要用。 */
export const WINDWARD_AZIMUTH = 1.85

// ── 數學小工具 ────────────────────────────────────────────

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

// ── 真實座標的路徑 ────────────────────────────────────────

/** [任務秒, 下靶場 km, 高度 km] */
type Knot = readonly [t: number, dr: number, alt: number]

interface PathSample {
  dr: number
  alt: number
  /** km/s */
  vdr: number
  valt: number
}

/**
 * 非均勻 Catmull-Rom（Hermite + 有限差分切線）。
 * 不用逐段 smootherstep：那會在每個錨點把速度歸零，飛起來一頓一頓的。
 */
class Path2 {
  constructor(private readonly k: readonly Knot[]) {}

  get t0(): number {
    return this.k[0][0]
  }
  get t1(): number {
    return this.k[this.k.length - 1][0]
  }

  at(t: number): PathSample {
    const k = this.k
    if (t <= k[0][0]) return { dr: k[0][1], alt: k[0][2], vdr: 0, valt: 0 }
    const last = k[k.length - 1]
    if (t >= last[0]) return { dr: last[1], alt: last[2], vdr: 0, valt: 0 }

    let i = 0
    while (k[i + 1][0] <= t) i++
    const p0 = k[i]
    const p1 = k[i + 1]
    const pm = k[i - 1] ?? p0
    const pp = k[i + 2] ?? p1
    const h = p1[0] - p0[0]
    const s = (t - p0[0]) / h

    // 切線：中央差分，縮放到本段的參數長度
    const m0dr = ((p1[1] - pm[1]) / (p1[0] - pm[0])) * h
    const m0alt = ((p1[2] - pm[2]) / (p1[0] - pm[0])) * h
    const m1dr = ((pp[1] - p0[1]) / (pp[0] - p0[0])) * h
    const m1alt = ((pp[2] - p0[2]) / (pp[0] - p0[0])) * h

    const s2 = s * s
    const s3 = s2 * s
    const h00 = 2 * s3 - 3 * s2 + 1
    const h10 = s3 - 2 * s2 + s
    const h01 = -2 * s3 + 3 * s2
    const h11 = s3 - s2
    const d00 = 6 * s2 - 6 * s
    const d10 = 3 * s2 - 4 * s + 1
    const d01 = -6 * s2 + 6 * s
    const d11 = 3 * s2 - 2 * s

    const dr = h00 * p0[1] + h10 * m0dr + h01 * p1[1] + h11 * m1dr
    const alt = h00 * p0[2] + h10 * m0alt + h01 * p1[2] + h11 * m1alt
    const vdr = (d00 * p0[1] + d10 * m0dr + d01 * p1[1] + d11 * m1dr) / h
    const valt = (d00 * p0[2] + d10 * m0alt + d01 * p1[2] + d11 * m1alt) / h
    return { dr: Math.max(0, dr), alt: Math.max(0, alt), vdr, valt }
  }
}

/**
 * 完整堆疊上升到熱分離。
 * 前 10 秒幾乎不動（推重比剛過 1），之後加速度遞增；重力轉彎讓下靶場逐漸拉開。
 * MECO 時約 46 km 下靶場 / 65 km 高、速度 1.6 km/s、路徑角約 26°——
 * 這組數字彼此一致（垂直速度 ≈ 0.7 km/s 可由 apogee 90 km 倒推）。
 */
const STACK_PATH = new Path2([
  // 前 12 秒下靶場維持 0：錨點鋪密一點，否則 Catmull-Rom 會在這裡過衝、
  // 讓箭體在 T+3 就歪向塔那邊
  [0, 0, 0],
  [5, 0, 0.08],
  [10, 0.005, 0.35],
  [20, 0.12, 1.3],
  [30, 0.5, 3.0],
  [62, 3.2, 12.0],
  [100, 12.5, 32.0],
  [152, 46.0, 65.0],
  [159, 54.0, 68.0],
  // 多鋪一個錨點越過熱分離：at(159) 才有導數（最後一個錨點的速度是 0）
  [164, 59.5, 71.0],
])

/**
 * Booster 分離後：慣性上衝到 apogee（~90 km、下靶場 ~71 km）、回推反向、
 * 彈道滑行返場、落地點火。回推 164–218 s 期間下靶場先到極大再回頭。
 */
const BOOSTER_PATH = new Path2([
  [159, 54.0, 68.0],
  [164, 59.5, 71.0],
  [190, 68.5, 84.0],
  [210, 71.0, 90.0],
  [218, 70.5, 89.5],
  [260, 56.0, 76.0],
  [300, 36.0, 54.0],
  [340, 17.0, 30.0],
  [385, 3.6, 12.0],
  [394, 1.2, 4.6],
  [405, 0.25, 0.9],
  [411, 0.0, 0.16],
])

/** Ship 分離後繼續加速到 SECO：路徑角越來越平，飛出畫面。 */
const SHIP_ASCENT_PATH = new Path2([
  [152, 46.0, 65.0], // 前一個錨點，讓 159 處有導數（與 STACK_PATH 同點，接得上）
  [159, 54.0, 68.0],
  [200, 112.0, 96.0],
  [260, 230.0, 122.0],
  [320, 390.0, 135.0],
  [420, 720.0, 148.0],
  [507, 1120.0, 152.0],
])

/**
 * Ship 再入返場。真實 Ship 會繞行後從另一側回來；這裡讓它從下靶場側進場，
 * 弧線在畫面上可讀。終端段腹部朝下近乎垂直下墜（真實約 70–90 m/s），
 * 3977 s 翻轉、3981 s 落地點火。
 */
const SHIP_RETURN_PATH = new Path2([
  [2805, 420.0, 122.0],
  [2845, 330.0, 110.0],
  [3000, 190.0, 88.0],
  [3300, 95.0, 62.0],
  [3600, 42.0, 33.0],
  [3810, 14.0, 18.0],
  [3900, 3.6, 4.2],
  [3960, 0.8, 1.1],
  [3977, 0.25, 0.7],
  [3990, 0.05, 0.3],
  [3996, 0.0, 0.16],
])

// ── 真實 → 視覺 ─────────────────────────────────────────

interface Visual {
  x: number
  y: number
  /** 真實距離 km，供縮放用 */
  r: number
}

/** 只壓距離、保留方向。 */
function toVisual(dr: number, alt: number): Visual {
  const r = Math.hypot(dr, alt)
  if (r < 1e-6) return { x: 0, y: 0, r: 0 }
  const rv = Math.min(VIS_MAX, VIS_A * Math.log(1 + r / VIS_K))
  return { x: (-dr / r) * rv, y: (alt / r) * rv, r }
}

/**
 * 機頭沿速度方向：atan2(下靶場速度, 垂直速度)，正值＝鼻朝 -X。
 * 上升段下靶場速度夾成非負：內插的微小過衝不該變成「往塔那邊歪」。
 */
function progradeTilt(s: PathSample): number {
  if (Math.abs(s.vdr) + Math.abs(s.valt) < 1e-6) return 0
  return Math.atan2(Math.max(0, s.vdr), Math.max(1e-6, s.valt))
}

/** 遠了就縮小：壓縮空間裡靠這個賣「距離感」。 */
function distanceScale(rKm: number, far: number, shrink: number): number {
  return 1 - shrink * smoothstep(12, far, rKm)
}

// ── 狀態型別 ──────────────────────────────────────────────

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
  booster: { x: number; y: number; tilt: number; scale: number; visible: boolean; opacity: number }
  /**
   * Ship 底部中心。姿態分解為：
   *  tilt   繞 Z 的傾角（與 Booster 同義）
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

// ── Booster 姿態 ──────────────────────────────────────────

/**
 * 分離後的傾角時序：
 *  - 分離後 1 秒開始翻身、約 12 秒完成（落在 1× 實時窗內看得到），
 *    翻到鼻朝 +X 水平——引擎朝前才能回推
 *  - 回推結束後慢慢轉成引擎朝下；返場時速度是 +X 帶向下，引擎朝前
 *    等於鼻略朝 -X 上方，所以先轉過頭到 +0.22 rad，再收到垂直
 *  - 穿音速前已完全垂直，落地點火與接塔都是直立的
 */
function boosterTilt(mission: number, sepTilt: number): number {
  const flip = smootherstep(T.hotStaging + 1, T.hotStaging + 13, mission)
  const boostbackTilt = -1.5
  let tilt = lerp(sepTilt, boostbackTilt, flip)
  const settle = smootherstep(T.boostbackEnd, 300, mission)
  tilt = lerp(tilt, 0.22, settle)
  const vertical = smootherstep(300, T.transonic, mission)
  return lerp(tilt, 0, vertical)
}

// ── 主函式 ────────────────────────────────────────────────

const SEP = STACK_PATH.at(T.hotStaging)
const SEP_TILT = progradeTilt(SEP)
/** Booster 落地點火啟動時的視覺位置：從這裡直線收斂到接點 */
const BOOSTER_FINAL_FROM = toVisual(BOOSTER_PATH.at(T.landingBurn).dr, BOOSTER_PATH.at(T.landingBurn).alt)
/**
 * Ship 終端段起點的視覉位置。從 3860 s 接手（此時約 0.55 m 高），
 * 讓翻轉發生在塔頂附近、落地點火期間還有可見的下降距離。
 */
const SHIP_FINAL_T0 = 3860
const SHIP_FINAL_FROM = toVisual(SHIP_RETURN_PATH.at(SHIP_FINAL_T0).dr, SHIP_RETURN_PATH.at(SHIP_FINAL_T0).alt)
/** 翻轉時的底部高度：介於接手高度與懸掛高度之間 */
const SHIP_FLIP_Y = lerp(SHIP_FINAL_FROM.y, SHIP_HANG_Y, 0.5)
/** 翻轉前水平船身停在塔的下靶場側，鼻端（+X 方向 ~0.13 m）不能插進塔架（x≈0.09） */
const SHIP_HOLD_X = Math.min(SHIP_FINAL_FROM.x, -0.34)

export function flightStateAt(mission: number): FlightState {
  const separated = mission >= T.hotStaging

  // ── Booster ────────────────────────────────────────────
  let bX: number
  let bY: number
  let bTilt: number
  let bScale = 1

  if (mission <= 0) {
    bX = 0
    bY = 0
    bTilt = 0
  } else if (!separated) {
    const s = STACK_PATH.at(mission)
    const v = toVisual(s.dr, s.alt)
    bX = v.x
    bY = v.y
    bTilt = progradeTilt(s)
    bScale = distanceScale(v.r, 115, 0.45)
  } else if (mission < T.landingBurn) {
    const s = BOOSTER_PATH.at(mission)
    const v = toVisual(s.dr, s.alt)
    bX = v.x
    bY = v.y
    bTilt = boosterTilt(mission, SEP_TILT)
    bScale = distanceScale(v.r, 115, 0.45)
  } else {
    // 落地點火 → 接塔：從點火時的位置直線收斂到筷子接點（單調下降，不會先低於再爬回）
    const k = smootherstep(T.landingBurn, T.catch, mission)
    bX = lerp(BOOSTER_FINAL_FROM.x, CATCH_X, k)
    bY = lerp(BOOSTER_FINAL_FROM.y, BOOSTER_HANG_Y, k)
    bTilt = boosterTilt(mission, SEP_TILT)
    bScale = 1
  }
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
    // 疊在 Booster 上：沿 Booster 的軸向偏移一個 Booster 高度
    sX = bX - Math.sin(bTilt) * BOOSTER_HEIGHT * bScale
    sY = bY + Math.cos(bTilt) * BOOSTER_HEIGHT * bScale
    sTilt = bTilt
    sScale = bScale
  } else if (mission < T.seco + 60) {
    const s = SHIP_ASCENT_PATH.at(mission)
    const v = toVisual(s.dr, s.alt)
    sX = v.x
    sY = v.y
    sTilt = progradeTilt(s)
    sScale = distanceScale(v.r, 400, 0.65)
    sOpacity = 1 - smoothstep(T.seco - 90, T.seco + 40, mission)
  } else if (mission < T.entry - 60) {
    // 軌道滑行：不在畫面裡
    sX = -1.4
    sY = VIS_CEILING
    sOpacity = 0
  } else {
    const appear = smoothstep(T.entry - 40, T.entry + 30, mission)
    sOpacity = appear

    if (mission < SHIP_FINAL_T0) {
      const s = SHIP_RETURN_PATH.at(mission)
      const v = toVisual(s.dr, s.alt)
      sX = v.x
      sY = v.y
      sScale = distanceScale(v.r, 400, 0.65)
    } else if (mission < T.landingFlip) {
      // 終端段 I：腹部朝下滑降到翻轉高度，x 停在塔的下靶場側
      const k = smootherstep(SHIP_FINAL_T0, T.landingFlip, mission)
      sX = lerp(SHIP_FINAL_FROM.x, SHIP_HOLD_X, k)
      sY = lerp(SHIP_FINAL_FROM.y, SHIP_FLIP_Y, k)
      sScale = 1
    } else {
      // 終端段 II：翻轉後在落地點火中降到懸掛高度，同時平移到接點
      // （真實 Ship 落地點火期間確實會做水平位移 divert）
      const k = smootherstep(T.landingFlip + 1, T.shipCatch, mission)
      sX = lerp(SHIP_HOLD_X, CATCH_X, k)
      sY = lerp(SHIP_FLIP_Y, SHIP_HANG_Y, k)
      sScale = 1
    }

    // 腹部朝下滑降：belly=π/2、隔熱瓦轉到朝下、鼻朝行進方向（+X）
    const bellyIn = smoothstep(T.entry - 20, T.entry + 40, mission)
    // 落地翻轉：約 4 個任務秒完成（真實約 2–5 秒），是整段的視覺高潮
    const flip = smootherstep(T.landingFlip, T.landingFlip + 4, mission)
    sBelly = (Math.PI / 2) * bellyIn * (1 - flip)
    sHeading = (Math.PI / 2) * bellyIn * (1 - flip)
    sRoll = -WINDWARD_AZIMUTH * bellyIn * (1 - flip)
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
    booster: { x: bX, y: bY, tilt: bTilt, scale: bScale, visible: bVisible, opacity: bOpacity },
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
