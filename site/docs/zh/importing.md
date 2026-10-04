---
title: 匯入 TouchDesigner 專案
description: 把 .toe 或 .tox 拖進編輯器。哪些內容會帶過來、哪些變成佔位節點、表達式如何翻譯，以及橋接程式與 toeexpand 兩條路。
---

把 `.toe` 或 `.tox` 拖進編輯器（或用 *load* 選取）。WebToe 會重建網路：支援的運算子立刻執行，其他保留成佔位節點（stub），匯入報告會清楚列出各有多少。

## 原生解碼 {#native}

<!-- TOE-NATIVE -->
WebToe 現在可以直接在瀏覽器裡解碼 .toe / .tox：不需要安裝 TouchDesigner，也不需要橋接程式；橋接程式加 toeexpand 的路徑仍保留作為備援。細節見 [.toe 格式](toe-format.md)。

原生 .toe 解碼僅供研究用途。
<!-- /TOE-NATIVE -->

## 會帶過來的內容 {#recovered}

- **運算子與階層。** 節點類型透過保守的類型對照表對應（目前約 90 種 TouchDesigner 類型）；COMP 網路的巢狀結構與 TouchDesigner 相同。
- **連線**，包括跨 COMP 邊界、穿過 `in` / `out` 運算子（TouchDesigner 的通道）的連線；輸入編號取自名稱，`in2` → 編號 1。
- **參數**：WebToe 實作的運算子都有逐一對照的數值表（選單 token、把顏色分量合併成一個顏色、TouchDesigner 自己的參數名稱）。
- **節點旗標。** render、display、bypass 旗標都會帶過來；和 TouchDesigner 一樣，Render TOP 只畫 render 旗標開啟的 Geometry COMP。
- **表達式。** 即時的 Python 表達式能忠實翻譯就翻譯，否則保持停用（見[下方](#expressions)）。參數模式欄位是位元旗標（bit 0 = 表達式），所以帶旗標的表達式模式也會匯入。
- **DAT 文字與表格。** TouchDesigner 把 DAT 內容存在有外框的二進位附檔裡，不是純文字；WebToe 會解開外框。
- **版面。** 節點位置保留，進入網路時會自動對準匯入的內容。

## 不會帶過來的 {#stubs}

- **沒有對應的運算子會變成同家族的佔位節點。** 佔位節點保留名稱、連線、版面、參數與 Python 程式碼，並把輸入直接傳下去，讓下游仍能計算。節點上會顯示原本的類型。
- **匯入的 Python 永遠不會執行。** 無法翻譯的表達式留在參數的 ƒ 欄位上、保持停用。Python DAT（parameter execute、panel execute、script）是永久的邊界。
- **媒體路徑**會變成佔位；圖片與影片檔不在 `.toe` 裡面。
- **不同網路之間、又不是 COMP 通道的連線**會略過，並計入報告（列為後續工作）。

## 匯入報告 {#report}

每次匯入結束都會顯示報告：匯入的節點數、可執行數、佔位節點數、翻譯與停用的表達式數，以及佔位類型的分布。WebToe 下一步要實作什麼，就是看這份分布決定的（[TouchDesigner 對齊度](td-parity.md)）。

在一個真實的 20 MB 正式演出檔上，透過橋接程式實測：**14,710 個節點、10,239 個可執行（70%）、翻譯 2,244 個表達式、還原 2,251 個 DAT 內容，從拖放到網路開始運作 8.0 秒**，其中 4.6 秒花在 `toeexpand`（WORKLOG，2026-08-01）。

## 表達式翻譯 {#expressions}

翻譯器把已知範圍內的 TouchDesigner Python 改寫成 WebToe 的表達式語言，再編譯並對一個無作用的作用域試跑一次。任一步失敗就保持停用。

| TouchDesigner | WebToe |
|---|---|
| `absTime.seconds`、`me.time.seconds` | `time.seconds` |
| `absTime.frame`、`me.time.frame` | `time.frame` |
| `math.sin(x)`、`mod.math.sin(x)` | `sin(x)` |
| `math.pi` | `PI` |
| `a if cond else b` | `cond ? a : b`（一層） |
| `and`、`or`、`not` | `&&`、`\|\|`、`!` |
| `int(x)`、`float(x)` | `trunc(x)`、`(x)` |
| `True`、`False`、`None` | `true`、`false`、`null` |
| `op('lfo1')['chan1']`、`parent().par.speed`、`me.par.x` | 不變：WebToe 有相同寫法 |

刻意保持停用的：f-string、`lambda`、迴圈、`mod(...)` 模組呼叫、`tdu.*`、`ext.*`、`project.*`、`.menuIndex`、`panel.*`、`me.digits`、整數除法 `//`，以及巢狀條件式。

## 橋接程式 {#bridge}

橋接程式是一個小型本機服務，執行**你自己**的 TouchDesigner 所附的 `toeexpand`（每套安裝都有的官方命令列工具），再把展開結果交給頁面。它只綁定 `127.0.0.1`，沒有相依套件，不含任何 Derivative 的東西，處理完就刪除上傳的檔案。拖入 `.toe` 時編輯器會自動尋找它。

```bash
npx webtoe              # 啟動編輯器與橋接程式，開啟 http://127.0.0.1:9881/app/
npx webtoe --no-open    # 只跑橋接程式，給 webtoe.openaudiovisual.com 上的編輯器用
```

沒有 Node？每套 TouchDesigner 都內附 Python，所以同一個橋接程式也有單檔、只用標準函式庫的版本，協定完全相同。下載 [`bridge.py`](/bridge.py) 後執行：

```bash
# macOS：任何 Python 3.8+，包括 TouchDesigner 內附的
python3 ~/Downloads/bridge.py
```

```text
REM Windows：使用 TouchDesigner 自己的 Python（必要時調整安裝路徑）
"C:\Program Files\Derivative\TouchDesigner\bin\python.exe" %USERPROFILE%\Downloads\bridge.py
```

沒有橋接程式在跑時，拖入 `.toe` 會打開一個說明視窗，列出這些指令，並持續偵測：一啟動橋接程式，它就會自己繼續。

### 共用一個橋接程式 {#shared}

橋接程式可以服務其他電腦（TouchDesigner 在一台，瀏覽器在另一台）：

```bash
npx webtoe --host 0.0.0.0 --token <密語>
# 然後開啟：https://webtoe.openaudiovisual.com/app/?bridge=http://<主機>:9881&bridgeToken=<密語>
```

這樣做之前請先知道：`toeexpand` 是解析未公開格式的原生程式，接受他人上傳的橋接程式應該放在可以隨時重灌的機器上。超出區域網路請用 HTTPS（例如 tunnel），因為瀏覽器只對 `127.0.0.1` 豁免混合內容限制。橋接程式最多同時處理三個展開。

## 完全不用橋接程式 {#manual}

自己展開檔案，把產生的資料夾拖到頁面上（或用 *import .toe.dir*）：

```bash
# macOS
"/Applications/TouchDesigner.app/Contents/MacOS/toeexpand" myproject.toe
```

```text
REM Windows
"C:\Program Files\Derivative\TouchDesigner\bin\toeexpand.exe" myproject.toe
```

批次轉換可以用命令列轉換器，輸出 `.webtoe.json`：

```bash
node packages/cli/toe-convert.mjs myproject.toe     # → myproject.webtoe.json
```

`toeexpand` 打不開非 ASCII 的檔名（它用 Latin-1 讀路徑）。橋接程式與轉換器會先用 ASCII 檔名複製一份，所以中文、日文、韓文命名的專案都能正常匯入。

## 如何測試 {#tests}

匯入流程以一份原創、已提交的測試檔涵蓋：為這個 repo 製作的真實二進位 `.toe`，加上它經官方 `toeexpand` 產生的標準展開結果（[來源說明](https://github.com/frank890417/WebToe/blob/main/tests/fixtures/README.md)）。CI 層驗證重建出來的整張圖（類型、跨 COMP 與通道連線、參數模式、在引擎中求值的翻譯表達式、佔位節點、報告數字）；第二層在沒安裝 TouchDesigner 的環境自動略過，會用真正的 `toeexpand` 展開那份二進位檔，端到端跑轉換器與橋接程式，包括檔名不是英文的專案。

WebToe 讀取的是你用自己合法授權的 TouchDesigner 打開的專案檔，目的在於互通。它不含任何 Derivative 的程式碼、執行檔或素材。
