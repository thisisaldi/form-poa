# Gelombang Baru untuk Dokter Deal — Business Rules

*Sumber requirement: `README.md`.*

## 1. Istilah
| Istilah | Arti |
|---|---|
| Dokter | Pasangan `(kodePI, namaCust)` di satu POA (sama seperti sekarang). |
| Gelombang (batch) | Kelompok baris dokter itu yang berjalan di satu siklus approval. Gelombang pertama = 1 (semua data lama). |
| Gelombang aktif | Gelombang dengan nomor terbesar untuk dokter itu. |

## 2. Aturan
| # | Aturan |
|---|---|
| R1 | Gelombang yang sudah Deal (`dealAt` terisi) tidak bisa diubah sama sekali oleh siapa pun (edit, hapus baris, tolak, batalkan approval, Ajukan Edit, hapus dokter/POA). Sudah berlaku sejak `58434c2`. |
| R2 | Menambah baris untuk dokter yang gelombang aktifnya sudah Deal membuat **gelombang baru** (nomor +1) di POA yang sama; approval gelombang baru mulai dari DRAFT, hanya berisi baris barunya. |
| R3 | Menambah baris untuk dokter yang gelombang aktifnya belum Deal tidak membuat gelombang baru: tetap aturan lock sekarang (DRAFT/REVISI bisa ditambah; yang sedang/sudah diajukan memakai Ajukan Edit). |
| R4 | Approval, lock edit, current holder, submit, reject, cancel, dan Ajukan Edit berlaku **per gelombang**, tidak saling memengaruhi. |
| R5 | `PoaForm.status` (rollup) = status paling belum maju di antara semua gelombang semua dokter, sama seperti rollup sekarang yang menghitung dokter. Gelombang Deal dihitung sebagai selesai. |
| R6 | Agregat (Summary, export, dashboard) menjumlahkan baris dari semua gelombang; baris identik tetap dihitung sekali (`lib/dedupeLineItems.ts`). |
| R7 | UI menampilkan gelombang pada dokter yang punya lebih dari satu ("Gelombang 2"), dan baris gelombang Deal ditandai terkunci. |

## 3. Perilaku gagal
Penambahan baris yang gagal di tengah (validasi, jaringan) tidak boleh meninggalkan gelombang kosong: gelombang dibuat dalam transaksi yang sama dengan baris pertamanya. Gelombang tanpa baris dihapus bersama approval-nya.

## 4. Open questions — status & asumsi
| # | Pertanyaan | Asumsi |
|---|---|---|
| Q1 | Kontrak Exodus (`/api/poa-doctors`, PATCH `[id]`) | ✅ **Tidak berubah.** Exodus mengenali baris lewat `uidCustomer` (id PoaLineItem anchor). Tiap gelombang punya anchor item sendiri, jadi muncul sebagai baris biasa terpisah (field dan bentuk respons sama); PATCH menandai `usedInExodus` hanya pada gelombang milik anchor itu. Catatan: Exodus tetap hanya melihat baris yang Fully Approved **dan Deal**, jadi gelombang baru baru muncul setelah Deal. Diuji lokal: 2 baris, PATCH baris 2 tidak menyembunyikan baris 1. |
| Q2 | Apakah gelombang baru boleh dibuat hanya bila gelombang aktif sudah Deal, atau juga bila Fully Approved belum Deal? | Hanya bila Deal (R2/R3); yang Fully Approved belum Deal memakai Ajukan Edit seperti sekarang. |
| Q3 | Level approval gelombang baru memakai rantai yang sama (ASM→SM→NSM, dan ASD bila `exodusRequiredRole`)? | Ya, rantai sama dengan gelombang 1. |
| Q4 | Gelombang baru dihitung "PSSP ke-N" atau kontrak baru di panel histori? | Tidak ada perubahan di panel histori. |
| Q5 | Notifikasi email approval per gelombang? | Sama seperti sekarang per dokter, subjek ditambah "Gelombang N". |
