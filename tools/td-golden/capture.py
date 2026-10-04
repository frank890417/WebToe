"""
Capture TouchDesigner golden data for WebToe's TOP fidelity tests.

Runs INSIDE TouchDesigner (Python 3, numpy ships with TD), e.g. from the
Textport, a Text DAT, or the touchdesigner-mcp `execute_python_script` tool:

    exec(open('/path/to/webtoe/tools/td-golden/capture.py').read())
    capture('/path/to/golden')          # or set the TD_GOLDEN_DIR env var

It builds a temporary baseCOMP, feeds TD-generated inputs (32-bit float
ramp / noise) through Level, Edge, Ramp, Blur, Noise and Composite TOPs with
the parameter sets below, and writes:

    <out>/manifest.json   jobs, parameters actually applied, TD build
    <out>/<name>.npy      float32 H x W x 4, row 0 = bottom (TOP.numpyArray)

Then, from the repo:

    TD_GOLDEN_DIR=/path/to/golden npx vitest run tests/td-golden.test.ts

Nothing here is copied from TouchDesigner; it only drives TD's public
Python API and records what the operators output. A parameter TD does not
know is recorded under the job's "errors" and the test skips that job.
"""
import json
import os

import numpy as np

W, H = 128, 64

INPUTS = {
    # name: (TD operator type, parameters)
    'ramp': ('rampTOP', {'type': 'horizontal', 'resolutionw': 256, 'resolutionh': 4,
                         'extendleft': 'hold', 'antialias': 1}),
    'smooth': ('noiseTOP', {'type': 'perlin3d', 'resolutionw': W, 'resolutionh': H, 'mono': 0,
                            'period': 0.8, 'harmon': 1, 'amp': 0.5, 'offset': 0.5}),
    'compa': ('noiseTOP', {'type': 'simplex3d', 'resolutionw': W, 'resolutionh': H, 'mono': 0,
                           'seed': 2, 'period': 0.6, 'alpha': 'random'}),
    'compb': ('noiseTOP', {'type': 'perlin2d', 'resolutionw': W, 'resolutionh': H, 'mono': 0,
                           'seed': 7, 'period': 1.3, 'amp': 0.6}),
}

LEVEL = [
    {}, {'invert': 1, 'blacklevel': 0.25}, {'brightness1': 2, 'contrast': 1.5},
    {'gamma1': 2.2, 'contrast': 1.3}, {'blacklevel': 0.1, 'brightness1': 1.4, 'gamma1': 0.6},
    {'inlow': 0.2, 'inhigh': 0.8, 'outlow': 0.1, 'outhigh': 0.9, 'opacity': 0.6},
    {'lowr': 0.1, 'highr': 0.9, 'highg': 0.5, 'gamma2': 0.7, 'brightness2': 1.2},
    {'invert': 0.5, 'contrast': 2},
]
EDGE = [
    {}, {'strength': 3.4}, {'strength': 2, 'offset1': 1.8, 'offset2': 1.8, 'blacklevel': 0.1},
    {'select': 'rgbmax', 'strength': 0.648}, {'offset1': 3, 'offset2': 3},
    {'combineinput': 'compedge', 'edgecolorr': 1, 'edgecolorg': 0.5, 'edgecolorb': 0},
]
RAMP_KEYS = [[0.0, 0.9, 0.2, 0.1, 1.0], [0.4, 0.1, 0.8, 0.3, 0.5], [0.8, 0.1, 0.3, 1.0, 1.0]]
RAMP = [
    {'type': 'horizontal'}, {'type': 'horizontal', 'phase': 0.25, 'period': 0.5},
    {'type': 'vertical', 'phase': -0.2, 'period': 1.5, 'extendleft': 'hold'},
    {'type': 'horizontal', 'phase': 0.3, 'extendleft': 'mirror'},
    {'type': 'radial', 'phase': 0.1}, {'type': 'circular', 'period': 0.7, 'extendleft': 'zero', 'position1': 0.1},
    {'type': 'horizontal', 'interpnotches': 'hermite'}, {'type': 'horizontal', 'antialias': 1, 'phase': 0.1},
]
BLUR = [
    {}, {'size': 16, 'type': 'gaussian'}, {'size': 9, 'preshrink': 2}, {'size': 4, 'type': 'box'},
    {'size': 7, 'offsetx': 2, 'offsety': 2}, {'size': 12, 'filterscalex': 2, 'filterscaley': 0.5},
]
NOISE = [dict(type=t, mono=0) for t in ('perlin2d', 'perlin3d', 'perlin4d', 'simplex2d', 'simplex3d', 'simplex4d')] + [
    {'type': 'perlin3d', 'period': 0.5, 'tx': 0.3, 'rz': 30, 'harmon': 1, 'amp': 0.8, 'exp': 2, 'offset': 0.2},
    {'type': 'simplex4d', 't4d': 0.7, 'spread': 2.5, 'gain': 0.5, 'seed': 7},
    {'type': 'simplex3d', 'aspectcorrect': 0, 'harmon': 0},
]
COMPOSITE = ['add', 'atop', 'average', 'brightest', 'burncolor', 'burnlinear', 'chromadifference', 'color', 'darkercolor',
             'difference', 'dimmest', 'divide', 'dodge', 'exclude', 'freeze', 'glow', 'hardlight', 'hardmix', 'heat', 'hue',
             'inside', 'insideluminance', 'inverse', 'lightercolor', 'luminancedifference', 'maximum', 'minimum', 'multiply',
             'negate', 'outside', 'outsideluminance', 'over', 'overlay', 'pinlight', 'reflect', 'screen', 'softlight',
             'linearlight', 'stencilluminance', 'subtract', 'subtractive', 'under', 'vividlight', 'xor', 'yfilm', 'zfilm']


