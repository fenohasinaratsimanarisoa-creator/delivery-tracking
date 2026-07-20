import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface ToastMessage {
  id: number;
  text: string;
  type: 'success' | 'error';
}

interface ToastCtx {
  toast: (text: string, type?: 'success' | 'error') => void;
}

const ToastContext = createContext<ToastCtx>({ toast: () => {} });
export const useToast = () => useContext(ToastContext);

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const toast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    const id = nextId++;
    setMessages((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setMessages((prev) => prev.filter((m) => m.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 3000, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {messages.map((m) => (
          <div key={m.id} style={{
            padding: '12px 20px', borderRadius: 6, color: '#fff', fontSize: '0.9rem',
            background: m.type === 'success' ? '#28a745' : '#dc3545',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)', transition: 'opacity 0.3s',
          }}>
            {m.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
