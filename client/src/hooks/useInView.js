import { useEffect, useState } from 'react';

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
//
// The ref it returns is a CALLBACK ref: the observer follows the element as it
// mounts and unmounts. With an object ref read once in an effect, an element
// rendered later than the hook (the results grid's "load more" sentinel, which
// only exists once the jobs have arrived) was never observed at all.
export function useInView({ rootMargin = '300px', once = false } = {}) {
    const [el, setEl] = useState(null);
    const [inView, setInView] = useState(false);

    useEffect(() => {
        // Gone from the page: it is not in view (a `once` result stays as seen).
        if (!el) { if (!once) setInView(false); return; }
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
    }, [el, rootMargin, once]);

    return [setEl, inView];
}
