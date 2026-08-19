import type { NextConfig } from "next";

const config: NextConfig = {
  /**
   * Standalone output is what the Docker image ships: a server.js plus only the
   * node_modules actually reached at runtime.
   *
   * It is opt-in rather than always on because producing it requires creating
   * symlinks, which Windows refuses without Developer Mode or an elevated
   * shell. Leaving it on by default would mean `pnpm build` fails on a plain
   * Windows checkout, which is a bad trade for a flag the Dockerfile can set.
   */
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,

  /**
   * Pin the file-tracing root to this project. Without it Next walks up looking
   * for a lockfile, and an unrelated one further up the tree (a stray
   * package-lock.json in a home directory, say) becomes the assumed workspace
   * root, which nests the standalone output inside a copy of that path.
   */
  outputFileTracingRoot: process.cwd(),

  experimental: {
    // Server Actions carry every board mutation; keep payloads small but allow
    // a pasted card description with an image data URI.
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default config;
