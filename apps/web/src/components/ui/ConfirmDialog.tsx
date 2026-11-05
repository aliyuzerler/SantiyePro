'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './Button';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Yıkıcı işlem (silme/iptal) ise onay butonu destructive çizilir. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Dialog içeriğine ek alan (ör. iptal açıklaması). */
  children?: ReactNode;
}

/**
 * Onay diyaloğu — kritik işlemlerde onay zorunluluğu (agents.md UI/UX).
 * Erişilebilirlik: Escape ile kapanır, açılınca odak diyaloğa girer, arka plan aria-hidden.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Onayla',
  cancelLabel = 'Vazgeç',
  destructive = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/40 p-4" onClick={onCancel}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-dialog border border-border-default bg-surface-0 p-6 shadow-[0_12px_32px_rgba(20,38,61,0.18)]"
      >
        <h2 className="text-base font-bold text-brand-900">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-text-secondary">{message}</p>
        {children}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'destructive' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
