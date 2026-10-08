"use client";

import { useState } from "react";
import { caricaFotoOfferta } from "@/lib/zoo-actions";

/**
 * Scheda della Raccolta foto: si trascina un'immagine dal computer sopra la
 * scheda (o si clicca «cambia foto») e diventa la foto del prodotto padre, o
 * dell'articolo se non ha un padre. Si vede subito, senza ricaricare la pagina.
 */
export default function FotoTrascinabile({
  offerId, src, titolo, sottotitolo, puoCaricare,
}: {
  offerId: string; src: string; titolo: string; sottotitolo: string; puoCaricare: boolean;
}) {
  const [foto, setFoto] = useState(src);
  const [sopra, setSopra] = useState(false);
  const [stato, setStato] = useState("");

  const carica = async (file?: File | null) => {
    if (!file || !file.type.startsWith("image/")) { setStato("Serve un'immagine (jpg, png, webp)."); return; }
    setStato("caricamento…");
    const fd = new FormData();
    fd.set("file", file);
    const r = await caricaFotoOfferta(offerId, fd).catch(() => ({ ok: false as const, error: "errore di rete" }));
    if (r.ok && "url" in r && r.url) { setFoto(r.url); setStato("✓ foto aggiornata"); }
    else setStato(("error" in r && r.error) || "non caricata");
  };

  const mancante = foto === "/immagini/mancante.jpg";
  return (
    <div className={`card foto-drop${sopra ? " sopra" : ""}`} style={{ padding: 10, textAlign: "center" }}
      onDragOver={(e) => { if (!puoCaricare) return; e.preventDefault(); setSopra(true); }}
      onDragLeave={() => setSopra(false)}
      onDrop={(e) => { if (!puoCaricare) return; e.preventDefault(); setSopra(false); carica(e.dataTransfer.files?.[0]); }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img loading="lazy" decoding="async" src={foto} alt={titolo} style={{ width: "100%", height: 150, objectFit: "contain", background: "#fff" }} />
      <div style={{ fontSize: 11.5, marginTop: 6, fontWeight: 700 }}>{titolo}</div>
      <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{sottotitolo} · {foto.split("/").pop()}</div>
      {mancante && <span className="pill pill-orange" style={{ marginTop: 4 }}>foto mancante</span>}
      {puoCaricare && (
        <div style={{ marginTop: 6, fontSize: 11 }}>
          <label className="mini-btn" style={{ cursor: "pointer" }}>
            {mancante ? "carica foto" : "cambia foto"}
            <input type="file" accept="image/*" hidden onChange={(e) => carica(e.target.files?.[0])} />
          </label>
          <span className="hint" style={{ display: "block", marginTop: 2 }}>{stato || "oppure trascinala qui"}</span>
        </div>
      )}
    </div>
  );
}