def _set(node, params, errors):
    for k, v in params.items():
        p = getattr(node.par, k, None)
        if p is None:
            errors.append('unknown parameter %s' % k)
            continue
        try:
            p.val = v
        except Exception as e:  # menu token TD does not accept, read-only…
            errors.append('%s=%r: %s' % (k, v, e))


def _float32(node, errors):
    _set(node, {'format': 'rgba32float'}, errors)


def _generator(base, kind, name, params, errors):
    node = base.create(globals()[kind], name)
    _set(node, {'outputresolution': 'custom'}, errors)
    _float32(node, errors)
    _set(node, params, errors)
    return node


def _save(node, out, fname):
    node.cook(force=True)
    arr = node.numpyArray(delayed=False)
    np.save(os.path.join(out, fname), np.ascontiguousarray(arr, dtype=np.float32))
    return [int(arr.shape[1]), int(arr.shape[0])]


def capture(out_dir=None):
    out = out_dir or os.environ.get('TD_GOLDEN_DIR')
    if not out:
        raise ValueError('give an output directory or set TD_GOLDEN_DIR')
    os.makedirs(out, exist_ok=True)
    root = op('/')  # noqa: F821 (TouchDesigner global)
    old = root.op('webtoe_golden')
    if old is not None:
        old.destroy()
    base = root.create(baseCOMP, 'webtoe_golden')  # noqa: F821
    manifest = {'td': {'build': str(app.build), 'version': str(app.version)}, 'inputs': {}, 'jobs': []}  # noqa: F821
    try:
        ins = {}
        for name, (kind, params) in INPUTS.items():
            errs = []
            ins[name] = _generator(base, kind, 'in_' + name, params, errs)
            ins[name].cook(force=True)
            size = _save(ins[name], out, 'in_%s.npy' % name)
            manifest['inputs'][name] = {'file': 'in_%s.npy' % name, 'size': size, 'params': params, 'errors': errs}

        def job(op_name, kind, idx, params, inputs, extra=None):
            errs = []
            name = '%s_%02d' % (op_name, idx)
            node = base.create(globals()[kind], name)
            for i, src in enumerate(inputs):
                node.inputConnectors[i].connect(ins[src])
            if not inputs:
                _set(node, {'outputresolution': 'custom', 'resolutionw': W, 'resolutionh': H}, errs)
            _float32(node, errs)
            if extra:
                extra(node, errs)
            _set(node, params, errs)
            size = _save(node, out, name + '.npy')
            manifest['jobs'].append({'id': name, 'op': op_name, 'params': params, 'inputs': inputs,
                                     'file': name + '.npy', 'size': size, 'errors': errs})

        for i, p in enumerate(LEVEL):
            job('level', 'levelTOP', i, p, ['ramp'])
        for i, p in enumerate(EDGE):
            job('edge', 'edgeTOP', i, p, ['smooth'])

        keys = base.create(tableDAT, 'ramp_keys')  # noqa: F821
        keys.clear()
        keys.appendRow(['pos', 'r', 'g', 'b', 'a'])
        for k in RAMP_KEYS:
            keys.appendRow(k)
        for i, p in enumerate(RAMP):
            job('ramp', 'rampTOP', i, p, [], extra=lambda n, e: _set(n, {'dat': keys}, e))
        manifest['ramp_keys'] = RAMP_KEYS

        for i, p in enumerate(BLUR):
            job('blur', 'blurTOP', i, p, ['smooth'])
        for i, p in enumerate(NOISE):
            job('noise', 'noiseTOP', i, p, [])
        for i, operand in enumerate(COMPOSITE):
            job('composite', 'compositeTOP', i, {'operand': operand}, ['compa', 'compb'])
    finally:
        base.destroy()
    with open(os.path.join(out, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
    return len(manifest['jobs'])


if os.environ.get('TD_GOLDEN_DIR') and __name__ in ('__main__', 'builtins'):
    capture()
