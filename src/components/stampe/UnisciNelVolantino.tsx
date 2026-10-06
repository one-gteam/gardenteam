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
export default function UnisciNelVolantino({ formId }: { formId: string }) {
  const router = useRouter();
  const [aperto, setAperto] = useState(false);
  const [titolo, setTitolo] = useState("");
  const [descrizione, setDescrizione] = useState("");
  const [prezzo, setPrezzo] = useState<"minimo" | "sconto" | "testo">("minimo");
  const [prezzoTesto, setPrezzoTesto] = useState("");
  const [esito, setEsito] = useState("");
  const [pending, startTransition] = useTransition();

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
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setAperto(!aperto)}
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
