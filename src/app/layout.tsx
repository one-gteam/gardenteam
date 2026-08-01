import type { Metadata } from "next";
import { Inter, Nunito, Poppins, Quicksand } from "next/font/google";
import { getDb } from "@/lib/db";
import "./globals.css";

/**
 * Impostazione tipografica di My Rosaflor: Inter per il testo (denso e leggibile
 * nelle tabelle), Poppins per i titoli (più caldo, richiama il brand).
 * Entrambi esposti come variabili CSS e usati da globals.css.
 */
const interSans = Inter({ variable: "--font-app-sans", subsets: ["latin"], display: "swap" });
const poppinsHeading = Poppins({
  variable: "--font-app-heading", subsets: ["latin"], weight: ["600", "700"], display: "swap",
});

// Font alternativi selezionabili dall'amministratore per il testo del portale.
const nunito = Nunito({ variable: "--font-alt", subsets: ["latin"], display: "swap" });
const quicksand = Quicksand({ variable: "--font-alt", subsets: ["latin"], display: "swap" });

const ALT_FONT_CLASSES: Record<string, string> = {
  nunito: nunito.variable,
  quicksand: quicksand.variable,
};

export const metadata: Metadata = {
  title: "Academy GT — Formazione Garden Team",
  description: "La piattaforma di formazione del Consorzio Garden Team",
};

// App interamente dinamica (login via cookie, dati sempre live da Supabase):
// niente va pre-generato in fase di build, altrimenti la build stessa dipende
// da una chiamata di rete a Supabase riuscita in quel momento.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { settings } = await getDb();
  // Palette derivata dai due colori del consorzio, applicata a tutto il portale
  const themeVars = `
    :root {
      --green-700: ${settings.colorPrimary};
      --green-600: color-mix(in srgb, ${settings.colorPrimary} 82%, #2fae5e);
      --green-900: color-mix(in srgb, ${settings.colorPrimary} 55%, black);
      --green-500: ${settings.colorAccent};
      --green-100: color-mix(in srgb, ${settings.colorAccent} 24%, white);
      --green-50: color-mix(in srgb, ${settings.colorAccent} 11%, white);
    }
  `;
  // Il font scelto in Impostazioni sostituisce Inter solo per il testo: i titoli
  // restano su Poppins, come su My Rosaflor.
  const altFont = ALT_FONT_CLASSES[settings.font ?? ""] ?? "";
  const fontVars = altFont ? `:root { --font-app-sans: var(--font-alt); }` : "";
  return (
    <html lang="it" className={`${interSans.variable} ${poppinsHeading.variable} ${altFont}`}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeVars + fontVars }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
