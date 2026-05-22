import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Box, Loader2, AlertTriangle } from 'lucide-react';

// Minimal three.js GLB viewer — no environment map, no AR, no post-fx. Two
// lights (hemisphere + directional) so PBR-textured meshes from Hunyuan3D
// look reasonable without an HDRI. OrbitControls for drag/zoom/pan; camera
// auto-frames the model from its bounding box on load.
//
// Render-on-demand: there's no permanent rAF loop. We only render when:
//   - the model finishes loading,
//   - OrbitControls fires 'change' (user dragged / zoomed / panned),
//   - the container resizes.
// This keeps dozens of grid-card viewers idle-cheap (no per-frame GPU draws
// when nobody is interacting). Damping is therefore disabled — it requires
// an interpolation loop, which would defeat the point.
//
// `compact` mode hides the help text overlay and tightens the loader for
// small grid thumbnails. The canvas wrapper stops pointer events so a drag
// to rotate the model doesn't bubble to a parent onClick (eg the Scheduler
// card that would otherwise open the lightbox).
const ModelViewer = ({ url, className = '', compact = false }) => {
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

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(width, height);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        mount.appendChild(renderer.domElement);

        scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.0));
        const dir = new THREE.DirectionalLight(0xffffff, 1.2);
        dir.position.set(2, 3, 2);
        scene.add(dir);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = false; // see render-on-demand note above
        let disposed = false;

        const render = () => {
            if (disposed) return;
            renderer.render(scene, camera);
        };
        controls.addEventListener('change', render);

        const loader = new GLTFLoader();
        loader.load(
            url,
            (gltf) => {
                if (disposed) return;
                const model = gltf.scene;
                scene.add(model);

                // Frame the model: shift origin to its center, set camera
                // distance so the bounding sphere fits the FOV with margin.
                const box = new THREE.Box3().setFromObject(model);
                const size = box.getSize(new THREE.Vector3());
                const center = box.getCenter(new THREE.Vector3());
                model.position.sub(center);

                const maxDim = Math.max(size.x, size.y, size.z) || 1;
                const fovRad = (camera.fov * Math.PI) / 180;
                const distance = (maxDim / 2) / Math.tan(fovRad / 2) * 1.6;

                camera.position.set(distance, distance * 0.4, distance);
                camera.near = distance / 100;
                camera.far = distance * 100;
                camera.updateProjectionMatrix();
                controls.target.set(0, 0, 0);
                controls.update();

                setStatus('ready');
                render();
            },
            undefined,
            (err) => {
                if (disposed) return;
                console.error('[ModelViewer] GLTF load failed:', err);
                setErrorMsg(err?.message || 'Failed to load 3D model');
                setStatus('error');
            }
        );

        // Resize handling — match the canvas to its container on layout change
        // (lightbox open, window resize). ResizeObserver is the modern path.
        const ro = new ResizeObserver(() => {
            const w = mount.clientWidth;
            const h = mount.clientHeight;
            if (w === 0 || h === 0) return;
            renderer.setSize(w, h);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            render();
        });
        ro.observe(mount);

        return () => {
            disposed = true;
            ro.disconnect();
            controls.removeEventListener('change', render);
            controls.dispose();
            // Walk the scene graph and release GPU resources so unmount
            // doesn't leak. Geometry, materials, and texture maps all need
            // explicit dispose() — three.js doesn't garbage-collect them.
            scene.traverse((obj) => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                    for (const m of mats) {
                        for (const key of Object.keys(m)) {
                            const v = m[key];
                            if (v && v.isTexture) v.dispose();
                        }
                        m.dispose();
                    }
                }
            });
            renderer.dispose();
            if (renderer.domElement.parentNode === mount) {
                mount.removeChild(renderer.domElement);
            }
        };
    }, [url]);

    // Pointer-event swallowing keeps drag-to-rotate from triggering parent
    // click handlers (Scheduler card → open lightbox). Click events on the
    // mount that *don't* turn into drags also stay here, which is fine: in
    // grid cards the user can click outside the viewer to open the lightbox.
    const stop = (e) => e.stopPropagation();

    return (
        <div
            className={`relative w-full h-full bg-black ${className}`}
            onPointerDown={stop}
            onPointerUp={stop}
            onClick={stop}
            onWheel={stop}
            onTouchStart={stop}
            onTouchEnd={stop}
        >
            <div ref={mountRef} className="w-full h-full" />
            {status === 'loading' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted pointer-events-none">
                    <Loader2 size={compact ? 18 : 32} className="animate-spin mb-2" />
                    {!compact && <span className="text-xs">Loading 3D model…</span>}
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
                    <Box size={10} />
                    <span>drag to rotate · scroll to zoom · right-click to pan</span>
                </div>
            )}
        </div>
    );
};

export default ModelViewer;
