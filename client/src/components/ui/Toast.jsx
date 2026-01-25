import React, { useEffect, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';

const Toast = ({ message, onClose, duration = 5000 }) => {
    const [isVisible, setIsVisible] = useState(true);

    useEffect(() => {
        const timer = setTimeout(() => {
            setIsVisible(false);
            setTimeout(onClose, 300); // Wait for animation
        }, duration);

        return () => clearTimeout(timer);
    }, [duration, onClose]);

    return (
        <div
            className={`fixed bottom-6 right-6 z-50 transition-all duration-300 ${isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
                }`}
        >
            <div className="bg-gradient-to-r from-success/90 to-success/80 backdrop-blur-lg border border-success/30 rounded-lg shadow-2xl p-4 flex items-center gap-3 min-w-[320px] max-w-md">
                <div className="p-2 bg-white/10 rounded-full">
                    <CheckCircle2 size={24} className="text-white" />
                </div>
                <div className="flex-1">
                    <p className="text-white font-semibold text-sm">Job Completed! 🎨</p>
                    <p className="text-white/80 text-xs mt-0.5">{message}</p>
                </div>
                <button
                    onClick={() => {
                        setIsVisible(false);
                        setTimeout(onClose, 300);
                    }}
                    className="p-1 hover:bg-white/10 rounded-full transition-colors"
                >
                    <X size={16} className="text-white/70" />
                </button>
            </div>
        </div>
    );
};

export default Toast;
