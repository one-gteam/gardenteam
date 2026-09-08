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
  const [pending, startTransition] = useTransition();

  const invia = (formData: FormData) =>
    startTransition(async () => {
      setErrore("");
      setFatto("");
      const res = await creaUtente(formData);
      if (res.ok) {
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
        <label className="field" style={{ marginBottom: 0 }}>
          Ruolo
          <select name="role" defaultValue="student">
            {ruoli.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </label>
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
          <span className="hint" style={{ marginLeft: 8 }}>nessuna spunta = quelle previste dal ruolo</span>
          <div style={{ display: "flex", gap: 14, marginTop: 4, flexWrap: "wrap" }}>
            {SITES.map((s) => (
              <label key={s} style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 12.5 }}>
                <input type="checkbox" name="sites" value={s} /> {SITE_LABELS[s]}
              </label>
            ))}
          </div>
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
