---
title: 運算子
description: WebToe 提供的每一個運算子，依家族列出、直接從引擎註冊表產生；以及 cook、佔位節點與自訂運算子的運作方式。
---

運算子（operator）是帶有類型的節點，例如 `top:noise` 或 `chop:lfo`：一個家族、一個名稱、有型別的參數、輸入數量，以及一個 cook 函式。家族沿用 TouchDesigner 的分法：連線上流動的是什麼，取決於產生它的運算子屬於哪個家族。

| 家族 | 傳遞的資料 | 在哪裡計算 |
|---|---|---|
| **TOP** | 影像（貼圖） | GPU，以 render pass 執行 |
| **CHOP** | 通道：具名的取樣陣列 | CPU，透過可換成 WASM 的核心介面 |
| **SOP** | 幾何：型別陣列的點、基本形、法線、顏色 | CPU |
| **MAT** | 場景渲染器用的材質 | 由 Render TOP 讀取的描述 |
| **COMP** | 網路（容器）與 3D 物件（geometry、camera、燈光） | 其子節點／場景 |
| **DAT** | 文字與表格 | CPU |

## 所有運算子 {#all}

<!-- OPS-TABLE -->

<!-- OPS-TOTAL -->

WebToe 實作與 TouchDesigner 相同概念的運算子時沿用其名稱，匯入器會把 TouchDesigner 的類型 token 對應過來（例如 Composite TOP 在專案檔裡叫 `comp`）。幾個值得注意的地方：

- **render** 用攝影機與燈光，畫出符合其樣式（`geo* ^geo7`，TouchDesigner 的語法）的 Geometry COMP；場景 pass 跑在 WebGL2。
- **geometry** COMP 可以依 SOP 的點或依 CHOP 通道做 instancing（每個變換分量一個通道；通道長度不足 instance 數時沿用最後一個取樣）。
- **lookup** 透過 ramp 對應影像；**ramp** 可以從 table DAT 讀取色彩鍵值。
- **feedback** 傳回輸入的上一格畫面，是唯一可以形成迴圈的運算子。
- **ndi in** / **ndi out** 與本機的 [NDI 橋接程式](ndi.md)溝通。
- TOP、CHOP、SOP、DAT 的 **in** / **out** 負責把資料送進、送出 COMP。

## cook 如何運作 {#cooking}

cook 是拉取式的。每一格，引擎從顯示中的輸出開始，向每個輸入要結果；每個運算子每格最多計算一次（快取），循環保護會回報迴圈而不是卡住。依賴時間、媒體或輸入裝置的運算子每格都重算。TOP 以與後端無關的 pass 約定描述工作，所以同一個運算子能在 WebGL2 和 WebGPU 上執行（[架構](architecture.md)）。

## 佔位節點 {#stubs}

每個家族都有一個佔位運算子。WebToe 沒有實作的 TouchDesigner 類型，匯入器都用它代替：佔位節點保留原本的類型、名稱、連線、參數與程式碼，並把輸入直接傳下去，讓只有部分支援的網路仍能計算。存檔時每個節點都會記錄家族，所以 `.webtoe.json` 裡不認得的類型也會降級成正確的佔位節點，而不是讀取失敗。

## 自己寫一個 {#custom}

運算子透過 `@webtoe/core` 的公開外掛 API 註冊。一個最小的 CHOP：

```ts
import { registerOp } from '@webtoe/core';

registerOp({
  type: 'chop:sine',               // family:name，不可重複
  family: 'CHOP',
  label: 'sine',
  inputs: { min: 0, max: 0 },
  alwaysCook: true,                // 依賴時間
  params: [{ key: 'freq', type: 'float', default: 1, min: 0, max: 10 }],
  cook(ctx) {
    const v = Math.sin(ctx.time.seconds * ctx.paramNum('freq') * Math.PI * 2);
    return { kind: 'chop', rate: 60, channels: [{ name: 'chan1', data: new Float32Array([v]) }] };
  },
});
```

面板、參數欄與檔案格式都透過註冊表找到運算子，其他地方不用改。TOP 另外要為每個後端各附一份著色器（WebGL2 用 GLSL、WebGPU 用 WGSL，都是手寫），並有約定測試檢查兩份都存在。
