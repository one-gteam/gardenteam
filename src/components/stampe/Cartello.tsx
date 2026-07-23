import { CardLayout, isImageField, PrintField, PrintFormat } from "@/lib/stampe";
import { stickerShapeStyle } from "./stickerStyle";

const FONT_CN = '"Avenir Next LT Pro Cn", "Avenir Next LT Pro", "Segoe UI", sans-serif';

/** Prezzo come nel template: intero grande + centesimi in apice ("109,00" → 109 ⁰⁰). */
function Prezzo({ value, size, scale }: { value: string; size: number; scale: number }) {
  const [int, cent] = value.split(",");
  const fs = (size * scale) / 2.4;
  return (
    <span style={{ fontFamily: FONT_CN, fontWeight: 800, lineHeight: 0.95, whiteSpace: "nowrap" }}>
      <span style={{ fontSize: fs }}>{int}</span>
      {cent !== undefined && (
        <span style={{ fontSize: fs * 0.38, verticalAlign: "super" }}>,{cent}</span>
      )}
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
  return (
    <div
      className="cartello"
      style={{
        width: W,
        height: H,
        backgroundImage: format.background ? `url("${format.background}")` : undefined,
        backgroundSize: "100% 100%",
      }}
    >
      {!layout && (
        <div style={{ padding: 12, fontSize: 12, color: "#999" }}>
          Nessun layout definito per questo formato: crealo nella pagina Layout.
        </div>
      )}
      {layout?.items.map((item, i) => {
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
          return (
            <div key={i} style={{ ...box, display: "flex", justifyContent: "flex-end", alignItems: "flex-start", color }}>
              <Prezzo value={value} size={meta.size} scale={scale} />
            </div>
          );
        }
        return (
          <div
            key={i}
            style={{
              ...box,
              fontSize: (meta.size * scale) / 2.4,
              fontWeight: meta.bold ? 700 : 400,
              fontFamily: meta.font === "cn" ? FONT_CN : undefined,
              lineHeight: 1.2,
              color,
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
