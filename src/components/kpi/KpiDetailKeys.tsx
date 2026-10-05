"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Esc = back to list, ←/→ = previous/next personil. Ignored while typing in a field. */
export function KpiDetailKeys({ back, prev, next }: { back: string; prev: string | null; next: string | null }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement | null)?.tagName ?? "")) return;
      if (e.key === "Escape") router.push(back);
      else if (e.key === "ArrowLeft" && prev) router.push(prev);
      else if (e.key === "ArrowRight" && next) router.push(next);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router, back, prev, next]);
  return null;
}
