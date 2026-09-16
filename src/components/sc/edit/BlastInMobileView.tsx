"use client";

import React from "react";

export interface BlastInMobileViewProps {
  loading: boolean;
  registrant: any;
  outletId?: string;
  yearNum: number;
  qNum: number;
  actualSales: number;
  estimasiQ: number;
  totalProjected: number;
  targetSales: number;
  hadiahCurrentQ: number;
  actualHeaderLabel?: string;
  displayQuarters: Array<{ quarter: number; data?: any }>;
  targetSalesAcc: number;
  poaSalesAmount: number;
}

export function BlastInMobileView({
  loading,
  registrant,
  outletId,
  yearNum,
  qNum,
  actualSales,
  estimasiQ,
  totalProjected,
  targetSales,
  hadiahCurrentQ,
  actualHeaderLabel,
  displayQuarters,
  targetSalesAcc,
  poaSalesAmount,
}: BlastInMobileViewProps) {
  return (
    <div className="space-y-4">
      {/* 1. Metric Summary Card (Replaces Table 1 on mobile) */}
      {(loading || registrant || !outletId) && (
        <div
          className="rounded-xl border overflow-hidden shadow-2xs text-xs"
          style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}
        >
          {/* Target & Hadiah Header */}
          <div
            className="p-3 border-b grid grid-cols-2 gap-2"
            style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}
          >
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>
                Target Blast-In Q{qNum}
              </div>
              <div className="font-bold text-xs mt-0.5 whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                {loading ? "..." : targetSales > 0 ? `Rp\u00A0${Math.round(targetSales).toLocaleString("id-ID")}` : "-"}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>
                Hadiah Q{qNum}
              </div>
              <div className="font-bold text-xs mt-0.5 whitespace-nowrap" style={{ color: "var(--color-blue, #2563eb)" }}>
                {loading ? "..." : hadiahCurrentQ > 0 ? `Rp\u00A0${Math.round(hadiahCurrentQ).toLocaleString("id-ID")}` : "-"}
              </div>
            </div>
          </div>

          {/* Sales Breakdown Table */}
          <table className="w-full text-xs border-collapse">
            <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
              <tr>
                <td className="py-2 px-3 font-medium" style={{ color: "var(--color-text-muted)" }}>
                  <div>Actual Sales</div>
                  {actualHeaderLabel && (
                    <div className="text-[10px] opacity-75">{actualHeaderLabel}</div>
                  )}
                </td>
                <td className="py-2 px-3 text-right font-medium whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                  {loading ? "..." : actualSales > 0 ? `Rp\u00A0${Math.round(actualSales).toLocaleString("id-ID")}` : "-"}
                </td>
              </tr>
              <tr>
                <td className="py-2 px-3 font-medium" style={{ color: "var(--color-text-muted)" }}>
                  Estimasi Q{qNum}
                </td>
                <td className="py-2 px-3 text-right font-medium whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                  {loading ? "..." : estimasiQ > 0 ? `Rp\u00A0${Math.round(estimasiQ).toLocaleString("id-ID")}` : "-"}
                </td>
              </tr>
              <tr style={{ background: "rgba(59, 130, 246, 0.04)" }}>
                <td className="py-2.5 px-3 font-bold" style={{ color: "var(--color-text)" }}>
                  Actual + Estimasi Q{qNum}
                </td>
                <td className="py-2.5 px-3 text-right font-bold text-sm whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                  {loading ? "..." : totalProjected > 0 ? `Rp\u00A0${Math.round(totalProjected).toLocaleString("id-ID")}` : "-"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* 2. History Penerimaan Hadiah (Replaces Table 2 on mobile) */}
      {(registrant || loading) && (
        <div className="space-y-2.5 pt-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider px-0.5" style={{ color: "var(--color-text-muted)" }}>
            History Penerimaan Hadiah
          </div>

          <div className="space-y-2">
            {displayQuarters.map(({ quarter: qIdx, data: qData }) => {
              const isPast = qIdx < qNum;
              const isCurrent = qIdx === qNum;

              let targetVal = 0;
              let actualVal = 0;
              let achPctStr = "-";

              if (isPast) {
                targetVal = Number(qData?.target_sales_acc) || Number(qData?.target_sales_quarter) || 0;
                actualVal = Number(qData?.actual_sales) || 0;
                if (targetVal > 0) {
                  achPctStr = `${Math.round((actualVal / targetVal) * 100)}%`;
                } else if (actualVal > 0) {
                  achPctStr = "100%";
                }
              } else if (isCurrent) {
                targetVal = targetSalesAcc > 0 ? targetSalesAcc : targetSales;
                const currentActualRaw = Number(qData?.actual_sales) || 0;
                actualVal = currentActualRaw > 0 ? currentActualRaw : (actualSales + poaSalesAmount);
                if (targetVal > 0 && actualVal > 0) {
                  achPctStr = `${Math.round((actualVal / targetVal) * 100)}%`;
                }
              }

              const targetText = targetVal > 0 ? `Rp\u00A0${Math.round(targetVal).toLocaleString("id-ID")}` : "-";
              const actualText = actualVal > 0 ? `Rp\u00A0${Math.round(actualVal).toLocaleString("id-ID")}` : "-";

              // Status Menang
              let won = false;
              if (isPast) {
                won = qData?.is_sales_achieve ?? ((qData?.actual_sales ?? 0) >= (qData?.target_sales_quarter ?? 0) && (qData?.actual_sales ?? 0) > 0);
              }

              // Hadiah
              let hadiahText = "-";
              if (isPast) {
                const val = qData?.reward_paid != null && qData.reward_paid > 0
                  ? qData.reward_paid
                  : qData?.reward_quarter != null && qData.reward_quarter > 0
                  ? qData.reward_quarter
                  : 0;
                hadiahText = val > 0 ? `Rp\u00A0${Math.round(val).toLocaleString("id-ID")}` : "-";
              } else if (isCurrent) {
                const val = qData?.reward_quarter ?? hadiahCurrentQ;
                hadiahText = val > 0 ? `Rp\u00A0${Math.round(val).toLocaleString("id-ID")}` : "-";
              }

              return (
                <div
                  key={qIdx}
                  className="rounded-xl border p-3 text-xs space-y-2 shadow-2xs"
                  style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}
                >
                  {/* Card Header: Q{x} + Badges */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm" style={{ color: "var(--color-text)" }}>
                        Q{qIdx}
                      </span>
                      {isPast ? (
                        <span
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                          style={{
                            background: won ? "rgba(22, 163, 74, 0.12)" : "rgba(225, 29, 72, 0.08)",
                            color: won ? "#16a34a" : "#e11d48",
                            border: `1px solid ${won ? "rgba(22, 163, 74, 0.25)" : "rgba(225, 29, 72, 0.2)"}`,
                          }}
                        >
                          {won ? "✓ Menang" : "Kalah"}
                        </span>
                      ) : isCurrent ? (
                        <span
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                          style={{
                            background: "rgba(100, 116, 139, 0.08)",
                            color: "#64748b",
                            border: "1px solid rgba(100, 116, 139, 0.2)",
                          }}
                        >
                          Estimasi
                        </span>
                      ) : null}
                    </div>

                    <div className="text-right">
                      <span
                        className="text-[11px] font-bold px-2 py-0.5 rounded"
                        style={{
                          background: achPctStr !== "-" && parseInt(achPctStr) >= 100 ? "rgba(22, 163, 74, 0.1)" : "rgba(100, 116, 139, 0.1)",
                          color: achPctStr !== "-" && parseInt(achPctStr) >= 100 ? "#16a34a" : "var(--color-text)",
                        }}
                      >
                        {achPctStr} Ach
                      </span>
                    </div>
                  </div>

                  {/* Target & Actual Row */}
                  <div className="grid grid-cols-2 gap-2 pt-1 border-t text-[11px]" style={{ borderColor: "var(--color-border)" }}>
                    <div>
                      <span className="block text-[10px]" style={{ color: "var(--color-text-muted)" }}>Target:</span>
                      <strong className="font-semibold whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                        {targetText}
                      </strong>
                    </div>
                    <div className="text-right">
                      <span className="block text-[10px]" style={{ color: "var(--color-text-muted)" }}>Actual:</span>
                      <strong className="font-semibold whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                        {actualText}
                      </strong>
                    </div>
                  </div>

                  {/* Hadiah & Status Penerimaan Row */}
                  <div className="flex items-center justify-between pt-1 border-t text-[11px]" style={{ borderColor: "var(--color-border)" }}>
                    <div>
                      <span className="text-[10px] block" style={{ color: "var(--color-text-muted)" }}>Hadiah:</span>
                      <strong className="font-semibold whitespace-nowrap" style={{ color: "var(--color-blue, #2563eb)" }}>
                        {hadiahText}
                      </strong>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] block" style={{ color: "var(--color-text-muted)" }}>Status:</span>
                      {isPast ? (
                        qData?.is_paid ? (
                          <span className="font-semibold text-emerald-600 text-[11px]">✓ Diterima</span>
                        ) : (
                          <span className="font-semibold text-amber-600 text-[11px]">Belum Diterima</span>
                        )
                      ) : isCurrent ? (
                        <span className="font-medium text-slate-500 text-[10px]">Belum (estimasi)</span>
                      ) : (
                        <span style={{ color: "var(--color-text-muted)" }}>-</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
