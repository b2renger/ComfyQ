import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { getImageUrl, getDownloadUrl } from '../../utils/api';

// Multi-image gallery for jobs that emit N images (Qwen multi-angle, batch
// outputs, …). A large main image fills the square, with prev/next arrows, a
// "k / N" counter, an optional per-image label, a download button for the
// current view, and a horizontal thumbnail strip to jump around.
//
// `images`: [{ filename, label }]. Lives in the lightbox media area (one
// instance), so a plain <img> per view is fine — no virtualization needed for
// the handful of outputs these workflows produce.
const ImageGallery = ({ images }) => {
    const [idx, setIdx] = useState(0);
    const n = images.length;
    const i = Math.min(idx, n - 1);
    const cur = images[i];
    const go = (d) => setIdx((i + d + n) % n);

    const downloadCurrent = (e) => {
        e.stopPropagation();
        const a = document.createElement('a');
        a.href = getDownloadUrl(cur.filename);
        a.download = cur.filename.split('/').pop();
        document.body.appendChild(a);
        a.click();
        a.remove();
    };

    return (
        <div className="w-full h-full flex flex-col bg-black">
            <div className="relative flex-1 min-h-0 flex items-center justify-center">
                <img src={getImageUrl(cur.filename)} alt={cur.label || `View ${i + 1}`} className="max-w-full max-h-full object-contain" />

                {cur.label && (
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/60 backdrop-blur-md text-[11px] font-medium text-white capitalize">
                        {cur.label}
                    </span>
                )}
                <span className="absolute top-2 right-2 px-2 py-0.5 rounded bg-black/60 backdrop-blur-md text-[11px] font-mono text-white/80">
                    {i + 1} / {n}
                </span>
                <button
                    onClick={downloadCurrent}
                    title="Download this view"
                    className="absolute bottom-2 right-2 p-2 rounded-full bg-black/60 hover:bg-primary text-white backdrop-blur-md transition-colors"
                >
                    <Download size={16} />
                </button>

                {n > 1 && (
                    <>
                        <button onClick={() => go(-1)} className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/50 hover:bg-black/80 text-white transition-colors">
                            <ChevronLeft size={20} />
                        </button>
                        <button onClick={() => go(1)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/50 hover:bg-black/80 text-white transition-colors">
                            <ChevronRight size={20} />
                        </button>
                    </>
                )}
            </div>

            <div className="shrink-0 flex gap-1.5 p-2 overflow-x-auto bg-black/40">
                {images.map((im, k) => (
                    <button
                        key={im.filename}
                        onClick={() => setIdx(k)}
                        title={im.label || undefined}
                        className={`shrink-0 w-14 h-14 rounded overflow-hidden border-2 transition-colors ${k === i ? 'border-primary' : 'border-transparent hover:border-white/30'}`}
                    >
                        <img src={getImageUrl(im.filename)} alt={im.label || `View ${k + 1}`} className="w-full h-full object-cover" />
                    </button>
                ))}
            </div>
        </div>
    );
};

export default ImageGallery;
