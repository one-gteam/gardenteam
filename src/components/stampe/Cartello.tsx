import type { CardLayout, LayoutItem, PrintField, PrintFormat } from "@/lib/stampe";
import { ELEMENTO_IMMAGINE, ELEMENTO_QR, ELEMENTO_RIQUADRO, isImageField } from "@/lib/cartello-campi";
import FitText from "./FitText";
import QrSvg from "./QrSvg";
import { layoutFontCss } from "@/lib/layout-fonts";
import {
  CorniceCampo, Prezzo, alignPrezzo, bordoRiquadro, coloreCampo, conPrefisso, isPrezzoField, justifyPrezzo,
  stileStickerCartello, stileTestoCartello, testoStampato,
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
    if (it.fieldId === ELEMENTO_IMMAGINE) return false;
    const meta = fields.find((f) => f.id === it.fieldId);
    return isImageField(meta, it.fieldId) && !values[it.fieldId];
  });
  const activeItems = (mancaLaFoto && layout?.itemsNoPhoto && layout.itemsNoPhoto.length > 0)
    ? layout.itemsNoPhoto
    : layout?.items;

  /*
   * "SCONTO 20%" prende il posto del prezzo sui cartelli a solo sconto. Se il
   * foglio in uso non ha il campo del prezzo — capita sul foglio senza foto,
   * disegnato quando quei cartelli restavano senza niente — lo si stampa nel
   * riquadro del tipo di promozione, così la scritta non sparisce.
   */
  const valori = (() => {
    const ci = (fid: string) => (activeItems ?? []).some((it) => it.fieldId === fid);
    let v = values;
    /*
     * "Condizioni" si porta dietro la validità del volantino: se il layout ha
     * anche il riquadro "Validità", la stessa frase uscirebbe due volte.
     */
    const validita = (v.validita ?? "").trim();
    if (validita && ci("condizioni") && ci("validita") && (v.condizioni ?? "").includes(validita)) {
      const ripulite = (v.condizioni ?? "")
        .split("·").map((t) => t.trim()).filter((t) => t && t !== validita).join(" · ");
      v = { ...v, condizioni: ripulite };
    }
    const prezzo = (v.prezzoPromo ?? "").trim();
    if (!prezzo || prezzo.startsWith("€") || v.tipoPromo) return v;
    return !ci("prezzoPromo") && ci("tipoPromo") ? { ...v, tipoPromo: prezzo } : v;
  })();

  /** Il riquadro dell'elemento: posizione, sfondo, angoli e bordo della cornice. */
  const riquadro = (item: LayoutItem, extra: React.CSSProperties = {}): React.CSSProperties => ({
    position: "absolute",
    left: `${item.x}%`,
    top: `${item.y}%`,
    width: `${item.w}%`,
    height: `${item.h}%`,
    overflow: "hidden",
    background: item.bg,
    borderRadius: item.radius ? item.radius * scale : undefined,
    ...bordoRiquadro(item, scale),
    ...extra,
  });

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
        // immagine/logo libero posizionato dall'editor
        if (item.fieldId === ELEMENTO_IMMAGINE && item.imageUrl) {
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={item.imageUrl} alt="" style={{ ...riquadro(item), objectFit: "contain", objectPosition: "left top", mixBlendMode: "multiply" }} />
          );
        }
        // riquadro libero: fascia colorata, cornice o scritta fissa — si stampa sempre
        if (item.fieldId === ELEMENTO_RIQUADRO) {
          return (
            <div key={i} style={riquadro(item)}>
              <CorniceCampo item={item} scale={scale}>
                {item.testo && (
                  <FitText style={{ width: "100%", height: "100%", ...stileTestoCartello(item, undefined, item.testo, scale) }}>
                    {testoStampato(item.testo)}
                  </FitText>
                )}
              </CorniceCampo>
            </div>
          );
        }
        // QR code della scheda online: c'è solo se la scheda per questo ambito è accesa
        if (item.fieldId === ELEMENTO_QR) {
          const url = valori[ELEMENTO_QR];
          if (!url) return null;
          return (
            <div key={i} style={riquadro(item, { display: "flex", flexDirection: "column", alignItems: "center" })}>
              <QrSvg testo={url} colore={item.color} style={{ flex: 1, minHeight: 0, width: "100%" }} />
              {item.testo && (
                <div style={{ flex: "none", fontSize: ((item.size ?? 7) * scale) / 2.4, lineHeight: 1.1, textAlign: "center", color: coloreCampo(item), whiteSpace: "pre-line", padding: `${0.5 * scale}px 0 0` }}>
                  {item.testo}
                </div>
              )}
            </div>
          );
        }
        const meta = fields.find((f) => f.id === item.fieldId);
        const value = valori[item.fieldId];
        if (!meta || !value) return null;
        // sticker/bollino associato a un campo
        if (item.sticker) {
          return (
            <div
              key={i}
              style={{
                ...riquadro(item),
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
            <img key={i} src={value} alt="" style={{ ...riquadro(item), objectFit: "contain", objectPosition: "left top", mixBlendMode: "multiply" }} />
          );
        }
        const color = coloreCampo(item);
        const testo = conPrefisso(item, value);
        if (isPrezzoField(item.fieldId)) {
          /*
           * Niente ritaglio sul prezzo: è scritto in corpo grande e con poco
           * interlinea, quindi trabocca facilmente dal riquadro — tagliarlo
           * mangerebbe la parte bassa delle cifre invece di lasciarle uscire.
           */
          return (
            <div key={i} style={riquadro(item, { overflow: "visible", color })}>
              <CorniceCampo item={item} scale={scale}>
                <div style={{ width: "100%", height: "100%", display: "flex", justifyContent: justifyPrezzo(item), alignItems: alignPrezzo(item), overflow: "visible" }}>
                  <Prezzo value={testo} size={item.size ?? meta.size} scale={scale} valign={item.valign} align={item.align}
                    font={item.font !== undefined ? layoutFontCss(item.font) : undefined} />
                </div>
              </CorniceCampo>
            </div>
          );
        }
        return (
          <div key={i} style={riquadro(item)}>
            <CorniceCampo item={item} scale={scale}>
              <FitText style={{ width: "100%", height: "100%", overflow: "hidden", ...stileTestoCartello(item, meta, testo, scale) }}>
                {testoStampato(testo)}
              </FitText>
            </CorniceCampo>
          </div>
        );
      })}
    </div>
  );
}
