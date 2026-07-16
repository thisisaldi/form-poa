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
};

export default nextConfig;
