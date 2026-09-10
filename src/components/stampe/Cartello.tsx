import type { CardLayout, PrintField, PrintFormat } from "@/lib/stampe";
import { isImageField } from "@/lib/cartello-campi";
import FitText from "./FitText";
import { layoutFontCss } from "@/lib/layout-fonts";
import {
  Prezzo, coloreCampo, isPrezzoField, justifyPrezzo, stileStickerCartello, stileTestoCartello, testoStampato,
} from "./cartelloStyle";

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
          background: item.bg,
          borderRadius: item.radius ? item.radius * scale : undefined,
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
              <div style={stileStickerCartello(item, scale)}>{testoStampato(value)}</div>
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
        const color = coloreCampo(item);
        if (isPrezzoField(item.fieldId)) {
          /*
           * Niente ritaglio sul prezzo: è scritto in corpo grande e con poco
           * interlinea, quindi trabocca facilmente dal riquadro — tagliarlo
           * mangerebbe la parte bassa delle cifre invece di lasciarle uscire.
           */
          return (
            <div key={i} style={{ ...box, overflow: "visible", display: "flex", justifyContent: justifyPrezzo(item), alignItems: "flex-start", color }}>
              <Prezzo value={value} size={item.size ?? meta.size} scale={scale}
                font={item.font !== undefined ? layoutFontCss(item.font) : undefined} />
            </div>
          );
        }
        return (
          <FitText key={i} style={{ ...box, ...stileTestoCartello(item, meta, value, scale) }}>
            {testoStampato(value)}
          </FitText>
        );
      })}
    </div>
  );
}
