import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Loader2, AlertTriangle, Globe } from 'lucide-react';

// Look around inside an equirectangular (2:1) panorama — the picture is
// wrapped on the inside of a sphere and the camera sits at its centre.
// Drag to look, scroll to zoom (field of view 30°–100°).
//
// Render-on-demand like ModelViewer: a frame is drawn only when the texture
// arrives, the view changes, or the container resizes.
//
// Dragging uses pointer capture on the canvas, so the drag ends even when the
// pointer is released outside it. The wrapper stops only `click` from
// bubbling (see ModelViewer for why stopping pointer events breaks things).
const PanoramaViewer = ({ url }) => {
    const mountRef = useRef(null);
    const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'

    useEffect(() => {
        const mount = mountRef.current;
        if (!mount || !url) return;
        let disposed = false;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, (mount.clientWidth || 1) / (mount.clientHeight || 1), 0.1, 1100);
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(mount.clientWidth, mount.clientHeight);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        mount.appendChild(renderer.domElement);
        const canvas = renderer.domElement;
        canvas.style.cursor = 'grab';
        canvas.style.touchAction = 'none';

        // Inside-out sphere: flipping x makes the texture read the right way
        // round from the centre.
        const geometry = new THREE.SphereGeometry(500, 96, 48);
        geometry.scale(-1, 1, 1);
        const material = new THREE.MeshBasicMaterial();
        scene.add(new THREE.Mesh(geometry, material));

        let lon = 0, lat = 0;
        const render = () => {
            if (disposed) return;
            const phi = THREE.MathUtils.degToRad(90 - lat);
            const theta = THREE.MathUtils.degToRad(lon);
            camera.lookAt(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
            renderer.render(scene, camera);
        };

        new THREE.TextureLoader().load(
            url,
            (tex) => {
                if (disposed) { tex.dispose(); return; }
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
                material.map = tex;
                material.needsUpdate = true;
                setStatus('ready');
                render();
            },
            undefined,
            () => { if (!disposed) setStatus('error'); }
        );

        let drag = null;
        const onDown = (e) => {
            if (e.button !== 0) return;
            canvas.setPointerCapture(e.pointerId);
            drag = { x: e.clientX, y: e.clientY, lon, lat };
            canvas.style.cursor = 'grabbing';
        };
        const onMove = (e) => {
            if (!drag) return;
            // Degrees per pixel follows the zoom, so a drag feels the same at any fov.
            const k = camera.fov / (mount.clientHeight || 1);
            lon = drag.lon - (e.clientX - drag.x) * k;
            lat = Math.max(-85, Math.min(85, drag.lat + (e.clientY - drag.y) * k));
            render();
        };
        const onUp = () => { drag = null; canvas.style.cursor = 'grab'; };
        const onWheel = (e) => {
            e.preventDefault();
            camera.fov = Math.max(30, Math.min(100, camera.fov + e.deltaY * 0.05));
            camera.updateProjectionMatrix();
            render();
        };
        canvas.addEventListener('pointerdown', onDown);
        canvas.addEventListener('pointermove', onMove);
        canvas.addEventListener('pointerup', onUp);
        canvas.addEventListener('pointercancel', onUp);
        canvas.addEventListener('wheel', onWheel, { passive: false });

        const ro = new ResizeObserver(() => {
            const w = mount.clientWidth, h = mount.clientHeight;
            if (!w || !h) return;
            renderer.setSize(w, h);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            render();
        });
        ro.observe(mount);

        return () => {
            disposed = true;
            ro.disconnect();
            canvas.removeEventListener('pointerdown', onDown);
            canvas.removeEventListener('pointermove', onMove);
            canvas.removeEventListener('pointerup', onUp);
            canvas.removeEventListener('pointercancel', onUp);
            canvas.removeEventListener('wheel', onWheel);
            if (material.map) material.map.dispose();
            material.dispose();
            geometry.dispose();
            renderer.dispose();
            if (canvas.parentNode === mount) mount.removeChild(canvas);
        };
    }, [url]);

    return (
        <div className="relative w-full h-full bg-black" onClick={(e) => e.stopPropagation()}>
            <div ref={mountRef} className="w-full h-full" />
            {status === 'loading' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted pointer-events-none">
                    <Loader2 size={32} className="animate-spin mb-2" />
                    <span className="text-xs">Loading panorama…</span>
                </div>
            )}
            {status === 'error' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-warning p-2 text-center">
                    <AlertTriangle size={32} className="mb-1" />
                    <span className="text-xs">The panorama could not be loaded.</span>
                </div>
            )}
            {status === 'ready' && (
                <div className="absolute bottom-2 left-2 flex items-center gap-1.5 text-[10px] text-white/50 pointer-events-none">
                    <Globe size={10} />
                    <span>drag to look around · scroll to zoom</span>
                </div>
            )}
        </div>
    );
};

export default PanoramaViewer;
