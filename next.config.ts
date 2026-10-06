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
    /*
     * Intestazioni di sicurezza su tutte le pagine. La CSP tiene 'unsafe-inline'
     * per gli script perché Next.js ne scrive di suoi in pagina; blocca comunque
     * plugin, <base> alterati, moduli che inviano ad altri siti e l'incorporamento
     * del sito in pagine altrui (resta permesso ai siti Rosàflor). Le lezioni
     * SCORM hanno una politica loro, più stretta, impostata dalla loro route.
     */
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""} https://www.youtube.com https://s.ytimg.com`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "media-src 'self' blob: https:",
      "connect-src 'self' https:",
      "frame-src 'self' https:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self' https://*.rosaflor.it https://*.rosaflorgarden.it",
    ].join("; ");
    const sicurezza = [
      { key: "Content-Security-Policy", value: csp },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
      { key: "Strict-Transport-Security", value: "max-age=31536000" },
    ];
    return [
      { source: "/((?!api/scorm|demo-volantino).*)", headers: sicurezza },
      // la demo pubblica del volantino digitale carica i caratteri da Google Fonts
      {
        source: "/demo-volantino/:path*",
        headers: [
          ...sicurezza.filter((h) => h.key !== "Content-Security-Policy"),
          { key: "Content-Security-Policy", value: csp.replace("style-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com").replace("font-src 'self' data:", "font-src 'self' data: https://fonts.gstatic.com") },
          ...cache,
        ],
      },
      ...["/immagini/:path*", "/loghi/:path*", "/fonts/:path*", "/uploads/:path*"].map((source) => ({ source, headers: cache })),
    ];
  },
};

export default nextConfig;
