"""Make a test-suite input from another workflow's output — or from an asset.

The library test suite feeds one workflow's result to the next. Most of the
time the file is used as it is; a few inputs need shaping first, and this does
it (run through ComfyUI's own python, which has PIL, numpy and PyAV).

IMAGE ops (the result is a PNG):

  frame        {"index": 0}              a still from a video (must be the first op)
  crop         {"box": [x0, y0, x1, y1]} fractions of the picture
  flip         {}                        left-right mirror
  scale        {"factor": 0.5}
  blur         {"radius": 3}             gaussian
  transparent  {"shape": "ellipse"|"rect", "box": [x0, y0, x1, y1]}
               make that region transparent -- how ComfyQ's mask painter marks
               "inpaint here" (LoadImage's MASK is 1 - alpha)
  circle       {"box": [...], "color": "#FF0000", "width": 0.008}
               an ellipse OUTLINE (no fill) — how Qwen-Image-Edit is told
               "this thing" in a picture; width is a fraction of the short side
  composite    {"overlay": "<file or asset:name>", "box": [...], "key": 242}
               paste a cut-out onto the picture, fitted bottom-centred into the
               box; the overlay's near-white background (min channel >= key) is
               keyed out, its edge left visible on purpose (a "pasted" look)
  jpeg         {"quality": 30}           bake JPEG block artefacts into the picture
  noise        {"sigma": 8, "seed": 1}   gaussian noise on 0-255, reproducible

VIDEO ops (the source is a video and the result an .mp4; no "frame" op):

  trim         {"start": 3, "duration": 2}   seconds; the audio is trimmed with it
  vscale       {"factor": 0.375}             every frame, Lanczos, even sizes
  vblur        {"radius": 1.5}               every frame
  mute         {}                            drop the audio
  encode       {"crf": 35}                   H.264 quality of the written file
                                             (default 16 = clean; 34-36 = blocky)

Reads {"src", "dest", "ops", "assets"} as JSON on stdin, writes dest, prints
{"ok": true, "size": [w, h], "kind": "image"|"video"} or {"ok": false, "error": "..."}.
"""
import json
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

VIDEO_OPS = {'trim', 'vscale', 'vblur', 'mute', 'encode'}


def frame_of(path, index):
    import av
    with av.open(path) as container:
        for i, f in enumerate(container.decode(video=0)):
            if i >= index:
                return f.to_image().convert('RGB')
    raise ValueError(f'the video has fewer than {index + 1} frames')


def box_px(box, size):
    w, h = size
    x0, y0, x1, y1 = (float(v) for v in box)
    return (round(x0 * w), round(y0 * h), round(x1 * w), round(y1 * h))


def resolve(name, assets):
    """An overlay given as asset:<name> lives in the assets folder."""
    if name.startswith('asset:'):
        p = os.path.realpath(os.path.join(assets or '', name[len('asset:'):]))
        root = os.path.realpath(assets or '')
        if not assets or not (p == root or p.startswith(root + os.sep)):
            raise ValueError(f'{name} is outside the assets folder')
        return p
    return name


