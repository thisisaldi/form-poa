"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";

interface NotReadyButtonProps {
  label: string;
  message?: string;
}

/** A button for features that aren't built yet — stays on the page and shows a toast instead of navigating. */
export function NotReadyButton({ label, message = "Fitur ini masih dalam pengembangan." }: NotReadyButtonProps) {
  const [showToast, setShowToast] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleClick() {
    setShowToast(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShowToast(false), 3000);
  }

  return (
    <div className="relative inline-block">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={handleClick}
        className="opacity-60"
        title={message}
      >
        {label}
      </Button>
      {showToast && (
        <div
          className="absolute right-0 top-full z-50 mt-2 whitespace-nowrap rounded-md px-3 py-2 text-xs font-medium shadow-lg"
          style={{ background: "var(--color-text)", color: "var(--color-surface)" }}
        >
          {message}
        </div>
      )}
    </div>
  );
}
