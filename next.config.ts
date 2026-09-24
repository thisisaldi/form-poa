import type { NextConfig } from "next";

const config = {
  inBuildEnvironment: process.env.NODE_ENV === "production",
};

const distDir = config.inBuildEnvironment
  ? `./dist/${process.env.APP_ENV}`
  : ".next";

const nextConfig: NextConfig = {
  distDir,
  devIndicators: false,
  output: "standalone",
  // Allows dev-server access (incl. HMR websocket) when opened via LAN IP instead of localhost.
  // Update this if the machine's LAN IP changes.
  allowedDevOrigins: ["10.198.2.14"],
  experimental: {
    // Upload dokumen POA Standarisasi (Form Approval, Surat KFT, bukti SP Non
    // Sales) lewat Server Action, bukan API route seperti upload survey. Default
    // body limit Server Action cuma 1 MB, jadi PDF/JPG hasil scan > 1 MB ditolak
    // framework sebelum action jalan (staging: POST 500 / "Server Components
    // render" tanpa detail). Batas aplikasinya 10 MB (MAX_FILE_SIZE_BYTES di
    // actions/poaStandarisasi.ts), 12mb ini menyisakan ruang overhead multipart.
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;
