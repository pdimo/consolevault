import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Button, cx } from './ui';

// --- Toasts -----------------------------------------------------------------
type ToastTone = 'info' | 'success' | 'error';
interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});
export const useToast = () => useContext(ToastContext);

const TONE_BORDER: Record<ToastTone, string> = {
  info: 'border-l-accent',
  success: 'border-l-ok',
  error: 'border-l-bad',
};

// --- Confirm dialog ---------------------------------------------------------
interface ConfirmOpts {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}
const ConfirmContext = createContext<(opts: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmContext);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const [confirmState, setConfirmState] = useState<
    (ConfirmOpts & { resolve: (v: boolean) => void }) | null
  >(null);
  const confirm = useCallback(
    (opts: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirmState({ ...opts, resolve })),
    [],
  );
  const closeConfirm = (v: boolean) => {
    confirmState?.resolve(v);
    setConfirmState(null);
  };

  return (
    <ToastContext.Provider value={toast}>
      <ConfirmContext.Provider value={confirm}>
        {children}

        {/* Toasts */}
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={cx(
                'pointer-events-auto rounded-lg border border-l-4 border-line bg-surface px-4 py-3 text-sm shadow-lg',
                TONE_BORDER[t.tone],
              )}
            >
              {t.message}
            </div>
          ))}
        </div>

        {/* Confirm dialog */}
        {confirmState && (
          <div
            className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
            onClick={() => closeConfirm(false)}
          >
            <div
              className="w-full max-w-sm rounded-xl border border-line bg-surface p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold">{confirmState.title}</h3>
              {confirmState.message && (
                <div className="mt-2 text-sm text-muted">{confirmState.message}</div>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => closeConfirm(false)}>
                  Cancel
                </Button>
                <Button
                  variant={confirmState.danger ? 'danger' : 'primary'}
                  onClick={() => closeConfirm(true)}
                >
                  {confirmState.confirmLabel ?? 'Confirm'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}
