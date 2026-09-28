import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import StampeHeader from "@/components/stampe/StampeHeader";
import ModuloAutoSalva from "@/components/ModuloAutoSalva";
import { ModuloInvio, PulsanteAzione } from "@/components/AzioneSenzaRicarica";
import { canAccessArea, isZooEditor, resolveScope } from "@/lib/stampe";
import { gestisce } from "@/lib/types";
import { getZooDb, effectiveParentText, campaignStato, animaleFocus } from "@/lib/zoo";
import {
  modificaFocus, togliDalFocus, aggiungiAlFocus, notaFocusCampagna,
  creaVolantinoFocus, salvaVolantinoFocus, eliminaVolantinoFocus, salvaGruppoFocus, eliminaGruppoFocus,
} from "@/lib/zoo-focus-actions";

interface VoceFocus { nome: string; descrizione: string; prezzo: string; inVolantino: boolean; offerId?: string }
interface GruppoFocus { chiave: string; focus: string; animale: string; offerte: VoceFocus[]; gruppoId?: string; righe?: string }
interface VolantinoFocus {
  id: string;
  nome: string;
  dal: string;
  al?: string;
  note?: string;
  manuale: boolean;
  inLavorazione: boolean;
  gruppi: GruppoFocus[];
  /** Offerte del volantino ancora senza focus: si possono aggiungere a un focus. */
  liberi: { id: string; nome: string }[];
}

/**
 * Storico dei focus: per ogni volantino uscito, i temi di comunicazione
 * (il campo "focus" delle offerte) con le offerte che li componevano,
 * suddivisi per animale. Serve a non ripetere lo stesso angolo due mesi di
 * fila e a ritrovare cosa si era detto l'anno prima nello stesso periodo.
 * Chi cura lo Zoo per il Consorzio può correggerlo e riportare a mano i
 * volantini fatti prima del sito (o fuori dal sito).
 */
