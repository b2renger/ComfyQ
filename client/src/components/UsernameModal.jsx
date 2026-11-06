import React, { useState } from 'react';
import { useSocket } from '../context/SocketContext';
import Card from './ui/Card';
import Button from './ui/Button';
import { UserCircle2, ArrowRight } from 'lucide-react';

// The library's showcase jobs live under this user (tools/maintenance/
// seed_examples.cjs). A job's owner is just the name typed here, so a student
// who took it could delete the examples and the result files they point to.
// The server refuses it too; this only says so before anything is sent.
const RESERVED_NAMES = new Set(['examples', 'storyboard']);

const UsernameModal = () => {
    const { username, registerUser } = useSocket();
    const [name, setName] = useState('');
    const [error, setError] = useState('');

    if (username) return null;

    const handleSubmit = (e) => {
        e.preventDefault();
        const n = name.trim();
        if (!n) return;
        if (RESERVED_NAMES.has(n.toLowerCase())) {
            setError(`“${n}” is reserved for ComfyQ's own jobs — please choose another name.`);
            return;
        }
        registerUser(n);
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-xl animate-in fade-in duration-500">
            <div className="w-full max-w-md animate-in zoom-in-95 slide-in-from-bottom-4 duration-500 delay-150 fill-mode-both">
                <Card className="shadow-2xl border-border overflow-hidden relative">
                    <div className="relative space-y-6 py-4">
                        <div className="flex flex-col items-center text-center space-y-2">
                            <div className="w-16 h-16 bg-surface border border-border rounded-2xl flex items-center justify-center mb-4">
                                <UserCircle2 size={32} className="text-muted" />
                            </div>
                            <h2 className="text-2xl font-bold tracking-tight text-foreground">Welcome to ComfyQ</h2>
                            <p className="text-muted text-sm max-w-[280px]">
                                Please enter your name to start scheduling your creative generations.
                            </p>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-muted uppercase tracking-widest ml-1">Your Name</label>
                                <input
                                    autoFocus
                                    type="text"
                                    className="w-full bg-background border border-border rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all placeholder:text-muted/30"
                                    placeholder="e.g. Alex"
                                    value={name}
                                    onChange={(e) => { setName(e.target.value); setError(''); }}
                                    required
                                />
                                {error && (
                                    <p className="text-xs text-danger ml-1">{error}</p>
                                )}
                            </div>

                            <Button
                                type="submit"
                                className="w-full py-4 text-base font-bold rounded-xl active:scale-[0.98]"
                                icon={ArrowRight}
                            >
                                Start Creating
                            </Button>
                        </form>
                    </div>
                </Card>
            </div>
        </div>
    );
};

export default UsernameModal;
