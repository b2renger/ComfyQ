import React from 'react';
import { isVideo, getImageUrl } from '../../utils/api';
import { Play } from 'lucide-react';

const MediaPreview = ({ filename, className = '', alt = 'Preview', showPlayIcon = true }) => {
    const isVid = isVideo(filename);
    const url = getImageUrl(filename);

    if (isVid) {
        return (
            <div className={`relative w-full h-full ${className}`}>
                <video
                    src={url}
                    className="w-full h-full object-cover"
                    muted
                    loop
                    playsInline
                    autoPlay
                />
                {showPlayIcon && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
                        <div className="p-2 rounded-full bg-white/20 backdrop-blur-sm border border-white/30">
                            <Play size={16} className="text-white fill-current" />
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <img
            src={url}
            alt={alt}
            className={`w-full h-full object-cover ${className}`}
        />
    );
};

export default MediaPreview;
