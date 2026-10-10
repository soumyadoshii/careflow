import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

type ToastItem = { id: number; message: string; kind: 'success' | 'error' | 'info' };
type ToastApi = { showToast: (message: string, kind?: ToastItem['kind']) => void };
const ToastContext = createContext<ToastApi>({ showToast: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const showToast = useCallback((message: string, kind: ToastItem['kind'] = 'success') => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current, { id, message, kind }]);
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 4200);
  }, []);
  const value = useMemo(() => ({ showToast }), [showToast]);
  return <ToastContext.Provider value={value}>{children}<div className="toast-stack" aria-live="polite">{items.map((item) => <div className={`toast toast-${item.kind}`} key={item.id}>{item.kind === 'error' ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}<span>{item.message}</span><button aria-label="Dismiss notification" onClick={() => setItems((current) => current.filter((toast) => toast.id !== item.id))}><X size={14} /></button></div>)}</div></ToastContext.Provider>;
}

export const useToast = (): ToastApi => useContext(ToastContext);
