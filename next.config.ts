import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Slide, PDF e pacchetti SCORM viaggiano come server action: il limite
    // predefinito di 1 MB è troppo basso. (In produzione su Vercel il body di
    // una serverless function è comunque limitato: per pacchetti SCORM grandi
    // andrà previsto l'upload diretto a Supabase.)
    serverActions: { bodySizeLimit: "60mb" },
  },
  /*
   * Immagini, loghi, caratteri e sfondi in public/ cambiano solo con un nuovo
   * deploy: il browser li tiene un giorno (e li riusa ancora una settimana
   * mentre li ricontrolla) invece di richiederli a ogni pagina.
   */
  async headers() {
    const cache = [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }];
    return ["/immagini/:path*", "/loghi/:path*", "/fonts/:path*", "/uploads/:path*"].map((source) => ({ source, headers: cache }));
  },
};

export default nextConfig;
