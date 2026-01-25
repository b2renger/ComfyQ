import React, { useState } from 'react';
import { useSocket } from '../context/SocketContext';
import Card from './ui/Card';
import Button from './ui/Button';
import { UserCircle2, ArrowRight } from 'lucide-react';

const UsernameModal = () => {
    const { username, registerUser } = useSocket();
    const [name, setName] = useState('');

    if (username) return null;

    const handleSubmit = (e) => {
        e.preventDefault();
        if (name.trim()) {
            registerUser(name.trim());
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-xl animate-in fade-in duration-500">
            <div className="w-full max-w-md animate-in zoom-in-95 slide-in-from-bottom-4 duration-500 delay-150 fill-mode-both">
                <Card className="shadow-2xl border-white/10 overflow-hidden relative group">
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-secondary/10 opacity-50 pointer-events-none" />

                    <div className="relative space-y-6 py-4">
                        <div className="flex flex-col items-center text-center space-y-2">
                            <div className="w-16 h-16 bg-gradient-to-br from-primary to-secondary rounded-2xl flex items-center justify-center shadow-2xl shadow-primary/20 mb-4 group-hover:scale-110 transition-transform duration-500">
                                <UserCircle2 size={32} className="text-white" />
                            </div>
                            <h2 className="text-2xl font-bold tracking-tight text-white">Welcome to ComfyQ</h2>
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
                                    onChange={(e) => setName(e.target.value)}
                                    required
                                />
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
