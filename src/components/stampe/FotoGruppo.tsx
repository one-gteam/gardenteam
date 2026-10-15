"use client";

import { useState } from "react";
import { caricaFotoOfferta } from "@/lib/zoo-actions";

const MANCANTE = "/immagini/mancante.jpg";

export interface RigaFotoGruppo {
  offerId: string;
  etichetta: string;
  sotto: string;
  /** Foto propria della riga (articolo, o padre nelle voci unite); vuota = usa quella del gruppo. */
  foto?: string;
}

/**
 * Raccolta foto, vista per padre: una scheda per prodotto padre (o per voce
 * unita), con sotto i suoi articoli. La foto caricata su un articolo qualsiasi
 * diventa quella del padre, quindi la scheda si aggiorna tutta: è la foto di
 * riferimento per il volantino. Nelle voci unite ogni riga è un padre diverso,
 * ognuno con la sua foto.
 */
export default function FotoGruppo({
  titolo, sottotitolo, foto, righe, tipo, puoCaricare,
}: {
  titolo: string; sottotitolo: string; foto: string; righe: RigaFotoGruppo[];
  tipo: "padre" | "unione" | "articolo"; puoCaricare: boolean;
}) {
  const [principale, setPrincipale] = useState(foto);
  const [proprie, setProprie] = useState<Record<string, string | undefined>>(Object.fromEntries(righe.map((r) => [r.offerId, r.foto])));
  const [sopra, setSopra] = useState(false);
  const [stato, setStato] = useState("");

  const carica = async (offerId: string, file?: File | null) => {
    if (!file || !file.type.startsWith("image/")) { setStato("Serve un'immagine (jpg, png, webp)."); return; }
    setStato("caricamento…");
    const fd = new FormData();
    fd.set("file", file);
    const r = await caricaFotoOfferta(offerId, fd).catch(() => ({ ok: false as const, error: "errore di rete" }));
    if (!(r.ok && "url" in r && r.url)) { setStato(("error" in r && r.error) || "non caricata"); return; }
    if (tipo === "unione") {
      // la foto va al padre di quella riga: cambia la riga, e la principale se era la prima
      setProprie((p) => ({ ...p, [offerId]: r.url }));
      if (righe[0]?.offerId === offerId || principale === MANCANTE) setPrincipale(r.url);
    } else {
      // padre: la foto è di tutti gli articoli; le foto proprie degli articoli restano le loro
      setPrincipale(r.url);
    }
    setStato("✓ foto aggiornata");
  };

  const mancante = principale === MANCANTE;
  return (
    <div className={`card foto-drop${sopra ? " sopra" : ""}`} style={{ padding: 10 }}
      onDragOver={(e) => { if (!puoCaricare) return; e.preventDefault(); setSopra(true); }}
      onDragLeave={() => setSopra(false)}
      onDrop={(e) => { if (!puoCaricare || !righe[0]) return; e.preventDefault(); setSopra(false); carica(righe[0].offerId, e.dataTransfer.files?.[0]); }}>
      <div style={{ position: "relative" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img loading="lazy" decoding="async" src={principale} alt={titolo} style={{ width: "100%", height: 160, objectFit: "contain", background: "#fff" }} />
        {tipo !== "articolo" && (
          <span className={`pill ${tipo === "unione" ? "pill-blue" : "pill-green"}`} style={{ position: "absolute", top: 4, left: 4, fontSize: 10 }}>
            {tipo === "unione" ? "voce unita" : "foto del padre"}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, marginTop: 6, fontWeight: 700, textAlign: "center" }}>{titolo}</div>
      <div style={{ fontSize: 10.5, color: "var(--muted)", textAlign: "center" }}>{sottotitolo}</div>
      {mancante && <div style={{ textAlign: "center" }}><span className="pill pill-orange" style={{ marginTop: 4 }}>foto mancante</span></div>}

      {righe.length > 1 || tipo !== "articolo" ? (
        <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, borderTop: "1px solid var(--line)", fontSize: 11 }}>
          {righe.map((r) => {
            const propria = proprie[r.offerId];
            return (
              <li key={r.offerId} style={{ display: "flex", gap: 6, alignItems: "center", padding: "4px 0", borderBottom: "1px solid #f0f0ee" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img loading="lazy" src={propria || principale} alt="" style={{ width: 28, height: 28, objectFit: "contain", background: "#fff", border: "1px solid #eee", borderRadius: 4, opacity: propria ? 1 : 0.45 }}
                  title={propria ? "foto propria" : "usa la foto del padre"} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.etichetta}>{r.etichetta}</span>
                  <span style={{ color: "var(--muted)", fontSize: 10 }}>{r.sotto}</span>
                </span>
                {puoCaricare && (
                  <label className="mini-btn" style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                    title={tipo === "unione" ? "Foto del padre di questa riga" : "La foto diventa quella del padre, per tutti gli articoli"}>
                    carica
                    <input type="file" accept="image/*" hidden onChange={(e) => carica(r.offerId, e.target.files?.[0])} />
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      ) : puoCaricare && righe[0] ? (
        <div style={{ marginTop: 6, fontSize: 11, textAlign: "center" }}>
          <label className="mini-btn" style={{ cursor: "pointer" }}>
            {mancante ? "carica foto" : "cambia foto"}
            <input type="file" accept="image/*" hidden onChange={(e) => carica(righe[0].offerId, e.target.files?.[0])} />
          </label>
        </div>
      ) : null}
      {puoCaricare && <span className="hint" style={{ display: "block", marginTop: 4, fontSize: 10.5, textAlign: "center" }}>{stato || "oppure trascinala sulla scheda"}</span>}
    </div>
  );
}
