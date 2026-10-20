"use client";

import { useState } from "react";
import { creaPasswordTemporanea } from "@/lib/actions";

/**
 * L'amministratore dà una password temporanea a chi non riesce a entrare: si
 * vede una volta sola, qui, e al primo ingresso la persona deve sceglierne una
 * sua. Non arriva per mail: la si detta o la si manda come si preferisce.
 */
export default function PasswordTemporanea({ userId, nome, email, attiva }: { userId: string; nome: string; email: string; attiva: boolean }) {
  const [password, setPassword] = useState("");
  const [esito, setEsito] = useState("");
  const [pending, setPending] = useState(false);
  const crea = async () => {
    if (!confirm(`Dare a ${nome} una password temporanea? Quella che ha adesso smette di valere e, se è collegato, deve rientrare. Al primo ingresso sceglierà la sua.`)) return;
    setEsito(""); setPending(true);
    const r = await creaPasswordTemporanea(userId).catch(() => ({ ok: false as const, error: "errore di rete" }));
    setPending(false);
    if (!r.ok || !("password" in r)) { setEsito(r.error ?? "Non riuscito"); return; }
    setPassword(r.password);
  };
  const testo = `Ciao ${nome}, per entrare in GT One usa ${email} e la password temporanea ${password} — al primo accesso ti chiede di sceglierne una tua.`;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {!password ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-outline" onClick={crea} disabled={pending}>{pending ? "…" : "Imposta password temporanea"}</button>
          {attiva && <span className="pill pill-amber">password temporanea ancora da cambiare</span>}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <code style={{ fontSize: 18, letterSpacing: ".06em", padding: "4px 10px", background: "var(--green-50, #eaf3e2)", borderRadius: 6 }}>{password}</code>
            <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard.writeText(testo).then(() => setEsito("Copiato il messaggio con email e password."), () => setEsito("Copia non riuscita: scrivila a mano."))}>Copia messaggio</button>
          </div>
          <span className="hint">Si vede solo adesso: annotala o mandala subito. Al primo accesso {nome} deve sceglierne una sua.</span>
        </>
      )}
      {esito && <span className="hint" style={{ fontWeight: 700 }}>{esito}</span>}
    </div>
  );
}
