"use client";

import { useState, useMemo } from "react";
import type { PoaStatus, User } from "@prisma/client";

export interface SalesCounterAuditLogItem {
  id: string;
  actorId: string;
  actor: User;
  action: string;
  fromStatus?: PoaStatus | string | null;
  toStatus?: PoaStatus | string | null;
  namaOutlet?: string | null;
  kodePI?: string | null;
  snapshot?: any;
  createdAt: Date | string;
}

interface SalesCounterActivityTimelineProps {
  auditLogs: SalesCounterAuditLogItem[];
  outlets?: Array<{ kodePI: string; namaOutlet?: string | null }>;
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  CREATE: "membuat draft SC",
  UPDATE: "mengedit SC",
  SUBMIT: "mengajukan SC",
  APPROVE: "menyetujui SC",
  REVISE: "mengedit SC (kembali ke Revisi)",
  REJECT: "menolak SC",
  CANCEL: "membatalkan approval SC",
  REQUEST_EDIT: "mengajukan permohonan edit",
  GRANT_EDIT: "menyetujui permohonan edit",
  DECLINE_EDIT: "menolak permohonan edit",
};

function formatMonth(ymStr?: string | null) {
  if (!ymStr || ymStr.length !== 6) return ymStr || "-";
  const year = ymStr.slice(0, 4);
  const monthNum = parseInt(ymStr.slice(4, 6), 10);
  const names = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return `${names[monthNum - 1] ?? monthNum} ${year}`;
}

function formatRupiah(val?: number | null) {
  return `Rp ${Math.round(val || 0).toLocaleString("id-ID")}`;
}

function parseSnapshot(raw: any): any {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw;
  return null;
}

