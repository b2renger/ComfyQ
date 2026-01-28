import React, { useState, useCallback } from 'react';
import { Upload, FileJson, AlertCircle, CheckCircle, FileUp } from 'lucide-react';

const WorkflowUpload = ({ onUploadSuccess }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState(null);

    const handleDrag = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setIsDragging(true);
        } else if (e.type === 'dragleave') {
            setIsDragging(false);
        }
    }, []);

    const processFile = async (file) => {
        if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
            setError('Please upload a valid JSON workflow file');
            return;
        }

        setIsUploading(true);
        setError(null);

        const formData = new FormData();
        formData.append('workflow', file);

        try {
            // Import SERVER_URL dynamically or assume relative path if checking locally
            const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

            const response = await fetch(`${SERVER_URL}/admin/upload-workflow`, {
                method: 'POST',
                body: formData,
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to parse workflow');
            }

            onUploadSuccess(data);
        } catch (err) {
            console.error('Upload failed:', err);
            setError(err.message);
        } finally {
            setIsUploading(false);
            setIsDragging(false);
        }
    };

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            processFile(e.dataTransfer.files[0]);
        }
    }, []);

    const handleFileSelect = (e) => {
        if (e.target.files && e.target.files[0]) {
            processFile(e.target.files[0]);
        }
    };

    return (
        <div className="w-full max-w-2xl mx-auto">
            <div
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                className={`
                    relative group border-2 border-dashed rounded-2xl p-12 transition-all duration-300 transform
                    ${isDragging
                        ? 'border-primary bg-primary/10 scale-[1.02]'
                        : 'border-white/10 hover:border-primary/50 hover:bg-white/5 bg-surface/50'
                    }
                    ${isUploading ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                `}
            >
                <input
                    type="file"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    accept=".json"
                    onChange={handleFileSelect}
                    disabled={isUploading}
                />

                <div className="flex flex-col items-center text-center space-y-6">
                    <div className={`
                        p-6 rounded-full transition-all duration-500
                        ${isDragging ? 'bg-primary text-white shadow-lg shadow-primary/30' : 'bg-surface border border-white/10 text-slate-400 group-hover:text-primary group-hover:border-primary/30'}
                    `}>
                        {isUploading ? (
                            <Upload className="animate-bounce" size={40} />
                        ) : (
                            <FileJson size={40} />
                        )}
                    </div>

                    <div className="space-y-2">
                        <h3 className="text-xl font-semibold text-white">
                            {isUploading ? 'Parsing Workflow...' : 'Upload ComfyUI Workflow'}
                        </h3>
                        <p className="text-slate-400 max-w-sm mx-auto">
                            Drag and drop your .json workflow file here, or click to browse
                        </p>
                    </div>

                    {!isUploading && !error && (
                        <div className="flex items-center gap-2 text-xs text-slate-500 bg-surface/50 px-3 py-1.5 rounded-full border border-white/5">
                            <FileUp size={12} />
                            <span>Supports standard ComfyUI JSON format</span>
                        </div>
                    )}
                </div>
            </div>

            {error && (
                <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-200 animate-in slide-in-from-top-2 fade-in">
                    <AlertCircle size={20} className="shrink-0" />
                    <p>{error}</p>
                </div>
            )}
        </div>
    );
};

export default WorkflowUpload;
