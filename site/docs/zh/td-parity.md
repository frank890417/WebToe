---
title: TouchDesigner 對齊度
description: 對瀏覽器引擎來說「往 TouchDesigner 對齊」是什麼意思、如何用 60 個真實專案量測、WebToe 現在在哪裡，以及接下來做什麼。
---

WebToe 追求的是與 TouchDesigner 在**創作語意上的對齊**（網路、cook、運算子、表達式、渲染、互動），而不是原生裝置層面的對齊。進度是量出來的，不是估的：以真實專案組成的語料庫，以及官方運算子清單為準。

## 怎麼量 {#method}

語料庫是 60 個來自每日生成藝術創作的真實 TouchDesigner 專案，2022–2026，從 199 個可用專案中跨年代抽樣：共 **28,698 個節點**，以官方 `toeexpand` 展開，依運算子類型、參數模式與表達式計數。分析工具放在這個 repo 之外，因為它讀的是私人檔案；公開的只有彙總數字。

語料庫的家族分布：TOP 7,536 · DAT 6,332 · COMP 5,417 · POP 3,148 · SOP 2,942 · CHOP 2,663 · MAT 660。有 13,708 個參數帶有即時 Python 表達式，另有約 7,000 個在帶旗標的表達式模式中。

| 階段 | 推出的內容 | 可執行的語料節點 |
|---|---|--:|
| v1 | 第一個版本：核心 TOP 與 CHOP、匯入器 | **32.3%** |
| 第一輪 | 表達式 v2（`parent()`、`.par`、Python 條件式）、路由類 TOP（switch、select、math、reorder、flip）、CHOP switch/speed/parameter、DAT 表格、參數模式位元旗標 | **47.1%** |
| R3 | 3D 管線：SOP、MAT、Geometry/Camera/Light COMP、Render TOP、instancing | **62.3%** |

一個 213 節點的參考專案在同樣的階段裡，可執行節點從 56 到 71 到 88。R3 之後，一件 2022 年的 DNA 螺旋作品從 55% 提高到 71%，另一件從 65% 到 74%；把 POP 對應到 SOP 實作後，一個大量使用 POP 的 2025 年專案從 43% 提高到 73%。

## 與官方清單對照 {#inventory}

<!-- PARITY-TABLE -->

官方數量來自 docs.derivative.ca 的運算子分類（2026-06-11 擷取）。不是每個官方運算子都該出現在瀏覽器裡；每一個都屬於以下四類之一：

- **可移植**：純計算或渲染語意（大多數 TOP、CHOP、SOP、POP、MAT），可以照原樣實作。
- **網頁對應**：在瀏覽器有對應功能的裝置或網路 I/O：Video Device In → `getUserMedia`（已推出為 camera in）、MIDI In → Web MIDI、Audio Device In/Out → Web Audio、Screen Grab → `getDisplayMedia`。
- **透過本機橋接程式的網頁對應**：瀏覽器沒有對應功能的 I/O，交給使用者執行的小型本機程式，與匯入橋接程式同一個模式。[NDI 收發](ndi.md)就是這樣推出的；Art-Net、Syphon/Spout 擷取與序列埠可以比照。
- **僅限原生**，明確不在範圍內：DirectX/SDI/ST 2110、廠商 SDK（Kinect、ZED、Oculus）、C++ 運算子、Notch 與 Substance 宿主。

## 忠實度：跟 TouchDesigner 算出一樣的數字 {#fidelity}

運算子數量說的是有沒有；忠實度說的是匯入的網路能不能畫出**一樣的像素**、用**一樣的節奏**前進。以下行為來自作者自己兩場 TouchDesigner 演出的正式網頁移植，在 TouchDesigner 2025 上用黑箱方式量出來（餵已知輸入、讀回輸出），再由作者移植過來。每條公式都有 CPU 參考實作和測試，真正的 shader 也會在 Chrome 裡跟參考值比對。