export function SalesCounterActivityTimeline({
  auditLogs = [],
  outlets = [],
}: SalesCounterActivityTimelineProps) {
  const [selectedOutlet, setSelectedOutlet] = useState<string>("ALL");

  const availableOutlets = useMemo(() => {
    const map = new Map<string, { kodePI: string; namaOutlet: string; count: number }>();

    // Daftarkan outlet dari data drafts jika ada
    for (const o of outlets) {
      if (o.kodePI) {
        map.set(o.kodePI, {
          kodePI: o.kodePI,
          namaOutlet: o.namaOutlet || o.kodePI,
          count: 0,
        });
      }
    }

    // Hitung kemunculan log per outlet
    for (const log of auditLogs) {
      const k = log.kodePI || "UNKNOWN";
      if (!map.has(k)) {
        map.set(k, {
          kodePI: k,
          namaOutlet: log.namaOutlet || (k === "UNKNOWN" ? "Umum / Tanpa Outlet" : k),
          count: 0,
        });
      }
      const item = map.get(k)!;
      item.count += 1;
      if (log.namaOutlet && item.namaOutlet === k) {
        item.namaOutlet = log.namaOutlet;
      }
    }

    return Array.from(map.values()).sort((a, b) => a.namaOutlet.localeCompare(b.namaOutlet));
  }, [auditLogs, outlets]);

  const filteredLogs = useMemo(() => {
    if (selectedOutlet === "ALL") return auditLogs;
    return auditLogs.filter((log) => (log.kodePI || "UNKNOWN") === selectedOutlet);
  }, [auditLogs, selectedOutlet]);

  if (auditLogs.length === 0) {
    return (
      <div className="p-4 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
        Belum ada aktivitas.
      </div>
    );
  }

  return (
    <div>
      {/* Dropdown Filter Outlet */}
      {availableOutlets.length > 1 && (
        <div
          className="p-3 border-b flex flex-wrap items-center justify-between gap-3 text-xs"
          style={{
            background: "var(--color-bg-subtle)",
            borderColor: "var(--color-border)",
          }}
        >
          <div className="flex items-center gap-2">
            <span className="font-medium" style={{ color: "var(--color-text-muted)" }}>
              Filter Outlet:
            </span>
            <select
              value={selectedOutlet}
              onChange={(e) => setSelectedOutlet(e.target.value)}
              className="px-2.5 py-1.5 rounded-md border text-xs font-medium cursor-pointer outline-none transition-colors"
              style={{
                background: "var(--color-surface)",
                borderColor: "var(--color-border)",
                color: "var(--color-text)",
              }}
            >
              <option value="ALL">Semua Outlet ({auditLogs.length})</option>
              {availableOutlets.map((o) => (
                <option key={o.kodePI} value={o.kodePI}>
                  {o.namaOutlet} {o.kodePI !== "UNKNOWN" ? `(${o.kodePI})` : ""} [{o.count}]
                </option>
              ))}
            </select>
          </div>

          <span className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>
            Menampilkan {filteredLogs.length} dari {auditLogs.length} aktivitas
          </span>
        </div>
      )}

      {/* Timeline List */}
      <div className="p-4">
        {filteredLogs.length === 0 ? (
          <p className="text-xs text-center py-4" style={{ color: "var(--color-text-muted)" }}>
            Tidak ada riwayat aktivitas untuk outlet yang dipilih.
          </p>
        ) : (
          <ol className="relative space-y-4 pl-5 border-l" style={{ borderColor: "var(--color-border)" }}>
            {filteredLogs.map((log) => {
              const snap = parseSnapshot(log.snapshot);
              const hasOutletChanges =
                snap &&
                (snap.new_jumlahKaryawan !== undefined ||
                  snap.new_persenResepDokter !== undefined ||
                  snap.new_jumlahPasien !== undefined ||
                  snap.new_jumlahPasienResep !== undefined ||
                  snap.new_jumlahPasienNonResep !== undefined ||
                  snap.new_lamaPeriode !== undefined);
              const hasEntertainChanges = snap && Array.isArray(snap.entertain) && snap.entertain.length > 0;
              const hasPersonChanges = snap && Array.isArray(snap.person) && snap.person.length > 0;
              const hasProductChanges = snap && Array.isArray(snap.product) && snap.product.length > 0;

              return (
                <li key={log.id} className="relative">
                  <span
                    className="absolute left-[-1.4rem] mt-1.5 h-2 w-2 rounded-full border border-white"
                    style={{ background: "var(--color-blue)" }}
                  />
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-xs font-mono" style={{ color: "var(--color-text-faint)" }}>
                      {new Date(log.createdAt).toLocaleString("id-ID", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    {log.namaOutlet && (
                      <span
                        className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded border"
                        style={{
                          background: "var(--color-bg-subtle)",
                          borderColor: "var(--color-border)",
                          color: "var(--color-text)",
                        }}
                      >
                        {log.namaOutlet} {log.kodePI && log.kodePI !== "UNKNOWN" ? `(${log.kodePI})` : ""}
                      </span>
                    )}
                  </div>

                  <p className="text-sm font-medium mt-0.5" style={{ color: "var(--color-text)" }}>
                    {log.actor.name}
                    <span className="ml-1.5 font-normal" style={{ color: "var(--color-text-muted)" }}>
                      {AUDIT_ACTION_LABELS[log.action] ?? log.action.toLowerCase()}
                    </span>
                  </p>

                  {log.toStatus && log.toStatus !== log.fromStatus && (
                    <p className="mt-0.5 text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                      &rarr; {log.toStatus.replace(/_/g, " ")}
                    </p>
                  )}

                  {/* Notes / Reason jika ada */}
                  {snap && snap.notes && (
                    <div
                      className="mt-1.5 p-2 rounded text-xs border"
                      style={{
                        background: "var(--color-surface)",
                        borderColor: "var(--color-border)",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      <span className="font-semibold text-[11px] block" style={{ color: "var(--color-text)" }}>
                        Catatan:
                      </span>
                      {snap.notes}
                    </div>
                  )}

                  {/* Rincian perubahan data outlet / karyawan */}
                  {hasOutletChanges && (
                    <div
                      className="mt-1.5 p-2 rounded text-xs border space-y-1"
                      style={{
                        background: "var(--color-surface)",
                        borderColor: "var(--color-border)",
                      }}
                    >
                      <span className="font-semibold text-[11px] block" style={{ color: "var(--color-text)" }}>
                        Perubahan Data Outlet:
                      </span>
                      <ul className="list-disc list-inside space-y-0.5 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                        {snap.new_jumlahKaryawan !== undefined && (
                          <li>
                            Jumlah Karyawan:{" "}
                            <span style={{ color: "var(--color-text-muted)" }}>
                              {snap.old_jumlahKaryawan != null ? snap.old_jumlahKaryawan : "-"}
                            </span>{" "}
                            &rarr;{" "}
                            <span className="font-medium" style={{ color: "var(--color-text)" }}>
                              {snap.new_jumlahKaryawan != null ? snap.new_jumlahKaryawan : "-"} orang
                            </span>
                          </li>
                        )}
                        {snap.new_persenResepDokter !== undefined && (
                          <li>
                            Resep Dokter:{" "}
                            <span style={{ color: "var(--color-text-muted)" }}>
                              {snap.old_persenResepDokter ?? 0}%
                            </span>{" "}
                            &rarr;{" "}
                            <span className="font-medium" style={{ color: "var(--color-text)" }}>
                              {snap.new_persenResepDokter}%
                            </span>
                          </li>
                        )}
                        {snap.new_jumlahPasien !== undefined && (
                          <li>
                            Total Pasien:{" "}
                            <span style={{ color: "var(--color-text-muted)" }}>
                              {snap.old_jumlahPasien != null ? snap.old_jumlahPasien : "-"}
                            </span>{" "}
                            &rarr;{" "}
                            <span className="font-medium" style={{ color: "var(--color-text)" }}>
                              {snap.new_jumlahPasien != null ? snap.new_jumlahPasien : "-"}
                            </span>
                          </li>
                        )}
                        {snap.new_jumlahPasienResep !== undefined && (
                          <li>
                            Pasien Resep:{" "}
                            <span style={{ color: "var(--color-text-muted)" }}>
                              {snap.old_jumlahPasienResep != null ? snap.old_jumlahPasienResep : "-"}
                            </span>{" "}
                            &rarr;{" "}
                            <span className="font-medium" style={{ color: "var(--color-text)" }}>
                              {snap.new_jumlahPasienResep != null ? snap.new_jumlahPasienResep : "-"}
                            </span>
                          </li>
                        )}
                        {snap.new_jumlahPasienNonResep !== undefined && (
                          <li>
                            Pasien Non-Resep:{" "}
                            <span style={{ color: "var(--color-text-muted)" }}>
                              {snap.old_jumlahPasienNonResep != null ? snap.old_jumlahPasienNonResep : "-"}
                            </span>{" "}
                            &rarr;{" "}
                            <span className="font-medium" style={{ color: "var(--color-text)" }}>
                              {snap.new_jumlahPasienNonResep != null ? snap.new_jumlahPasienNonResep : "-"}
                            </span>
                          </li>
                        )}
                        {snap.new_lamaPeriode !== undefined && (
                          <li>
                            Lama Periode:{" "}
                            <span style={{ color: "var(--color-text-muted)" }}>
                              {snap.old_lamaPeriode ?? 0} bulan
                            </span>{" "}
                            &rarr;{" "}
                            <span className="font-medium" style={{ color: "var(--color-text)" }}>
                              {snap.new_lamaPeriode} bulan
                            </span>
                          </li>
                        )}
                      </ul>
                    </div>
                  )}

                  {/* Rincian perubahan biaya entertain */}
                  {hasEntertainChanges && (
                    <div
                      className="mt-1.5 p-2 rounded text-xs border space-y-1"
                      style={{
                        background: "var(--color-surface)",
                        borderColor: "var(--color-border)",
                      }}
                    >
                      <span className="font-semibold text-[11px] block" style={{ color: "var(--color-text)" }}>
                        Perubahan Biaya Entertain ({snap.entertain.length}):
                      </span>
                      <ul className="list-disc list-inside space-y-0.5 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                        {snap.entertain.map((e: any, eIdx: number) => {
                          const monthLabel = formatMonth(e.periodeMonth);
                          return (
                            <li key={eIdx}>
                              {e.type === "add" && (
                                <span className="text-emerald-600 font-medium">
                                  Tambah: {monthLabel} ({formatRupiah(e.biayaEntertain)})
                                </span>
                              )}
                              {e.type === "delete" && (
                                <span className="text-rose-600 font-medium">
                                  Hapus: {monthLabel} (sebelumnya {formatRupiah(e.biayaEntertain)})
                                </span>
                              )}
                              {e.type === "update" && (
                                <span>
                                  Ubah: {monthLabel} · {formatRupiah(e.old_biayaEntertain)} &rarr;{" "}
                                  <span className="font-medium" style={{ color: "var(--color-text)" }}>
                                    {formatRupiah(e.new_biayaEntertain)}
                                  </span>
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  {/* Rincian perubahan staff sales counter */}
                  {hasPersonChanges && (
                    <div
                      className="mt-1.5 p-2 rounded text-xs border space-y-1"
                      style={{
                        background: "var(--color-surface)",
                        borderColor: "var(--color-border)",
                      }}
                    >
                      <span className="font-semibold text-[11px] block" style={{ color: "var(--color-text)" }}>
                        Perubahan Sales Counter ({snap.person.length}):
                      </span>
                      <ul className="list-disc list-inside space-y-0.5 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                        {snap.person.map((p: any, pIdx: number) => (
                          <li key={pIdx}>
                            {p.type === "add" && (
                              <span className="text-emerald-600 font-medium">
                                Tambah: {p.personName || `ID ${p.nik_ktp}`}
                              </span>
                            )}
                            {p.type === "delete" && (
                              <span className="text-rose-600 font-medium">
                                Hapus: {p.personName || `ID ${p.nik_ktp}`}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Rincian perubahan produk jika ada */}
                  {hasProductChanges && (
                    <div
                      className="mt-1.5 p-2 rounded text-xs border space-y-1"
                      style={{
                        background: "var(--color-surface)",
                        borderColor: "var(--color-border)",
                      }}
                    >
                      <span className="font-semibold text-[11px] block" style={{ color: "var(--color-text)" }}>
                        Perubahan Produk ({snap.product.length}):
                      </span>
                      <ul className="list-disc list-inside space-y-0.5 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                        {snap.product.slice(0, 5).map((p: any, pIdx: number) => (
                          <li key={pIdx}>
                            {p.type === "add" && (
                              <span className="text-emerald-600 font-medium">
                                Tambah: {p.namaProduk || p.kodeProduk} (Qty: {p.qtyPerBulan}/bln)
                              </span>
                            )}
                            {p.type === "delete" && (
                              <span className="text-rose-600 font-medium">
                                Hapus: {p.namaProduk || p.kodeProduk}
                              </span>
                            )}
                            {p.type === "update" && (
                              <span>
                                Ubah: {p.namaProduk || p.kodeProduk}
                                {p.new_qtyPerBulan !== undefined && ` · Qty ${p.old_qtyPerBulan} → ${p.new_qtyPerBulan}/bln`}
                                {p.new_persenDiskon !== undefined && ` · Diskon ${p.old_persenDiskon}% → ${p.new_persenDiskon}%`}
                              </span>
                            )}
                          </li>
                        ))}
                        {snap.product.length > 5 && (
                          <li className="text-[10px] italic">...dan {snap.product.length - 5} produk lainnya</li>
                        )}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
