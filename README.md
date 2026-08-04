# ORBITAL HOUR

跑在手機瀏覽器裡的 WebXR AR 時鐘：把 Starship 完整堆疊放在你面前的地板上，
每到整點就執行一次帶遙測 HUD 的發射序列當作報時。

> 非官方作品，與 SpaceX 沒有任何關聯。所有幾何都是程序化生成的，
> 沒有使用任何第三方模型。詳見 [`CREDITS.md`](./CREDITS.md)。

---

## 使用者流程

1. 手機 Chrome 開啟網頁 → 點「進入 AR」（同一個手勢同時解鎖 AudioContext）
2. hit-test 找到地板 → 點擊放置發射台，火箭以 1:200 站在地上（約 60 cm 高）
3. **待機**：火箭靜置，HUD 顯示現在時刻與距離下次發射的倒數
4. **整點**：T-10 倒數 → 點火 → 升空 → Max-Q → 熱分離 → Booster 返場接塔 → SECO，約 52 秒
5. SECO 後定格 3 秒顯示整點（例如 `15:00`），回到待機

不支援 WebXR 的裝置（例如 iOS Safari）自動進入**桌面模式**：同一套場景圖與時間軸，
改用 OrbitControls 環繞觀看。降級模式不是次等公民。

## 開發

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 型別檢查 + 產生 dist/
npm run preview    # 預覽 production build（http://localhost:4173/arpoc/）
```

### 用實機測 AR

WebXR **只在 secure context 下啟動**。用區網 IP 開 `http://192.168.x.x:5173`
不會有 AR 按鈕。兩個做法：

- 在手機 Chrome 開 `chrome://flags/#unsafely-treat-insecure-origin-as-secure`，
  把 `http://<你的內網 IP>:5173` 加進去
- 或直接測部署好的 HTTPS 網址

### 煙霧測試

```bash
npm run build && npm run preview &
npm run smoke                          # 跑完整條時間軸並逐段截圖到 smoke-out/
node scripts/reduced-motion-check.mjs
```

需要 Playwright 的 chromium（`npx playwright install chromium`），
或用 `SMOKE_CHROMIUM=/path/to/chrome` 指定既有的。
**AR 路徑無法在無頭瀏覽器裡測**，那必須在實機上跑（見下方驗收清單）。

## 部署（GitHub Pages）

`.github/workflows/deploy.yml` 會在推上 `main` 時自動建置並部署。

workflow 裡的 `configure-pages` 帶了 `enablement: true`，會在 repo 還沒開
Pages 時自己用 API 開起來。如果那步仍然報
`Get Pages site failed ... Not Found`，代表 token 沒有開啟 Pages 的權限，
手動去 **Settings → Pages → Build and deployment → Source**
選 **GitHub Actions**（不是 `gh-pages` 分支）再重跑一次即可。

站台會出現在 `https://<user>.github.io/<repo>/`。
Vite 的 `base` 由 workflow 的 `BASE_PATH` 環境變數帶入 repo 名稱；
如果之後改用自訂網域或 user site（掛在 `/`），把 `BASE_PATH` 設成 `/` 即可。

`public/.nojekyll` 是必要的——沒有它，GitHub Pages 的 Jekyll 會吃掉
以底線開頭的檔名。

## 架構

```
src/
  sim/
    timeline.ts    事件表、變速播放的 mission↔play 對映、標籤格式化
    telemetry.ts   高度／速度的擬合曲線
    flight.ts      任務時間 → 場景姿態（含視覺高度壓縮）
    scheduler.ts   整點排程（自我校正迴圈 + 遲到策略）
  scene/
    rocket.ts      程序化 Starship / Super Heavy
    pad.ts         發射台與塔架
    effects.ts     尾焰 shader、塵埃環、火花粒子池
    world.ts       場景組裝與每幀套用
  hud/panel.ts     3D billboard 遙測面板（canvas texture）
  ar/session.ts    WebXR session、hit-test、wake lock、能力偵測
  audio/audio.ts   Web Audio 合成
  app.ts           狀態機、播放控制、輸入
  main.ts          DOM 接線
```

AR 與桌面模式**共用同一份場景圖與時間軸**，差別只在相機來源與
anchor 是不是被 hit-test 放到地板上。

