import React, { useEffect, useState } from 'react';
import Modal from './Modal';
import Button from './Button';
import { AlertTriangle, KeyRound } from 'lucide-react';

// Reusable confirmation dialog. Supports an optional admin-password input
// when `requirePassword` is true — used for cross-user deletions.
const ConfirmDialog = ({
    isOpen,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'danger',
    requirePassword = false,
    passwordHint,
    isBusy = false,
    onConfirm,
    onClose
}) => {
    const [password, setPassword] = useState('');
    useEffect(() => { if (!isOpen) setPassword(''); }, [isOpen]);

    const handleConfirm = () => {
        if (requirePassword && !password) return;
        onConfirm(requirePassword ? password : undefined);
    };

    return (
        <Modal isOpen={isOpen} onClose={isBusy ? undefined : onClose} title={title} maxWidth="max-w-md">
            <div className="space-y-4">
                <div className="flex items-start gap-3">
                    <AlertTriangle size={20} className={variant === 'danger' ? 'text-danger shrink-0 mt-0.5' : 'text-warning shrink-0 mt-0.5'} />
                    <p className="text-sm text-slate-300">{message}</p>
                </div>
                {requirePassword && (
                    <div className="space-y-1.5">
                        <label className="text-xs uppercase tracking-wider text-muted font-semibold flex items-center gap-1.5">
                            <KeyRound size={12} /> Admin password
                        </label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && password) handleConfirm(); }}
                            placeholder="Required to act on another user's job"
                            autoFocus
                            className="w-full bg-background border border-border rounded-lg p-2.5 text-white text-sm"
                        />
                        {passwordHint && <p className="text-[10px] text-muted">{passwordHint}</p>}
                    </div>
                )}
                <div className="flex justify-end gap-2 pt-2 border-t border-border">
                    <Button variant="ghost" onClick={onClose} disabled={isBusy}>{cancelLabel}</Button>
                    <Button
                        variant={variant}
                        onClick={handleConfirm}
                        disabled={isBusy || (requirePassword && !password)}
                    >
                        {isBusy ? 'Working…' : confirmLabel}
                    </Button>
                </div>
            </div>
        </Modal>
    );
};

export default ConfirmDialog;
