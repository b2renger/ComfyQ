import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import Card from './Card';

const Modal = ({ isOpen, onClose, title, children, maxWidth = 'max-w-md' }) => {
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
            <div
                className="absolute inset-0 bg-black/70 backdrop-blur-md transition-opacity"
                onClick={onClose}
            />
            <div className={`relative w-full ${maxWidth} z-10 animate-in fade-in zoom-in-95 duration-200 max-h-[95vh] flex flex-col`}>
                <Card className="shadow-2xl border-white/10 flex flex-col overflow-hidden" noPadding>
                    <div className="flex items-center justify-between p-4 sm:p-6 border-b border-border bg-surface shrink-0">
                        <h3 className="text-lg font-semibold text-white truncate mr-4">{title}</h3>
                        <button
                            onClick={onClose}
                            className="p-2 -mr-2 text-muted hover:text-white transition-colors rounded-lg hover:bg-white/5"
                        >
                            <X size={20} />
                        </button>
                    </div>
                    <div className="p-4 sm:p-6 overflow-y-auto custom-scrollbar">
                        {children}
                    </div>
                </Card>
            </div>
        </div>
    );
};

export default Modal;
