---
title: 開始使用
description: 在瀏覽器打開編輯器、用 npx webtoe 在本機執行，或建立 monorepo 開發環境。
---

## 在瀏覽器裡試用 {#online}

打開**[編輯器](/app/)**。需要支援 WebGL2 的瀏覽器（目前版本的 Chrome、Edge、Firefox、Safari 都可以）。不用安裝，也不會上傳任何東西：專案在頁面裡載入、執行。

- **範例。** 工具列的 *examples…* 選單可載入十個內建專案，從四個節點的 noise patch 到 3D 場景。見[範例](examples.md)。
- **你的檔案。** *load* 開啟 `.webtoe.json`；*save* 把目前的網路下載成 `.webtoe.json`。也可以把檔案拖到頁面任何位置：`.webtoe.json`、TouchDesigner 的 `.toe` / `.tox`，或 `toeexpand` 產生的 `.toe.dir` 資料夾。見[匯入 TouchDesigner 專案](importing.md)。
- **連結。** `/app/?project=<網址>` 會從網址載入專案（對方伺服器需以 CORS 允許）。相對路徑以 `/app/` 為基準，所以 `/app/?project=examples/01-hello-noise.webtoe.json` 會打開第一個範例。

### 在網路裡操作 {#keys}

| 動作 | 方式 |
|---|---|
| 新增運算子 | <kbd>Tab</kbd> 或在網路上雙擊：每個家族一個分頁，搜尋跨所有家族 |
| 接線 | 從輸出點拖到輸入點 |
| 選取 | 點擊節點；參數面板與檢視器會跟著選取 |
| 參數改用表達式 | 參數旁的 **ƒ** 按鈕 |
| 進入 COMP／回上一層 | <kbd>i</kbd> / <kbd>u</kbd> |
| 顯示旗標（檢視器顯示誰） | <kbd>Shift</kbd> + <kbd>D</kbd> |
| 在網路背後顯示輸出 | <kbd>d</kbd> |
| 刪除 | <kbd>Backspace</kbd> 或 <kbd>Delete</kbd> |

### 網址參數 {#url}

| 參數 | 作用 |
|---|---|
| `?project=<網址>` | 啟動時載入一個 `.webtoe.json` |
| `?backend=webgpu` | 改用 WebGPU 後端（啟動失敗時退回 WebGL2） |
| `?bridge=<網址>` | 使用這個位址的匯入橋接程式，而不是 `http://127.0.0.1:9881` |
| `?bridgeToken=<token>` | 共用橋接程式的 bearer token；第一次造訪後瀏覽器會記住 |

## 在你的電腦上執行 {#local}

```bash
npx webtoe
```

這會在 `127.0.0.1:9881` 啟動 WebToe 橋接程式，於 `http://127.0.0.1:9881/app/` 提供編輯器並自動開啟。有了橋接程式，頁面才能使用你自己的 TouchDesigner 的 `toeexpand`（見[匯入](importing.md#bridge)）。需要 Node 20 以上，沒有任何相依套件。

| 旗標 | 預設 | 意義 |
|---|---|---|
| `--port <n>` | `9881` | 監聽的連接埠 |
| `--no-open` | | 不開瀏覽器（只跑橋接程式，給線上版編輯器用） |
| `--host <位址>` | `127.0.0.1` | 綁定位址；超出本機迴路時應搭配 `--token` |
| `--token <密語>` | | `/expand` 需附 `Authorization: Bearer <密語>` |
| `--toeexpand <路徑>` | 自動尋找 | `toeexpand` 不在標準安裝位置時指定路徑 |
| `--app <資料夾>` | 建置好的網站 | 改用另一份網站建置 |

## 修改原始碼 {#dev}

WebToe 是以 TypeScript 撰寫的 npm workspaces monorepo。發佈出去的 app 沒有執行期相依套件；開發時使用 Vite、Vitest、TypeScript 與 playwright-core。

```bash
git clone https://github.com/frank890417/WebToe.git
cd WebToe
npm install
npm run dev          # 編輯器在 http://localhost:8643/app/
npm run check        # 型別檢查 + 測試
npm run build        # apps/web/dist：網站在 /，編輯器在 /app/
```

| 指令 | 作用 |
|---|---|
| `npm run dev` | 編輯器（`apps/web`）的 Vite 開發伺服器 |
| `npm run check` | `tsc --noEmit`，再跑 `tests/` 下所有 Vitest 測試 |
| `npm run build` | 把編輯器建置到 `apps/web/dist/app/`，再在外圍產生這個網站 |
| `npm run site:check` | 在記憶體中建置網站，任何失效連結或缺少的翻譯都會讓它失敗 |
| `npm run bridge` | 從原始碼執行本機橋接程式（建置後會提供 `apps/web/dist`） |

改動引擎之前，先讀[架構](architecture.md)：套件相依規則和 GPU pass 約定，是其他一切的基礎。
