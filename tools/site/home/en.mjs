// Site strings, English (served at /, /docs/…). Shape must match zh.mjs key
// for key — tools/site/build.mjs refuses to build otherwise.
// Strings may contain inline HTML (authored, trusted). Code, URLs and the
// order of things live in page.mjs. Tokens:
//   {name}         filled at build time (bundleKb, bundleGz, TOP … DAT, total)
//   {{TOE_NAME}}   left for the repo owner to fill with validated numbers

export default {
  meta: {
    title: 'WebToe · a web-native dataflow engine for real-time visuals',
    description: 'Patch operators in the browser, TouchDesigner-style: TOPs, CHOPs, SOPs, MATs, COMPs and DATs on WebGL2 and WebGPU, expressions on every parameter, and import of your existing .toe projects. Open source, MIT, zero runtime dependencies.',
    ogDescription: 'TouchDesigner-style patching that runs in a browser tab, and opens your .toe.',
    ogImageAlt: 'WebToe: a web-native dataflow engine for real-time visuals. A network of operators wired together.',
    ld: 'A web-native, node-based dataflow engine and editor for real-time visuals: operator families (TOP, CHOP, SOP, MAT, COMP, DAT) wired into networks, expression-driven parameters and a pull-based cook loop on WebGL2 and WebGPU, with import of TouchDesigner .toe projects. MIT, zero runtime dependencies.',
  },

  ui: {
    skip: 'Skip to content',
    navLabel: 'Site',
    nav: { toe: 'Import .toe', how: 'Dataflow', parity: 'Parity', docs: 'Docs' },
    langLabel: 'Language',
    home: 'WebToe home',
    openEditor: 'Open editor',
    copy: 'Copy',
    copied: 'Copied',
  },

  footer: {
    disclaimer: 'Independent open-source project, not affiliated with or endorsed by Derivative Inc. TouchDesigner is a trademark of Derivative Inc. WebToe contains no Derivative code, binaries or assets.',
    license: 'MIT license · built by <a href="https://cheyuwu.com">Che-Yu Wu</a>',
    pages: 'Pages',
    home: 'Home',
    editor: 'Editor',
    docs: 'Docs',
    machine: 'Machine-readable',
  },

  hero: {
    sub: 'A web-native dataflow engine for real-time visuals.',
    lede: 'Operators, wires and a live cook loop, TouchDesigner-style, in a browser tab. TOPs run as GPU passes, CHOPs drive parameters through expressions, SOPs and MATs feed a 3D renderer. Drop in a <code>.toe</code> and your network opens.',
    ctaEditor: 'Open the editor',
    ctaDocs: 'Read the docs',
    facts: 'MIT · zero runtime dependencies · WebGL2 + WebGPU · {bundleKb} KB of JavaScript',
    netCaption: 'This drawing is example 03 itself, read from its project file: three ramp chains rotated by LFOs through expressions (dashed), composited, hue-shifted.',
    netOpen: 'Open it',
    legendLabel: 'How to read the drawing',
    legend: [
      '<b>wire</b> output into input',
      '<b>dashed</b> a CHOP channel read by an expression',
      '<b>ƒ</b> expression-driven parameter',
      '<b>●</b> display flag',
    ],
    shotAlt: 'The WebToe editor running example 03, lfo garden: a network of ramp, transform, composite and hsv adjust operators with live previews on every node, and the output in the viewer.',
    shotCaption: 'The editor at /app/, running the same patch on WebGL2. TOP nodes preview live: one GPU compositor paints the viewer and every visible thumbnail each frame.',
  },

  shots: {
    title: 'In the editor',
    items: [
      { title: '3D pipeline', text: 'Example 10: SOP ribbons and instanced spheres in Geometry COMPs, a camera, two lights, a Render TOP and a glow chain. The output is painted behind the network, as in TouchDesigner.', alt: 'Example 10, 3d lines, in the editor: geometry, camera, light, render, blur and composite nodes over the rendered scene of line ribbons and orange spheres.' },
      { title: 'Every family at once', text: 'Example 09: 27 nodes, a kaleidoscope COMP with in/out tunnels, and a CHOP rig driving the whole patch through live expressions.', alt: 'Example 09, showcase: a dense network of TOP, CHOP, COMP and DAT nodes with the composited output in the viewer.' },
      { title: 'Feedback', text: 'A feedback TOP hands back the previous frame; a fading level turns mouse movement into trails.', alt: 'Example 02, feedback trails: rectangle, transform, composite, blur, feedback and level operators wired in a loop.' },
      { title: 'CHOP scope', text: 'Select a CHOP and the viewer scopes its channels, here a raw sum against its lagged copy.', alt: 'Example 05, chop playground: LFO, noise, math, lag and merge CHOPs, with the merge selected and its channels drawn in the viewer.' },
      { title: 'Create operator', text: 'Tab or double-click opens the palette: a tab per family, one search across all of them.', alt: 'The create-operator dialog over a small noise patch, listing TOP operators in a searchable grid.' },
      { title: 'WebGPU', text: 'The same project on <code>?backend=webgpu</code>. Every 2D TOP ships hand-written GLSL and WGSL.', alt: 'Example 03 running on the WebGPU backend.' },
    ],
  },

  toe: {
    eyebrow: '01 · Import',
    title: 'Drop a .toe. It opens.',
    lede: 'Drag a TouchDesigner project onto the editor and it becomes a live WebToe network. Supported operators run; everything else is kept as a stub with its name, wires, parameters and code, and the import report says exactly how much of each.',
    nativeTitle: 'Decoded in the browser',
    nativeText: 'WebToe reads the binary <code>.toe</code> / <code>.tox</code> container itself: no TouchDesigner install, no bridge, and the file never leaves your machine.',
    nativeStats: [
      { label: 'to decode a 20 MB show file in the browser', value: '{{TOE_DECODE_TIME}}' },
      { label: 'project files decoded byte-exact against TouchDesigner’s own <code>toeexpand</code>', value: '{{TOE_BYTE_EXACT}}' },
    ],
    research: 'Native .toe decoding is provided for research purposes only.',
    fallbackTitle: 'The bridge, as fallback',
    fallbackText: 'The local bridge runs the <code>toeexpand</code> of your own TouchDesigner install on 127.0.0.1 and hands the expansion to the page. One command, or <a href="{root}bridge.py"><code>bridge.py</code></a> run with the Python that ships inside TouchDesigner.',
    fallbackNote: 'Binds to 127.0.0.1 by default, ships nothing of Derivative’s, and deletes every upload when it is done.',
    measuredTitle: 'Measured on a real show file',
    measuredNote: 'A 20 MB production project, dropped on the page through the bridge (WORKLOG, 2026-08-01).',
    measured: [
      { label: 'nodes imported', value: '14,710' },
      { label: 'runnable (10,239 nodes)', value: '70%' },
      { label: 'Python expressions translated', value: '2,244' },
      { label: 'DAT bodies recovered', value: '2,251' },
      { label: 'from drop to a running graph', value: '8.0 s' },
    ],
    shotAlt: 'The TouchDesigner import report: 213 nodes, 71 runnable, 142 kept as stubs with structure, wires and layout preserved; 9 expressions translated, 14 kept inert.',
    shotCaption: 'The import report for a 213-node production project at v1.1: 71 runnable. The same file reached 88 after the first evolution cycle.',
    recovers: 'Recovered: node types and hierarchy, wires across COMP boundaries and through in/out tunnels, parameter values and modes, DAT text and tables, network layout, and live Python expressions, translated where faithful (<code>absTime.seconds*0.2</code> → <code>time.seconds*0.2</code>) and kept inert otherwise. Imported Python never runs.',
    docsLink: 'Importing TouchDesigner projects',
  },

  how: {
    eyebrow: '02 · Dataflow',
    title: 'Operators, wires, expressions, one cook loop.',
    lede: 'A network is operators wired together. Each frame the engine pulls from the output, cooks what it depends on once, and memoizes the result for that frame. Feedback is the one deliberate cycle: it reads the previous frame.',
    families: [
      'GPU image operators: generators, filters, compositing, feedback, lookup, render, media and NDI in/out.',
      'Channels: LFO, noise, math, lag, speed, mouse in, SOP to. The values that drive parameters.',
      'Typed-array geometry: primitives, copy, skin, noise, twist, and in/out for COMP networks.',
      'Materials for the scene renderer: constant, lit (phong and pbr), line, point sprite, wireframe.',
      'Containers with in/out tunnels, and the 3D objects: geometry (with instancing), camera, lights.',
      'Text and tables that operators read: a ramp can take its colour keys from a table.',
    ],
    familiesNote: '{total} operator types, counted from the engine’s registry at build time.',
    opsLink: 'All operators',
    exprTitle: 'Every parameter can be an expression',
    exprText: 'Expressions are JavaScript evaluated against a fixed scope: <code>time</code>, <code>me</code>, <code>op()</code>, <code>parent()</code>, <code>ext()</code> and a math library (<code>sin</code>, <code>clamp</code>, <code>fract</code>, <code>lerp</code>, <code>rand</code> …). They can read channels and other parameters, live, with a cycle guard.',
    exprLink: 'Expressions',
  },

  parity: {
    eyebrow: '03 · Parity',
    title: 'Measured against real TouchDesigner work.',
    lede: '“Complete” is defined by data, not by a feature list: 60 real TouchDesigner projects from a daily generative-art practice (28,698 nodes, 2022–2026), expanded with the official <code>toeexpand</code> and counted by operator type. Only aggregate numbers are published.',
    chartTitle: 'Corpus nodes that run as WebToe operators',
    stages: [
      { name: 'v1', text: 'first release' },
      { name: 'Cycle 1', text: 'expressions v2, routing TOPs, DAT tables' },
      { name: 'R3', text: 'the 3D pipeline: SOPs, MATs, geometry, camera, render' },
    ],
    chartNote: 'Each step was re-measured on the same 28,698 nodes (docs/ROADMAP.md). The rest import as stubs: structure, wires, layout and code survive.',
    facts: [
      { label: 'runnable nodes in a 213-node reference project, across the same three steps', value: '56 → 71 → 88' },
      { label: 'operators in the official TouchDesigner inventory, across 7 families', value: '~675' },
      { label: 'operator types WebToe ships today', value: '{total}' },
      { label: 'runnable in a 2025 POP-heavy project once POPs mapped onto the SOP implementations', value: '43% → 73%' },
    ],
    nextTitle: 'Next, in order',
    next: [
      'Multi-sample CHOPs and time slicing, the prerequisite for audio, trail, resample and wave.',
      'GLSL TOP: TouchDesigner’s injected shader contract, shimmed onto WebGL2.',
      'POPs on WebGPU compute, the reason the second backend exists.',
    ],
    boundary: 'Python is a permanent boundary. Imported Python is kept and shown, never executed; the planned answer is an opt-in JavaScript callback DAT.',
    link: 'The TouchDesigner parity charter',
  },

  engine: {
    eyebrow: '04 · Engine',
    title: 'Small, explicit, no dependencies.',
    lede: 'An original engine written for the web, not a port. It implements the workflow (operator families, wired networks, expression-driven parameters, a live cook loop) on browser GPUs.',
    facts: [
      { title: 'Zero runtime dependencies', text: 'The app is engine, editor and shaders, nothing else: {bundleKb} KB of JavaScript, {bundleGz} KB gzipped.' },
      { title: 'Two GPU backends', text: 'WebGL2 by default, WebGPU with <code>?backend=webgpu</code>, both behind one backend-agnostic pass contract. 2D is at parity; the 3D scene pass is WebGL2 today.' },
      { title: 'One dependency rule', text: 'Imports flow downward only, and <code>core</code> imports nothing. Operators register through the public <code>registerOp</code> API.' },
      { title: 'Embeddable', text: '<code>mountEditor(el, options)</code> puts the framework-free editor in any page. Hosts load projects and drive expressions over <code>postMessage</code>.' },
      { title: 'A versioned file format', text: '<code>.webtoe.json</code> carries a version and a migration chain; unknown operator types degrade to family stubs instead of failing.' },
      { title: 'WASM where it pays', text: 'The NDI pixel conversion runs in a 1 KB WebAssembly kernel with a JavaScript fallback. WASM is adopted only on a measured win.' },
    ],
    depsLabel: 'Package dependency diagram: apps/web depends on the editor; the editor on ops, gpu and io; all of them on core.',
    depsCaption: 'npm workspaces, imports flowing one way.',
    archLink: 'Architecture',
  },

  oav: {
    eyebrow: '05 · Engine ↔ show',
    title: 'WebToe is the engine. open-audiovisual is the show.',
    p1: '<a href="https://openaudiovisual.com/">open-audiovisual</a> is the sister project: a web-native framework for audiovisual performance, with MIDI, chord and pose inputs, a signal-to-parameter mapping layer, a timeline with scenes and cues, and a backstage monitor.',
    p2: 'Its <code>@openav/world-webtoe</code> adapter embeds this editor in an iframe, reads the show’s resolved parameters every frame and posts the ones that changed into the patch. Inside the network they are plain numbers: <code>ext(\'energy\')</code> in any expression.',
    docsLink: 'Embedding and external control',
  },

  start: {
    eyebrow: '06 · Start',
    title: 'Three ways in.',
    browserTitle: 'In the browser',
    browserText: 'Nothing to install. Open the editor, load one of the ten examples from the toolbar, or drop a project file on the page.',
    localTitle: 'On your machine',
    localText: 'Serves the editor and the import bridge on 127.0.0.1 and opens it. Needs Node 20 or newer.',
    sourceTitle: 'From source',
    sourceText: 'The monorepo: engine, operators, both GPU backends, editor, importer, bridges. <code>npm run check</code> runs the type check and the test suite.',
    docsTitle: 'Documentation',
  },

  docs: {
    title: 'Documentation',
    navLabel: 'Documentation',
    menu: 'Docs menu',
    toc: 'On this page',
    prev: 'Previous',
    next: 'Next',
    pagerLabel: 'Previous and next page',
    edit: 'Edit this page on GitHub',
    groups: { start: 'Start', import: 'Import', build: 'Build', integrate: 'Integrate', engine: 'Engine' },
    opsFamily: 'Family',
    opsCount: 'Ops',
    opsList: 'Operators',
    opsTotal: 'Total',
    parityOfficial: 'Official',
    parityNote: 'Note',
    parityPop: 'imported POPs run their geometry through the SOP implementations',
    opsSource: 'Generated at build time from the operator registry in <code>packages/ops/src</code>, so this table always matches the code. Per-family stubs, which the importer uses for unmapped types, are not counted.',
  },
};
