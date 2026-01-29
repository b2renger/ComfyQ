import React, { useEffect } from 'react';
import { X, Download, User, Clock, Sparkles } from 'lucide-react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { getImageUrl, getDownloadUrl, isVideo } from '../utils/api';

const ImageLightbox = ({ isOpen, onClose, job }) => {
    if (!job) return null;

    const isVid = isVideo(job.result_filename);

    const downloadMedia = (e) => {
        e.stopPropagation();
        const link = document.createElement('a');
        link.href = getDownloadUrl(job.result_filename);
        link.download = job.result_filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Generation Details" maxWidth="max-w-4xl">
            <div className="flex flex-col lg:flex-row gap-6">
                {/* Media Section */}
                <div className="flex-1 relative group">
                    <div className="aspect-square bg-black rounded-xl overflow-hidden border border-white/10 shadow-2xl flex items-center justify-center">
                        {isVid ? (
                            <video
                                src={getImageUrl(job.result_filename)}
                                className="w-full h-full object-contain"
                                controls
                                autoPlay
                                loop
                            />
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
                                    "{job.prompt}"
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-4 pt-2">
                                <div className="space-y-1">
                                    <label className="text-[10px] text-muted uppercase font-bold tracking-wider">Steps</label>
                                    <p className="text-sm font-mono text-white">{job.params?.steps || 20}</p>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] text-muted uppercase font-bold tracking-wider">Resolution</label>
                                    <p className="text-sm font-mono text-white">{job.params?.width}x{job.params?.height}</p>
                                </div>
                            </div>
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

                    <div className="pt-4 mt-auto">
                        <Button
                            variant="primary"
                            className="w-full"
                            icon={Download}
                            onClick={downloadMedia}
                        >
                            Download Creation
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
};

export default ImageLightbox;
