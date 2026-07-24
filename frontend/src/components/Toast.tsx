import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface ToastMessage {
  id: number;
  text: string;
  type: 'success' | 'error' | 'info';
}

interface ToastCtx {
  toast: (text: string, type?: 'success' | 'error' | 'info') => void;
}

const ToastContext = createContext<ToastCtx>({ toast: () => {} });
export const useToast = () => useContext(ToastContext);

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const toast = useCallback((text: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = nextId++;
    setMessages((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setMessages((prev) => prev.filter((m) => m.id !== id));
    }, 4500);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div style={{
        position: 'fixed', bottom: 24, right: 24,
        zIndex: 10000,
        display: 'flex', flexDirection: 'column',
        gap: 'var(--space-sm)',
        pointerEvents: 'none',
        maxWidth: 380,
      }}>
        {messages.map((m) => {
          const bgColor = m.type === 'success' ? 'var(--color-teal)'
            : m.type === 'error' ? 'var(--color-red)'
            : 'var(--color-accent)';
          return (
            <div
              key={m.id}
              style={{
                padding: 'var(--space-md) var(--space-lg)',
                borderRadius: 'var(--radius-lg)',
                color: m.type === 'info' ? 'var(--color-bg)' : '#fff',
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                background: bgColor,
                boxShadow: 'var(--shadow-lg)',
                pointerEvents: 'auto',
                animation: 'dt-slide-in-right 0.25s ease-out',
                fontFamily: 'var(--font-body)',
                lineHeight: 1.4,
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                border: '1px solid var(--color-glass-border)',
              }}
            >
              {m.text}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
