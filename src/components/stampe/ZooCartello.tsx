const FONT_CN = '"Avenir Next LT Pro Cn", "Avenir Next LT Pro", "Segoe UI", sans-serif';
const FONT = '"Avenir Next LT Pro", "Segoe UI", sans-serif';

function Prezzo({ value, fs }: { value: string; fs: number }) {
  const [int, cent] = value.split(",");
  return (
    <span style={{ fontFamily: FONT_CN, fontWeight: 800, lineHeight: 0.9, whiteSpace: "nowrap" }}>
      <span style={{ fontSize: fs }}>{int}</span>
      <span style={{ fontSize: fs * 0.38, verticalAlign: "super" }}>,{cent ?? "00"}</span>
    </span>
  );
}

export interface ZooCartelloData {
  titolo: string;
  descrizione: string;
  prezzo: string;
  prezzoListino?: string;
  condizioni?: string;
  marca?: string;
  ean?: string;
  image: string;
  label?: string;
  validita?: string; // "dal x al y"
  logoInsegna?: string;
}

/**
 * Cartello promozionale ZOO: layout predefinito A5/A4 (banda offerta, foto,
 * descrizione cartello, prezzo grande con centesimi in apice, listino barrato).
 */
export default function ZooCartello({
  data,
  formato = "a5",
  scale = 2.2, // px per mm
}: {
  data: ZooCartelloData;
  formato?: "a5" | "a4";
  scale?: number;
}) {
  const mm = formato === "a4" ? { w: 210, h: 297 } : { w: 148, h: 210 };
  const W = mm.w * scale;
  const H = mm.h * scale;
  const u = (n: number) => (n * scale * mm.w) / 148; // unità proporzionale al formato

  return (
    <div
      className="cartello"
      style={{
        width: W, height: H, position: "relative", background: "#fff",
        border: "1px solid #e2e2e2", overflow: "hidden", fontFamily: FONT, color: "#111",
      }}
    >
      {/* banda superiore */}
      <div style={{
        position: "absolute", left: 0, top: 0, width: "100%", height: "11%",
        background: "#c8161d", color: "#fff", display: "flex", alignItems: "center",
        justifyContent: "space-between", padding: `0 ${u(6)}px`,
      }}>
        <span style={{ fontFamily: FONT_CN, fontWeight: 800, fontSize: u(9) }}>OFFERTA ZOO</span>
        {data.validita && <span style={{ fontSize: u(3.6), fontWeight: 700 }}>{data.validita}</span>}
      </div>

      {/* etichetta / bollino */}
      {data.label && (
        <div style={{
          position: "absolute", right: "4%", top: "13%", background: "#f7c500", color: "#7a1010",
          fontFamily: FONT_CN, fontWeight: 800, fontSize: u(4.4), padding: `${u(1.6)}px ${u(3)}px`,
          transform: "rotate(6deg)", borderRadius: 4, zIndex: 2,
        }}>
          {data.label}
        </div>
      )}

      {/* foto */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={data.image} alt="" style={{
        position: "absolute", left: "5%", top: "14%", width: "44%", height: "38%",
        objectFit: "contain", objectPosition: "center", mixBlendMode: "multiply",
      }} />

      {/* titolo + marca + descrizione */}
      <div style={{ position: "absolute", left: "53%", top: "15%", width: "43%" }}>
        {data.marca && <div style={{ fontSize: u(3.8), fontWeight: 700, color: "#c8161d", textTransform: "uppercase" }}>{data.marca}</div>}
        <div style={{ fontFamily: FONT_CN, fontWeight: 800, fontSize: u(7.2), lineHeight: 1.05 }}>{data.titolo}</div>
      </div>
      <div style={{ position: "absolute", left: "5%", top: "55%", width: "90%", fontSize: u(4.2), lineHeight: 1.3, whiteSpace: "pre-line" }}>
        {data.descrizione}
      </div>

      {/* prezzo */}
      <div style={{ position: "absolute", right: "5%", bottom: "9%", textAlign: "right" }}>
        {data.prezzoListino && (
          <div style={{ fontSize: u(4.6), color: "#666", textDecoration: "line-through" }}>
            anziché € {data.prezzoListino}
          </div>
        )}
        <div style={{ color: "#c8161d", display: "flex", alignItems: "baseline", gap: u(1.5), justifyContent: "flex-end" }}>
          <span style={{ fontSize: u(5.4), fontWeight: 800 }}>€</span>
          <Prezzo value={data.prezzo} fs={u(22)} />
        </div>
      </div>

      {/* piede */}
      <div style={{
        position: "absolute", left: 0, bottom: 0, width: "100%", height: "6.5%",
        borderTop: "1px solid #ddd", display: "flex", alignItems: "center",
        justifyContent: "space-between", padding: `0 ${u(5)}px`, fontSize: u(3),
        color: "#555", background: "#fafafa",
      }}>
        <span>{data.condizioni ?? ""}</span>
        <span style={{ display: "flex", alignItems: "center", gap: u(2) }}>
          {data.ean && <span>EAN {data.ean}</span>}
          {data.logoInsegna && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.logoInsegna} alt="" style={{ height: "70%", maxHeight: u(4.4), mixBlendMode: "multiply" }} />
          )}
        </span>
      </div>
    </div>
  );
}
