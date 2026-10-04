---
title: 架構
description: 套件與唯一的相依規則、兩個後端共用的 GPU pass 約定、cook 模型、檔案格式，以及背後的取捨。
---

WebToe 是為網頁原創的引擎。它以 TypeScript 在 WebGL2 與 WebGPU 上實作 TouchDesigner 的工作方式（運算子家族、接線網路、表達式驅動的參數、即時 cook 迴圈），沒有任何執行期相依套件。

## 套件與相依規則 {#packages}

```text
apps/web ──▶ @webtoe/editor ──▶ @webtoe/ops ──┐
                       │            │          ├──▶ @webtoe/core
                       ├──▶ @webtoe/gpu ───────┤
                       └──▶ @webtoe/io ────────┘
@webtoe/cli  (standalone node script; mirrors io's tables)
```

**import 只往下走，`core` 不 import 任何東西。** 除了編輯器、app 與媒體類運算子（image、video、camera），沒有套件碰 DOM。`core` 與 `ops` 的 CHOP 部分可以在測試中無頭執行。

| 套件 | 職責 |
|---|---|
| `@webtoe/core` | 圖模型、拉取式 cook 引擎、表達式、與後端無關的 GPU pass 約定、有版本的序列化、`registerOp` |
| `@webtoe/ops` | 運算子定義；可換成 WASM 的 CHOP 核心介面；每個後端各自手寫的 TOP 著色器（GLSL 與 WGSL） |
| `@webtoe/gpu` | WebGL2 與 WebGPU 後端：貼圖池、回授用的 ping-pong、場景渲染、讀回 |
| `@webtoe/io` | `.webtoe.json` 讀寫與 TouchDesigner 匯入器，透過 `ProjectLoader` 轉接 |
| `@webtoe/editor` | 不依賴框架的編輯器，`mountEditor(el, options)` |
| `webtoe`（packages/bridge） | `npx webtoe` 背後的本機匯入橋接程式 |
| `webtoe-ndi-bridge` | 本機 NDI 橋接程式 |

## 一切所依靠的約定 {#contracts}

1. **GPU pass 約定**（`core/passes.ts`）。TOP 從不直接碰 WebGL 或 WebGPU，而是以 pass 描述工作（`TexturePassSpec`：著色器 id、uniform、輸入、輸出；3D 用 `ScenePassSpec`），交給 `GpuFacade`；資源、管線快取、每個節點的貼圖池、媒體上傳、blit 與讀回都由各後端負責。兩個後端能並存靠的就是它，未來的 compute pass 也會從這裡延伸。
2. **註冊表**（`core/registry.ts`）。`registerOp(spec)` 是公開的外掛介面，面板、參數欄與序列化都從這裡找運算子；類型鍵以 `family:name` 命名。
3. **`ProjectLoader`**（`io`）。匯入器是轉接器（`canLoad` / `load` → 圖 + 匯入報告）。TouchDesigner 匯入器是其中之一；若 Derivative 推出官方 JSON 格式，可以並排加入而不必改引擎。
4. **核心接縫**（`ops/chop/kernels.ts`）。CPU 核心藏在介面後面，TypeScript 實作是永久備援；只有實測至少快 2 倍才會改用 WASM 版本。
5. **有版本的檔案**（`serialize.ts`）。`.webtoe.json` 帶有版本與一串遷移步驟；每個存下的節點都記錄家族，不認得的類型會降級成正確的佔位節點。

## cook 模型 {#cook}

- 拉取式，每格快取，並有循環保護。表達式可以重入地拉取其他節點（`op('x')`）。
- **feedback** 是刻意的循環斷點：它的輸入不會先被計算，而是從後端的貼圖池傳回輸入上一格的貼圖（第一格是透明黑）。
- 依賴時間、媒體或輸入的運算子標記為每格重算。

## GPU 後端 {#gpu}

| | WebGL2 | WebGPU |
|---|---|---|
| 狀態 | 完整：所有 TOP，加上 3D 場景渲染器 | 2D 對齊：所有用到著色器的 TOP 都有 WGSL；3D 場景 pass 尚未完成 |
| pass | 全螢幕三角形，每個著色器的 program 與 uniform 位置快取 | 共用一個明確的 bind-group layout：globals @0、運算子 uniform @1（256 位元組對齊）、sampler @2、貼圖 @3+ |
| uniform | 依名稱 | 依名稱排序，每個一個 `vec4f`；由測試把關 |
| 讀回 | 同步 `readPixels` | 非同步 buffer 複製，延遲一格 |

預設是 WebGL2；`?backend=webgpu` 切到 WebGPU，初始化失敗時退回 WebGL2。預覽由覆蓋在編輯器上的一張透明合成畫布負責，每格把檢視器與所有可見的 TOP 縮圖畫上去；預覽完全不需要 CPU 讀回。

## 3D {#3d}

SOP 產生型別陣列幾何，帶版本號讓渲染器可以快取頂點陣列。Geometry COMP 選出顯示的 SOP、套上材質，並依 SOP 的點或 CHOP 通道做 instancing；Render TOP 收集符合的 Geometry COMP、攝影機與燈光，以四個原創著色器繪製，支援深度、instancing 與半透明最後排序。這個第一版明確宣告的限制：場景 pass 只有 WebGL2、線寬 1 px、不繼承父層變換。

## 編輯器 {#editor}

DOM 節點方塊疊在 SVG 連線層上，以 CSS transform 平移縮放；有新增面板、支援逐參數表達式與分頁的參數欄，以及能顯示 TOP、示波 CHOP、列出 DAT 的檢視器。選 DOM 而不是 canvas 繪製網路，是為了免費得到點擊判定與文字；可見節點到數百個都沒問題，日後也能在同一個介面後面換成 canvas 渲染。

## 取捨 {#decisions}

- **WebGL2 為下限、WebGPU 為上限。** compute shader 是粒子（POP）家族的路，所以有 pass 約定。
- **兩個後端的著色器都手寫，不用轉譯器。** 可稽核、來源乾淨，勝過少寫一些；約定測試確保兩份都在。
- **表達式是固定作用域裡的 JavaScript。** 接線工具的信任模型，不是沙箱。匯入的 Python 永不執行。
- **零執行期相依套件。** 為了長期可維護、方便嵌入，也讓整個系統保持可讀。
- **repo 裡沒有任何 Derivative 的程式碼、執行檔、範例檔或介面素材。** 著色器與介面都是原創；匯入器讀的是你用自己的 TouchDesigner 打開的檔案。