export default async function ZooFocusPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessArea(user, "zoo")) redirect("/studente");
  // lo storico dei focus serve a chi costruisce i volantini: il capo reparto non lo vede
  if (!gestisce(user, "zoo")) redirect("/stampe/zoo/stampa");
  const sp = await searchParams;
  const db = await getZooDb();
  const academyDb = await getDb();
  const scope = resolveScope(user, sp.scope, academyDb);
  const puoModificare = isZooEditor(user);
  const animaliScelta = [...db.settings.categorieAnimali, "Altro"];

  const data = (d?: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("it-IT") : "—");
  const prodById = new Map(db.products.map((p) => [p.id, p]));
  const parentById = new Map(db.parents.map((p) => [p.id, p]));
  const nomeOfferta = (o: (typeof db.offers)[number]) => {
    const product = prodById.get(o.productId ?? "");
    const parent = product?.parentId ? parentById.get(product.parentId) : undefined;
    return {
      nome: parent ? effectiveParentText(db, scope, parent, "nome", academyDb).value || o.descrizione : o.descrizione,
      descrizione: parent ? effectiveParentText(db, scope, parent, "descVolantino", academyDb).value : "",
    };
  };

  const dalSito: VolantinoFocus[] = db.campaigns
    .filter((c) => campaignStato(c) !== "lavorazione" || db.offers.some((o) => o.campaignId === c.id && o.focus))
    .map((c) => {
      const offerte = db.offers.filter((o) => o.campaignId === c.id);
      // focus → animale → offerte: lo stesso testo di focus su animali diversi resta separato
      const gruppi = new Map<string, GruppoFocus>();
      const liberi = new Map<string, { id: string; nome: string }>();
      for (const o of offerte) {
        const { nome, descrizione } = nomeOfferta(o);
        const focus = (o.focus ?? "").trim();
        if (!focus) {
          if (!liberi.has(nome)) liberi.set(nome, { id: o.id, nome });
          continue;
        }
        const animale = animaleFocus(db, o);
        const chiave = `${animale}|${focus.toLowerCase()}`;
        const g = gruppi.get(chiave) ?? { chiave, focus, animale, offerte: [] };
        if (!g.offerte.some((x) => x.nome === nome)) {
          g.offerte.push({ nome, descrizione, prezzo: o.prezzoPromo, inVolantino: !!o.selezionata, offerId: o.id });
        }
        gruppi.set(chiave, g);
      }
      return {
        id: c.id, nome: c.nome, dal: c.dal, al: c.al, note: c.focusNote, manuale: false,
        inLavorazione: campaignStato(c) === "lavorazione",
        gruppi: [...gruppi.values()],
        liberi: [...liberi.values()].sort((a, b) => a.nome.localeCompare(b.nome)),
      };
    });

  const aMano: VolantinoFocus[] = db.focusManuali.map((v) => ({
    id: v.id, nome: v.nome, dal: v.dal, al: v.al, note: v.note, manuale: true, inLavorazione: false, liberi: [],
    gruppi: v.gruppi.map((g) => ({
      chiave: g.id, gruppoId: g.id, focus: g.focus, animale: g.animale, righe: g.righe,
      offerte: g.righe.split("\n").map((r) => r.trim()).filter(Boolean)
        .map((r) => ({ nome: r, descrizione: "", prezzo: "", inVolantino: false })),
    })),
  }));

  const volantini = [...dalSito, ...aMano]
    .filter((v) => v.gruppi.length > 0 || v.manuale || sp.tutti === "1")
    .sort((a, b) => (b.dal ?? "").localeCompare(a.dal ?? ""));

  const filtroAnimale = sp.animale ?? "";
  const selettoreAnimale = (valore: string) => (
    <select name="animale" defaultValue={valore} style={{ marginTop: 0 }}>
      {[...new Set([...animaliScelta, valore])].filter(Boolean).map((a) => <option key={a} value={a}>{a}</option>)}
    </select>
  );
  const rosso = { color: "var(--red)", borderColor: "var(--red)" };

  return (
    <div>
      <StampeHeader user={user} active="focus" area="zoo" />
      <div className="container">
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0 }}>Storico dei focus</h1>
            <p className="subtitle" style={{ margin: "4px 0 0" }}>
              I temi di comunicazione di ogni volantino, per animale e data di uscita: cosa si è messo in evidenza e quando.
              {puoModificare && " Puoi correggerli con «✎ Modifica» e aggiungere i volantini fatti fuori dal sito."}
            </p>
          </div>
          <form method="get" style={{ display: "flex", gap: 8, alignItems: "end" }}>
            <label className="field" style={{ marginBottom: 0 }}>
              Animale
              <select name="animale" defaultValue={filtroAnimale}>
                <option value="">Tutti</option>
                {animaliScelta.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label className="hint" style={{ display: "flex", gap: 4, alignItems: "center", paddingBottom: 6 }}>
              <input type="checkbox" name="tutti" value="1" defaultChecked={sp.tutti === "1"} /> anche i volantini senza focus
            </label>
            <button className="btn btn-sm" type="submit">Filtra</button>
          </form>
        </div>

        {puoModificare && (
          <details className="card" style={{ padding: 14, marginBottom: 14, background: "var(--green-50)" }}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>＋ Aggiungi un volantino precedente (non fatto con il sito)</summary>
            <p className="hint" style={{ margin: "8px 0" }}>
              Dopo averlo creato, dalla sua scheda («✎ Modifica») aggiungi i focus: animale, tema e le offerte, una per riga.
            </p>
            <ModuloInvio azione={creaVolantinoFocus} style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
              <label className="field" style={{ marginBottom: 0, flex: 1, minWidth: 220 }}>Nome<input type="text" name="nome" required placeholder="es. Volantino Zoo marzo 2025" /></label>
              <label className="field" style={{ marginBottom: 0 }}>Uscita dal<input type="date" name="dal" required /></label>
              <label className="field" style={{ marginBottom: 0 }}>al<input type="date" name="al" /></label>
              <button className="btn btn-sm" type="submit">Crea</button>
            </ModuloInvio>
          </details>
        )}

        {volantini.length === 0 && (
          <div className="card"><p className="empty">Nessun focus registrato: si scrive in Offerte in corso, colonna «Focus».</p></div>
        )}

        {volantini.map((v) => {
          const gruppi = v.gruppi.filter((g) => !filtroAnimale || g.animale === filtroAnimale);
          if (filtroAnimale && gruppi.length === 0 && !v.manuale) return null;
          const perAnimale = new Map<string, GruppoFocus[]>();
          for (const g of gruppi) perAnimale.set(g.animale, [...(perAnimale.get(g.animale) ?? []), g]);
          const animali = [...perAnimale.keys()].sort();
          return (
            <div key={v.id} className="card" style={{ padding: 14, marginBottom: 14 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", marginBottom: 8 }}>
                <strong style={{ fontSize: 15 }}>{v.nome}</strong>
                <span className="hint">uscita {data(v.dal)} → {data(v.al)}</span>
                <span className="pill pill-blue">{v.gruppi.length} focus</span>
                {v.manuale && <span className="pill pill-gray">aggiunto a mano</span>}
                {v.inLavorazione && <span className="pill pill-orange">in lavorazione</span>}
              </div>
              {v.note && <p style={{ margin: "0 0 10px", fontSize: 13, whiteSpace: "pre-line", background: "#faf8f2", padding: "6px 10px", borderRadius: 6 }}>📝 {v.note}</p>}
              {animali.length === 0 && <p className="hint" style={{ margin: 0 }}>Nessun focus su questo volantino.</p>}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                {animali.map((animale) => (
                  <div key={animale} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
                    <div style={{ fontWeight: 800, marginBottom: 6 }}>{animale}</div>
                    {perAnimale.get(animale)!.map((g) => (
                      <div key={g.chiave} style={{ marginBottom: 8 }}>
                        <div style={{ fontWeight: 700, fontSize: 13.5, color: "#274b7a" }}>{g.focus}</div>
                        <ul style={{ margin: "2px 0 0", paddingLeft: 16, fontSize: 12.5 }}>
                          {g.offerte.map((o) => (
                            <li key={o.offerId ?? o.nome}>
                              {o.nome}{o.prezzo ? ` · € ${o.prezzo}` : ""}
                              {o.inVolantino && <span className="pill pill-green" style={{ marginLeft: 4, fontSize: 9.5 }}>in volantino</span>}
                              {o.descrizione && <div className="hint">{o.descrizione}</div>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              {puoModificare && (
                <details style={{ marginTop: 12, borderTop: "1px dashed var(--line)", paddingTop: 10 }}>
                  <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13.5 }}>✎ Modifica</summary>
                  <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
                    {v.manuale ? (
                      <>
                        <ModuloAutoSalva azione={salvaVolantinoFocus.bind(null, v.id)}>
                          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10 }} className="griglia-fissa">
                            <label className="field" style={{ marginBottom: 0 }}>Nome<input type="text" name="nome" defaultValue={v.nome} required /></label>
                            <label className="field" style={{ marginBottom: 0 }}>Uscita dal<input type="date" name="dal" defaultValue={v.dal} required /></label>
                            <label className="field" style={{ marginBottom: 0 }}>al<input type="date" name="al" defaultValue={v.al ?? ""} /></label>
                          </div>
                          <label className="field" style={{ marginBottom: 0 }}>
                            Note
                            <textarea name="note" rows={2} defaultValue={v.note ?? ""} placeholder="com'è andato, cosa ripetere o evitare" />
                          </label>
                        </ModuloAutoSalva>
                        {v.gruppi.map((g) => (
                          <div key={g.chiave} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
                            <ModuloAutoSalva azione={salvaGruppoFocus.bind(null, v.id, g.gruppoId!)}>
                              <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10 }} className="griglia-fissa">
                                <label className="field" style={{ marginBottom: 0 }}>Animale{selettoreAnimale(g.animale)}</label>
                                <label className="field" style={{ marginBottom: 0 }}>Focus<input type="text" name="focus" defaultValue={g.focus} required /></label>
                              </div>
                              <label className="field" style={{ marginBottom: 0 }}>
                                Offerte (una per riga, es. «Monge Natural Superpremium 12 kg · € 49,90»)
                                <textarea name="righe" rows={3} defaultValue={g.righe ?? ""} />
                              </label>
                            </ModuloAutoSalva>
                            <div style={{ marginTop: 6 }}>
                              <PulsanteAzione azione={eliminaGruppoFocus.bind(null, v.id, g.gruppoId!)} conferma={`Togliere il focus «${g.focus}»?`} style={rosso}>
                                Togli questo focus
                              </PulsanteAzione>
                            </div>
                          </div>
                        ))}
                        <ModuloInvio azione={salvaGruppoFocus.bind(null, v.id, null)}
                          style={{ border: "1px dashed var(--line)", borderRadius: 8, padding: 10, background: "#fafaf7" }}>
                          <strong style={{ fontSize: 13 }}>Nuovo focus</strong>
                          <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10, marginTop: 6 }} className="griglia-fissa">
                            <label className="field" style={{ marginBottom: 0 }}>Animale{selettoreAnimale(animaliScelta[0])}</label>
                            <label className="field" style={{ marginBottom: 0 }}>Focus<input type="text" name="focus" required placeholder="es. Alimentazione cuccioli" /></label>
                          </div>
                          <label className="field">Offerte (una per riga)<textarea name="righe" rows={3} /></label>
                          <button className="btn btn-sm" type="submit">Aggiungi focus</button>
                        </ModuloInvio>
                        <div>
                          <PulsanteAzione azione={eliminaVolantinoFocus.bind(null, v.id)} conferma={`Eliminare dallo storico «${v.nome}» con tutti i suoi focus?`} style={rosso}>
                            Elimina questo volantino dallo storico
                          </PulsanteAzione>
                        </div>
                      </>
                    ) : (
                      <>
                        <ModuloAutoSalva azione={notaFocusCampagna.bind(null, v.id)}>
                          <label className="field" style={{ marginBottom: 0 }}>
                            Note sul volantino
                            <textarea name="note" rows={2} defaultValue={v.note ?? ""} placeholder="com'è andato, cosa ripetere o evitare" />
                          </label>
                        </ModuloAutoSalva>
                        {v.gruppi.map((g) => (
                          <div key={g.chiave} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
                            <ModuloInvio azione={modificaFocus.bind(null, v.id, g.animale, g.focus.toLowerCase())} svuota={false}
                              style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
                              <label className="field" style={{ marginBottom: 0 }}>Animale{selettoreAnimale(g.animale)}</label>
                              <label className="field" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>Focus<input type="text" name="focus" defaultValue={g.focus} required /></label>
                              <button className="btn btn-outline btn-sm" type="submit">Salva</button>
                            </ModuloInvio>
                            <ul style={{ margin: "8px 0 0", paddingLeft: 0, listStyle: "none", fontSize: 12.5, display: "grid", gap: 4 }}>
                              {g.offerte.map((o) => (
                                <li key={o.offerId} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                  <span style={{ flex: 1 }}>{o.nome}{o.prezzo ? ` · € ${o.prezzo}` : ""}</span>
                                  <PulsanteAzione azione={togliDalFocus.bind(null, o.offerId!)} title="L'offerta resta nel volantino, solo senza questo focus">
                                    togli
                                  </PulsanteAzione>
                                </li>
                              ))}
                            </ul>
                            {v.liberi.length > 0 && (
                              <ModuloInvio azione={aggiungiAlFocus.bind(null, v.id)} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                                <input type="hidden" name="focus" value={g.focus} />
                                <input type="hidden" name="animale" value={g.animale} />
                                <select name="offerId" required defaultValue="" style={{ marginTop: 0, flex: 1, minWidth: 200, fontSize: 12.5 }}>
                                  <option value="" disabled>aggiungi un&apos;offerta del volantino…</option>
                                  {v.liberi.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
                                </select>
                                <button className="btn btn-outline btn-sm" type="submit">Aggiungi</button>
                              </ModuloInvio>
                            )}
                          </div>
                        ))}
                        {v.liberi.length > 0 && (
                          <ModuloInvio azione={aggiungiAlFocus.bind(null, v.id)}
                            style={{ border: "1px dashed var(--line)", borderRadius: 8, padding: 10, background: "#fafaf7" }}>
                            <strong style={{ fontSize: 13 }}>Nuovo focus</strong>
                            <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10, marginTop: 6 }} className="griglia-fissa">
                              <label className="field" style={{ marginBottom: 0 }}>Animale{selettoreAnimale(animaliScelta[0])}</label>
                              <label className="field" style={{ marginBottom: 0 }}>Focus<input type="text" name="focus" required /></label>
                            </div>
                            <label className="field">
                              Prima offerta (le altre si aggiungono dopo)
                              <select name="offerId" required defaultValue="">
                                <option value="" disabled>scegli…</option>
                                {v.liberi.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
                              </select>
                            </label>
                            <button className="btn btn-sm" type="submit">Crea focus</button>
                          </ModuloInvio>
                        )}
                      </>
                    )}
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
