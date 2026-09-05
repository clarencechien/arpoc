# CREDITS

## 3D 資產

**沒有使用任何第三方 3D 模型。**

Starship 與 Super Heavy 的幾何、發射台、塔架全部由 `src/scene/` 底下的程式碼在
執行期以 three.js 的 `CylinderGeometry` / `LatheGeometry` / `ExtrudeGeometry`
產生；表面的焊縫、板材起伏與六角隔熱瓦是 `scene/materials.ts` 在啟動時
用 canvas 畫出來再轉成的 normal / roughness map，同樣沒有外部檔案。

外形依 **Starship V3（Block 3）**——Flight 12 / 13 飛的載具：熱分離段整合在
Booster 上不再拋離、3 片 T 字配置的格柵翼、前襟翼移到更偏背風面、全長 124.4 m。

這是刻意的決定：

- Sketchfab 上的候選模型逐一授權不同，得逐個確認，而且多半沒有針對即時渲染最佳化
- 在 1:200（約 60 cm）的 AR 尺度下，程序化幾何與減面過的掃描模型看不出差別
- 完全沒有授權風險，也沒有 4 MB 的下載

要換成 GLB 時，只需維持 `src/scene/rocket.ts` 的介面：`booster` 與 `ship`
各自是獨立的 `THREE.Group`、Y 軸向上、原點在各自底部中心。

## 程式庫

| 名稱 | 版本 | 授權 |
|---|---|---|
| [three.js](https://threejs.org/) | 0.169 | MIT |
| [Vite](https://vitejs.dev/) | 5.x | MIT |
| [TypeScript](https://www.typescriptlang.org/) | 5.x | Apache-2.0 |
| [Playwright](https://playwright.dev/)（僅開發用） | 1.x | Apache-2.0 |

`RoomEnvironment`（用於金屬反射的環境貼圖）來自 three.js 的 examples，同為 MIT。

## 字體

| 名稱 | 用途 | 授權 |
|---|---|---|
| [Saira Condensed](https://fonts.google.com/specimen/Saira+Condensed) | 遙測數字 | SIL Open Font License 1.1 |
| [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono) | 事件標籤 | SIL Open Font License 1.1 |

兩者皆由 Google Fonts CDN 載入。載入失敗時會退回系統的窄體與等寬字體，
版面不會壞（面板的數字是逐字元畫進固定格子的，不依賴字體本身的 tabular figures）。

## 音效

全部以 Web Audio API 即時合成（`src/audio/audio.ts`）：棕噪音經低通濾波作為引擎轟鳴、
低頻正弦作為次低頻、方波短音作為事件提示。**沒有使用任何錄音素材**，
因此沒有錄音授權問題。

## 資料出處

上升與 Booster 返場時間軸取自 Starship Flight 6（2024-11-19）公開任務時間軸，
Max-Q 時間參照 Flight 8 轉播時間表；Ship 再入段對齊 Flight 6 的 Ship 濺落時序，
結尾的 Ship 接塔為 Flight 14 預定剖面（截至 2026-08，真實飛行尚未實施）。
Booster 返場的量級（apogee 約 90 km、下靶場 >60 km、回推後滑行）依 SpaceX 對
Flight 7 的公開說明。高度與速度為對齊關鍵點的擬合曲線，下靶場距離由速度與
路徑角推得——不是真實遙測資料，也不是物理模擬。

## 視覺參考

建模與材質比對用的參考照片（僅供比對，未放進專案）：

- *Full Stack starship.jpg*，Jenny Hautmann，CC BY-SA 4.0，Wikimedia Commons——
  Booster 7 / Ship 24 在 OLM 上，2023-04-16。用來校不鏽鋼的反射結構、
  引擎裙的暗度、塔架與 OLM 腿的量體
- *Starship launch tower in Starbase.jpg*，Alexander Hatley，CC BY 2.0，
  Wikimedia Commons——塔架桁架的斜撐配置

## 商標聲明

本作品與 SpaceX 沒有任何關聯，亦未獲其授權或背書。
「Starship」、「Super Heavy」、「Raptor」等名稱與相關載具外型的權利屬於 SpaceX。
本專案為非商業性的技術展示。
