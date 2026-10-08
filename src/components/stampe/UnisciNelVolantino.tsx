"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { unisciVociVolantino } from "@/lib/zoo-actions";

/**
 * Scelta offerte Volantino, Consorzio: le righe spuntate diventano UNA voce del
 * volantino (es. tutti gli snack Ligo), con titolo, descrizione e prezzo scelti
 * qui. Vale solo per il volantino: i cartelli restano uno per prezzo, e in
 * Stampa cartelli si vede che nel volantino sono uniti.
 */
/** Le foto delle voci da unire: spuntane una o più; quelle spuntate escono affiancate nella voce. */
export function SceltaFoto({ disponibili, scelte, onChange }: { disponibili: string[]; scelte: string[]; onChange: (v: string[]) => void }) {
  if (disponibili.length < 2) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>Foto della voce unita</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {disponibili.map((u) => {
          const on = scelte.includes(u);
          return (
            <button key={u} type="button" onClick={() => onChange(on ? scelte.filter((x) => x !== u) : [...scelte, u])}
              title={on ? "Tolta dalla voce unita" : "Mettila nella voce unita"}
              style={{ border: on ? "2px solid var(--green-700)" : "1px solid var(--line)", borderRadius: 8, padding: 2, background: "#fff", position: "relative", cursor: "pointer" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="" style={{ width: 56, height: 56, objectFit: "contain", display: "block", opacity: on ? 1 : 0.45 }} />
              {on && <span style={{ position: "absolute", top: 1, right: 3, color: "var(--green-700)", fontWeight: 900, fontSize: 12 }}>✓</span>}
            </button>
          );
        })}
      </div>
      <span className="hint" style={{ fontSize: 11 }}>{scelte.length === 0 ? "nessuna scelta: resta la foto della prima voce" : scelte.length === 1 ? "una foto sola" : `${scelte.length} foto affiancate`}</span>
    </div>
  );
}

export default function UnisciNelVolantino({ formId }: { formId: string }) {
  const router = useRouter();
  const [aperto, setAperto] = useState(false);
  const [titolo, setTitolo] = useState("");
  const [descrizione, setDescrizione] = useState("");
  const [prezzo, setPrezzo] = useState<"minimo" | "sconto" | "testo">("minimo");
  const [prezzoTesto, setPrezzoTesto] = useState("");
  const [esito, setEsito] = useState("");
  const [pending, startTransition] = useTransition();
  // foto delle righe spuntate: si sceglie quale tenere (una o più)
  const [fotoDisponibili, setFotoDisponibili] = useState<string[]>([]);
  const [fotoScelte, setFotoScelte] = useState<string[]>([]);
  const apri = () => {
    if (!aperto) {
      const spunte = [...document.querySelectorAll<HTMLInputElement>(`input[name="zsel"][form="${formId}"]:checked`)];
      const foto = [...new Set(spunte.map((c) => c.dataset.foto ?? "").filter((u) => u && !u.endsWith("/mancante.jpg")))];
      setFotoDisponibili(foto);
      setFotoScelte(foto.slice(0, 1));
    }
    setAperto(!aperto);
  };

  const unisci = () => {
    const spunte = [...document.querySelectorAll<HTMLInputElement>(`input[name="zsel"][form="${formId}"]:checked`)];
    const ids = spunte.map((c) => c.value);
    if (ids.length < 2) { setEsito("Spunta prima due o più righe."); return; }
    if (prezzo !== "minimo" && !prezzoTesto.trim()) { setEsito("Scrivi il testo del prezzo (es. Sconto 20%)."); return; }
    startTransition(async () => {
      const r = await unisciVociVolantino(ids, {
        titolo: titolo.trim() || undefined,
        descrizione: descrizione.trim() || undefined,
        prezzo, prezzoTesto: prezzo === "minimo" ? undefined : prezzoTesto.trim(),
        foto: fotoScelte.length ? fotoScelte : undefined,
      }, true).catch(() => ({ ok: false, error: "errore" }));
      if (!r.ok) { setEsito(r.error ?? "Unione non riuscita."); return; }
      for (const c of spunte) c.checked = false;
      setEsito(`✓ ${ids.length} righe unite in una voce del volantino.`);
      setAperto(false); setTitolo(""); setDescrizione(""); setPrezzoTesto(""); setPrezzo("minimo");
      router.refresh();
    });
  };

  return (
    <span style={{ position: "relative", display: "inline-flex", gap: 6, alignItems: "center" }}>
      <button type="button" className="btn btn-outline btn-sm" onClick={apri}
        title="Le righe spuntate diventano una voce sola nel volantino; i cartelli restano separati">
        ⛓ Unisci nel volantino
      </button>
      {esito && <span className="hint">{esito}</span>}
      {aperto && (
        <div className="card" style={{ position: "absolute", top: "100%", left: 0, zIndex: 30, marginTop: 4, padding: 12, width: 360, boxShadow: "0 6px 20px rgba(0,0,0,.15)", background: "#fff" }}>
          <strong style={{ fontSize: 13 }}>Una voce sola nel volantino</strong>
          <p className="hint" style={{ margin: "2px 0 8px" }}>
            Solo per il volantino: in Stampa cartelli ogni prezzo resta sul suo cartello, con la nota che nel volantino sono uniti.
          </p>
          <SceltaFoto disponibili={fotoDisponibili} scelte={fotoScelte} onChange={setFotoScelte} />
          <label className="field" style={{ marginBottom: 6 }}>Titolo della voce
            <input type="text" value={titolo} onChange={(e) => setTitolo(e.target.value)} placeholder="es. Snack Ligo" />
          </label>
          <label className="field" style={{ marginBottom: 6 }}>Descrizione
            <textarea rows={2} value={descrizione} onChange={(e) => setDescrizione(e.target.value)} placeholder="es. in vari gusti e formati" />
          </label>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 2 }}>Prezzo sul volantino</div>
          <label style={{ display: "flex", gap: 6, fontSize: 12.5 }}>
            <input type="radio" name="prezzo-unione" checked={prezzo === "minimo"} onChange={() => setPrezzo("minimo")} /> «a partire da» il prezzo più basso
          </label>
          <label style={{ display: "flex", gap: 6, fontSize: 12.5 }}>
            <input type="radio" name="prezzo-unione" checked={prezzo === "sconto"} onChange={() => { setPrezzo("sconto"); if (!prezzoTesto) setPrezzoTesto("Sconto 20%"); }} /> uno sconto uguale per tutti
          </label>
          <label style={{ display: "flex", gap: 6, fontSize: 12.5 }}>
            <input type="radio" name="prezzo-unione" checked={prezzo === "testo"} onChange={() => setPrezzo("testo")} /> un testo libero
          </label>
          {prezzo !== "minimo" && (
            <input type="text" value={prezzoTesto} onChange={(e) => setPrezzoTesto(e.target.value)}
              placeholder={prezzo === "sconto" ? "es. Sconto 20%" : "es. a partire da € 2,49"} style={{ marginTop: 4 }} />
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="button" className="btn btn-sm" disabled={pending} onClick={unisci}>Unisci</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setAperto(false)}>Annulla</button>
          </div>
        </div>
      )}
    </span>
  );
}
