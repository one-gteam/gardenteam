import type { Metadata } from "next";
import {
  Inter, Nunito, Poppins, Quicksand,
  Oswald, Bebas_Neue, Playfair_Display, Montserrat, Roboto_Condensed,
} from "next/font/google";
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

/**
 * Font scegliibili nell'editor dei layout cartelli (Stampe → Layout): caricati qui,
 * una volta sola per tutto il sito, con next/font (nessuna chiamata a Google in
 * pagina, il file resta servito dal nostro dominio). Le variabili CSS sono
 * globali, quindi valgono anche nella pagina di stampa vera e propria.
 */
const tagPoppins = Poppins({ variable: "--font-tag-poppins", subsets: ["latin"], weight: ["400", "600", "700", "800"], display: "swap" });
const tagOswald = Oswald({ variable: "--font-tag-oswald", subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap" });
const tagBebas = Bebas_Neue({ variable: "--font-tag-bebas", subsets: ["latin"], weight: "400", display: "swap" });
const tagPlayfair = Playfair_Display({ variable: "--font-tag-playfair", subsets: ["latin"], weight: ["400", "700", "800"], display: "swap" });
const tagMontserrat = Montserrat({ variable: "--font-tag-montserrat", subsets: ["latin"], weight: ["400", "600", "700", "800"], display: "swap" });
const tagRobotoCond = Roboto_Condensed({ variable: "--font-tag-robotocond", subsets: ["latin"], weight: ["400", "700"], display: "swap" });
const TAG_FONT_VARS = [tagPoppins, tagOswald, tagBebas, tagPlayfair, tagMontserrat, tagRobotoCond]
  .map((f) => f.variable).join(" ");

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
    <html lang="it" className={`${interSans.variable} ${poppinsHeading.variable} ${altFont} ${TAG_FONT_VARS}`}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeVars + fontVars }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
