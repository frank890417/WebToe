---
title: NDI 橋接程式
description: 透過一個小型本機橋接程式，從瀏覽器接收與送出 NDI 影像；像素轉換跑在 1 KB 的 WebAssembly 核心上。
---

瀏覽器無法加入 NDI 網路：網頁裡沒有 mDNS 探索，也沒有原始 TCP 或 UDP，而 NDI SDK 是閉源的。所以 WebToe 把工作拆成兩半：一個小型本機橋接程式用**你自己安裝**的 NDI runtime 處理 NDI 那一端，`ndi in` / `ndi out` TOP 則在瀏覽器裡處理像素，透過 localhost 上的 WebSocket 與橋接程式溝通。

```text
NDI 網路 ⇄ packages/ndi-bridge（Node；ws，選用 grandiose）
         ⇄ ws://127.0.0.1:9980   JSON 控制訊息 + 二進位影格
         ⇄ ndi in / ndi out TOP ⇄ 影像核心（WASM，JS 備援）⇄ GPU 貼圖
```

## 不裝 NDI 也能試 {#mock}

在 repo 的工作目錄裡（`npm install` 之後）：

```bash
node packages/ndi-bridge/index.mjs --mock
```

模擬模式完全不需要 NDI：橋接程式產生一個會動的 UYVY 測試圖樣，來源名稱是 *WebToe Mock (Pattern)*，也會接收瀏覽器送來的影格。在編輯器裡新增 **ndi in** TOP，它會連到 `ws://127.0.0.1:9980` 並顯示圖樣；在任何影像後面接 **ndi out** TOP，橋接程式會記錄收到的影格。

## 真正的 NDI {#real}

1. 安裝 Vizrt 的 NDI runtime。
2. 在 `packages/ndi-bridge` 裡安裝選用的綁定：`npm i grandiose`。
3. 執行 `node packages/ndi-bridge/index.mjs`（不加 `--mock`）。沒有 `grandiose` 時會退回模擬行為並提示。

| 運算子 | 參數 |
|---|---|
| **ndi in** | `bridge url`（預設 `ws://127.0.0.1:9980`）、`ndi source`（空白 = 找到的第一個來源） |
| **ndi out** | `bridge url`、`sender name`（預設 *WebToe Out*）、`active`、`send rate`（預設 30 fps）、`send width` × `send height`（預設 1280 × 720） |

橋接程式選項：`--port <n>`（預設 9980）、`--mock`、`--mock-name <名稱>`。

## 協定 {#protocol}

第 1 版，`packages/ndi-bridge/index.mjs` 與 `packages/ops/src/video/protocol.ts` 保持同步：

- **控制訊息**是 JSON 文字：`hello`（版本與模式）、`sources`（來源名稱清單）、`subscribe` `{ source }`、`send-open` `{ name, w, h, fps }`。
- **影格**是二進位：24 位元組標頭（magic `WTNF`、`u32` 寬、`u32` 高、fourcc `RGBA` 或 `UYVY`、`f64` 時間戳）加上像素。

## 為什麼這裡用 WebAssembly {#wasm}

每一格的每個像素都要做 UYVY 轉 RGBA（BT.601）與 BGRA 換序，這是引擎裡唯一值得用 WASM 核心的地方。核心以 AssemblyScript 撰寫（`packages/wasm-kernels`），編譯成 1 KB 的 `.wasm`，app 啟動時載入；JavaScript 實作是永久備援，也是單元測試的參考。主控台會顯示目前用的是哪一個（`video kernels: wasm`）。

## 限制 {#limits}

`ndi out` 在 WebGL2 上同步讀回像素（以送出速率節流）；WebGPU 的非同步讀回與壓縮傳輸列為後續工作。來源以 `ndi source` 參數的名稱指定。

NDI® 是 Vizrt NDI AB 的商標。WebToe 不附帶任何 NDI SDK 的內容；真正的 NDI 模式使用你自己安裝的 runtime。
