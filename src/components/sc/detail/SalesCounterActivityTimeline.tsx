"use client";

import { AUDIT_ACTION_LABELS } from "./constants/auditActionLabels";
import { formatMonthKey } from "./utils/formatDateUtils";
import { formatRp } from "./SalesCounterStatsPanel";
import { parseSnapshot } from "./utils/auditLogUtils";
import { useActivityTimeline } from "./hooks/useActivityTimeline";
import type {
  SalesCounterAuditLogItem,
  SalesCounterActivityTimelineProps,
} from "./types/timeline";

export type { SalesCounterAuditLogItem };

export function SalesCounterActivityTimeline({
  auditLogs = [],
  outlets = [],
}: SalesCounterActivityTimelineProps) {
  const {
    selectedOutlet,
    setSelectedOutlet,
    availableOutlets,
    filteredLogs,
  } = useActivityTimeline({ auditLogs, outlets });

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
                          const monthLabel = formatMonthKey(e.periodeMonth);
                          return (
                            <li key={eIdx}>
                              {e.type === "add" && (
                                <span className="text-emerald-600 font-medium">
                                  Tambah: {monthLabel} ({formatRp(e.biayaEntertain)})
                                </span>
                              )}
                              {e.type === "delete" && (
                                <span className="text-rose-600 font-medium">
                                  Hapus: {monthLabel} (sebelumnya {formatRp(e.biayaEntertain)})
                                </span>
                              )}
                              {e.type === "update" && (
                                <span>
                                  Ubah: {monthLabel} · {formatRp(e.old_biayaEntertain)} &rarr;{" "}
                                  <span className="font-medium" style={{ color: "var(--color-text)" }}>
                                    {formatRp(e.new_biayaEntertain)}
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
                                Tambah: {p.personName || `ID ${p.outletPersonId || p.nik_ktp}`}
                              </span>
                            )}
                            {p.type === "delete" && (
                              <span className="text-rose-600 font-medium">
                                Hapus: {p.personName || `ID ${p.outletPersonId || p.nik_ktp}`}
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
                        {snap.product.slice(0, 5).map((p: any, pIdx: number) => {
                          const hasMonthly = Array.isArray(p.monthly) && p.monthly.length > 0;
                          return (
                            <li key={pIdx}>
                              {p.type === "add" && (
                                <div>
                                  <span className="text-emerald-600 font-medium">
                                    Tambah: {p.namaProduk || p.kodeProduk}
                                  </span>
                                  {hasMonthly ? (
                                    <span className="ml-1.5 text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                                      ({p.monthly.map((m: any) => `${formatMonthKey(m.periodeMonth)}: ${m.qty}`).join(", ")})
                                    </span>
                                  ) : (
                                    p.qtyPerBulan !== undefined && <span> (Qty: {p.qtyPerBulan}/bln)</span>
                                  )}
                                </div>
                              )}
                              {p.type === "delete" && (
                                <span className="text-rose-600 font-medium">
                                  Hapus: {p.namaProduk || p.kodeProduk}
                                </span>
                              )}
                              {p.type === "update" && (
                                <div>
                                  <span>Ubah: <strong>{p.namaProduk || p.kodeProduk}</strong></span>
                                  {hasMonthly ? (
                                    <div className="pl-2 space-y-0.5 mt-0.5">
                                      {p.monthly
                                        .filter((m: any) => m.old_qty !== m.new_qty)
                                        .map((m: any, mIdx: number) => (
                                          <div key={mIdx} className="text-[10px]">
                                            · {formatMonthKey(m.periodeMonth)}: Qty {m.old_qty} &rarr;{" "}
                                            <span className="font-semibold text-emerald-600">{m.new_qty}</span>
                                          </div>
                                        ))}
                                    </div>
                                  ) : (
                                    <span>
                                      {p.new_qtyPerBulan !== undefined && ` · Qty ${p.old_qtyPerBulan} → ${p.new_qtyPerBulan}/bln`}
                                      {p.new_persenDiskon !== undefined && ` · Diskon ${p.old_persenDiskon}% → ${p.new_persenDiskon}%`}
                                    </span>
                                  )}
                                </div>
                              )}
                            </li>
                          );
                        })}
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
