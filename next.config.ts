import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: {
    // Server Actions carry every board mutation; keep payloads small but allow
    // a pasted card description with an image data URI.
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default config;
