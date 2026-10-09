"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { creaUtente } from "@/lib/actions";
import { ROLE_LABELS, Role, SITE_LABELS, SiteId } from "@/lib/types";

const SITES: SiteId[] = ["academy", "arredo", "zoo", "piante"];

/**
 * Aggiunta di un collaboratore direttamente da "Utenti e ruoli": prima si poteva
 * solo aspettare che si registrasse da sé o importarlo da CSV. L'account nasce
 * senza password — la sceglie la persona al primo accesso da "Attiva utente" —
 * e riceve subito la mail di benvenuto con i corsi già assegnati dal suo profilo.
 */
export default function NuovoUtente({
  ruoli, insegne, puntiVendita, reparti, mostraInsegna, mostraPuntoVendita,
}: {
  ruoli: Role[];
  insegne: { id: string; nome: string }[];
  puntiVendita: { id: string; nome: string; tenantId: string }[];
  reparti: { id: string; nome: string }[];
  mostraInsegna: boolean;
  mostraPuntoVendita: boolean;
}) {
  const router = useRouter();
  const [aperto, setAperto] = useState(false);
  const [errore, setErrore] = useState("");
  const [fatto, setFatto] = useState("");
  const [ruolo, setRuolo] = useState<Role>("student");
  /** I ruoli in più: un menu a tendina ciascuno, «＋ altro ruolo» ne aggiunge uno. */
  const [altri, setAltri] = useState<Role[]>([]);
  const liberi = (attuale?: Role) => ruoli.filter((r) => r === attuale || (r !== ruolo && !altri.includes(r)));
  const [pending, startTransition] = useTransition();

  const invia = (formData: FormData) =>
    startTransition(async () => {
      setErrore("");
      setFatto("");
      const res = await creaUtente(formData);
      if (res.ok) {
        setAltri([]);
        setFatto(`${formData.get("firstName")} ${formData.get("lastName")} è stato aggiunto: riceverà la mail di benvenuto e attiverà l'account da «Attiva utente».`);
        router.refresh();
      } else {
        setErrore(res.error ?? "Non è stato possibile creare l'utente");
      }
    });

  if (!aperto) {
    return (
      <div style={{ marginBottom: 14 }}>
        <button type="button" className="btn btn-sm" onClick={() => setAperto(true)}>+ Aggiungi collaboratore</button>
        {fatto && <div className="alert alert-green" style={{ marginTop: 10 }}>✓ {fatto}</div>}
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 14, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <strong>Nuovo collaboratore</strong>
        <button type="button" className="btn btn-outline btn-sm" style={{ marginLeft: "auto" }} onClick={() => setAperto(false)}>
          ✕ Chiudi
        </button>
      </div>
      {errore && <div className="alert alert-amber">{errore}</div>}
      {fatto && <div className="alert alert-green">✓ {fatto}</div>}
      <form action={invia} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
        <label className="field" style={{ marginBottom: 0 }}>Nome<input type="text" name="firstName" required /></label>
        <label className="field" style={{ marginBottom: 0 }}>Cognome<input type="text" name="lastName" required /></label>
        <label className="field" style={{ marginBottom: 0 }}>Email<input type="email" name="email" required placeholder="nome@insegna.it" /></label>
        <div className="field nuovo-ruoli" style={{ marginBottom: 0 }}>
          Ruolo{altri.length > 0 ? " principale" : ""}
          <select name="role" value={ruolo} onChange={(e) => { const r = e.target.value as Role; setRuolo(r); setAltri(altri.filter((x) => x !== r)); }}>
            {ruoli.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          {altri.map((a, i) => (
            <span key={i} className="nuovo-ruolo-altro">
              <select name="ruoliExtra" value={a} onChange={(e) => setAltri(altri.map((x, k) => (k === i ? (e.target.value as Role) : x)))}>
                {liberi(a).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
              <button type="button" className="ruoli-extra-x" title="Togli questo ruolo" onClick={() => setAltri(altri.filter((_, k) => k !== i))}>×</button>
            </span>
          ))}
          {liberi().length > 0 && (
            <button type="button" className="mini-btn" style={{ justifySelf: "start", marginTop: 4 }}
              onClick={() => setAltri([...altri, liberi()[0]])}
              title="Un altro ruolo per la stessa persona: quando entra sceglie con quale lavorare">＋ altro ruolo</button>
          )}
          {altri.length > 0 && <span className="hint">Quando entra sceglie con quale ruolo lavorare. Gli altri ruoli hanno le stesse aree.</span>}
        </div>
        {mostraInsegna && (
          <label className="field" style={{ marginBottom: 0 }}>
            Insegna
            <select name="tenantId" defaultValue="">
              <option value="">— Consorzio —</option>
              {insegne.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
          </label>
        )}
        {mostraPuntoVendita && (
          <label className="field" style={{ marginBottom: 0 }}>
            Punto vendita
            <select name="storeId" defaultValue="">
              <option value="">— Nessuno —</option>
              {puntiVendita.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
            <span className="hint">Scegliendolo, l&apos;insegna viene presa da lì.</span>
          </label>
        )}
        <label className="field" style={{ marginBottom: 0 }}>
          Reparto
          <select name="departmentId" defaultValue="">
            <option value="">— Nessuno —</option>
            {reparti.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
          </select>
        </label>
        <label className="field" style={{ marginBottom: 0 }}>
          Genere
          <select name="gender" defaultValue="">
            <option value="">— Non specificato —</option>
            <option value="f">Femminile</option>
            <option value="m">Maschile</option>
          </select>
          <span className="hint">Decide come sono scritte le email: «benvenuta» invece di «benvenuto».</span>
        </label>
        <label className="field" style={{ marginBottom: 0 }}>Mansione<input type="text" name="jobTitle" placeholder="es. Addetto vendita" /></label>
        <label className="field" style={{ marginBottom: 0 }}>Data di assunzione<input type="date" name="hireDate" /></label>
        <div style={{ gridColumn: "1 / -1" }}>
          <strong style={{ fontSize: 12.5 }}>Aree del portale</strong>
          <span className="hint" style={{ marginLeft: 8 }}>nessuna spunta = nessun accesso finché non gliene dai una</span>
          <div style={{ display: "flex", gap: 14, marginTop: 4, flexWrap: "wrap" }}>
            {SITES.map((s) => (
              <label key={s} style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 12.5 }}>
                <input type="checkbox" name="sites" value={s} /> {SITE_LABELS[s]}
              </label>
            ))}
          </div>
          {(ruolo === "manager" || altri.includes("manager")) && (
            <div style={{ marginTop: 8 }}>
              <strong style={{ fontSize: 12.5 }}>Aree che gestisce</strong>
              <span className="hint" style={{ marginLeft: 8 }}>le altre a cui accede le usa da operativo</span>
              <div style={{ display: "flex", gap: 14, marginTop: 4, flexWrap: "wrap" }}>
                {SITES.map((s) => (
                  <label key={`m_${s}`} style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 12.5 }}>
                    <input type="checkbox" name="manages" value={s} /> {SITE_LABELS[s]}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <button className="btn btn-sm" type="submit" disabled={pending}>
            {pending ? "Creazione…" : "Crea collaboratore"}
          </button>
        </div>
      </form>
    </div>
  );
}
