"use client";

import { useState } from "react";
import { creaLinkAccesso } from "@/lib/actions";

/**
 * Per chi non riceve la mail (spam, quarantena aziendale): il link per
 * scegliere o reimpostare la password, da copiare e mandare per WhatsApp o da
 * un'altra casella. È lo stesso della mail e smette di valere appena la
 * persona sceglie la password.
 */
export default function LinkAccesso({ userId, nome, email }: { userId: string; nome: string; email: string }) {
  const [link, setLink] = useState("");
  const [scade, setScade] = useState("");
  const [esito, setEsito] = useState("");
  const crea = async () => {
    setEsito("");
    const r = await creaLinkAccesso(userId).catch(() => ({ ok: false as const, error: "errore di rete" }));
    if (!r.ok || !("link" in r)) { setEsito(r.error ?? "Non riuscito"); return; }
    setLink(r.link); setScade(r.scade);
  };
  const testo = `Ciao ${nome}, ecco il link per entrare in GT One e scegliere la password (accedi poi con ${email}): ${link}`;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {!link ? (
        <button type="button" className="btn btn-outline" onClick={crea} style={{ justifySelf: "start" }}>Crea link di accesso</button>
      ) : (
        <>
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} style={{ marginTop: 0, fontSize: 12 }} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard.writeText(testo).then(() => setEsito("Copiato: incollalo in una mail o in un messaggio."), () => setEsito("Copia non riuscita: seleziona il link e copialo a mano."))}>Copia messaggio con link</button>
            <a className="btn btn-outline btn-sm" href={`https://wa.me/?text=${encodeURIComponent(testo)}`} target="_blank" rel="noreferrer">Manda con WhatsApp</a>
            <span className="hint">vale fino al {scade}</span>
          </div>
        </>
      )}
      {esito && <span className="hint" style={{ fontWeight: 700 }}>{esito}</span>}
    </div>
  );
}
