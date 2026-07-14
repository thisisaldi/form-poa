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
};

export default nextConfig;