def image_op(img, op, assets):
    name = op.get('op')
    if name == 'crop':
        return img.crop(box_px(op['box'], img.size))
    if name == 'flip':
        return ImageOps.mirror(img)
    if name == 'scale':
        f = float(op.get('factor', 1))
        return img.resize((max(1, round(img.width * f)), max(1, round(img.height * f))), Image.LANCZOS)
    if name == 'blur':
        return img.filter(ImageFilter.GaussianBlur(float(op.get('radius', 2))))
    if name == 'transparent':
        alpha = Image.new('L', img.size, 255)
        draw = ImageDraw.Draw(alpha)
        shape = draw.ellipse if op.get('shape', 'ellipse') == 'ellipse' else draw.rectangle
        shape(box_px(op['box'], img.size), fill=0)
        out = img.convert('RGB').convert('RGBA')
        out.putalpha(alpha)
        return out
    if name == 'circle':
        out = img.convert('RGB')
        w = max(2, round(min(out.size) * float(op.get('width', 0.008))))
        ImageDraw.Draw(out).ellipse(box_px(op['box'], out.size), outline=op.get('color', '#FF0000'), width=w)
        return out
    if name == 'composite':
        base = img.convert('RGB')
        ov = Image.open(resolve(op['overlay'], assets)).convert('RGB')
        r, g, b = ov.split()
        lo = ImageChops.darker(ImageChops.darker(r, g), b)            # min channel
        key = int(op.get('key', 242))
        alpha = lo.point(lambda v: 0 if v >= key else 255).filter(ImageFilter.GaussianBlur(float(op.get('feather', 1.0))))
        bbox = alpha.point(lambda v: 255 if v > 16 else 0).getbbox()
        if not bbox:
            raise ValueError('the overlay is all background after keying')
        ov, alpha = ov.crop(bbox), alpha.crop(bbox)
        x0, y0, x1, y1 = box_px(op['box'], base.size)
        bw, bh = x1 - x0, y1 - y0
        s = min(bw / ov.width, bh / ov.height)
        nw, nh = max(1, round(ov.width * s)), max(1, round(ov.height * s))
        ov, alpha = ov.resize((nw, nh), Image.LANCZOS), alpha.resize((nw, nh), Image.LANCZOS)
        base.paste(ov, (x0 + (bw - nw) // 2, y1 - nh), alpha)        # bottom-centred
        return base
    if name == 'jpeg':
        from io import BytesIO
        buf = BytesIO()
        img.convert('RGB').save(buf, format='JPEG', quality=int(op.get('quality', 40)))
        buf.seek(0)
        out = Image.open(buf)
        out.load()
        return out.convert('RGB')
    if name == 'noise':
        import numpy as np
        rng = np.random.default_rng(int(op.get('seed', 1)))
        arr = np.asarray(img.convert('RGB')).astype(np.float32)
        arr += rng.normal(0.0, float(op.get('sigma', 8)), arr.shape)
        return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    raise ValueError(f'unknown op "{name}"')


def derive_image(req):
    ops = list(req.get('ops') or [])
    if ops and ops[0].get('op') == 'frame':
        img = frame_of(req['src'], int(ops.pop(0).get('index', 0)))
    else:
        img = Image.open(req['src'])
        img.load()
        if img.mode not in ('RGB', 'RGBA'):
            img = img.convert('RGB')
    for op in ops:
        if op.get('op') in VIDEO_OPS:
            raise ValueError(f'"{op.get("op")}" is a video op; this chain makes a picture')
        img = image_op(img, op, req.get('assets'))
    img.save(req['dest'], format='PNG')
    return {'ok': True, 'size': list(img.size), 'kind': 'image'}


def derive_video(req):
    import av
    from fractions import Fraction
    ops = list(req.get('ops') or [])
    start, duration, mute, crf = 0.0, None, False, 16
    steps = []          # per-frame steps, IN ORDER: a down-scale then an up-scale softens
    for op in ops:
        n = op.get('op')
        if n == 'trim':
            start = float(op.get('start', 0)); duration = float(op['duration']) if op.get('duration') is not None else None
        elif n == 'vscale':
            steps.append(('scale', float(op.get('factor', 1))))
        elif n == 'vblur':
            steps.append(('blur', float(op.get('radius', 1.5))))
        elif n == 'mute':
            mute = True
        elif n == 'encode':
            crf = int(op.get('crf', 16))
        else:
            raise ValueError(f'"{n}" is not a video op')
    end = start + duration if duration is not None else None

    src = av.open(req['src'])
    vin = src.streams.video[0]
    rate = vin.average_rate or vin.guessed_rate or Fraction(24, 1)
    ain = None if mute or not src.streams.audio else src.streams.audio[0]
    w0, h0 = vin.codec_context.width, vin.codec_context.height
    factor = 1.0
    for kind, v in steps:
        if kind == 'scale':
            factor *= v
    w, h = max(2, round(w0 * factor / 2) * 2), max(2, round(h0 * factor / 2) * 2)

    out = av.open(req['dest'], 'w')
    vout = out.add_stream('libx264', rate=rate)
    vout.width, vout.height, vout.pix_fmt = w, h, 'yuv420p'
    vout.options = {'crf': str(crf), 'preset': 'medium'}
    aout = None
    if ain is not None:
        aout = out.add_stream('aac', rate=ain.codec_context.sample_rate or 48000)
        aout.layout = ain.codec_context.layout.name if ain.codec_context.layout else 'stereo'

    n = 0
    for frame in src.decode(vin):
        t = float(frame.pts * vin.time_base) if frame.pts is not None else n / float(rate)
        if t < start - 1e-6:
            continue
        if end is not None and t >= end - 1e-6:
            break
        img = frame.to_image().convert('RGB')
        f = 1.0
        for kind, v in steps:
            if kind == 'scale':
                f *= v
                img = img.resize((max(2, round(w0 * f)), max(2, round(h0 * f))), Image.LANCZOS)
            else:
                img = img.filter(ImageFilter.GaussianBlur(v))
        if img.size != (w, h):
            img = img.resize((w, h), Image.LANCZOS)
        vf = av.VideoFrame.from_image(img)
        vf.pts = n
        vf.time_base = Fraction(1, 1) / rate
        for p in vout.encode(vf):
            out.mux(p)
        n += 1
    for p in vout.encode():
        out.mux(p)
    if n == 0:
        raise ValueError('no frames in the chosen span')

    if aout is not None:
        src.close()
        src = av.open(req['src'])
        ain = src.streams.audio[0]
        resampler = av.AudioResampler(format='fltp', layout=aout.layout.name, rate=aout.rate)
        for frame in src.decode(ain):
            t = float(frame.pts * ain.time_base) if frame.pts is not None else 0.0
            if t < start - 0.05:
                continue
            if end is not None and t >= end:
                break
            frame.pts = None
            for rf in resampler.resample(frame):
                for p in aout.encode(rf):
                    out.mux(p)
        for p in aout.encode():
            out.mux(p)
    out.close()
    src.close()
    return {'ok': True, 'size': [w, h], 'kind': 'video', 'frames': n}


def main():
    req = json.load(sys.stdin)
    ops = list(req.get('ops') or [])
    is_video = any(op.get('op') in VIDEO_OPS for op in ops)
    res = derive_video(req) if is_video else derive_image(req)
    print(json.dumps(res))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # reported to the sweep, which skips the run with the reason
        print(json.dumps({'ok': False, 'error': f'{type(e).__name__}: {e}'}))
