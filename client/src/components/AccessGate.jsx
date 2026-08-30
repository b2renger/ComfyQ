import React, { useState } from 'react';
import Card from './ui/Card';
import Button from './ui/Button';
import { Lock, ArrowRight } from 'lucide-react';
import { SERVER_URL } from '../utils/api';
import { setAccessToken } from '../utils/access';

/**
 * AccessGate
 *
 * Shown before the student UI when this machine has an access password set
 * (Admin → "Student access"). The admin uses it to keep a rig for one group:
 * anyone else on the LAN reaches this screen and stops here.
 *
 * On success the server returns a token, which we store and replay on the
 * socket handshake / uploads. The password itself is never kept.
 *
 * @param {Function} props.onUnlocked - called once the token is stored
 * @param {string}   [props.machineName] - shown in the subtitle when known
 */
const AccessGate = ({ onUnlocked, machineName }) => {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [checking, setChecking] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        if (!password || checking) return;
        setChecking(true);
        setError('');
        try {
            const res = await fetch(`${SERVER_URL}/access/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data.error || 'Wrong password');
                setPassword('');
                return;
            }
            setAccessToken(data.token || '');
            onUnlocked?.();
        } catch {
            setError('Could not reach this machine — check your connection.');
        } finally {
            setChecking(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/90 backdrop-blur-xl animate-in fade-in duration-500">
            <div className="w-full max-w-md animate-in zoom-in-95 slide-in-from-bottom-4 duration-500 delay-150 fill-mode-both">
                <Card className="shadow-2xl border-border overflow-hidden relative">
                    <div className="relative space-y-6 py-4">
                        <div className="flex flex-col items-center text-center space-y-2">
                            <div className="w-16 h-16 bg-surface border border-border rounded-2xl flex items-center justify-center mb-4">
                                <Lock size={30} className="text-muted" />
                            </div>
                            <h2 className="text-2xl font-bold tracking-tight text-foreground">This machine is reserved</h2>
                            <p className="text-muted text-sm max-w-[300px]">
                                {machineName ? `“${machineName}” needs` : 'This ComfyQ station needs'} an access
                                password. Ask the person running the session for it.
                            </p>
                        </div>

                        <form onSubmit={submit} className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-muted uppercase tracking-widest ml-1">
                                    Access password
                                </label>
                                <input
                                    autoFocus
                                    type="password"
                                    className={`w-full bg-background border rounded-xl px-4 py-3 text-foreground focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all placeholder:text-muted/30 ${error ? 'border-danger/60' : 'border-border'}`}
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => { setPassword(e.target.value); if (error) setError(''); }}
                                    required
                                />
                                {error && <p className="text-xs text-danger ml-1">{error}</p>}
                            </div>

                            <Button
                                type="submit"
                                isLoading={checking}
                                className="w-full py-4 text-base font-bold rounded-xl active:scale-[0.98]"
                                icon={checking ? undefined : ArrowRight}
                            >
                                {checking ? 'Checking…' : 'Unlock'}
                            </Button>
                        </form>
                    </div>
                </Card>
            </div>
        </div>
    );
};

export default AccessGate;
