import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Le slide e i PDF delle lezioni viaggiano come server action: il limite
    // predefinito di 1 MB sarebbe troppo basso per una presentazione.
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
