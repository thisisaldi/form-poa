"use client";

import { useEffect } from "react";
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;
  const t = TONE[tone];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onCancel} aria-hidden />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="relative w-full max-w-sm rounded-lg shadow-xl"
        style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
      >
        <div className="p-5 space-y-3">
          <div className="flex items-start gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base"
              style={{ background: t.bg, color: t.fg }}
              aria-hidden
            >
              {t.icon}
            </span>
            <div className="min-w-0 pt-1">
              <p id="confirm-dialog-title" className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>
                {title}
              </p>
              <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                {message}
              </p>
            </div>
          </div>
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
    </div>
  );
}
