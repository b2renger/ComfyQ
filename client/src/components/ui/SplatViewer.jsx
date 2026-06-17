import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { Sparkles, Loader2, AlertTriangle } from 'lucide-react';

// Gaussian-splat viewer — the splat counterpart to ModelViewer.jsx (which
// renders polygon meshes via GLTFLoader). Splats can't go through GLTFLoader;
// they're point/gaussian data in `.spz` / `.ply` / `.splat` containers, so we
// use Spark (@sparkjsdev/spark) — a three.js-native splat renderer from the
// .spz authors. Spark adds a SparkRenderer (a THREE.Mesh) to the scene that
// does the splat sort/accumulation during the normal renderer.render() call.
//
// Continuous render loop (renderer.setAnimationLoop) rather than ModelViewer's
// render-on-demand. Splat sorting is camera-dependent and runs asynchronously
// on a worker, so an on-demand "render once per OrbitControls change" left
// wheel-zoom and right-click-pan looking dead (the sort landed a frame later
// with nothing to trigger the redraw). A steady loop is Spark's documented
// pattern and is cheap here because SplatViewer only mounts in the lightbox —
// one instance — never in the many-card grid (grids show a placeholder).
//
// Note: Spark recommends `antialias: false` on the WebGLRenderer — MSAA does
// nothing for splat accumulation and costs performance.
//
// `compact` mode hides the help overlay for small thumbnails. The wrapper
// swallows only the click so a tap doesn't bubble to a parent onClick — it must
// NOT swallow pointerup/pointerdown/wheel (see the note by `stop`), or
// OrbitControls' document-level pointerup never fires and rotate/zoom/pan break.
const SplatViewer = ({ url, className = '', compact = false }) => {
    const mountRef = useRef(null);
    const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
    const [errorMsg, setErrorMsg] = useState('');

    useEffect(() => {
        const mount = mountRef.current;
        if (!mount || !url) return;

        const width = mount.clientWidth;
        const height = mount.clientHeight;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x111111);

        const camera = new THREE.PerspectiveCamera(40, width / height, 0.01, 1000);
        camera.position.set(0, 0, 3);

        const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(width, height);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        mount.appendChild(renderer.domElement);

        let disposed = false;

        // SparkRenderer does the splat sort/accumulation during renderer.render().
        const spark = new SparkRenderer({ renderer });
        scene.add(spark);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.enableZoom = true;       // scroll to zoom
        controls.enablePan = true;        // right-click to pan
        controls.screenSpacePanning = true;
        controls.zoomToCursor = true;

        // Continuous render loop — Spark's recommended pattern. Unlike
        // ModelViewer (render-on-demand, because dozens of GLB thumbnails share
        // the grid), SplatViewer only ever mounts in the lightbox gallery, one
        // instance at a time, so a steady loop is cheap. It also lets Spark
        // re-sort splats every frame as the camera moves and gives damped
        // zoom/pan/rotate — the render-on-demand variant fought Spark's async
        // sort, which is why wheel-zoom and right-click-pan didn't update.
        renderer.setAnimationLoop(() => {
            if (disposed) return;
            controls.update();
            renderer.render(scene, camera);
        });

        // Spark splats use a Y-down convention vs three.js Y-up; a 180° flip
        // about X (quaternion (1,0,0,0)) brings them upright. Matches Spark's
        // own hello-world example.
        const splats = new SplatMesh({
            url,
            onLoad: () => {
                if (disposed) return;

                // Frame the splat from its bounding box (computed from splat
                // centers). Transform the local box by the mesh world matrix so
                // the flip above is accounted for, then place the camera so the
                // bounding sphere fits the FOV with margin.
                splats.updateMatrixWorld(true);
                let center = new THREE.Vector3(0, 0, 0);
                let maxDim = 1;
                try {
                    const box = splats.getBoundingBox(true).applyMatrix4(splats.matrixWorld);
                    if (box && isFinite(box.min.x) && !box.isEmpty()) {
                        const size = box.getSize(new THREE.Vector3());
                        center = box.getCenter(new THREE.Vector3());
                        maxDim = Math.max(size.x, size.y, size.z) || 1;
                    }
                } catch {
                    // getBoundingBox can throw on degenerate splats — fall back
                    // to the default framing below.
                }

                const fovRad = (camera.fov * Math.PI) / 180;
                const distance = (maxDim / 2) / Math.tan(fovRad / 2) * 1.6;
                camera.position.set(center.x + distance, center.y + distance * 0.4, center.z + distance);
                camera.near = distance / 100;
                camera.far = distance * 100;
                camera.updateProjectionMatrix();
                controls.target.copy(center);
                controls.update();

                setStatus('ready');
            },
            onProgress: undefined
        });
        splats.quaternion.set(1, 0, 0, 0);
        scene.add(splats);

        // SplatMesh surfaces load failures through the `initialized` promise
        // rejecting (onLoad only fires on success).
        splats.initialized?.catch?.((err) => {
            if (disposed) return;
            console.error('[SplatViewer] splat load failed:', err);
            setErrorMsg(err?.message || 'Failed to load Gaussian splat');
            setStatus('error');
        });

        const ro = new ResizeObserver(() => {
            const w = mount.clientWidth;
            const h = mount.clientHeight;
            if (w === 0 || h === 0) return;
            renderer.setSize(w, h);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        });
        ro.observe(mount);

        return () => {
            disposed = true;
            renderer.setAnimationLoop(null);
            ro.disconnect();
            controls.dispose();
            // Spark owns GPU buffers/workers for the splat data — dispose both
            // it and the mesh, then the renderer.
            try { splats.dispose(); } catch { /* already torn down */ }
            try { spark.dispose(); } catch { /* already torn down */ }
            renderer.dispose();
            if (renderer.domElement.parentNode === mount) {
                mount.removeChild(renderer.domElement);
            }
        };
    }, [url]);

    // Stop ONLY the click — that's what bubbles to a parent's onClick (eg a
    // Scheduler card that opens the lightbox). A real drag emits no click, so
    // rotate/zoom/pan never trigger it. Do NOT also stop pointerdown/pointerup/
    // wheel here: OrbitControls binds pointermove/pointerup on the canvas's
    // ownerDocument (not the canvas) and only clears its drag state in the
    // pointerup handler. React 17+ delegates events at the root container —
    // above this wrapper — so stopping pointerup blocks that native event from
    // ever reaching document. The drag then never ends (state stuck off-NONE),
    // and since onMouseWheel bails while state !== NONE, wheel-zoom dies too.
    // That was the "grabs the click but never releases, can't pan/zoom" bug.
    const stop = (e) => e.stopPropagation();

    return (
        <div
            className={`relative w-full h-full bg-black ${className}`}
            onClick={stop}
        >
            <div ref={mountRef} className="w-full h-full" />
            {status === 'loading' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted pointer-events-none">
                    <Loader2 size={compact ? 18 : 32} className="animate-spin mb-2" />
                    {!compact && <span className="text-xs">Loading splat…</span>}
                </div>
            )}
            {status === 'error' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-warning p-2 text-center">
                    <AlertTriangle size={compact ? 18 : 32} className="mb-1" />
                    {!compact && <span className="text-xs">{errorMsg}</span>}
                </div>
            )}
            {status === 'ready' && !compact && (
                <div className="absolute bottom-2 left-2 flex items-center gap-1.5 text-[10px] text-white/50 pointer-events-none">
                    <Sparkles size={10} />
                    <span>Gaussian splat · drag to rotate · scroll to zoom · right-click to pan</span>
                </div>
            )}
        </div>
    );
};

export default SplatViewer;
