import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import styles from './Toast.module.css';

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
      <div className={styles.container}>
        {messages.map((m) => {
          const bgColor = m.type === 'success' ? 'var(--color-teal)'
            : m.type === 'error' ? 'var(--color-red)'
            : 'var(--color-accent)';
          return (
            <div
              key={m.id}
              className={styles.toast}
              style={{
                color: m.type === 'info' ? 'var(--color-bg)' : '#fff',
                background: bgColor,
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
