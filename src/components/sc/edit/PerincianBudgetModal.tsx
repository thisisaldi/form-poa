"use client";

import React from "react";

function formatRp(val: number): string {
  return new Intl.NumberFormat("id-ID").format(Math.round(val || 0));
}

interface PerincianBudgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  totalEstimasiBudget?: number;
  totalNilaiSc: number;
  totalDiskonVal: number;
  totalEntertainVal: number;
  totalCashbackVal: number;
  totalBlastInVal?: number;
  totalPosmVal?: number;
  showCashback?: boolean;
  showBlastIn?: boolean;
  showPosm?: boolean;
}

export function PerincianBudgetModal({
  isOpen,
  onClose,
  totalEstimasiBudget,
  totalNilaiSc,
  totalDiskonVal,
  totalEntertainVal,
  totalCashbackVal,
  totalBlastInVal = 0,
  totalPosmVal = 0,
  showCashback = true,
  showBlastIn = false,
  showPosm = false,
}: PerincianBudgetModalProps) {
  if (!isOpen) return null;

  const items: { label: string; value: number }[] = [
    { label: "INSENTIF SC", value: totalNilaiSc },
    { label: "DISKON", value: totalDiskonVal },
    { label: "ENTERTAIN", value: totalEntertainVal },
  ];

  if (showCashback) {
    items.push({ label: "CASHBACK", value: totalCashbackVal });
  }
  if (showBlastIn) {
    items.push({ label: "BLAST-IN", value: totalBlastInVal });
  }
  if (showPosm) {
    items.push({ label: "POSM", value: totalPosmVal });
  }

  const calculatedTotal =
    totalEstimasiBudget ??
    items.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
      <div
        className="w-full max-w-sm rounded-xl border shadow-xl overflow-hidden space-y-4 p-5 animate-scale-in"
        style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--color-border)" }}>
          <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: "var(--color-text)" }}>
            PERINCIAN ESTIMASI BUDGET
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-md text-lg leading-none cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Total Display */}
        <div className="space-y-0.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
            TOTAL ESTIMASI BUDGET
          </div>
          <div className="text-2xl font-bold" style={{ color: "var(--color-blue, #2563eb)" }}>
            Rp {formatRp(calculatedTotal)}
          </div>
        </div>

        {/* Items breakdown list - Free / Un-boxed */}
        <div className="space-y-1.5 pt-1">
          {items.map((item, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between text-xs py-1"
            >
              <span className="font-semibold text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                {item.label}
              </span>
              <span className="font-bold" style={{ color: "var(--color-text)" }}>
                Rp {formatRp(item.value)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