| 運算子 | 跟 TouchDesigner 一致的部分 | 實測誤差 |
|---|---|---|
| Level | 運算順序、black level、範圍、low/high、post 頁；opacity 同時乘上 RGB 與 alpha | ≤ 1e-3（14 × 2 組） |
| Edge | TouchDesigner 的公式（√strength、black level、offset）、Rec.709 亮度、邊緣疊在輸入上 | ≤ 1.2e-7（65 組） |
| Monochrome、Lookup | Rec.709 亮度、TouchDesigner 的通道選單 | 公式完全一致 |
| Ramp | 色標首尾相接（最多 32 個）、phase／period 規則、延伸、內插、比例適配 | 中位數 ≤ 1e-5（35 組）；不重現 antialias |
| Blur | size 為全寬、核心按像素積分、單次取樣的預縮 | ≤ 7.5e-7（52 張） |
| Noise | Gustavson 的 Perlin／simplex 2D–4D、TouchDesigner 的座標、變換頁、種子與八度數 | ≤ 3.7e-3，99.9% ≤ 6e-4 |
| Composite | 預乘 alpha、全部 46 種運算、變換頁 | 37 種 ≤ 1e-7，9 種擬合 ≤ 3e-5 |
| Cook 時鐘 | 依專案 cook 速率固定步長；每步的常數在任何螢幕上都跟 TouchDesigner 一樣 | 決定論，有測試 |
| Lag、Speed、Feedback | lag 是走到 90% 的秒數（a = 1 − exp(−dt·ln10/lag)）；speed 輸出這一步之前的累積；feedback 回傳目標 TOP 的上一步 | 有測試 |

兩個 GPU 後端畫這些 shader 的結果，差距在 1/255 以內。完整表格，以及哪些是推估或近似，見 [docs/TD-PARITY.md](https://github.com/frank890417/WebToe/blob/main/docs/TD-PARITY.md#fidelity--tops-that-reproduce-touchdesigners-numbers)。

## 引擎概念 {#concepts}

| 概念 | WebToe 現況 |
|---|---|
| 3D：幾何、材質、攝影機、燈光、Render TOP、instancing | 已推出（R3），在 WebGL2 上；WebGPU 場景 pass 尚未完成 |
| 多樣本 CHOP 與時間切片 | 尚未：目前通道是控制速率的單一取樣。這是音訊、trail、resample、wave 的前提 |
| 音訊 | 規劃以 Web Audio 實作（AudioWorklet ↔ 多樣本 CHOP，頻譜用 AnalyserNode） |
| GLSL TOP | 規格已定：把 TouchDesigner 注入的約定（不含標頭的 GLSL、`sTD2DInputs`、`vUV`、`uTD2DInfos`、`TDOutputSwizzle`）轉接到 GLSL ES 3.00。60 個語料專案中有 32 個用到 |
| POP | 匯入後透過 SOP 實作執行幾何部分；動力學（力場、解算器）仍是佔位。原生 POP 規劃在 WebGPU compute 上實作 |
| 參數 | 分頁與表達式已推出；pulse 參數、綁定與 COMP 自訂參數尚待完成 |
| 面板 | button、slider、container 面板規劃以 DOM 疊層實作 |
| Replicator | 規劃搭配表格驅動的範本；60 個語料專案全都用到 `COMP:replicator` |
| Python | **永久邊界**：匯入的 Python 會保留、會顯示，但不會執行。規劃中的替代方案是需手動啟用、介面仿照 TouchDesigner 的 JavaScript 回呼 DAT |

## 循環 {#loop}

1. **量測**：跑語料分析，讀覆蓋率與佔位類型分布。
2. **挑選**：「影響專案數 × 低成本」最高者，並遵守前提（多樣本在音訊之前、3D 在依賴 render 的 TOP 之前）。
3. **實作**：基於公開約定，`registerOp`、兩個後端的著色器、匯入器對照表，其餘誠實地留作佔位節點。
4. **驗證**：單元測試、測試檔往返，以及在瀏覽器裡跑真實作品。真實專案揭露的每個錯誤都要有回歸測試。
5. **記錄**：把新數字寫進 docs/ROADMAP.md，再量一次。

## 接下來 {#next}

依序：**多樣本 CHOP 與時間切片 → GLSL TOP → WebGPU compute 上的 POP → WebGPU 3D 場景 pass → replicator、表格與面板。** 完整的理由與量測門檻見 [docs/ROADMAP.md](https://github.com/frank890417/WebToe/blob/main/docs/ROADMAP.md) 與 [docs/TD-PARITY.md](https://github.com/frank890417/WebToe/blob/main/docs/TD-PARITY.md)。
