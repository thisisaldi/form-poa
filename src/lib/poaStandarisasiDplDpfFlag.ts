/**
 * Kill switch "Ajukan DPL/DPF" ke Exodus (Step 5 tab "Request DPL/DPF") —
 * dimatikan 2026-10-01: POST /promotion/v1/request/discount dengan token
 * client_credentials selalu 200 `{error.status:false}` tapi TIDAK membuat
 * request apa pun (dipindai 20.446 request di GET /promotion/v1/request/discount
 * staging: tidak ada satu pun dari >20 POST tes). Tombol yang tampak sukses
 * padahal tidak ada yang terkirim menyesatkan MR. Nyalakan lagi (false) setelah
 * tim Exodus menjelaskan cara POST yang benar dan sudah dites ulang lewat GET list.
 */
export const DPL_DPF_SUBMIT_DISABLED = false; // dinyalakan lagi 2026-10-02 (user), dengan konfirmasi GET setelah POST (confirmDiscountRequest) supaya tidak ada klaim "Terkirim" palsu
export const DPL_DPF_SUBMIT_DISABLED_MESSAGE =
  "Pengajuan DPL/DPF dari sini belum tersedia — integrasi ke Exodus masih menunggu konfirmasi tim Exodus. Ajukan lewat sistem Exodus.";
