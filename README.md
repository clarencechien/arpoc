# ORBITAL HOUR

跑在手機瀏覽器裡的 WebXR AR 時鐘：把 Starship 完整堆疊放在你面前的地板上，
每到整點就執行一次帶遙測 HUD 的發射序列當作報時。

> 非官方作品，與 SpaceX 沒有任何關聯。所有幾何都是程序化生成的，
> 沒有使用任何第三方模型。載具依 **Starship V3（Block 3）** 建模。
> 詳見 [`CREDITS.md`](./CREDITS.md)。

---

## 使用者流程

1. 手機 Chrome 開啟網頁 → 點「進入 AR」（同一個手勢同時解鎖 AudioContext）
2. hit-test 找到地板 → 點擊放置發射台，火箭以 1:200 站在地上（約 60 cm 高）
3. **待機**：火箭靜置，HUD 顯示現在時刻與距離下次發射的倒數
4. **整點**：T-10 倒數 → 點火 → 升空 → Max-Q → 熱分離 → Booster 返場接塔 →
   SECO → 再入 → Ship 腹部朝下滑降 → 落地翻轉 → 筷子接塔，約 80 秒
5. Ship 接塔後定格 3 秒顯示整點（例如 `15:00`），回到待機

不支援 WebXR 的裝置自動進入**桌面模式**：同一套場景圖與時間軸，
改用 OrbitControls 環繞觀看。降級模式不是次等公民。

## 平台支援

| 平台 | AR 模式 | 桌面模式 |
|---|---|---|
| Android Chrome / Edge（ARCore 裝置） | ✅ | ✅ |
| Meta Quest Browser | ✅ | ✅ |
| **iOS / iPadOS（所有瀏覽器）** | ❌ | ✅ |
| Apple Vision Pro Safari | ❌ | ✅ |
| 桌機瀏覽器 | ❌ | ✅ |

### iOS 為什麼沒有 AR

**Safari 完全沒有實作 WebXR Device API**——不只是 AR 模組，是整個 API 都沒有。
而 iOS 上的 Chrome、Firefox、Edge 依 App Store 規定都用 WebKit 核心，
所以換瀏覽器不會有幫助。截至 2026 年 8 月，Apple 未公布任何導入計畫。

Vision Pro 是唯一的例外，但也只有一半：visionOS 2 的 Safari 預設開了
`immersive-vr`，**AR 模組仍未啟用**，所以這個 `immersive-ar` 應用一樣進不去。

**iOS 使用者實際會拿到什麼**：啟動頁偵測到之後會說明原因，並把「桌面模式」
變成主要按鈕。進去之後完整 3D 場景、飛行時間軸、遙測 HUD、33 引擎環形圖、
整點排程、音效、測試面板全部都在——少的只有相機透視畫面與 hit-test 放置，
改成手指拖曳環繞。不是白畫面，也不是殘廢版。

