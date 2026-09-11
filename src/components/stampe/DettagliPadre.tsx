"use client";

import { useEffect, useState, useTransition } from "react";
import InlineEdit from "./InlineEdit";
import InlineSelect from "./InlineSelect";
import ParentQuickEdit from "./ParentQuickEdit";
import {
  updateParentFieldInline, updateProductFieldInline, setParentTagScoped, toggleParentCaratteristicaInline, moveProductToParent,
  setParentImageFromFile, segnalaProblemaInline, setParentImage, rigeneraTestiAI, scioglieParent,
} from "@/lib/zoo-actions";

interface Valore { value: string; custom: boolean }
interface Articolo {
  id: string; ean: string; codice: string; descrizione: string; marca: string; fornitore: string; prezzo: string; image: string;
  promo: string; contenuto: string; contenutoManuale: boolean;
  offerta: { prezzoPromo: string; prezzoListino: string; meccanica: string; prezzoUnita: string } | null;
}
interface Dettaglio {
  consortium: boolean;
  gestione: boolean;
  scopeType: string;
  scopeLabel: string;
  parent: {
    id: string; aiGenerated: boolean; nome: Valore; descVolantino: Valore; descCartello: Valore;
    animale: Valore; caratt: Valore; caratteristiche: string[]; animaliConsorzio: string[]; carattConsorzio: string[]; image: string;
  };
  articoli: Articolo[];
  padri: { id: string; nome: string }[];
  settings: { caratteristiche: string[]; categorieAnimali: string[]; caratteristicheProdotto: string[] };
  fotoDisponibili: string[];
  fotoBaseUrl: string;
}

const EVENTO = "zoo:dettagli";

/**
 * Il link "dettagli" sulla riga di un prodotto padre. Non porta da nessuna
 * parte: manda un segnale al pannello della stessa riga (PannelloPadre), che
 * si apre e chiede al server solo i dati di quel padre. Prima il dettaglio
 * era un parametro dell'indirizzo e ogni clic ricaricava l'intera tabella.
 */
export function DettagliPadre({ parentId }: { parentId: string }) {
  const [aperto, setAperto] = useState(false);
  useEffect(() => {
    const onEvento = (e: Event) => {
      const d = (e as CustomEvent<{ parentId: string; aperto: boolean }>).detail;
      if (d.parentId === parentId) setAperto(d.aperto);
    };
    window.addEventListener(EVENTO, onEvento);
    return () => window.removeEventListener(EVENTO, onEvento);
  }, [parentId]);
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(EVENTO, { detail: { parentId, aperto: !aperto } }))}
      style={{ fontSize: 10.5, color: "#274b7a", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit" }}
    >
      {aperto ? "▾ dettagli" : "▸ dettagli"}
    </button>
  );
}

