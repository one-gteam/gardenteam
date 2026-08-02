import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Slide, PDF e pacchetti SCORM viaggiano come server action: il limite
    // predefinito di 1 MB è troppo basso. (In produzione su Vercel il body di
    // una serverless function è comunque limitato: per pacchetti SCORM grandi
    // andrà previsto l'upload diretto a Supabase.)
    serverActions: { bodySizeLimit: "60mb" },
  },
};

export default nextConfig;
