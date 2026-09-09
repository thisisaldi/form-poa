"use client";

import React, { useState, useEffect } from "react";
import { getBlastInDataAction } from "@/app/actions/canvasser";
import type { BlastInResponse } from "@/app/(app)/sc/[id]/_services/getBlastInData";

import type { BlastInTableProps } from "./types/widgetTypes";
import { parseBlastInPeriod } from "./utils/periodUtils";

export function BlastInTable({
  poaPeriod = "2026-Q3",
  quarter,
  outletId,
  estimasiSales = 0,
}: BlastInTableProps) {
  const { qNum, yearNum } = parseBlastInPeriod(poaPeriod, quarter);

  const [loading, setLoading] = useState(false);
  const [blastInData, setBlastInData] = useState<BlastInResponse | null>(null);

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

  const actualHeader = (
    <div className="leading-tight">
      <div>Actual Sales</div>
      {qNum > 1 && (
        <div className="text-[10px] font-normal opacity-75">
          {qNum === 2 ? "(Q1)" : qNum === 3 ? "(Q1-Q2)" : "(Q1-Q3)"}
        </div>
      )}
    </div>
  );

  const estimasiHeader = (
    <div className="leading-tight">
      <div>Estimasi</div>
      <div className="text-[10px] font-normal opacity-75">Q{qNum}</div>
    </div>
  );

  const sumHeader = (
    <div className="leading-tight">
      <div>Actual + Estimasi</div>
      <div className="text-[10px] font-normal opacity-75">Q{qNum}</div>
    </div>
  );

  const targetHeader = (
    <div className="leading-tight">
      <div>Target Blast-In</div>
      <div className="text-[10px] font-normal opacity-75">Q{qNum}</div>
    </div>
  );

  const hadiahHeader = (
    <div className="leading-tight">
      <div>Hadiah</div>
      <div className="text-[10px] font-normal opacity-75">Q{qNum}</div>
    </div>
  );

  const registrant = blastInData?.data?.registrants?.[0] || null;
  const quarters = registrant?.quarters || [];

  // Previous quarter actual sales
  let actualSales = 0;
  if (qNum > 1) {
    const prevQ = quarters.find((q) => q.quarter === qNum - 1);
    actualSales = Number(prevQ?.actual_sales) || 0;
  }

  // Current quarter data
  const currentQ = quarters.find((q) => q.quarter === qNum);
  const targetSalesQuarter = Number(currentQ?.target_sales_quarter) || 0;
  const targetSalesAcc = Number(currentQ?.target_sales_acc) || 0;

  // Estimasi Q: target_sales_acc - actual sales
  const estimasiQ = currentQ
    ? targetSalesAcc > 0
      ? Math.max(0, targetSalesAcc - actualSales)
      : targetSalesQuarter > 0
      ? Math.max(0, targetSalesQuarter - actualSales)
      : Number(estimasiSales) || 0
    : Number(estimasiSales) || 0;

  // Actual + Estimasi Q
  const totalProjected = actualSales + estimasiQ;

  // Target Blast-In is target_sales_quarter
  const targetSales = targetSalesQuarter;

  // Hadiah: akumulasi dari Q1-Q{qNum} jika dan hanya jika is_paid masih false
  const hadiah = quarters
    .filter((q) => q.quarter <= qNum && !q.is_paid)
    .reduce((sum, q) => sum + (Number(q.reward_quarter) || 0), 0);

  const isAchieved =
    currentQ?.is_sales_achieve ??
    (currentQ?.actual_sales != null && currentQ.actual_sales >= targetSalesQuarter);

  return (
    <div className="space-y-2 mt-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold tracking-wide" style={{ color: "var(--color-text)" }}>
            BLAST-IN {yearNum}
          </span>
          {loading && (
            <span className="text-[10px] animate-pulse" style={{ color: "var(--color-text-faint)" }}>
              Memuat data performa...
            </span>
          )}
        </div>

        {registrant && isAchieved && (
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded"
            style={{
              background: "rgba(22, 163, 74, 0.12)",
              color: "#16a34a",
              border: "1px solid rgba(22, 163, 74, 0.25)",
            }}
          >
            ✓ Target Tercapai
          </span>
        )}
      </div>

      {!loading && !registrant && outletId && (
        <div
          className="rounded-lg border p-3 text-center text-xs"
          style={{ borderColor: "var(--color-border)", color: "var(--color-text-faint)" }}
        >
          Outlet tidak terdaftar dalam program Blast-In tahun {yearNum}.
        </div>
      )}

      {(loading || registrant || !outletId) && (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
          <table className="w-full text-xs text-center border-collapse">
            <thead>
              <tr style={{ background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}>
                <th className="px-2 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>
                  {actualHeader}
                </th>
                <th className="px-2 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>
                  {estimasiHeader}
                </th>
                <th className="px-2 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>
                  {sumHeader}
                </th>
                <th className="px-2 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>
                  {targetHeader}
                </th>
                <th className="px-2 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>
                  {hadiahHeader}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                <td className="px-2 py-2.5 text-center font-medium" style={{ color: "var(--color-text)" }}>
                  {loading ? (
                    <span className="animate-pulse opacity-50">...</span>
                  ) : actualSales > 0 ? (
                    <span className="whitespace-nowrap">{`Rp ${Math.round(actualSales).toLocaleString("id-ID")}`}</span>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-2 py-2.5 text-center font-medium" style={{ color: "var(--color-text)" }}>
                  {loading ? (
                    <span className="animate-pulse opacity-50">...</span>
                  ) : estimasiQ > 0 ? (
                    <span className="whitespace-nowrap">{`Rp ${Math.round(estimasiQ).toLocaleString("id-ID")}`}</span>
                  ) : (
                    "-"
                  )}
                </td>
                <td
                  className="px-2 py-2.5 text-center font-semibold"
                  style={{ color: isAchieved ? "#16a34a" : "var(--color-text)" }}
                >
                  {loading ? (
                    <span className="animate-pulse opacity-50">...</span>
                  ) : totalProjected > 0 ? (
                    <span className="whitespace-nowrap">{`Rp ${Math.round(totalProjected).toLocaleString("id-ID")}`}</span>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-2 py-2.5 text-center font-medium" style={{ color: "var(--color-text)" }}>
                  {loading ? (
                    <span className="animate-pulse opacity-50">...</span>
                  ) : targetSales > 0 ? (
                    <span className="whitespace-nowrap">{`Rp ${Math.round(targetSales).toLocaleString("id-ID")}`}</span>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-2 py-2.5 text-center font-semibold" style={{ color: "#2563eb" }}>
                  {loading ? (
                    <span className="animate-pulse opacity-50">...</span>
                  ) : hadiah > 0 ? (
                    <span className="whitespace-nowrap">{`Rp ${Math.round(hadiah).toLocaleString("id-ID")}`}</span>
                  ) : (
                    "-"
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
