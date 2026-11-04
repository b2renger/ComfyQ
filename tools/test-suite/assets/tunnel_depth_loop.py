"""Synthesize a perfectly seamless DEPTH-PASS loop for the loop-restyle card: the camera flies
straight down an endless square corridor whose walls carry identical square frames (ribs) at
exactly even spacing. Depth-map convention: near = white, far = black; the far end fades to black.
One cycle = the camera advances exactly one rib spacing, so frame CYCLE equals frame 0.
Writes CYCLES whole cycles (no duplicated closing frame) as H.264, 24 fps, no audio.
usage: python -I tunnel_depth_loop.py out.mp4 [W H CYCLE CYCLES]   (defaults 1024 576 34 3)"""
import sys, numpy as np, av
out = sys.argv[1]
W, H = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (1024, 576)
CYCLE = int(sys.argv[4]) if len(sys.argv) > 4 else 34   # frames per rib spacing (34 x 3 = 102 = the length-107 loop)
CYCLES = int(sys.argv[5]) if len(sys.argv) > 5 else 3
A, RIB = 1.0, 0.22                      # corridor half-width, rib depth into the corridor (fraction of A)
Z_NEAR, SPACING, N, FALLOFF = 0.55, 1.0, 16, 2.4   # near plane, rib spacing, ribs drawn, depth fade length
F = Z_NEAR * (W / 2) / A                # wall reaches the frame edge at the near plane
Z_FAR = Z_NEAR + N * SPACING
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
r = np.maximum(np.abs(xx - W / 2), np.abs(yy - H / 2)) + 1e-3   # square radius of each pixel
wall_z = F * A / r                                             # depth of the corridor wall seen at that pixel
def lum(z):
    return np.clip(np.exp(-(z - Z_NEAR) / FALLOFF), 0, 1)      # near = white, fades to black with distance
def frame(t):                          # t in [0, 1): phase within one rib spacing
    z = wall_z.copy()
    for k in range(N + 1):
        zk = Z_NEAR + (k + 1 - t) * SPACING
        if zk <= Z_NEAR or zk > Z_FAR: continue
        outer, inner = F * A / zk, F * A * (1 - RIB) / zk
        hit = (r <= outer) & (r >= inner)
        z = np.where(hit, np.minimum(z, zk), z)               # the rib face is nearer than the wall behind it
    return (lum(z) * 255).astype(np.uint8)
c = av.open(out, 'w'); st = c.add_stream('libx264', rate=24)
st.width, st.height, st.pix_fmt = W, H, 'yuv420p'; st.options = {'crf': '12'}
for i in range(CYCLE * CYCLES):
    g = frame((i % CYCLE) / CYCLE)
    for p in st.encode(av.VideoFrame.from_ndarray(np.stack([g, g, g], -1), format='rgb24')): c.mux(p)
for p in st.encode(): c.mux(p)
c.close()
print('frames', CYCLE * CYCLES, 'seam diff (frame after last vs first):',
      int(np.abs(frame(0.0).astype(int) - frame(((CYCLE * CYCLES) % CYCLE) / CYCLE).astype(int)).max()))
