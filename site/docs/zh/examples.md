---
title: 範例
description: 編輯器內建的十個專案，各自示範什麼，以及直接打開它們的連結。
---

編輯器內建十個專案。可以從工具列的 *examples…* 選單載入，或用下面的連結直接打開。它們都是一般的 `.webtoe.json` 檔，放在 [`apps/web/public/examples`](https://github.com/frank890417/WebToe/tree/main/apps/web/public/examples)：存下來、改一改、再載入回去。

## 手作的 patch {#authored}

### 01 · hello noise {#hello-noise}

會動的 fBm noise；一個 LFO 透過表達式驅動 level 的亮度。最小的完整 patch：四個運算子、一個表達式。[在編輯器中打開](/app/?project=examples/01-hello-noise.webtoe.json)

### 02 · feedback trails {#feedback-trails}

在檢視器上移動滑鼠。回授迴圈加上逐漸變暗的 level，讓跟著滑鼠的矩形拖出殘影。[在編輯器中打開](/app/?project=examples/02-feedback-trails.webtoe.json)

### 03 · lfo garden {#lfo-garden}

三條 ramp 鏈，各自由一個 LFO 透過表達式旋轉，以相加方式合成，色相緩慢漂移。[在編輯器中打開](/app/?project=examples/03-lfo-garden.webtoe.json)

### 04 · webcam displace {#webcam-displace}

網路攝影機畫面被會動的 noise 扭曲，再疊上邊緣偵測。請允許使用攝影機；沒有攝影機時會顯示佔位畫面。[在編輯器中打開](/app/?project=examples/04-webcam-displace.webtoe.json)

### 05 · chop playground {#chop-playground}

選取 `merge1` 來看通道：原始加總和它延遲後的版本。延遲後的加總會旋轉 ramp。[在編輯器中打開](/app/?project=examples/05-chop-playground.webtoe.json)

## 從 TouchDesigner 匯入的 {#imported}

三件 2022 年的每日創作，由匯入器從原始 `.toe` 檔轉換而來，為網頁做了輕微調整（例如把影片來源換成 noise）。它們揭露的兩個引擎錯誤（composite 圖層順序、帶引號的字串常數）都已修正，並有回歸測試。

### 06 · sketch: pseudo voronoi (2022) {#voronoi}

由會動的 noise 產生的類 Voronoi 圖樣。[在編輯器中打開](/app/?project=examples/06-sketch-voronoi.webtoe.json)

### 07 · sketch: fractals (2022) {#fractals}

類碎形的回授 noise。[在編輯器中打開](/app/?project=examples/07-sketch-fractals.webtoe.json)

### 08 · sketch: chop study (2022) {#chop-study}

在檢視器裡點擊並移動：延遲後的滑鼠通道會縮放合成結果。[在編輯器中打開](/app/?project=examples/08-sketch-chop-study.webtoe.json)

## 展示 {#showcases}

### 09 · showcase {#showcase}

27 個節點一次用上所有家族：攝影機接邊緣偵測、帶 in/out 通道的萬花筒 COMP、彩色 noise、滑鼠控制的來源切換、noise 位移、色相漂移的回授殘影，以及由 CHOP 組成的控制系統（lag、speed 積分、參數讀取、完整 math 管線）透過即時表達式驅動全部。在檢視器上移動滑鼠：x 切換來源，y 控制位移量。[在編輯器中打開](/app/?project=examples/09-showcase.webtoe.json)

### 10 · 3d lines {#3d-lines}

完整的 3D 管線：蒙皮、擺動的線條緞帶（Geometry COMP 裡的 SOP，搭配 line MAT）、被 noise 散開的 instanced 球體、繞行的 look-at 攝影機、點光源與環境光、Render TOP，以及之後的 2D 光暈處理。使用 WebGL2 後端。[在編輯器中打開](/app/?project=examples/10-3d-lines.webtoe.json)

## TouchDesigner 原始檔 {#raw-toe}

作者自己 2022 年的兩個每日創作，直接用原始的 `.toe` 檔，由 TouchDesigner 2021.16410 存檔。選了就會在瀏覽器裡原生解碼（幾毫秒）再匯入，匯入報告會列出哪些節點可以執行、哪些保留成佔位節點。原生 .toe 解碼僅供研究用途。

### 11 · 原始 .toe：pseudo voronoi {#raw-voronoi}

用動態 noise 做出的偽 voronoi 細胞，維持在 TouchDesigner 裡存檔時的樣子。[在編輯器中打開](/app/?project=examples/toe/2022-pseudo-voronoi.toe)

### 12 · 原始 .toe：fractals {#raw-fractals}

碎形回授的練習，維持在 TouchDesigner 裡存檔時的樣子。[在編輯器中打開](/app/?project=examples/toe/2022-fractals.toe)
