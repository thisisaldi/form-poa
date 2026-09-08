"use client";

import React, { useState, useEffect } from "react";
import { getBlastInDataAction } from "@/app/actions/canvasser";
import type { BlastInResponse } from "@/app/(app)/sc/[id]/_services/getBlastInData";

interface BlastInTableProps {
  poaPeriod?: string;
  quarter?: number;
  outletId?: string;
  estimasiSales?: number;
}

export function BlastInTable({
  poaPeriod = "2026-Q3",
  quarter,
  outletId,
  estimasiSales = 0,
}: BlastInTableProps) {
  let qNum = quarter;
  let yearNum = new Date().getFullYear();

  if (poaPeriod) {
    const m = poaPeriod.match(/^(\d{4})-?Q([1-4])$/i);
    if (m) {
      yearNum = parseInt(m[1], 10);
      if (!qNum) {
        qNum = parseInt(m[2], 10);
      }
    } else {
      const mYear = poaPeriod.match(/^(\d{4})/);
      if (mYear) yearNum = parseInt(mYear[1], 10);
      const mQ = poaPeriod.match(/Q([1-4])/i);
      if (mQ && !qNum) {
        qNum = parseInt(mQ[1], 10);
      } else {
        const mYM = poaPeriod.match(/^\d{4}(\d{2})$/);
        if (mYM && !qNum) {
          const monthNum = parseInt(mYM[1], 10);
          qNum = Math.ceil(monthNum / 3);
        }
      }
    }
  }
  if (!qNum) qNum = 3;

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

  const actualHeader =
    qNum === 1
      ? "ACTUAL SALES"
      : qNum === 2
      ? "ACTUAL SALES (Q1)"
      : qNum === 3
      ? "ACTUAL SALES (Q1-Q2)"
      : "ACTUAL SALES (Q1-Q3)";

  const estimasiHeader = `ESTIMASI Q${qNum}`;
  const sumHeader = `ACTUAL + ESTIMASI Q${qNum}`;
  const targetHeader = `TARGET BLAST-IN Q${qNum}`;
  const hadiahHeader = `HADIAH Q${qNum}`;

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
          <table className="w-full text-xs text-center border-collapse min-w-[500px]">
            <thead>
              <tr style={{ background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: "var(--color-text-muted)", width: "20%" }}>
                  {actualHeader}
                </th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: "var(--color-text-muted)", width: "20%" }}>
                  {estimasiHeader}
                </th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: "var(--color-text-muted)", width: "20%" }}>
                  {sumHeader}
                </th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: "var(--color-text-muted)", width: "20%" }}>
                  {targetHeader}
                </th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: "var(--color-text-muted)", width: "20%" }}>
                  {hadiahHeader}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                <td className="px-4 py-3 text-center font-medium" style={{ color: "var(--color-text)" }}>
                  {loading ? (
                    <span className="animate-pulse opacity-50">...</span>
                  ) : actualSales > 0 ? (
                    `Rp ${Math.round(actualSales).toLocaleString("id-ID")}`
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-4 py-3 text-center font-medium" style={{ color: "var(--color-text)" }}>
                  {loading ? (
                    <span className="animate-pulse opacity-50">...</span>
                  ) : estimasiQ > 0 ? (
                    `Rp ${Math.round(estimasiQ).toLocaleString("id-ID")}`
                  ) : (
                    "-"
                  )}
                </td>
                <td
                  className="px-4 py-3 text-center font-semibold"
                  style={{ color: isAchieved ? "#16a34a" : "var(--color-text)" }}
                >
                  {loading ? (
                    <span className="animate-pulse opacity-50">...</span>
                  ) : totalProjected > 0 ? (
                    `Rp ${Math.round(totalProjected).toLocaleString("id-ID")}`
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-4 py-3 text-center font-medium" style={{ color: "var(--color-text)" }}>
                  {loading ? (
                    <span className="animate-pulse opacity-50">...</span>
                  ) : targetSales > 0 ? (
                    `Rp ${Math.round(targetSales).toLocaleString("id-ID")}`
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-4 py-3 text-center font-semibold" style={{ color: "#2563eb" }}>
                  {loading ? (
                    <span className="animate-pulse opacity-50">...</span>
                  ) : hadiah > 0 ? (
                    `Rp ${Math.round(hadiah).toLocaleString("id-ID")}`
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