/** La riga espansa sotto il prodotto padre: si riempie solo quando la si apre. */
export function PannelloPadre({ parentId, scopeParam, back }: { parentId: string; scopeParam: string; back: string }) {
  const [aperto, setAperto] = useState(false);
  const [dati, setDati] = useState<Dettaglio | null>(null);
  const [errore, setErrore] = useState("");
  const [segnalazione, setSegnalazione] = useState("");
  const [esitoSegnalazione, setEsitoSegnalazione] = useState("");
  const [pending, startTransition] = useTransition();

  const carica = async () => {
    try {
      const r = await fetch(`/stampe/zoo/padre?id=${encodeURIComponent(parentId)}&scope=${encodeURIComponent(scopeParam)}`);
      if (!r.ok) throw new Error(String(r.status));
      setDati((await r.json()) as Dettaglio);
      setErrore("");
    } catch {
      setErrore("Non riesco a leggere il dettaglio: riprova.");
    }
  };

  useEffect(() => {
    const onEvento = (e: Event) => {
      const d = (e as CustomEvent<{ parentId: string; aperto: boolean }>).detail;
      if (d.parentId !== parentId) return;
      setAperto(d.aperto);
      if (d.aperto) void carica();
    };
    window.addEventListener(EVENTO, onEvento);
    return () => window.removeEventListener(EVENTO, onEvento);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentId, scopeParam]);

  if (!aperto) return null;
  const chiudi = () => window.dispatchEvent(new CustomEvent(EVENTO, { detail: { parentId, aperto: false } }));

  if (!dati) {
    return <div style={{ padding: 10, fontSize: 12.5, color: "var(--muted)" }}>{errore || "Carico il dettaglio…"}</div>;
  }
  const { parent, consortium, gestione, scopeType, articoli, settings } = dati;
  const consorzio = scopeType === "system";

  return (
    <div style={{ padding: "10px 12px", background: "#f5f8fc", borderTop: "2px solid #274b7a", borderBottom: "2px solid #274b7a" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 14 }}>
          Prodotto padre: {parent.nome.value}
          {parent.aiGenerated && <span className="pill pill-blue" style={{ marginLeft: 8 }}>testi AI</span>}
        </strong>
        <button type="button" className="btn btn-outline btn-sm" onClick={chiudi}>✕ Chiudi</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 16 }}>
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={parent.image} alt="" style={{ width: "100%", borderRadius: 8, background: "#fff", border: "1px solid #e4e4e4" }} />
          {consortium && (
            <>
              <form action={setParentImage.bind(null, back, parent.id, scopeParam)} style={{ marginTop: 8, display: "grid", gap: 6 }}>
                <select name="fromChild" style={{ fontSize: 12 }}>
                  <option value="">Immagine di riferimento: scegli da un articolo…</option>
                  {articoli.filter((c) => c.image).map((c) => (
                    <option key={c.id} value={c.id}>{c.descrizione.slice(0, 45)}</option>
                  ))}
                </select>
                <button className="btn btn-outline btn-sm" type="submit">Usa questa</button>
              </form>
              <form action={setParentImage.bind(null, back, parent.id, scopeParam)} style={{ marginTop: 6, display: "grid", gap: 6 }}>
                <input type="file" name="file" accept="image/*" style={{ fontSize: 12 }} />
                <button className="btn btn-outline btn-sm" type="submit">Carica nuova immagine</button>
              </form>
            </>
          )}

          <div style={{ marginTop: 10 }}>
            <strong style={{ fontSize: 12.5 }}>Caratteristiche{consortium ? "" : " (Consorzio)"}</strong>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
              {settings.caratteristiche.map((c) => {
                const on = parent.caratteristiche.includes(c);
                if (!consortium) return on ? <span key={c} className="pill pill-green">{c}</span> : null;
                return (
                  <button key={c} type="button" className={`pill ${on ? "pill-green" : "pill-gray"}`} disabled={pending}
                    style={{ cursor: "pointer", border: "none" }}
                    onClick={() => startTransition(async () => {
                      const r = await toggleParentCaratteristicaInline(parent.id, c);
                      if (r.ok) setDati((d) => d ? { ...d, parent: { ...d.parent, caratteristiche: r.caratteristiche } } : d);
                    })}>
                    {on ? "✓ " : ""}{c}
                  </button>
                );
              })}
            </div>
          </div>

          {!consorzio && (
            /*
             * Chi sta in un'insegna o in un punto vendita non tocca le caratteristiche
             * comuni, ma può dire come vede lui questo padre: animale e caratteristica
             * valgono per i suoi cartelli e per la scelta del layout.
             */
            <div style={{ marginTop: 10 }}>
              <strong style={{ fontSize: 12.5 }}>Per {dati.scopeLabel}</strong>
              <div style={{ display: "grid", gap: 4, marginTop: 4, fontSize: 12 }}>
                <label>Animale
                  <InlineSelect value={parent.animale.value} options={settings.categorieAnimali} onSaved={carica}
                    onSave={setParentTagScoped.bind(null, parent.id, "animale", scopeParam)} />
                  {parent.animale.custom && <span className="pill pill-orange">vostro</span>}
                </label>
                <label>Caratteristica
                  <InlineSelect value={parent.caratt.value} options={settings.caratteristicheProdotto} onSaved={carica}
                    onSave={setParentTagScoped.bind(null, parent.id, "prodotto", scopeParam)} />
                  {parent.caratt.custom && <span className="pill pill-orange">vostra</span>}
                </label>
              </div>
            </div>
          )}
        </div>

        <div>
          <div style={{ display: "grid", gap: 8 }}>
            <label className="field" style={{ marginBottom: 0 }}>
              Nome prodotto padre {parent.nome.custom && <span className="pill pill-orange">personalizzato</span>}
              <InlineEdit value={parent.nome.value} onSaved={carica}
                onSave={updateParentFieldInline.bind(null, parent.id, "nome", scopeParam)} />
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              Descrizione per il VOLANTINO {parent.descVolantino.custom && <span className="pill pill-orange">personalizzata</span>}
              <InlineEdit value={parent.descVolantino.value} multiline onSaved={carica}
                onSave={updateParentFieldInline.bind(null, parent.id, "descVolantino", scopeParam)} />
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              Descrizione per il CARTELLO {parent.descCartello.custom && <span className="pill pill-orange">personalizzata</span>}
              <InlineEdit value={parent.descCartello.value} multiline onSaved={carica}
                onSave={updateParentFieldInline.bind(null, parent.id, "descCartello", scopeParam)} />
            </label>
            <span className="hint">
              I testi si salvano da soli uscendo dal campo
              {consorzio ? " (versione Consorzio)." : `: valgono per ${dati.scopeLabel}, la versione del Consorzio resta intatta.`}
            </span>
          </div>

          {consortium && (
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <form action={rigeneraTestiAI.bind(null, back, parent.id, scopeParam)}>
                <button className="btn btn-outline btn-sm" type="submit">Rigenera testi con AI</button>
              </form>
              <form action={scioglieParent.bind(null, back, parent.id, scopeParam)}>
                <button className="btn btn-outline btn-sm" type="submit">Sciogli raggruppamento</button>
              </form>
            </div>
          )}

          {/* gli articoli del padre, subito visibili: senza dover aprire "N articoli" nella colonna */}
          <div style={{ marginTop: 12 }}>
            <strong style={{ fontSize: 12.5 }}>Articoli ({articoli.length})</strong>
            <div className="table-wrap" style={{ marginTop: 4 }}>
              <table className="data" style={{ fontSize: 11.5 }}>
                <thead>
                  <tr><th></th><th>Articolo</th><th>EAN · codice</th><th>Marca</th><th title="Quanto contiene la confezione: serve per il prezzo al chilo/litro">Contenuto</th><th>Prezzo base</th><th>Ultima promo</th><th>€/kg · l</th></tr>
                </thead>
                <tbody>
                  {articoli.map((a) => (
                    <tr key={a.id}>
                      <td>
                        {a.image
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={a.image} alt="" style={{ width: 30, height: 30, objectFit: "contain", background: "#fff", border: "1px solid #eee", borderRadius: 4 }} />
                          : <span className="pill pill-gray" style={{ fontSize: 9.5 }}>no foto</span>}
                      </td>
                      <td>{a.descrizione}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{a.ean}<div style={{ color: "var(--muted)" }}>{a.codice}</div></td>
                      <td>{a.marca}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {consortium
                          ? <InlineEdit value={a.contenuto} placeholder="es. 1,5 kg" onSaved={carica}
                              onSave={updateProductFieldInline.bind(null, a.id, "contenuto")} />
                          : (a.contenuto || "—")}
                      </td>
                      <td>{a.prezzo ? `€ ${a.prezzo}` : "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {a.offerta
                          ? <>
                              <span style={{ color: "#c8161d", fontWeight: 800 }}>€ {a.offerta.prezzoPromo || "—"}</span>
                              {a.offerta.prezzoListino && <span style={{ color: "var(--muted)", textDecoration: "line-through", marginLeft: 4 }}>€ {a.offerta.prezzoListino}</span>}
                              {a.offerta.meccanica && <span className="pill pill-blue" style={{ marginLeft: 4 }}>{a.offerta.meccanica}</span>}
                            </>
                          : <span style={{ color: "var(--muted)" }}>—</span>}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{a.offerta?.prezzoUnita || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {consortium && (
            <ParentQuickEdit
              parentId={parent.id}
              articoli={articoli.map((c) => ({ id: c.id, ean: c.ean, descrizione: c.descrizione }))}
              padri={dati.padri}
              foto={dati.fotoDisponibili}
              fotoBaseUrl={dati.fotoBaseUrl}
              onMove={moveProductToParent.bind(null, back, scopeParam)}
              onSetImage={setParentImageFromFile.bind(null, parent.id)}
            />
          )}

          {!gestione && (
            /* chi non gestisce l'area (capo reparto) segnala al gestore quello che non torna */
            <div style={{ marginTop: 12, borderTop: "1px dashed var(--line)", paddingTop: 8 }}>
              <strong style={{ fontSize: 12.5 }}>Segnala un errore al gestore</strong>
              <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                <input type="text" value={segnalazione} onChange={(e) => setSegnalazione(e.target.value)}
                  placeholder="es. la foto è di un altro prodotto, il prezzo di partenza è sbagliato…"
                  style={{ flex: 1, minWidth: 240, fontSize: 12.5, marginTop: 0 }} />
                <button type="button" className="btn btn-sm" disabled={pending || !segnalazione.trim()}
                  onClick={() => startTransition(async () => {
                    const r = await segnalaProblemaInline(scopeParam, parent.id, undefined, segnalazione);
                    setEsitoSegnalazione(r.ok ? "✓ Segnalazione inviata al gestore" : "Non inviata: riprova");
                    if (r.ok) setSegnalazione("");
                  })}>
                  Invia
                </button>
              </div>
              {esitoSegnalazione && <span className="hint">{esitoSegnalazione}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
