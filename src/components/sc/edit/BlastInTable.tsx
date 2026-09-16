"use client";

import React, { useState, useEffect, useMemo } from "react";
import { getBlastInDataAction } from "@/app/actions/canvasser";
import type { BlastInResponse, BlastInQuarter } from "@/app/(app)/sc/[id]/_services/getBlastInData";

import type { BlastInTableProps } from "./types/widgetTypes";
import { parseBlastInPeriod } from "./utils/periodUtils";
import { BlastInMobileView } from "./BlastInMobileView";

export function BlastInTable({
  poaPeriod = "2026-Q3",
  quarter,
  outletId,
  estimasiSales = 0,
}: BlastInTableProps) {
  const { qNum, yearNum } = parseBlastInPeriod(poaPeriod, quarter);

  const [loading, setLoading] = useState(false);
  const [blastInData, setBlastInData] = useState<BlastInResponse | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!outletId) {
      setBlastInData(null);
      return;
    }
    let isMounted = true;
    setLoading(true);
    getBlastInDataAction(outletId, yearNum)
      .then((res) => {
        if (isMounted) setBlastInData(res);
      })
      .catch((err) => {
        console.error("Error fetching blast-in data in BlastInTable:", err);
        if (isMounted) setBlastInData(null);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [outletId, yearNum]);

  const registrant = blastInData?.data?.registrants?.[0] || null;
  const quarters = useMemo(() => registrant?.quarters || [], [registrant]);

  // Previous quarter actual sales (accumulated up to qNum - 1)
  const actualSales = useMemo(() => {
    if (qNum <= 1) return 0;
    const prevQuarters = quarters.filter((q) => q.quarter < qNum);
    if (prevQuarters.length === 0) return 0;
    const immediatePrev = prevQuarters.find((q) => q.quarter === qNum - 1);
    if (immediatePrev?.actual_sales != null) {
      return Number(immediatePrev.actual_sales) || 0;
    }
    return prevQuarters.reduce((acc, q) => acc + (Number(q.actual_sales) || 0), 0);
  }, [quarters, qNum]);

  // Current quarter data
  const currentQ = useMemo(() => quarters.find((q) => q.quarter === qNum), [quarters, qNum]);
  const targetSalesQuarter = Number(currentQ?.target_sales_quarter) || 0;
  const targetSalesAcc = Number(currentQ?.target_sales_acc) || 0;

  // X = target_sales_acc - actual_sales (kekurangan sales untuk mencapai target akumulasi kuartal ini)
  const targetToReach = targetSalesAcc > 0 ? targetSalesAcc : (actualSales + targetSalesQuarter);
  const estimasiQ = currentQ ? Math.max(0, targetToReach - actualSales) : 0;

  // Total Projected: Actual sales from past quarters + estimasiQ (X) = targetToReach (target_sales_acc)
  const totalProjected = actualSales + estimasiQ;

  // Target Blast-In for current quarter: target_sales_quarter
  const targetSales = targetSalesQuarter > 0 ? targetSalesQuarter : targetSalesAcc;

  // Hadiah Q: reward_quarter of current quarter
  const hadiahCurrentQ = Number(currentQ?.reward_quarter) || 0;

  // Estimasi Menang Q:
  // Penjualan yang diajukan di form POA saat ini (estimasiSales) vs kekurangan target (estimasiQ / X)
  // Jika estimasiSales >= estimasiQ (mampu menutup kekurangan untuk mencapai target), maka Estimasi Menang!
  const poaSalesAmount = Number(estimasiSales) || 0;
  const isEstimatedWin = useMemo(() => {
    if (!currentQ) return false;
    // Jika target sudah terlampaui dari actualSales sebelumnya (estimasiQ === 0)
    if (estimasiQ === 0 && actualSales >= targetToReach && targetToReach > 0) return true;
    // Jika penjualan POA mampu menutup kekurangan yang dibutuhkan
    return poaSalesAmount > 0 && poaSalesAmount >= estimasiQ;
  }, [currentQ, estimasiQ, poaSalesAmount, actualSales, targetToReach]);

  // Quarters to display in Section 2 and Section 1 pills: up to qNum (quarters that are relevant for this period)
  const displayQuarters = useMemo(() => {
    const list: Array<{
      quarter: number;
      data?: BlastInQuarter;
    }> = [];

    for (let i = 1; i <= qNum; i++) {
      const qData = quarters.find((q) => q.quarter === i);
      list.push({ quarter: i, data: qData });
    }
    return list;
  }, [qNum, quarters]);

  const actualHeaderLabel = qNum > 1 ? (qNum === 2 ? "(Q1)" : qNum === 3 ? "(Q1-Q2)" : "(Q1-Q3)") : "";

  return (
    <div className="space-y-4 mt-4">
      {/* 1. SECTION 1: BLAST-IN TAHUN + BADGES & METRICS */}
      <div className="space-y-2">
        <div
          onClick={() => setIsOpen((prev) => !prev)}
          className="flex items-center justify-between flex-wrap gap-2 cursor-pointer select-none py-1 group"
        >
          <div className="flex items-center gap-2">
            <svg
              className={`w-3.5 h-3.5 transition-transform duration-200 text-slate-500 group-hover:text-slate-800 ${isOpen ? "rotate-0" : "-rotate-90"}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
            </svg>
            <span className="text-xs font-semibold uppercase tracking-wider group-hover:opacity-80 transition-opacity" style={{ color: "var(--color-text)" }}>
              BLAST-IN {yearNum}
            </span>
            {loading && (
              <span className="text-[10px] animate-pulse" style={{ color: "var(--color-text-faint)" }}>
                Memuat data performa...
              </span>
            )}
          </div>

          {/* Quarter status pills (e.g. Kalah Q1, Kalah Q2, Estimasi Q3) */}
          {registrant && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {displayQuarters.map(({ quarter: qIdx, data: qData }) => {
                const isPast = qIdx < qNum;
                const isCurrent = qIdx === qNum;

                if (isPast) {
                  const won = qData?.is_sales_achieve ?? ((qData?.actual_sales ?? 0) >= (qData?.target_sales_quarter ?? 0) && (qData?.actual_sales ?? 0) > 0);
                  return (
                    <span
                      key={qIdx}
                      className="text-[10px] font-medium px-2.5 py-0.5 rounded-full flex items-center gap-1"
                      style={{
                        background: won ? "rgba(22, 163, 74, 0.12)" : "rgba(225, 29, 72, 0.08)",
                        color: won ? "#16a34a" : "#e11d48",
                        border: `1px solid ${won ? "rgba(22, 163, 74, 0.25)" : "rgba(225, 29, 72, 0.2)"}`,
                      }}
                    >
                      {won ? `✓ Menang Q${qIdx}` : `Kalah Q${qIdx}`}
                    </span>
                  );
                }

                if (isCurrent) {
                  return (
                    <span
                      key={qIdx}
                      className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1"
                      style={{
                        background: "rgba(100, 116, 139, 0.08)",
                        color: "#64748b",
                        border: "1px solid rgba(100, 116, 139, 0.2)",
                      }}
                    >
                      Est Q{qIdx}
                    </span>
                  );
                }

                return null;
              })}
            </div>
          )}
        </div>

        {isOpen && (
          <>
            {!loading && !registrant && outletId && (
              <div
                className="rounded-lg border p-3 text-center text-xs"
                style={{ borderColor: "var(--color-border)", color: "var(--color-text-faint)" }}
              >
                Outlet tidak terdaftar dalam program Blast-In tahun {yearNum}.
              </div>
            )}

        {(loading || registrant || !outletId) && (
          <>
            {/* Mobile View: Clean cards with zero horizontal scrolling */}
            <div className="md:hidden">
              <BlastInMobileView
                loading={loading}
                registrant={registrant}
                outletId={outletId}
                yearNum={yearNum}
                qNum={qNum}
                actualSales={actualSales}
                estimasiQ={estimasiQ}
                totalProjected={totalProjected}
                targetSales={targetSales}
                hadiahCurrentQ={hadiahCurrentQ}
                actualHeaderLabel={actualHeaderLabel}
                displayQuarters={displayQuarters}
                targetSalesAcc={targetSalesAcc}
                poaSalesAmount={poaSalesAmount}
              />
            </div>

            {/* Desktop View Table */}
            <div className="hidden md:block overflow-x-auto rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
              <table className="w-full text-xs text-center border-collapse">
                <thead>
                  <tr style={{ background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}>
                    <th className="px-2.5 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>
                      <div className="leading-tight">
                        <div>Actual Sales</div>
                      {actualHeaderLabel && (
                        <div className="text-[10px] font-normal opacity-75">{actualHeaderLabel}</div>
                      )}
                    </div>
                  </th>
                  <th className="px-2.5 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>
                    <div className="leading-tight">
                      <div>Estimasi</div>
                      <div className="text-[10px] font-normal opacity-75">Q{qNum}</div>
                    </div>
                  </th>
                  <th className="px-2.5 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>
                    <div className="leading-tight">
                      <div>Actual + Estimasi</div>
                      <div className="text-[10px] font-normal opacity-75">Q{qNum}</div>
                    </div>
                  </th>
                  <th className="px-2.5 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>
                    <div className="leading-tight">
                      <div>Target Blast-In</div>
                      <div className="text-[10px] font-normal opacity-75">Q{qNum}</div>
                    </div>
                  </th>
                  <th className="px-2.5 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>
                    <div className="leading-tight">
                      <div>Hadiah</div>
                      <div className="text-[10px] font-normal opacity-75">Q{qNum}</div>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ background: "var(--color-bg)" }}>
                  <td className="px-2.5 py-2.5 text-center font-medium" style={{ color: "var(--color-text)" }}>
                    {loading ? (
                      <span className="animate-pulse opacity-50">...</span>
                    ) : actualSales > 0 ? (
                      <span className="whitespace-nowrap">{`Rp ${Math.round(actualSales).toLocaleString("id-ID")}`}</span>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-2.5 py-2.5 text-center font-medium" style={{ color: "var(--color-text)" }}>
                    {loading ? (
                      <span className="animate-pulse opacity-50">...</span>
                    ) : estimasiQ > 0 ? (
                      <span className="whitespace-nowrap">{`Rp ${Math.round(estimasiQ).toLocaleString("id-ID")}`}</span>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-2.5 py-2.5 text-center font-bold" style={{ color: "var(--color-text)" }}>
                    {loading ? (
                      <span className="animate-pulse opacity-50">...</span>
                    ) : totalProjected > 0 ? (
                      <span className="whitespace-nowrap">{`Rp ${Math.round(totalProjected).toLocaleString("id-ID")}`}</span>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-2.5 py-2.5 text-center font-medium" style={{ color: "var(--color-text)" }}>
                    {loading ? (
                      <span className="animate-pulse opacity-50">...</span>
                    ) : targetSales > 0 ? (
                      <span className="whitespace-nowrap">{`Rp ${Math.round(targetSales).toLocaleString("id-ID")}`}</span>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-2.5 py-2.5 text-center font-bold" style={{ color: "var(--color-blue, #2563eb)" }}>
                    {loading ? (
                      <span className="animate-pulse opacity-50">...</span>
                    ) : hadiahCurrentQ > 0 ? (
                      <span className="whitespace-nowrap">{`Rp ${Math.round(hadiahCurrentQ).toLocaleString("id-ID")}`}</span>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )}
</div>

      {/* 2. SECTION 2: HISTORY PENERIMAAN HADIAH (DESKTOP) */}
      {isOpen && (registrant || loading) && (
        <div className="hidden md:block space-y-2 pt-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>
              HISTORY PENERIMAAN HADIAH
            </span>
          </div>

          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr style={{ background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}>
                  <th className="px-3 py-2 font-medium text-left w-[80px]" style={{ color: "var(--color-text-muted)" }}>
                    QUARTER
                  </th>
                  <th className="px-3 py-2 font-medium text-left" style={{ color: "var(--color-text-muted)" }}>
                    TARGET
                  </th>
                  <th className="px-3 py-2 font-medium text-left" style={{ color: "var(--color-text-muted)" }}>
                    ACTUAL
                  </th>
                  <th className="px-3 py-2 font-medium text-left" style={{ color: "var(--color-text-muted)" }}>
                    % ACH
                  </th>
                  <th className="px-3 py-2 font-medium text-left" style={{ color: "var(--color-text-muted)" }}>
                    STATUS MENANG
                  </th>
                  <th className="px-3 py-2 font-medium text-left" style={{ color: "var(--color-text-muted)" }}>
                    HADIAH
                  </th>
                  <th className="px-3 py-2 font-medium text-left" style={{ color: "var(--color-text-muted)" }}>
                    STATUS PENERIMAAN
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayQuarters.map(({ quarter: qIdx, data: qData }, idx) => {
                  const isPast = qIdx < qNum;
                  const isCurrent = qIdx === qNum;

                  // Target, Actual, % Ach
                  let targetVal = 0;
                  let actualVal = 0;
                  let achPctStr = "-";

                  if (isPast) {
                    // Target akumulasi (e.g. Q1 = target Q1, Q2 = target Q1 + Q2 -> target_sales_acc)
                    targetVal = Number(qData?.target_sales_acc) || Number(qData?.target_sales_quarter) || 0;
                    // Actual dari API sudah akumulasi (e.g. 9.349.536), jangan ditambah lagi
                    actualVal = Number(qData?.actual_sales) || 0;
                    if (targetVal > 0) {
                      achPctStr = `${Math.round((actualVal / targetVal) * 100)}%`;
                    } else if (actualVal > 0) {
                      achPctStr = "100%";
                    }
                  } else if (isCurrent) {
                    // Current quarter target akumulasi
                    targetVal = targetSalesAcc > 0 ? targetSalesAcc : targetSales;
                    // Actual akumulasi: past actual sales + poaSalesAmount form
                    const currentActualRaw = Number(qData?.actual_sales) || 0;
                    actualVal = currentActualRaw > 0 ? currentActualRaw : (actualSales + poaSalesAmount);
                    if (targetVal > 0 && actualVal > 0) {
                      achPctStr = `${Math.round((actualVal / targetVal) * 100)}%`;
                    }
                  }

                  const targetText = targetVal > 0 ? `Rp ${Math.round(targetVal).toLocaleString("id-ID")}` : "-";
                  const actualText = actualVal > 0 ? `Rp ${Math.round(actualVal).toLocaleString("id-ID")}` : "-";

                  // 1. Status Menang
                  let statusMenangNode: React.ReactNode = "-";
                  if (isPast) {
                    const won = qData?.is_sales_achieve ?? ((qData?.actual_sales ?? 0) >= (qData?.target_sales_quarter ?? 0) && (qData?.actual_sales ?? 0) > 0);
                    statusMenangNode = (
                      <span
                        className="inline-block text-[10px] font-semibold px-2.5 py-0.5 rounded-full"
                        style={{
                          background: won ? "rgba(22, 163, 74, 0.12)" : "rgba(225, 29, 72, 0.08)",
                          color: won ? "#16a34a" : "#e11d48",
                          border: `1px solid ${won ? "rgba(22, 163, 74, 0.25)" : "rgba(225, 29, 72, 0.2)"}`,
                        }}
                      >
                        {won ? "Menang" : "Kalah"}
                      </span>
                    );
                  } else if (isCurrent) {
                    statusMenangNode = (
                      <span
                        className="inline-block text-[10px] font-semibold px-2.5 py-0.5 rounded-full"
                        style={{
                          background: "rgba(100, 116, 139, 0.08)",
                          color: "#64748b",
                          border: "1px solid rgba(100, 116, 139, 0.2)",
                        }}
                      >
                        Estimasi
                      </span>
                    );
                  }

                  // 2. Hadiah
                  let hadiahText = "-";
                  if (isPast) {
                    const val = qData?.reward_paid != null && qData.reward_paid > 0
                      ? qData.reward_paid
                      : qData?.reward_quarter != null && qData.reward_quarter > 0
                      ? qData.reward_quarter
                      : 0;
                    hadiahText = val > 0 ? `Rp ${Math.round(val).toLocaleString("id-ID")}` : "-";
                  } else if (isCurrent) {
                    const val = qData?.reward_quarter ?? hadiahCurrentQ;
                    hadiahText = val > 0 ? `Rp ${Math.round(val).toLocaleString("id-ID")}` : "-";
                  }

                  // 3. Status Penerimaan (is_paid)
                  let statusPenerimaanNode: React.ReactNode = "-";
                  if (isPast) {
                    if (qData?.is_paid) {
                      statusPenerimaanNode = (
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 text-xs">
                          <span>✓</span> Sudah Diterima
                        </span>
                      );
                    } else {
                      statusPenerimaanNode = (
                        <span className="inline-flex items-center gap-1 font-semibold text-amber-600 text-xs">
                          Belum Diterima
                        </span>
                      );
                    }
                  } else if (isCurrent) {
                    statusPenerimaanNode = (
                      <span className="inline-flex items-center gap-1 font-medium text-slate-500 dark:text-slate-400 text-xs">
                        <span>🕒</span> Belum Diterima (estimasi)
                      </span>
                    );
                  }

                  return (
                    <tr
                      key={qIdx}
                      style={{
                        background: "var(--color-bg)",
                        borderBottom: idx < displayQuarters.length - 1 ? "1px solid var(--color-border)" : "none",
                      }}
                    >
                      <td className="px-3 py-2.5 font-bold" style={{ color: "var(--color-text)" }}>
                        Q{qIdx}
                      </td>
                      <td className="px-3 py-2.5 font-medium tabular-nums whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                        {targetText}
                      </td>
                      <td className="px-3 py-2.5 font-medium tabular-nums whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                        {actualText}
                      </td>
                      <td className="px-3 py-2.5 font-medium tabular-nums whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                        {achPctStr}
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        {statusMenangNode}
                      </td>
                      <td className="px-3 py-2.5 font-medium tabular-nums whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                        {hadiahText}
                      </td>
                      <td className="px-3 py-2.5 align-middle whitespace-nowrap">
                        {statusPenerimaanNode}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isOpen && (registrant || loading) && (
        <p className="text-[11px] leading-relaxed italic pt-1" style={{ color: "var(--color-text-faint)" }}>
          Kalau &ldquo;Menang&rdquo;, hadiah pasti didapat — kolom &ldquo;Status Penerimaan&rdquo; cuma menandai sudah dibayarkan/diproses atau belum, bukan menentukan berhak/tidaknya.
        </p>
      )}
    </div>
  );
}
