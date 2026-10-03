import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/playlists": ["./server/data/corpus.sqlite3"],
    "/api/demo": ["./server/data/corpus.sqlite3"],
  },
  poweredByHeader: false,
};

export default nextConfig;
