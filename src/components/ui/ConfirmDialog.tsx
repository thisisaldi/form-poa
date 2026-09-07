"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Colors the icon + confirm button. "warning" for state-resetting actions, "danger" for destructive ones. */
  tone?: "warning" | "danger";
  /** Disables + shows a spinner on the confirm button — e.g. while the action is in flight. */
  confirmPending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const TONE = {
  warning: { fg: "var(--color-warning, #f59e0b)", bg: "var(--color-warning-bg, #fef3c7)", icon: "⚠" },
  danger: { fg: "var(--color-red, #dc2626)", bg: "var(--color-red-light, #fee2e2)", icon: "🗑" },
} as const;

export function ConfirmDialog({
  open, title, message, confirmLabel = "Lanjutkan", cancelLabel = "Batal",
  tone = "warning", confirmPending = false, onConfirm, onCancel,
}: ConfirmDialogProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open || !mounted) return null;
  const t = TONE[tone];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 text-left whitespace-normal">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-xs" onClick={onCancel} aria-hidden />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="relative w-full max-w-md rounded-lg shadow-xl text-left whitespace-normal"
        style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
      >
        <div className="p-5 space-y-2">
          <h3 id="confirm-dialog-title" className="font-semibold text-base" style={{ color: "var(--color-text)" }}>
            {title}
          </h3>
          <p className="text-sm leading-relaxed whitespace-normal break-words" style={{ color: "var(--color-text-muted)" }}>
            {message}
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-3" style={{ borderColor: "var(--color-border)" }}>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={confirmPending}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onConfirm}
            loading={confirmPending}
            style={tone === "warning" ? { background: t.fg, color: "#fff" } : undefined}
            variant={tone === "danger" ? "danger" : "primary"}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
