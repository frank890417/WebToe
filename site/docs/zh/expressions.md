---
title: 表達式
description: 用一行 JavaScript 表達式驅動任何參數，讀取時間、通道、其他參數，以及宿主頁面送進來的數值。
---

任何參數都能用旁邊的 **ƒ** 按鈕從常數切換成表達式。表達式是單一個 JavaScript 運算式，每段原始碼只編譯一次，每次讀取參數時在固定的作用域裡求值。

```js
op('lfo1')['chan1']                  // CHOP lfo1 的 chan1 通道
op('lfo1')[0] * 10                   // 第一個通道，用索引
parent().par.speed * 0.5             // 所在 COMP 的 speed 參數
op('noise1').par.period              // 另一個節點的參數
time.seconds * 0.2                   // 引擎時間
fract(time.seconds * 0.02)           // 緩慢的 0..1 鋸齒波
clamp(op('mouse1')['ty'], 0, 1)      // mouse in，限制在範圍內
ext('energy', 0.5)                   // 宿主頁面送來的值，收到之前是 0.5
```

## 作用域 {#scope}

| 名稱 | 內容 |
|---|---|
| `time.seconds`、`time.frame`、`time.delta`、`time.fps` | 引擎時間：啟動後秒數、格數、上一格耗時、平滑後的幀率 |
| `me` | 這個節點：`me.name`、`me.path`、`me.par.<key>` |
| `op(路徑)` | 另一個節點。`op('x')['chan']` 或 `op('x')[i]` 讀 CHOP 通道（最後一個取樣）；`op('x').par.<key>` 讀參數 |
| `parent(n = 1)` | 往上 `n` 層的 COMP，可用 `.par.<key>` |
| `ext(名稱, 預設 = 0)` | 從 patch 外部設定的數字（[嵌入](embedding.md)） |
| `PI`、`abs`、`sin`、`cos`、`tan`、`asin`、`acos`、`atan`、`atan2`、`floor`、`ceil`、`round`、`trunc`、`min`、`max`、`pow`、`sqrt`、`exp`、`log`、`sign` | 與 JavaScript 的 `Math` 相同 |
| `clamp(v, lo, hi)`、`fract(v)`、`lerp(a, b, t)` | 常用輔助函式 |
| `rand(seed)` | 以 `seed` 產生的 0..1 決定性雜湊（同一個 seed 永遠得到同一個值） |

路徑的寫法與 TouchDesigner 相同：`op('noise1')` 在節點所在的網路裡找，`op('../lfo1')` 往上一層，`op('/geo1/out1')` 從根開始。

## 讀取其他節點 {#reading}

需要時 `op()` 會先讓目標節點計算，所以表達式看到的永遠是這一格的值。透過 `.par` 讀參數也是即時的；若兩個參數互相讀取，循環保護會讓節點回報表達式循環，而不是無限遞迴。被表達式讀取的 CHOP 不需要連線：表達式裡的路徑就是連結。

## 錯誤 {#errors}

語法錯誤會讓欄位變紅。表達式丟出例外，或傳回的不是數字、字串、布林或數字陣列時，參數會退回它的常數值，節點的錯誤標記會顯示原因。表達式是使用者撰寫的 patch 程式碼，以 `new Function` 在上述作用域中求值：這是接線工具的信任模型，不是安全沙箱。不要貼上你不會執行的表達式。

## 從 TouchDesigner 來的 {#from-td}

匯入的 Python 表達式能忠實翻譯就翻譯（`absTime.seconds*0.2` → `time.seconds*0.2`、`math.sin(x)` → `sin(x)`、`a if c else b` → `c ? a : b`），否則保持停用；匯入的 Python 永遠不會執行。完整對照表見[匯入](importing.md#expressions)。
