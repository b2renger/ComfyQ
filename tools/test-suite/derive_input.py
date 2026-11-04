"""Make a test-suite input from another workflow's output.

The library test suite feeds one workflow's result to the next. Most of the
time the file is used as it is; a few inputs need shaping first, and this does
it (run through ComfyUI's own python, which has PIL and PyAV):

  frame        {"index": 0}              a still from a video (must be the first op)
  crop         {"box": [x0, y0, x1, y1]} fractions of the picture
  flip         {}                        left-right mirror
  scale        {"factor": 0.5}
  blur         {"radius": 3}             gaussian
  transparent  {"shape": "ellipse"|"rect", "box": [x0, y0, x1, y1]}
               make that region transparent -- how ComfyQ's mask painter marks
               "inpaint here" (LoadImage's MASK is 1 - alpha)

Reads {"src", "dest", "ops"} as JSON on stdin, writes a PNG to dest, prints
{"ok": true, "size": [w, h]} or {"ok": false, "error": "..."}.
"""
import json
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageOps


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


def main():
    req = json.load(sys.stdin)
    ops = list(req.get('ops') or [])
    if ops and ops[0].get('op') == 'frame':
        img = frame_of(req['src'], int(ops.pop(0).get('index', 0)))
    else:
        img = Image.open(req['src'])
        img.load()
        if img.mode not in ('RGB', 'RGBA'):
            img = img.convert('RGB')
    for op in ops:
        name = op.get('op')
        if name == 'crop':
            img = img.crop(box_px(op['box'], img.size))
        elif name == 'flip':
            img = ImageOps.mirror(img)
        elif name == 'scale':
            f = float(op.get('factor', 1))
            img = img.resize((max(1, round(img.width * f)), max(1, round(img.height * f))), Image.LANCZOS)
        elif name == 'blur':
            img = img.filter(ImageFilter.GaussianBlur(float(op.get('radius', 2))))
        elif name == 'transparent':
            alpha = Image.new('L', img.size, 255)
            draw = ImageDraw.Draw(alpha)
            shape = draw.ellipse if op.get('shape', 'ellipse') == 'ellipse' else draw.rectangle
            shape(box_px(op['box'], img.size), fill=0)
            img = img.convert('RGB').convert('RGBA')
            img.putalpha(alpha)
        else:
            raise ValueError(f'unknown op "{name}"')
    img.save(req['dest'], format='PNG')
    print(json.dumps({'ok': True, 'size': list(img.size)}))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # reported to the sweep, which skips the run with the reason
        print(json.dumps({'ok': False, 'error': f'{type(e).__name__}: {e}'}))
