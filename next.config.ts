import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  ...(process.env.FOLIO_RUNTIME === "aws" ? {
    output: "standalone" as const,
    poweredByHeader: false,
    experimental: { cpus: 2 },
  } : {}),
  webpack(config, { webpack }) {
    if (process.env.FOLIO_RUNTIME === "aws") {
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(
        /(?:^|\/)team-runtime(?:\.ts)?$/,
        path.resolve("lib/server/team-node.ts"),
      ));
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(
        /(?:^|\/)workspace-storage(?:\.ts)?$/,
        path.resolve("lib/server/storage-node.ts"),
      ));
    }
    return config;
  },
};

export default nextConfig;
