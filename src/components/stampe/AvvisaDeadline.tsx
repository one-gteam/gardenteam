"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { avvisaDeadline } from "@/lib/zoo-incontri";

/**
 * «Avvisa le squadre» accanto alla data di invio al grafico: si spuntano una
 * o più squadre (i gruppi di Utenti e ruoli), si aggiunge un testo e parte una
 * mail a ciascuno.
 */
export default function AvvisaDeadline({ campaignId, squadre, ultimo, haData }: {
  campaignId: string;
  squadre: { id: string; nome: string; persone: string[] }[];
  ultimo?: string;
  haData: boolean;
}) {
  const router = useRouter();
  const [aperto, setAperto] = useState(false);
  const [scelte, setScelte] = useState<string[]>(squadre.map((s) => s.id));
  const [testo, setTesto] = useState("");
  const [esito, setEsito] = useState("");
  const [pending, start] = useTransition();
  const persone = new Set(squadre.filter((s) => scelte.includes(s.id)).flatMap((s) => s.persone));

  if (!aperto) {
    return (
      <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-outline btn-sm" disabled={!haData} title={haData ? "Manda una mail alle squadre con la data di consegna" : "Prima fissa la data"} onClick={() => setAperto(true)}>Avvisa le squadre</button>
        {ultimo && <span className="hint" style={{ fontSize: 11.5 }}>ultimo avviso {ultimo}</span>}
        {esito && <span className="hint" style={{ fontWeight: 700 }}>{esito}</span>}
      </span>
    );
  }
  return (
    <div className="avvisa-box">
      {squadre.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>
          Nessuna squadra: crea i gruppi «Squadra Zoo», «Squadra Comunicazione»… in <a href="/ruoli/organizzazione">Utenti e ruoli → Organizzazione → Gruppi</a> e mettici le persone.
        </p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {squadre.map((s) => (
              <label key={s.id} style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }} title={s.persone.join(", ") || "nessuno"}>
                <input type="checkbox" checked={scelte.includes(s.id)} onChange={() => setScelte((x) => (x.includes(s.id) ? x.filter((y) => y !== s.id) : [...x, s.id]))} />
                <strong>{s.nome}</strong> <span className="hint">{s.persone.length} {s.persone.length === 1 ? "persona" : "persone"}</span>
              </label>
            ))}
          </div>
          <textarea value={testo} onChange={(e) => setTesto(e.target.value)} rows={2} placeholder="Testo in più (facoltativo): es. mancano le foto di Gatto, chiudiamo le pagine 4 e 5 entro mercoledì" style={{ width: "100%", marginTop: 6 }} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-sm" disabled={pending || persone.size === 0}
              onClick={() => start(async () => {
                const r = await avvisaDeadline(campaignId, scelte, testo).catch(() => ({ ok: false, error: "errore di rete" }));
                setEsito(r.error ?? (r.ok ? "Avviso mandato." : "Non riuscito"));
                if (r.ok) { setAperto(false); setTesto(""); router.refresh(); }
              })}>{pending ? "Mando…" : `Manda a ${persone.size} ${persone.size === 1 ? "persona" : "persone"}`}</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setAperto(false)}>Annulla</button>
            <a className="hint" href="/ruoli/organizzazione">gestisci le squadre</a>
            {esito && <span className="hint" style={{ fontWeight: 700 }}>{esito}</span>}
          </div>
        </>
      )}
    </div>
  );
}
