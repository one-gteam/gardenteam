/**
 * Caratteri scegliibili per un campo del cartello.
 *
 * Vive in un file a sé, e non dentro `stampe.ts`, perché serve anche all'editor
 * del layout, che è un componente client: `stampe.ts` importa `fs` e non può
 * essere incluso nel bundle del browser.
 */
export const LAYOUT_FONTS: { id: string; label: string; css: string }[] = [
  { id: "", label: "Avenir (predefinito)", css: '"Avenir Next LT Pro", "Segoe UI", sans-serif' },
  { id: "cn", label: "Avenir Condensed", css: '"Avenir Next LT Pro Cn", "Avenir Next LT Pro", "Segoe UI", sans-serif' },
  { id: "arial", label: "Arial / Helvetica", css: "Arial, Helvetica, sans-serif" },
  { id: "georgia", label: "Georgia (con grazie)", css: 'Georgia, "Times New Roman", serif' },
  { id: "times", label: "Times New Roman", css: '"Times New Roman", Times, serif' },
  { id: "courier", label: "Courier (monospaziato)", css: '"Courier New", Courier, monospace' },
  { id: "impact", label: "Impact (titoli)", css: 'Impact, "Arial Narrow Bold", sans-serif' },
  // Google Fonts, caricati una volta per tutto il sito da app/layout.tsx (next/font)
  { id: "poppins", label: "Poppins (Google)", css: 'var(--font-tag-poppins), "Segoe UI", sans-serif' },
  { id: "montserrat", label: "Montserrat (Google)", css: 'var(--font-tag-montserrat), "Segoe UI", sans-serif' },
  { id: "oswald", label: "Oswald condensato (Google)", css: 'var(--font-tag-oswald), "Segoe UI", sans-serif' },
  { id: "bebas", label: "Bebas Neue (Google)", css: "var(--font-tag-bebas), Impact, sans-serif" },
  { id: "playfair", label: "Playfair Display (Google)", css: 'var(--font-tag-playfair), Georgia, serif' },
  { id: "robotocond", label: "Roboto Condensed (Google)", css: 'var(--font-tag-robotocond), Arial, sans-serif' },
];

/** Famiglia CSS corrispondente alla chiave salvata nel layout. */
export function layoutFontCss(id: string | undefined): string | undefined {
  return LAYOUT_FONTS.find((f) => f.id === (id ?? ""))?.css;
}
