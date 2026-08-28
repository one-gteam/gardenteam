import { CardLayout, isImageField, PrintField, PrintFormat } from "@/lib/stampe";
import { layoutFontCss } from "@/lib/layout-fonts";
import { stickerShapeStyle } from "./stickerStyle";

const FONT_CN = '"Avenir Next LT Pro Cn", "Avenir Next LT Pro", "Segoe UI", sans-serif';

/**
 * Prezzo come nel template: intero grande + centesimi più piccoli allineati in
 * alto ("109,00" → 109 ⁰⁰). Non un <sup> con vertical-align: quel calcolo
 * dipende dai metrici del font, e sia dentro un contenitore flex sia in stampa
 * (motore di rasterizzazione diverso da quello a schermo) i centesimi
 * finivano in basso invece che in alto. Un flex "allineati in alto" non
 * dipende dal motore di rendering: è pura disposizione dei riquadri.
 */
function Prezzo({ value, size, scale, font }: { value: string; size: number; scale: number; font?: string }) {
  const [int, cent] = value.split(",");
  const fs = (size * scale) / 2.4;
  return (
    <span style={{ fontFamily: font ?? FONT_CN, fontWeight: 800, lineHeight: 0.95, whiteSpace: "nowrap", fontSize: fs, display: "inline-flex", alignItems: "flex-start" }}>
      <span>{int}</span>
      {cent !== undefined && <span style={{ fontSize: "0.5em", marginLeft: "0.05em" }}>,{cent}</span>}
    </span>
  );
}

/** Anteprima di un cartello: campi posizionati in % sul formato scelto. */
export default function Cartello({
  format,
  layout,
  fields,
  values,
  scale = 2, // px per mm
}: {
  format: PrintFormat;
  layout?: CardLayout;
  fields: PrintField[];
  values: Record<string, string>;
  scale?: number;
}) {
  const W = format.w * scale;
  const H = format.h * scale;
  const margin = layout?.margin ?? 0;
  /*
   * Se il layout ha un campo foto e per questo prodotto manca (values vuoto per
   * quel campo), si stampa il foglio "senza foto" al suo posto — se ne esiste
   * uno. "__img" non conta: è un'immagine libera scelta dall'operatore, non la
   * foto del prodotto.
   */
  const mancaLaFoto = (layout?.items ?? []).some((it) => {
    if (it.fieldId === "__img") return false;
    const meta = fields.find((f) => f.id === it.fieldId);
    return isImageField(meta, it.fieldId) && !values[it.fieldId];
  });
  const activeItems = (mancaLaFoto && layout?.itemsNoPhoto && layout.itemsNoPhoto.length > 0)
    ? layout.itemsNoPhoto
    : layout?.items;
  return (
    <div
      className="cartello"
      style={{
        width: W,
        height: H,
        backgroundImage: format.background ? `url("${format.background}")` : undefined,
        backgroundSize: "100% 100%",
        boxSizing: "border-box",
        padding: margin > 0 ? margin * scale : undefined,
      }}
    >
      {!layout && (
        <div style={{ padding: 12, fontSize: 12, color: "#999" }}>
          Nessun layout definito per questo formato: crealo nella pagina Layout.
        </div>
      )}
      {activeItems?.map((item, i) => {
        const box: React.CSSProperties = {
          position: "absolute",
          left: `${item.x}%`,
          top: `${item.y}%`,
          width: `${item.w}%`,
          height: `${item.h}%`,
          overflow: "hidden",
        };
        // immagine/logo libero posizionato dall'editor
        if (item.fieldId === "__img" && item.imageUrl) {
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={item.imageUrl} alt="" style={{ ...box, objectFit: "contain", objectPosition: "left top", mixBlendMode: "multiply" }} />
          );
        }
        const meta = fields.find((f) => f.id === item.fieldId);
        const value = values[item.fieldId];
        if (!meta || !value) return null;
        // sticker/bollino associato a un campo
        if (item.sticker) {
          return (
            <div
              key={i}
              style={{
                ...box,
                overflow: "visible",
                transform: `rotate(${item.sticker.rotation}deg)`,
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  padding: "6%",
                  color: item.color ?? "#fff",
                  fontWeight: 800,
                  fontFamily: item.sticker.font === "cn" ? FONT_CN : undefined,
                  fontSize: (item.sticker.size * scale) / 2.4,
                  lineHeight: 1.05,
                  ...stickerShapeStyle(item.sticker),
                }}
              >
                {value.replace(/ {2}/g, "\n")}
              </div>
            </div>
          );
        }
        if (isImageField(meta, item.fieldId)) {
          return (
            // eslint-disable-next-line @next/next/no-img-element
            // il blend "multiply" elimina lo sfondo bianco dei loghi jpg
            <img key={i} src={value} alt="" style={{ ...box, objectFit: "contain", objectPosition: "left top", mixBlendMode: "multiply" }} />
          );
        }
        const color = item.color ?? "#111";
        if (item.fieldId === "prezzo" || item.fieldId === "prezzoPromo") {
          const justify = item.align === "left" ? "flex-start" : item.align === "center" ? "center" : "flex-end";
          return (
            <div key={i} style={{ ...box, display: "flex", justifyContent: justify, alignItems: "flex-start", color }}>
              <Prezzo value={value} size={item.size ?? meta.size} scale={scale}
                font={item.font !== undefined ? layoutFontCss(item.font) : undefined} />
            </div>
          );
        }
        return (
          <div
            key={i}
            style={{
              ...box,
              fontSize: ((item.size ?? meta.size) * scale) / 2.4,
              fontWeight: (item.bold ?? meta.bold) ? 700 : 400,
              fontStyle: item.italic ? "italic" : "normal",
              fontFamily: item.font !== undefined ? layoutFontCss(item.font) : meta.font === "cn" ? FONT_CN : undefined,
              lineHeight: 1.2,
              color,
              textAlign: item.align ?? "left",
              whiteSpace: "pre-line",
            }}
          >
            {/* la regola Garden Team "a capo con due spazi" viene rispettata */}
            {value.replace(/ {2}/g, "\n")}
          </div>
        );
      })}
    </div>
  );
}