### 幾個值得知道的決定

**HUD 是 3D 空間裡的 billboard，不是螢幕上的 DOM。**
面板錨定在發射台旁邊，使用者繞著火箭走時它跟著載具留在原地。
螢幕鎖定的 HUD 等於白做了 AR。DOM 那層只放按鈕與一行狀態文字。

**HUD 上的 `T+` 永遠是真實任務時間，不是播放時間。**
加速播放時數字跑得快——這是特徵不是 bug。

**倒數數字不會左右抖。**
canvas 2D 沒有 `font-variant-numeric`，所以 `hud/panel.ts` 的 `drawTabular()`
把每個字元畫進以 `'0'` 寬度為準的固定格子裡，不依賴字體自帶 tabular figures。

**視覺高度是壓縮過的。**
真實 152 km 換算 1:200 也有 760 公尺。`flight.ts` 用一條飽和曲線把它壓進
1.25 公尺的錐形範圍，再靠縮小與淡出暗示距離。

**桌面模式會自動取景。**
AR 裡是使用者自己抬頭，桌面模式沒有這個動作，所以鏡頭隨高度後退並抬高目標點，
讓載具與錨定在地面的遙測面板同時留在畫面裡。回推點火之後主角換成返場的 Booster。

**整點排程不用單一長 `setTimeout`。**
分頁在背景時計時器被節流，長 timeout 的誤差可以到分鐘級。
`scheduler.ts` 每 5 秒醒來比對 `Date.now()`，逼近整點才切到精確計時。
觸發時已晚於整點 90 秒（裝置剛喚醒）就**跳過這次，不補放**。

**渲染迴圈一律用 `renderer.setAnimationLoop()`。**
three 在 XR session 進行中會自動改用 `XRSession.requestAnimationFrame`——
window 的 `rAF` 在背景分頁會停掉。

## 與 handoff 規格的差異

三處，都是規格本身有矛盾或不足：

1. **總長約 52 秒，不是 45 秒。**
   handoff §5 的速率表本身就要 80 秒實時（`T-10 → T+70` 全段 1.0×），
   與同一節宣稱的 45 秒互相矛盾。這裡保留了它真正在意的兩段實時——
   倒數 10 秒與熱分離前後 18 秒——其餘壓緊。速率表在
   `src/sim/timeline.ts` 的 `RATE_PLAN`，要調整只動那一張表。

2. **播到 SECO，不是 T+170 就淡出。**
   §5 說 T+170 之後淡出結束，但 §7 又要求「SECO 後 HUD 定格 3 秒顯示整點」。
   兩者不能同時成立。選了後者——報時的第一要務是讓人立刻知道現在幾點——
   並把 T+169 之後高度壓縮（60×），只在 `T+380 ~ T+416` 放慢到 9×
   讓 Booster 的落地點火與接塔看得清楚。

3. **遙測面板顯示的是 Ship 的數值，包含 Booster 返場那一段。**
   跟真實轉播的主讀數一致；Booster 的狀態由畫面本身表達。

## 驗收清單

在實機（Android Chrome）上跑：

- [ ] 進 AR、放置、觸發、完整播完不掉幀（目標 ≥ 30 fps）
- [ ] iOS Safari 自動進入桌面模式，不是錯誤畫面
- [x] 倒數數字不左右抖動
- [ ] HUD 在白牆與雜亂背景前都清晰可讀
- [ ] 分頁切走五分鐘再切回，整點仍準時觸發
- [ ] 冷啟動後首次點擊即有音效
- [x] `prefers-reduced-motion` 下不播飛行動畫
- [x] 所有第三方資產的授權列在 `CREDITS.md`

已勾選的項目在無頭 Chromium 上驗過（`npm run smoke`）；
其餘需要真實裝置與相機，無法在 CI 裡驗證。

## 測試入口

進入任一模式後點右下角「測試面板」：

- **手動發射**：不必等一小時
- **中止**：回到待機
- **每分鐘報時（測試）**：把排程週期改成 60 秒，用來驗整點觸發與遲到策略
- **時間軸拖曳**：直接跳到任意時刻並暫停

待機時直接點擊火箭本身也會發射。
