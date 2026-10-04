---
title: Expressions
description: Drive any parameter with a JavaScript expression that reads time, channels, other parameters and values sent by a host page.
---

Any parameter can switch from a constant to an expression with its **ƒ** button. An expression is a single JavaScript expression, compiled once per source string and evaluated every time the parameter is read, against a fixed scope.

```js
op('lfo1')['chan1']                  // channel chan1 of the CHOP lfo1
op('lfo1')[0] * 10                   // first channel, by index
parent().par.speed * 0.5             // parameter `speed` of the COMP this node is in
op('noise1').par.period              // another node's parameter
time.seconds * 0.2                   // engine time
fract(time.seconds * 0.02)           // a slow 0..1 ramp
clamp(op('mouse1')['ty'], 0, 1)      // mouse in, clamped
ext('energy', 0.5)                   // a value from the host page, 0.5 until one arrives
```

## The scope {#scope}

| Name | Value |
|---|---|
| `time.seconds`, `time.frame`, `time.delta`, `time.fps` | engine time: seconds since start, frame count, last frame's duration, smoothed frame rate |
| `me` | this node: `me.name`, `me.path`, `me.par.<key>` |
| `op(path)` | another node. `op('x')['chan']` or `op('x')[i]` reads a CHOP channel (its last sample); `op('x').par.<key>` reads a parameter |
| `parent(n = 1)` | the COMP `n` levels up, with `.par.<key>` |
| `ext(name, fallback = 0)` | a number set from outside the patch ([Embedding](embedding.md)) |
| `PI`, `abs`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `floor`, `ceil`, `round`, `trunc`, `min`, `max`, `pow`, `sqrt`, `exp`, `log`, `sign` | as in JavaScript's `Math` |
| `clamp(v, lo, hi)`, `fract(v)`, `lerp(a, b, t)` | the usual helpers |
| `rand(seed)` | a deterministic 0..1 hash of `seed` (the same seed always gives the same value) |

Paths work like TouchDesigner's: `op('noise1')` looks in the network the node lives in, `op('../lfo1')` one level up, `op('/geo1/out1')` from the root.

## Reading other nodes {#reading}

`op()` cooks the node it points at when needed, so an expression always sees the current frame's value. Reading parameters through `.par` is live too, and a guard stops parameter cycles (two parameters that read each other): the node reports an expression cycle instead of recursing. A CHOP read by an expression needs no wire: the path in the expression is the connection.

## Errors {#errors}

A syntax error marks the field red. When an expression throws, or returns something other than a number, string, boolean or array of numbers, the parameter falls back to its constant value and the node shows the error on its badge. Expressions are user-authored patch code, evaluated with `new Function` against the scope above: the trust model of a patching environment, not a security sandbox. Do not paste expressions you would not run.

## From TouchDesigner {#from-td}

Imported Python expressions are translated when the translation is faithful (`absTime.seconds*0.2` → `time.seconds*0.2`, `math.sin(x)` → `sin(x)`, `a if c else b` → `c ? a : b`) and kept inert otherwise; imported Python is never executed. The full table is in [Importing](importing.md#expressions).
