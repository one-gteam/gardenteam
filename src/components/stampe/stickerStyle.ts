import type { StickerStyle } from "@/lib/stampe";

/** Forme dei bollini: clip-path per stella e nastro, border-radius per cerchio/quadrato. */
export function stickerShapeStyle(sticker: StickerStyle): React.CSSProperties {
  const base: React.CSSProperties = { background: sticker.bg };
  if (sticker.shape === "cerchio") return { ...base, borderRadius: "50%" };
  if (sticker.shape === "quadrato") return { ...base, borderRadius: "10%" };
  if (sticker.shape === "nastro")
    return { ...base, clipPath: "polygon(0 50%, 7% 0, 93% 0, 100% 50%, 93% 100%, 7% 100%)" };
  // stella / burst a 12 punte
  return {
    ...base,
    clipPath:
      "polygon(50% 0%, 59% 12%, 72% 5%, 75% 19%, 90% 18%, 86% 32%, 100% 38%, 90% 50%, 100% 62%, 86% 68%, 90% 82%, 75% 81%, 72% 95%, 59% 88%, 50% 100%, 41% 88%, 28% 95%, 25% 81%, 10% 82%, 14% 68%, 0% 62%, 10% 50%, 0% 38%, 14% 32%, 10% 18%, 25% 19%, 28% 5%, 41% 12%)",
  };
}
