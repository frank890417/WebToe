---
title: 嵌入與外部控制
description: 把編輯器放進 iframe 或直接掛載到你的頁面，用網址載入專案，並以 postMessage 與 ext() 從外部驅動 patch。
---

有兩種方式把 WebToe 放進別的頁面：用 iframe 嵌入線上版編輯器並以 `postMessage` 溝通，或直接掛載編輯器套件。

## 用網址載入專案 {#project}

```text
https://webtoe.openaudiovisual.com/app/?project=https://example.com/patch.webtoe.json
```

`?project=` 接受瀏覽器能抓取的任何網址；其他來源的專案必須以允許的 CORS 標頭提供。相對網址以 `/app/` 為基準，內建範例就是這樣連結的：`/app/?project=examples/03-lfo-garden.webtoe.json`。

## 從外部驅動 patch {#ext}

在 patch 裡，`ext('名稱', 預設值)` 讀取從外部設定的數字。宿主頁面用 `postMessage` 送值，任何參數表達式都能讀：

```html
<iframe id="webtoe" src="https://webtoe.openaudiovisual.com/app/?project=https://example.com/patch.webtoe.json"
        allow="camera; microphone" style="width:100%;aspect-ratio:16/9;border:0"></iframe>
<script>
  const frame = document.getElementById('webtoe');

  // 每一格，或有東西改變時
  function send(values) {
    frame.contentWindow.postMessage({ type: 'webtoe:ext', values }, '*');
  }
  send({ energy: 0.8, hue: 0.25 });

  // 不重新載入 iframe 就換專案
  frame.contentWindow.postMessage({ type: 'webtoe:load', url: 'https://example.com/other.webtoe.json' }, '*');
</script>
```

在 patch 裡把參數設成像 `ext('energy', 0.5) * 2` 這樣的表達式。收到第一個值之前使用預設值。

| 訊息 | 格式 | 作用 |
|---|---|---|
| `webtoe:ext` | `{ type: 'webtoe:ext', values: { [名稱]: number } }` | 設定外部數值；非數字與非有限數會被丟棄；沒送到的名稱保留上一次的值 |
| `webtoe:load` | `{ type: 'webtoe:load', url: string }` | 載入 `url` 的專案，取代目前的專案 |

任何來源的訊息都會接受。這是刻意的，與 patch 本身的信任模型一致：訊息只能設定表達式讀取的數字，或載入一個本來就能用連結載入的專案。

## open-audiovisual 轉接器 {#oav}

[open-audiovisual](https://openaudiovisual.com/) 用的就是這套方式。它的 `@openav/world-webtoe` 套件把嵌入的 WebToe 編輯器包裝成 openav 的 *world*：演出的對應層把輸入（MIDI、音訊、和弦、手勢、時間軸）解算成參數，轉接器每一格把它們以 `webtoe:ext` 送進 patch，只在數值改變時才送。在 patch 裡它們就是一般的 `ext()` 讀取，所以同一張網路可以靠預設值單獨執行，也可以由演出驅動。

## 把編輯器掛載到你的頁面 {#mount}

編輯器套件不依賴任何框架、沒有相依套件，可以掛載到任何元素：

```ts
import { registerAllOps } from '@webtoe/ops';
import { mountEditor } from '@webtoe/editor';
import { setExternals } from '@webtoe/core';

registerAllOps();
const editor = await mountEditor(document.getElementById('app')!, {
  examples: [{ name: 'my patch', url: '/patches/my.webtoe.json' }],  // 工具列選單
  backend: 'webgl2',          // 或 'webgpu'；網址的 ?backend= 優先
  starterPatch: false,        // 從空白開始，不建立預設 patch
  repoUrl: 'https://github.com/you/your-fork',
});

await editor.loadUrl('/patches/my.webtoe.json');
setExternals({ energy: 0.8 });   // 與 webtoe:ext 的效果相同
```

這些套件目前是 repo 裡的 workspace 套件，尚未發佈到 npm；請從 monorepo 建置（`apps/web/src/main.ts` 是完整的參考宿主，包含 `postMessage` 監聽）。

## 舊連結相容 {#compat}

網站把編輯器移到 `/app/` 之前，編輯器就在網站根目錄。仍指向 `https://webtoe.openaudiovisual.com/` 的連結與嵌入都照常運作：根目錄頁面在 iframe 裡被打開，或帶有 `?project=`、`?bridge=`、`?backend=` 之類的參數時，會在畫面出現前帶著相同的參數與 hash 轉到 `/app/`。只有行銷追蹤參數（`utm_*`、`fbclid`、`gclid`…）時不會轉址。
