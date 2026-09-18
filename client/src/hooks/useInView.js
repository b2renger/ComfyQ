import { useEffect, useRef, useState } from 'react';

// Is this element on (or near) the screen?
//
// The results grid can hold hundreds of cards. Every video card used to decode
// and autoplay at once, and every GLB card built its own WebGL context —
// browsers cap those at ~16 and silently kill the oldest, which is why 3D
// thumbnails went blank and the tab crawled. Cards use this to play or mount
// only what the student can actually see.
//
// `rootMargin` starts the work slightly before the card scrolls in, so it is
// ready by the time it is visible.
export function useInView({ rootMargin = '300px', once = false } = {}) {
    const ref = useRef(null);
    const [inView, setInView] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        // No IntersectionObserver (very old browser): show everything rather
        // than nothing.
        if (typeof IntersectionObserver === 'undefined') { setInView(true); return; }
        const io = new IntersectionObserver((entries) => {
            const visible = entries.some(e => e.isIntersecting);
            setInView(visible);
            if (visible && once) io.disconnect();
        }, { rootMargin });
        io.observe(el);
        return () => io.disconnect();
    }, [rootMargin, once]);

    return [ref, inView];
}

export default useInView;
