"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import EditorTesto, { type EditorTestoHandle } from "./EditorTesto";
import { salvaArticolo, descrizioneAi, eliminaArticolo } from "@/lib/articoli-actions";
import type { Allegato, Articolo, Categoria, LinkEsterno, ModelloArticolo } from "@/lib/articoli";

/**
 * Il modulo dell'articolo, per crearlo e per correggerlo: titolo, categoria,
 * testo formattato, allegati (PDF e immagini), link, destinatari (arrivano
 * dal server come caselle già disegnate), evidenza, scadenza, bozza o
 * pubblicato. "Scrivi con l'AI" manda titolo, appunti e allegati al modello
 * e mette il testo nell'editor, da correggere.
 */
export default function ArticoloForm({
  articolo, categorie, destinatari, gestore, modelli = [], esceIl = "", programmato = false,
}: {
  articolo?: Articolo;
  categorie: Categoria[];
  destinatari: ReactNode;
  gestore: boolean;
  modelli?: ModelloArticolo[];
  /** "Esce il" già scritto in ora italiana (articolo programmato). */
  esceIl?: string;
  programmato?: boolean;
}) {
  const router = useRouter();
  const editor = useRef<EditorTestoHandle>(null);
  const form = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [aiInCorso, setAiInCorso] = useState(false);
  const [errore, setErrore] = useState("");
  const [link, setLink] = useState<LinkEsterno[]>(articolo?.link?.length ? articolo.link : []);
  const [allegatiEsistenti, setAllegatiEsistenti] = useState<Allegato[]>(articolo?.allegati ?? []);
  const [nuoviFile, setNuoviFile] = useState<string[]>([]);
  const [modelloId, setModelloId] = useState(articolo?.modelloId ?? "");
  const categoria = useRef<HTMLSelectElement>(null);
  const [quando, setQuando] = useState(esceIl);

  /*
   * Scegliere un modello: categoria, scheletro del testo e destinatari già
   * pronti. Se nell'editor c'è già del testo si chiede prima di sostituirlo.
   */
  const applicaModello = (id: string) => {
    setModelloId(id);
    const m = modelli.find((x) => x.id === id);
    if (!m || !form.current) return;
    if (m.categoriaId && categoria.current) categoria.current.value = m.categoriaId;
    const attuale = (editor.current?.html() ?? "").replace(/<[^>]+>/g, "").trim();
    if (m.testo && (!attuale || window.confirm("Sostituire il testo scritto con lo schema del modello?"))) editor.current?.imposta(m.testo);
    const d = m.destinatari ?? {};
    const scelti = new Set([...(d.ruoli ?? []), ...(d.tenantIds ?? []), ...(d.storeIds ?? []), ...(d.departmentIds ?? []), ...(d.groupIds ?? []), ...(d.userIds ?? [])]);
    if (scelti.size > 0) {
      for (const c of form.current.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name^="dest_"]')) c.checked = scelti.has(c.value);
    }
  };

  const invia = (stato: "pubblicato" | "bozza") => {
    if (!form.current) return;
    const fd = new FormData(form.current);
    fd.set("stato", stato);
    setErrore("");
    startTransition(async () => {
      const r: { ok: boolean; error?: string; id?: string } = await salvaArticolo(articolo?.id ?? null, fd).catch(() => ({ ok: false, error: "Non salvato: riprova." }));
      if (!r.ok) { setErrore(r.error ?? "Non salvato"); return; }
      router.push(stato === "bozza" ? "/articoli?bozze=1" : `/articoli/${r.id}`);
      router.refresh();
    });
  };

  const scriviConAi = async () => {
    if (!form.current) return;
    const fd = new FormData(form.current);
    for (const a of allegatiEsistenti) fd.append("allegato_url", a.url);
    setAiInCorso(true);
    setErrore("");
    const r: { ok: boolean; testo?: string; error?: string } = await descrizioneAi(fd).catch(() => ({ ok: false, error: "Chiamata non riuscita" }));
    setAiInCorso(false);
    if (!r.ok || !r.testo) { setErrore(r.error ?? "L'AI non ha risposto"); return; }
    editor.current?.imposta(r.testo);
  };

  const elimina = () => {
    if (!articolo || !window.confirm(`Eliminare «${articolo.titolo}»?`)) return;
    startTransition(async () => {
      const r = await eliminaArticolo(articolo.id);
      if (r.ok) { router.push("/articoli"); router.refresh(); } else setErrore(r.error ?? "Non eliminato");
    });
  };

  return (
    <form ref={form} className="articolo-form" onSubmit={(e) => { e.preventDefault(); invia("pubblicato"); }}>
      <input type="hidden" name="modelloId" value={modelloId} />
      {modelli.length > 0 && !articolo && (
        <div className="modelli-scelta">
          <span className="hint">Parti da un modello:</span>
          {modelli.map((m) => (
            <button key={m.id} type="button" className={`chip ${modelloId === m.id ? "on" : ""}`} onClick={() => applicaModello(m.id)}>
              {m.emoji ? `${m.emoji} ` : ""}{m.nome}
            </button>
          ))}
          {modelloId && <button type="button" className="chip" onClick={() => setModelloId("")}>✕ nessun modello</button>}
        </div>
      )}
      <div className="card">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 12 }}>
          <label className="field">Titolo *<input type="text" name="titolo" required defaultValue={articolo?.titolo ?? ""} placeholder="es. Nuove regole per i resi" autoFocus /></label>
          <label className="field">
            Categoria
            <select ref={categoria} name="categoriaId" defaultValue={articolo?.categoriaId ?? ""}>
              <option value="">— nessuna —</option>
              {categorie.map((c) => <option key={c.id} value={c.id}>{c.emoji ? `${c.emoji} ` : ""}{c.nome}</option>)}
            </select>
          </label>
        </div>

        <div className="field">
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span>Descrizione</span>
            <button type="button" className="btn btn-outline btn-sm" disabled={aiInCorso} onClick={scriviConAi}
              title="Il modello legge titolo, appunti, link e allegati (PDF e immagini) e propone il testo">
              {aiInCorso ? "Scrivo…" : "✨ Scrivi la descrizione con l'AI"}
            </button>
            <span className="hint">Allega prima i file: l'AI li legge.</span>
          </div>
          <EditorTesto ref={editor} name="testo" iniziale={articolo?.testo ?? ""} />
        </div>

        <div className="field">
          <span>Allegati (PDF e immagini, fino a 15 MB l&apos;uno)</span>
          <input type="file" name="allegati" multiple accept="application/pdf,image/*"
            onChange={(e) => setNuoviFile([...(e.target.files ?? [])].map((f) => f.name))} />
          {nuoviFile.length > 0 && <div className="hint">Da caricare: {nuoviFile.join(", ")}</div>}
          {allegatiEsistenti.length > 0 && (
            <div className="chips" style={{ marginTop: 6 }}>
              {allegatiEsistenti.map((a) => (
                <span key={a.url} className="chip on">
                  <a href={a.url} target="_blank" rel="noopener noreferrer">{a.nome}</a>
                  <button type="button" className="chip-x" title="Togli questo allegato"
                    onClick={() => { setAllegatiEsistenti((p) => p.filter((x) => x.url !== a.url)); }}>✕</button>
                </span>
              ))}
            </div>
          )}
          {/* gli allegati tolti si comunicano al server come url */}
          {(articolo?.allegati ?? []).filter((a) => !allegatiEsistenti.some((x) => x.url === a.url)).map((a) => (
            <input key={a.url} type="hidden" name="togli_allegato" value={a.url} />
          ))}
        </div>

        <div className="field">
          <span>Link a siti esterni</span>
          {link.map((l, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, marginBottom: 6 }}>
              <input type="text" name="link_url" placeholder="https://…" value={l.url}
                onChange={(e) => setLink((p) => p.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
              <input type="text" name="link_titolo" placeholder="titolo del link (facoltativo)" value={l.titolo ?? ""}
                onChange={(e) => setLink((p) => p.map((x, j) => (j === i ? { ...x, titolo: e.target.value } : x)))} />
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setLink((p) => p.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setLink((p) => [...p, { url: "" }])}>＋ Aggiungi link</button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h3 style={{ marginTop: 0 }}>Chi lo vede</h3>
        {destinatari}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12, alignItems: "end" }}>
          {gestore && (
            <label className="interruttore-grande">
              <input type="checkbox" name="inEvidenza" value="1" defaultChecked={!!articolo?.inEvidenza} />
              In evidenza (resta in cima)
            </label>
          )}
          <label className="field" style={{ marginBottom: 0 }}>
            Esce il <span className="hint">(vuoto = subito)</span>
            <input type="datetime-local" name="esceIl" value={quando} onChange={(e) => setQuando(e.target.value)} />
          </label>
          <label className="field" style={{ marginBottom: 0 }}>
            Scade il <span className="hint">(poi va in archivio)</span>
            <input type="date" name="scadenza" defaultValue={articolo?.scadenza ?? ""} />
          </label>
        </div>
        {articolo?.stato === "pubblicato" && !programmato && (
          <label className="interruttore-grande" style={{ marginTop: 12 }}
            title="Se cambi testo o allegati, chi l'aveva già letto lo ritrova fra i nuovi. La versione di prima resta consultabile.">
            <input type="checkbox" name="rileggere" value="1" />
            Cambio importante: segnalo come da rileggere
          </label>
        )}
      </div>

      {errore && <div className="alert alert-amber" style={{ marginTop: 12 }}>{errore}</div>}

      <div className="azioni-stampa" style={{ marginTop: 14 }}>
        {articolo && (
          <button type="button" className="btn btn-outline btn-sm" style={{ color: "var(--red)", borderColor: "var(--red)" }} disabled={pending} onClick={elimina}>
            Elimina
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-outline" disabled={pending} onClick={() => invia("bozza")}>Salva come bozza</button>
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Salvo…" : quando && new Date(quando) > new Date() ? "Programma" : articolo?.stato === "pubblicato" ? "Salva" : "Pubblica"}
        </button>
      </div>
    </form>
  );
}
