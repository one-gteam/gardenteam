import type { Metadata } from "next";
import { Inter, Nunito, Poppins, Quicksand } from "next/font/google";
import { getDb } from "@/lib/db";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap" });
const nunito = Nunito({ subsets: ["latin"], display: "swap" });
const poppins = Poppins({ subsets: ["latin"], weight: ["400", "600", "700", "800"], display: "swap" });
const quicksand = Quicksand({ subsets: ["latin"], display: "swap" });

const FONT_CLASSES: Record<string, string> = {
  inter: inter.className,
  nunito: nunito.className,
  poppins: poppins.className,
  quicksand: quicksand.className,
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
  const fontClass = FONT_CLASSES[settings.font ?? "system"] ?? "";
  return (
    <html lang="it">
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeVars }} />
      </head>
      <body className={fontClass}>{children}</body>
    </html>
  );
}
