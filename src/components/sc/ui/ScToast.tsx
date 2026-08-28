"use client";

import { createContext, useContext, useState, ReactNode } from "react";

type ToastType = "success" | "error" | "info";

interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
}

interface ScToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ScToastContext = createContext<ScToastContextType | undefined>(undefined);

export function ScToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = (message: string, type: ToastType = "success") => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  return (
    <ScToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast container floating on top right */}
      <div className="fixed top-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all transform animate-in fade-in slide-in-from-top-2"
            style={{
              background:
                t.type === "success"
                  ? "#dcfce7"
                  : t.type === "error"
                  ? "#fee2e2"
                  : "#eff6ff",
              color:
                t.type === "success"
                  ? "#15803d"
                  : t.type === "error"
                  ? "#dc2626"
                  : "#1d4ed8",
              border: `1px solid ${
                t.type === "success"
                  ? "#86efac"
                  : t.type === "error"
                  ? "#fca5a5"
                  : "#93c5fd"
              }`,
            }}
          >
            <div className="flex items-center gap-2.5">
              <span className="font-bold text-base leading-none">
                {t.type === "success" ? "✓" : t.type === "error" ? "✕" : "ℹ"}
              </span>
              <span className="leading-snug">{t.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="text-xs opacity-60 hover:opacity-100 font-bold px-1"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ScToastContext.Provider>
  );
}

export function useScToast() {
  const context = useContext(ScToastContext);
  if (!context) {
    return {
      showToast: (msg: string) => console.log("Toast:", msg),
    };
  }
  return context;
}