偵測是問 `navigator.xr.isSessionSupported('immersive-ar')`，不是 UA 白名單。
Apple 哪天開了，「進入 AR」會自動亮起來，這邊一行都不用改。

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
node scripts/reduced-motion-check.mjs  # 驗 prefers-reduced-motion 不播飛行動畫
node scripts/inspect.mjs               # 固定 6 機位 contact sheet（正側／45°／引擎／格柵翼／襟翼／全景）
node scripts/trajectory.mjs            # 固定廣角機位、逐任務秒截圖排成 strip，看弧線與姿態
```

後兩支是**視覺對照工具**：改完材質或軌跡，直接拿 `smoke-out/contact.png` 與
`smoke-out/trajectory.png` 跟真實照片並排比。「哪裡不對」用眼睛比對遠比用想的準——
格柵翼被封成實心方塊、分離瞬間 Booster 跳成垂直，都是這樣抓到的。
兩支都透過 `window.__orbital.view()` / `.mission()` 設機位與時刻，不靠拖曳。

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
    flight.ts      任務時間 → 場景姿態（真實座標路徑 + 只壓距離的視覺映射）
    scheduler.ts   整點排程（自我校正迴圈 + 遲到策略）
  scene/
    rocket.ts      程序化 Starship V3 / Super Heavy V3
    materials.ts   程序化貼圖（焊縫、板材、六角隔熱瓦、AO）
    sky.ts         給 PMREM 的程序化天空（亮天／暗地／硬邊地平線／太陽）
    pad.ts         發射台與塔架
    effects.ts     尾焰 shader、塵埃環、火花粒子池
    world.ts       場景組裝與每幀套用
  hud/panel.ts     3D billboard 遙測面板（canvas texture）
  ar/session.ts    WebXR session、hit-test、wake lock、light estimation、能力偵測
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

**不鏽鋼的長相由環境貼圖決定，不是燈光。**
外殼 `metalness 0.92`，diffuse 幾乎為零，三盞燈對它幾乎沒有貢獻——整艘船的樣子
是 `scene.environment` 單獨決定的。原本用 three 的 `RoomEnvironment`（攝影棚方盒）
再壓到 0.55，反射出來一片均勻的灰，就是「灰色塑膠圓柱」。
`scene/sky.ts` 換成亮天空／暗地面／**硬邊地平線**／過曝太陽：那條沿著圓柱滑動的
分界線才是不鏽鋼的視覺簽名。地平線刻意放在 v=0.56（鏡頭永遠在 60 cm 模型上方
往下看，反射到的是略低於水平那一帶；真實照片是從地面往上拍），env 再傾 0.28 rad
讓箭體一側映天、一側映地。升空時傾角隨高度變化，反射的地平線會跟著翻。

**表面細節靠貼圖，不靠面數；但邊緣要有倒角。**
`scene/materials.ts` 在啟動時畫幾張 canvas，轉成 normal / roughness / ao map：
環焊縫、桶段接縫、板材起伏、六角隔熱瓦、桶段兩端的遮蔽都在貼圖裡。
圓周 96 段，接合處用 `LatheGeometry` 加極窄 chamfer——真實世界沒有數學銳邊，
每條邊都有一線高光。金屬 base color 用接近中性的亮灰 `0xe4e7ea`：對金屬而言
color 是乘進反射的，暗色等於把環境再調暗一次。

**有真實陰影，AR 掉幀時退回 AO。**
key light 投 2048 的 shadow map，frustum 收緊到載具並每幀跟著載具走；
箭體自我遮蔽（襟翼在箭體上有投影、格柵翼格子裡有暗部）。
AR 模式量到滑動平均 < 30 fps 持續 2 秒就關陰影、只關不開，aoMap 留著讓凹處仍是暗的。
這是專案裡唯一為 AR 開的特例，且只關效能。

**AR 模式會用現場光照。**
裝置支援 `light-estimation` 時，棚拍光整組換成 WebXR 估計出的方向光與
反射環境貼圖，不鏽鋼會反射真實房間。AR 裡最容易「看起來是貼上去的」
原因不是模型不夠細，是光對不上。不支援就沿用棚拍光。

**軌跡先在真實座標鋪好，最後才壓縮——而且只壓距離、不壓方向。**
`flight.ts` 用公開資料的錨點（下靶場 km、高度 km）鋪出連續路徑
（非均勻 Catmull-Rom，不會在錨點停頓），機頭沿速度向量，Booster 分離後
照真實時序翻身。映射到場景時 `visual = dir × A·ln(1 + r/K)`：
地面觀察者看到的是角度，方向保留就等於弧線形狀是對的，只是拉近了；
Booster apogee（r ≈ 115 km）落在 1.45 m。遠了就縮小，賣距離感。
原本「高度與下靶場各自套飽和曲線、傾角另外手調」三者互不相干，機頭不對飛行方向，
那是「看起來假」的根源。

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

四處，都是規格本身有矛盾或不足：

1. **總長約 80 秒，不是 45 秒。**
   handoff §5 的速率表本身就要 80 秒實時（`T-10 → T+70` 全段 1.0×），
   與同一節宣稱的 45 秒互相矛盾；後續又應要求加入了 Ship 返場接塔。
   保留三段實時／近實時——倒數、熱分離、Ship 落地翻轉——其餘壓緊。
   速率表在 `src/sim/timeline.ts` 的 `RATE_PLAN`，要調整只動那一張表。

2. **播到 Ship 接塔，不是 T+170 就淡出。**
   §2 說「非目標：重返與接塔動畫」，但這是後續明確要求加入的功能。
   結尾順序：Booster 接塔（Flight 5/7/8 已實做）→ SECO → 軌道滑行 →
   再入電漿 → 腹部朝下滑降 → 落地翻轉 → 落地點火 → 筷子夾住 Ship。
   Ship 接塔在真實飛行尚未發生——Flight 13（2026-07-24）完成了驗證用的
   垂直濺落，Flight 14 預定首次接塔；這裡演的是那個預定剖面。
   （真實計畫用二號塔接 Ship，這裡場景只有一座塔，共用。）

3. **遙測面板顯示的是 Ship 的數值，包含 Booster 返場那一段。**
   跟真實轉播的主讀數一致；Booster 的狀態由畫面本身表達。

4. **載具是 V3，時間軸是 Flight 6（V1）。**
   handoff 指定 Flight 6 的時間軸為基準真實值，但要求「像最新的 Starship」的
   是模型。兩者版本不同，所以：
   - **沒有 `HOT-STAGE JETTISON` 事件。** V3 的熱分離段整合在 Booster 上，
     不再拋離；照 Flight 6 播就會出現一個這輛載具不會做的動作
   - **33 具引擎的點亮波只走 0.7 秒。** V3 改了燃料輸送管之後是同時點火的，
     不再分批。環形圖的識別性保留，但不誤導成分批點火
   - 其餘事件時間仍照 Flight 6

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

iOS 那一條要驗的不是 AR（那確定沒有），而是**偵測邏輯有沒有正確認出 iOS
並給出對的文案**。iPadOS 的偵測靠
`navigator.platform === 'MacIntel' && maxTouchPoints > 1`，這個手法一向脆弱，
實機看一眼最快。

## TODO

### 待實機驗證（做不到，需要真的手機）

- [ ] Android Chrome：AR 全流程與幀率（目標 ≥ 30 fps）。目前完全沒量過，
      新增的儲罐區、塔架斜撐、程序化貼圖都還沒在行動 GPU 上跑過
- [ ] `light-estimation` 實際效果——支援與否、環境貼圖有沒有真的反射房間
- [ ] AR 尺度感：1:200 的 60 cm 在真實房間裡是不是舒服的大小
- [ ] HUD 面板在白牆與雜亂背景前的可讀性
- [ ] wake lock、背景分頁五分鐘後回來的整點準時性
- [ ] iPadOS 的偵測（見上）

### 已知限制（接受，不打算修）

- **iOS 沒有 AR**。三條替代路（陀螺儀＋相機透視偽 AR、AR Quick Look USDZ、
  8th Wall 之類的商用 SDK）都評估過，決定不做：偽 AR 沒有平面追蹤走動就穿幫，
  USDZ 只剩模型沒有時鐘，商用 SDK 與「零第三方授權風險 + 純靜態部署」衝突
- **場景只有一座塔**，Booster 與 Ship 共用。真實計畫是二號塔接 Ship
- **遙測面板顯示 Ship 的數值**，包含 Booster 返場那一段（比照真實轉播主讀數）
- **格柵翼的格子板厚被放大到 R×0.075**，否則 60 cm 尺度下是次像素；靠輪廓在讀
- **AR 的陰影是有條件的**：< 30 fps 持續 2 秒就關、只關不開，之後只剩 aoMap 的暗部
- **軌跡的下靶場距離是推算值**：公開資料只有高度／速度／事件時間，下靶場由速度與
  路徑角倒推（MECO 約 46 km、路徑角 26°，與 apogee 90 km 一致），不是遙測
- 字體走 Google Fonts CDN，載入失敗會退回系統窄體（版面不會壞，
  數字等寬是自己畫格子做的，不依賴字體）

### 隨真實飛行更新

- **Ship 接塔是預測剖面**，不是已發生的事。Flight 13（2026-07-24）完成垂直
  濺落驗證，Flight 14 預定首次接塔。真的飛了之後，`sim/timeline.ts` 的
  `EVENTS` 與 `sim/flight.ts` 的返場曲線應該換成實際轉播時間
- 上升段仍照 Flight 6（V1）的時間軸，載具卻是 V3。若 SpaceX 公布 V3 的
  完整任務時間軸，整張表可以換掉
- 軌跡錨點在 `sim/flight.ts` 的 `STACK_PATH` / `BOOSTER_PATH` / `SHIP_*_PATH`，
  格式是 `[任務秒, 下靶場 km, 高度 km]`。有更好的資料（例如從轉播 OCR 出來的
  遙測）直接換錨點就好，映射與姿態都會跟著對

### 可能的下一步（沒人要求，只是記著）

- **M6 資產替換**：`scene/rocket.ts` 的介面已經預留好（booster / ship 各自
  獨立 Group、原點在底部中心），要換 GLB 不用動其他檔案
- 音效目前是合成的方波與棕噪音，可以做得更有層次（分離的爆震、風噪）
- 桌面模式的自動取景在 Ship 再入段還是偏遠，可以再分一段
- 排程只支援整點；若要「每半小時」之類的，`HourlyScheduler` 的
  `computeNextMark` 是唯一要改的地方

## 測試入口

進入任一模式後點右下角「測試面板」：

- **手動發射**：不必等一小時
- **中止**：回到待機
- **每分鐘報時（測試）**：把排程週期改成 60 秒，用來驗整點觸發與遲到策略
- **時間軸拖曳**：直接跳到任意時刻並暫停

待機時直接點擊火箭本身也會發射。
