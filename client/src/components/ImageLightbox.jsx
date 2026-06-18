import React, { useState } from 'react';
import { Download, User, Clock, Sparkles, RotateCw, Wand2, Box, Copy } from 'lucide-react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import ModelViewer from './ui/ModelViewer';
import SplatViewer from './ui/SplatViewer';
import AudioPlayer from './ui/AudioPlayer';
import ImageGallery from './ui/ImageGallery';
import { useSocket } from '../context/SocketContext';
import { getImageUrl, getDownloadUrl, isVideo, isModel3d, isSplat, isAudio, isImage } from '../utils/api';
import { getDisplayPrompt, getPrimaryDownloadFilename, getGenerationMs, formatDuration, getJobText } from '../utils/jobDisplay';

const downloadFile = (filename) => {
    if (!filename) return;
    const link = document.createElement('a');
    link.href = getDownloadUrl(filename);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

// Derive a human label from a ComfyUI output filename's prefix, dropping the
// trailing `_00001_` counter + extension and a leading "ComfyUI[-_]". Returns
// '' when nothing meaningful remains (generic "ComfyUI_00001_.png"), so the
// gallery only labels views when the workflow named them (e.g. the multi-angle
// workflow's "ComfyUI-close_up", "ComfyUI-45_right").
const deriveViewLabel = (filename) => {
    if (!filename) return '';
    const base = filename.split('/').pop();
    const m = base.match(/^(.+?)_\d+_?\.\w+$/);
    let p = (m ? m[1] : base.replace(/\.\w+$/, ''));
    p = p.replace(/^ComfyUI[-_]?/i, '').replace(/[-_]+/g, ' ').trim();
    return p;
};

const ImageLightbox = ({ isOpen, onClose, job, onReuse }) => {
    const { workflowsById } = useSocket();
    // Gallery tab for 3D jobs that ship both a splat and a mesh (TripoSplat).
    const [view, setView] = useState('splat'); // 'splat' | 'mesh'
    if (!job) return null;
    const wf = workflowsById?.[job.workflow_id];
    const displayPrompt = getDisplayPrompt(job);

    // The wire job carries every output the executor collected. A TripoSplat
    // job ships a Gaussian splat (.spz) + an extracted mesh (.glb) + a .ply
    // splat export — and (legacy) maybe a video, which we deliberately ignore
    // here. Pick a persistent output over a temp/ one for each viewer.
    const outputs = job.outputs || [];
    const pick = (test) => outputs.find(o => test(o.filename) && o.type !== 'temp')
        || outputs.find(o => test(o.filename)) || null;
    const fileByExt = (rx) => (outputs.find(o => rx.test(o.filename || '') && o.type !== 'temp')
        || outputs.find(o => rx.test(o.filename || '')))?.filename || null;

    const splatOutput = pick(isSplat);
    const meshOutput = pick(isModel3d);
    const is3D = !!(splatOutput || meshOutput);

    // Export targets — one button per format that the job actually produced.
    const spzFile = fileByExt(/\.spz$/i);
    const plyFile = fileByExt(/\.ply$/i);
    const glbFile = fileByExt(/\.(glb|gltf)$/i);

    // Which viewer the gallery shows. Falls back to whichever exists when only
    // one is present, so the toggle never lands on an empty pane.
    const activeView = !splatOutput ? 'mesh' : !meshOutput ? 'splat' : view;

    // Non-3D jobs keep the original single-media + single-download behavior.
    const primaryFilename = getPrimaryDownloadFilename(job);
    const isVid = !is3D && isVideo(job.result_filename);
    const isAud = !is3D && isAudio(job.result_filename);

    // Multi-image jobs (Qwen multi-angle, batch outputs) → gallery. Prefer
    // persistent outputs; a single image keeps the plain <img> path.
    const imageOutputs = outputs.filter(o => isImage(o.filename) && o.type !== 'temp');
    const isMultiImage = !is3D && !isAud && !isVid && imageOutputs.length > 1;
    const galleryImages = imageOutputs.map(o => ({ filename: o.filename, label: deriveViewLabel(o.filename) }));

    // Text-output jobs (Gemma describe / captioning) have no media file — the
    // result is an inline string. Render it as a readable, copyable panel.
    const jobText = getJobText(job);
    const isTextJob = !is3D && !isAud && !isVid && !isMultiImage && !job.result_filename && !!jobText;

    const downloadAll = (e) => {
        e.stopPropagation();
        // Best-effort sequential downloads (browsers may throttle past the
        // first few; the gallery's per-image button is the reliable fallback).
        galleryImages.forEach((im, k) => setTimeout(() => downloadFile(im.filename), k * 250));
    };

    const downloadMedia = (e) => {
        e.stopPropagation();
        downloadFile(primaryFilename);
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Generation Details" maxWidth="max-w-4xl">
            <div className="flex flex-col lg:flex-row gap-6">
                {/* Media Section */}
                <div className="flex-1 relative group">
                    {/* Gallery toggle — only when the job has both a splat and a mesh. */}
                    {splatOutput && meshOutput && (
                        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex rounded-lg overflow-hidden border border-white/10 bg-black/60 backdrop-blur-md text-xs">
                            <button
                                onClick={() => setView('splat')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${activeView === 'splat' ? 'bg-primary text-white' : 'text-white/70 hover:text-white'}`}
                            >
                                <Sparkles size={12} /> Splat
                            </button>
                            <button
                                onClick={() => setView('mesh')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${activeView === 'mesh' ? 'bg-primary text-white' : 'text-white/70 hover:text-white'}`}
                            >
                                <Box size={12} /> Mesh
                            </button>
                        </div>
                    )}
                    <div className="aspect-square bg-black rounded-xl overflow-hidden border border-white/10 shadow-2xl flex items-center justify-center">
                        {is3D ? (
                            activeView === 'splat' && splatOutput ? (
                                <SplatViewer url={getImageUrl(splatOutput.filename)} />
                            ) : (
                                <ModelViewer url={getImageUrl((meshOutput || splatOutput).filename)} />
                            )
                        ) : isAud ? (
                            <AudioPlayer url={getImageUrl(job.result_filename)} filename={job.result_filename} />
                        ) : isMultiImage ? (
                            <ImageGallery images={galleryImages} />
                        ) : isVid ? (
                            <video
                                src={getImageUrl(job.result_filename)}
                                className="w-full h-full object-contain"
                                controls
                                autoPlay
                                loop
                            />
                        ) : isTextJob ? (
                            <div className="w-full h-full overflow-y-auto custom-scrollbar p-5 text-left">
                                <p className="text-sm text-slate-100 leading-relaxed whitespace-pre-wrap">{jobText}</p>
                            </div>
                        ) : (
                            <img
                                src={getImageUrl(job.result_filename)}
                                alt="Full Preview"
                                className="w-full h-full object-contain"
                            />
                        )}
                    </div>
                </div>

                {/* Sidebar Info Section */}
                <div className="lg:w-80 flex flex-col space-y-6">
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] uppercase tracking-widest text-muted font-bold">Status</span>
                            <div className="flex items-center space-x-2">
                                <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                                <span className="text-xs font-semibold text-success uppercase">Completed</span>
                            </div>
                        </div>

                        <div className="p-4 bg-white/5 rounded-xl border border-white/10 space-y-4">
                            <div className="space-y-1">
                                <label className="text-[10px] text-muted uppercase font-bold tracking-wider">Prompt</label>
                                <p className="text-sm text-slate-200 leading-relaxed italic">
                                    {displayPrompt ? `"${displayPrompt}"` : <span className="text-muted not-italic">No prompt entered</span>}
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-4 pt-2">
                                {job.params?.steps != null && (
                                    <div className="space-y-1">
                                        <label className="text-[10px] text-muted uppercase font-bold tracking-wider">Steps</label>
                                        <p className="text-sm font-mono text-white">{job.params.steps}</p>
                                    </div>
                                )}
                                {(job.params?.width != null && job.params?.height != null) && (
                                    <div className="space-y-1">
                                        <label className="text-[10px] text-muted uppercase font-bold tracking-wider">Resolution</label>
                                        <p className="text-sm font-mono text-white">{job.params.width}x{job.params.height}</p>
                                    </div>
                                )}
                                {(() => {
                                    const genMs = getGenerationMs(job);
                                    return genMs != null ? (
                                        <div className="space-y-1">
                                            <label className="text-[10px] text-muted uppercase font-bold tracking-wider">Generation time</label>
                                            <p className="text-sm font-mono text-white">{formatDuration(genMs)}</p>
                                        </div>
                                    ) : null;
                                })()}
                            </div>

                            {job.workflow_id && (
                                <div className="space-y-1 pt-3 border-t border-white/10">
                                    <label className="text-[10px] text-muted uppercase font-bold tracking-wider">Workflow</label>
                                    <p className="text-sm font-medium text-foreground flex items-center gap-2">
                                        <Wand2 size={14} className="text-primary shrink-0" />
                                        <span className="truncate" title={job.workflow_id}>{wf?.name || job.workflow_id}</span>
                                    </p>
                                    {wf && wf.category && wf.category !== 'other' && (
                                        <p className="text-[10px] text-muted uppercase tracking-wider">{wf.category}</p>
                                    )}
                                    {!wf && (
                                        <p className="text-[10px] text-warning">No longer in library</p>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="flex flex-col space-y-3 pt-2">
                            <div className="flex items-center space-x-3 text-muted">
                                <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center">
                                    <User size={14} />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-xs font-semibold text-white">{job.user_id}</span>
                                    <span className="text-[10px]">Creator</span>
                                </div>
                            </div>
                            <div className="flex items-center space-x-3 text-muted">
                                <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center">
                                    <Clock size={14} />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-xs font-semibold text-white">
                                        {new Date(job.time_slot).toLocaleTimeString()}
                                    </span>
                                    <span className="text-[10px]">{new Date(job.time_slot).toLocaleDateString()}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="pt-4 mt-auto space-y-2">
                        {onReuse && (
                            <Button
                                variant="secondary"
                                className="w-full"
                                icon={RotateCw}
                                onClick={() => { onReuse(job); onClose(); }}
                                title="Open the booking dialog pre-filled with this job's prompt and parameters"
                            >
                                Use these settings
                            </Button>
                        )}
                        {is3D ? (
                            <div className="space-y-2">
                                <label className="text-[10px] text-muted uppercase font-bold tracking-wider">Export</label>
                                {spzFile && (
                                    <Button variant="primary" className="w-full" icon={Download}
                                        onClick={() => downloadFile(spzFile)} title="Gaussian splat (Spark / .spz)">
                                        Splat (.spz)
                                    </Button>
                                )}
                                {plyFile && (
                                    <Button variant="secondary" className="w-full" icon={Download}
                                        onClick={() => downloadFile(plyFile)} title="Gaussian splat point cloud (.ply)">
                                        Splat (.ply)
                                    </Button>
                                )}
                                {glbFile && (
                                    <Button variant="secondary" className="w-full" icon={Download}
                                        onClick={() => downloadFile(glbFile)} title="Polygon mesh (.glb)">
                                        Mesh (.glb)
                                    </Button>
                                )}
                            </div>
                        ) : isMultiImage ? (
                            <Button
                                variant="primary"
                                className="w-full"
                                icon={Download}
                                onClick={downloadAll}
                            >
                                Download all ({galleryImages.length})
                            </Button>
                        ) : isTextJob ? (
                            <Button
                                variant="primary"
                                className="w-full"
                                icon={Copy}
                                onClick={() => { try { navigator.clipboard?.writeText(jobText); } catch { /* clipboard may be blocked */ } }}
                            >
                                Copy text
                            </Button>
                        ) : (
                            <Button
                                variant="primary"
                                className="w-full"
                                icon={Download}
                                onClick={downloadMedia}
                            >
                                Download Creation
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </Modal>
    );
};

export default ImageLightbox;
