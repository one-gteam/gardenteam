import FotoMini from "@/components/stampe/FotoMini";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import StampeHeader from "@/components/stampe/StampeHeader";
import { canAccessArea, isZooEditor, scopesForUser, resolveScope } from "@/lib/stampe";
import { getDb } from "@/lib/db";
import {
  getZooDb, campagnaInLavorazione, zooImageUrl, effectiveParentText, animaliDi, caratteristicheProdottoDi,
  chiavePrezzo, datiPrezzoOfferta, migraVolantinoPages, storicoOfferteByEan, periodoBreve, NO_VOLANTINO,
} from "@/lib/zoo";
import {
  updateOfferVolantino,
  renameScheda, addScheda, resolveZooSuggestion, sendZooSuggestion,
  updateOfferGroupFieldInline, setParentTagInline, updateParentFieldInline, updateOfferFieldInline,
} from "@/lib/zoo-actions";
import InlineSelect from "@/components/stampe/InlineSelect";
import InlineEdit from "@/components/stampe/InlineEdit";
import FiltriMobile from "@/components/FiltriMobile";
import ShiftChecks from "@/components/stampe/ShiftChecks";
import { VotoOfferta, VotoSpuntate } from "@/components/stampe/VotoOfferta";
import BarraFissa from "@/components/stampe/BarraFissa";
import PaginaRapida from "@/components/stampe/PaginaRapida";
import UnisciNelVolantino from "@/components/stampe/UnisciNelVolantino";
import { PulsanteAzione } from "@/components/AzioneSenzaRicarica";
import { separaUnioneVolantino } from "@/lib/zoo-actions";
import ColumnTools from "@/components/stampe/ColumnTools";

const RIGHE_MAX = 300;

export default async function ZooVolantinoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessArea(user, "zoo")) redirect("/studente");
  const sp = await searchParams;

  // letture indipendenti: in parallelo pesa solo la più lenta, non la somma
  const [db, academyDb] = await Promise.all([getZooDb(), getDb()]);
  const scopes = scopesForUser(user, academyDb);
  const scope = resolveScope(user, sp.scope, academyDb);
  const scopeParam = `${scope.type}:${scope.id}`;
  const consortium = isZooEditor(user);
  /*
   * Chi vota è il capo reparto: «Proponi», «Non tratto» e la segnalazione sono
   * suoi. Il gestore e gli amministratori leggono i voti; il Consorzio decide.
   */
  const vota = user.role === "dept_head";
  const spunte = vota || consortium;

  // solo il volantino IN LAVORAZIONE: su quelli chiusi o archiviati non si sceglie più
  const campaign = campagnaInLavorazione(db);
  const allOffers = campaign ? db.offers.filter((o) => o.campaignId === campaign.id) : [];
  // i focus già scritti in questo volantino, per riusare lo stesso testo su altri prodotti
  const focusEsistenti = [...new Set(allOffers.map((o) => (o.focus ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const schedaFilter = sp.scheda ?? "";
  const baseOffers = schedaFilter
    ? allOffers.filter((o) => o.selezionata && o.schedaId === schedaFilter)
    : allOffers;

  /*
   * Indici per id: con oltre mille articoli e centinaia di offerte, un `.find()`
   * dentro il ciclo delle righe (per prodotto, padre e voti) costa quadratico ed
   * era una delle ragioni per cui questa pagina risultava lenta.
   */
  const prodById = new Map(db.products.map((p) => [p.id, p]));
  const parentById = new Map(db.parents.map((p) => [p.id, p]));
  const votesByOffer = new Map<string, typeof db.votes>();
  for (const v of db.votes) votesByOffer.set(v.offerId, [...(votesByOffer.get(v.offerId) ?? []), v]);

  // ---- filtro offerte (colonna sinistra) ----
  const parentOf = (o: (typeof allOffers)[number]) => {
    const parentId = prodById.get(o.productId ?? "")?.parentId;
    return parentId ? parentById.get(parentId) : undefined;
  };
  const caratteristicheOf = (o: (typeof allOffers)[number]): string[] => parentOf(o)?.caratteristiche ?? [];
  const prodOf = (o: (typeof allOffers)[number]) => prodById.get(o.productId ?? "");
  const ANIMALI = db.settings.categorieAnimali;
  const carattsProdotto = db.settings.caratteristicheProdotto;
  const marche = [...new Set(baseOffers.map((o) => prodOf(o)?.marca).filter(Boolean) as string[])].sort();
  const fornitori = [...new Set(baseOffers.map((o) => prodOf(o)?.fornitore).filter(Boolean) as string[])].sort();
  // se sono già su una scheda con nome animale (es. "Cane"), il filtro parte da lì
  const schedaNome = campaign?.schede.find((s) => s.id === schedaFilter)?.nome ?? "";
  const animale = sp.animale ?? (ANIMALI.includes(schedaNome) ? schedaNome : "");
  const caratt = sp.caratt ?? "";
  /*
   * Pagine del volantino (le stesse di Crea Volantino): la colonna "Pagina" le
   * assegna, il filtro le isola, il contatore in alto dice quante voci ha
   * ciascuna mentre si sceglie.
   */
  const layoutVol = campaign ? db.volantinoLayouts.find((l) => l.campaignId === campaign.id) : undefined;
  const pagineVolantino = layoutVol
    ? migraVolantinoPages(layoutVol.pages).map((p, i) => ({ id: p.id, nome: `${i + 1}. ${p.titolo || `Pagina ${i + 1}`}` }))
    : [];
  const nomePagina = new Map(pagineVolantino.map((p) => [p.id, p.nome]));
  // più pagine insieme: "pagina=a,b,_nessuna"; un clic su una pillola la aggiunge o la toglie
  const filtriPagina = (sp.pagina ?? "").split(",").filter(Boolean);
  const filtroPagina = filtriPagina[0] ?? "";
  const inPagine = (o: { paginaId?: string }) => filtriPagina.some((f) => (f === "_nessuna" ? !o.paginaId : o.paginaId === f));
  const storico = storicoOfferteByEan(db);
  const offers = baseOffers.filter((o) => {
    if (filtriPagina.length > 0 && !inPagine(o)) return false;
    if (animale && !caratteristicheOf(o).includes(animale)) return false;
    if (caratt && !caratteristicheOf(o).includes(caratt)) return false;
    if (sp.marca && prodOf(o)?.marca !== sp.marca) return false;
    if (sp.fornitore && prodOf(o)?.fornitore !== sp.fornitore) return false;
    return true;
  });

  // ordinamento per colonna (clic sull'intestazione): mantiene tutti i filtri correnti
  const sortDir = sp.dir === "desc" ? "desc" : "asc";
  const sortVal = (o: (typeof offers)[number]): string | number => {
    switch (sp.sort) {
      case "prezzo": return Number.parseFloat((o.prezzoPromo || "0").replace(",", "."));
      case "marca": return prodOf(o)?.marca ?? "";
      case "fornitore": return prodOf(o)?.fornitore ?? "";
      case "animale": return animaliDi(db, caratteristicheOf(o)).join(", ");
      default: return o.descrizione;
    }
  };
  const offersOrdinate = sp.sort
    ? [...offers].sort((a, b) => {
        const va = sortVal(a);
        const vb = sortVal(b);
        const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "it");
        return sortDir === "desc" ? -cmp : cmp;
      })
    : offers;
  /*
   * Le varianti di uno stesso padre diventano una riga sola: con centinaia di
   * offerte è molto più leggero da scorrere, e chi sceglie ragiona comunque per
   * prodotto ("mettiamo questa linea?") più che per singolo gusto/formato.
   */
  const gruppi = (() => {
    const map = new Map<string, { parent?: (typeof db.parents)[number]; offs: typeof offersOrdinate }>();
    for (const o of offersOrdinate) {
      const parent = parentOf(o);
      // padre + prezzo, come in Offerte in corso e nei cartelli: prezzi diversi, righe diverse
      const key = parent ? `${parent.id}~${chiavePrezzo(o)}` : `_o_${o.id}`;
      const g = map.get(key) ?? { parent, offs: [] };
      g.offs.push(o);
      map.set(key, g);
    }
    return [...map.values()];
  })();
  const gruppiVisibili = gruppi.slice(0, RIGHE_MAX);
  const vociPerPagina = (() => {
    const voci = new Map<string, Set<string>>();
    for (const o of allOffers) {
      const pid = o.paginaId || "_nessuna";
      const parent = parentOf(o);
      const chiave = parent ? `${parent.id}~${chiavePrezzo(o)}` : o.id;
      voci.set(pid, (voci.get(pid) ?? new Set()).add(chiave));
    }
    return (pid: string) => voci.get(pid)?.size ?? 0;
  })();
  /*
   * La pagina "giusta" per un animale: quella col suo nome, oppure quella che
   * lo raccoglie con altri (Pesci → Acquariologia, Roditori/Uccelli/Rettili →
   * Piccoli animali). Così la colonna Pagina propone i pulsanti giusti.
   */
  const SINONIMI_PAGINA: Record<string, string[]> = {
    pesci: ["acquari", "pesc"], roditori: ["piccoli animali", "roditor"], uccelli: ["piccoli animali", "uccell"],
    rettili: ["piccoli animali", "rettil", "terrar"],
  };
  const paginaPerAnimale = (nomePagina: string, animale: string) => {
    const n = nomePagina.toLowerCase();
    const a = animale.toLowerCase();
    return n.includes(a) || (SINONIMI_PAGINA[a] ?? []).some((x) => n.includes(x));
  };
  const hrefPagina = (pid: string) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "pagina" && k !== "scope") params.set(k, v);
    params.set("scope", scopeParam);
    // clic su una pagina già scelta = la toglie; "" = tutte
    const prossime = !pid ? [] : filtriPagina.includes(pid) ? filtriPagina.filter((x) => x !== pid) : [...filtriPagina, pid];
    if (prossime.length) params.set("pagina", prossime.join(","));
    return `?${params.toString()}`;
  };
  const nomeFiltroPagina = (f: string) => (f === "_nessuna" ? "da assegnare" : f === NO_VOLANTINO ? "no volantino" : nomePagina.get(f) ?? f);

  const sortHref = (field: string) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "sort" && k !== "dir" && k !== "scope") params.set(k, v);
    params.set("scope", scopeParam);
    params.set("sort", field);
    params.set("dir", sp.sort === field && sortDir === "asc" ? "desc" : "asc");
    return `?${params.toString()}`;
  };
  const sortArrow = (field: string) => (sp.sort === field ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  const activeOffer = allOffers.find((o) => o.id === sp.offerta);
  const selCount = allOffers.filter((o) => o.selezionata).length;
  const openSuggestions = db.suggestions.filter((s) => s.status === "aperta");

  const dataIt = (d?: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("it-IT") : "—");

  return (
    <div>
      <StampeHeader user={user} active="volantino" area="zoo" />
      <div className="container">
        <div className="testata-compatta">
          <h1 style={{ margin: 0, fontSize: 24, whiteSpace: "nowrap" }}>Scelta offerte Volantino</h1>
          <span className="hint" style={{ flex: 1, minWidth: 220 }}>
            {campaign
              ? <><strong>{campaign.nome}</strong> · {dataIt(campaign.dal)} → {dataIt(campaign.al)} · {selCount} scelte</>
              : "Nessun volantino in lavorazione: aprine uno da Offerte in corso"}
            <span title={consortium ? "Vedi i voti di tutti i PV e fai la selezione finale." : vota ? "Segna le offerte che ti piacciono: il Consorzio vede i voti di tutti i capi reparto." : "Qui leggi i voti dei capi reparto e la selezione del Consorzio."}> ⓘ</span>
          </span>
          {consortium && campaign && (
            <>
              <a className="btn btn-outline btn-sm" href={`/stampe/zoo/excel?volantino=1&campagna=${campaign.id}&scope=${scopeParam}`}>Excel per il grafico</a>
              <a className="btn btn-outline btn-sm" href={`/stampe/zoo/foto?campagna=${campaign.id}&scope=${scopeParam}`}>Raccolta foto</a>
            </>
          )}
          <form method="get" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select name="scope" defaultValue={scopeParam} style={{ marginTop: 0 }} aria-label="Insegna / PV">
              {scopes.map((s) => (
                <option key={`${s.type}:${s.id}`} value={`${s.type}:${s.id}`}>{s.label}</option>
              ))}
            </select>
            <button className="btn btn-sm" type="submit">OK</button>
          </form>
        </div>

        {!campaign && (
          <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
            Importa prima le offerte mensili nella pagina &quot;Offerte in corso&quot;.
          </div>
        )}

        {campaign && (
          <>
            {/* schede: il vecchio modo di dividere il volantino, prima delle pagine di Crea Volantino.
                Restano visibili solo se qualche offerta le usa ancora (o se una è aperta). */}
            {(schedaFilter || allOffers.some((o) => o.selezionata && o.schedaId)) && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
              <a className={`pill ${!schedaFilter ? "pill-blue" : "pill-gray"}`} href={`/stampe/zoo/volantino?scope=${scopeParam}`} style={{ textDecoration: "none" }}>
                Tutte le offerte ({allOffers.length})
              </a>
              {campaign.schede.map((s) => {
                const n = allOffers.filter((o) => o.selezionata && o.schedaId === s.id).length;
                return (
                  <a key={s.id} className={`pill ${schedaFilter === s.id ? "pill-blue" : "pill-gray"}`}
                    href={`/stampe/zoo/volantino?scope=${scopeParam}&scheda=${s.id}`} style={{ textDecoration: "none" }}>
                    {s.nome} ({n})
                  </a>
                );
              })}
              {consortium && (
                <form action={addScheda.bind(null, campaign.id, scopeParam)}>
                  <button className="btn btn-outline btn-sm" type="submit">+ scheda</button>
                </form>
              )}
            </div>
            )}

            {/* rinomina schede */}
            {consortium && schedaFilter && (
              <div className="card" style={{ padding: 10, marginBottom: 12 }}>
                <form action={renameScheda.bind(null, campaign.id, schedaFilter, scopeParam)} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>Rinomina scheda:</span>
                  <input type="text" name="nome" defaultValue={campaign.schede.find((s) => s.id === schedaFilter)?.nome} style={{ width: 240 }} />
                  <button className="btn btn-sm" type="submit">Salva</button>
                </form>
              </div>
            )}

            {/* pannello modifica offerta (Consorzio) */}
            {consortium && activeOffer && (
              <div className="card" style={{ padding: 14, marginBottom: 12, border: "2px solid #274b7a" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <strong>Modifica offerta per il volantino</strong>
                  <a className="btn btn-outline btn-sm" href={`/stampe/zoo/volantino?scope=${scopeParam}`}>✕ Chiudi</a>
                </div>
                <form action={updateOfferVolantino.bind(null, activeOffer.id, scopeParam)} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label className="field" style={{ marginBottom: 0, gridColumn: "1 / -1" }}>
                    Descrizione promo
                    <textarea name="descrizione" rows={2} defaultValue={activeOffer.descrizione} />
                  </label>
                  <label className="field" style={{ marginBottom: 0 }}>
                    Scheda
                    <select name="schedaId" defaultValue={activeOffer.schedaId ?? ""}>
                      <option value="">— non assegnata —</option>
                      {campaign.schede.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                    </select>
                  </label>
                  <label className="field" style={{ marginBottom: 0 }}>
                    Etichetta
                    <select name="label" defaultValue={activeOffer.label ?? ""}>
                      <option value="">— nessuna —</option>
                      {db.settings.labels.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </label>
                  <label className="field" style={{ marginBottom: 0 }}>
                    Area tematica (gruppo)
                    <input type="text" name="gruppo" defaultValue={activeOffer.gruppo ?? ""} placeholder="es. Speciale cuccioli" />
                  </label>
                  <label className="field" style={{ marginBottom: 0 }}>
                    Descrizione area tematica
                    <input type="text" name="gruppoDescrizione" defaultValue={activeOffer.gruppoDescrizione ?? ""} placeholder="testo introduttivo del gruppo" />
                  </label>
                  <label className="field" style={{ marginBottom: 0 }}>
                    Tieni vicino a
                    <select name="tieniVicinoA" defaultValue={activeOffer.tieniVicinoA ?? ""}>
                      <option value="">—</option>
                      {allOffers.filter((o) => o.id !== activeOffer.id && o.selezionata).map((o) => (
                        <option key={o.id} value={o.id}>{o.descrizione.slice(0, 50)}</option>
                      ))}
                    </select>
                  </label>
                  <div style={{ display: "flex", alignItems: "end" }}>
                    <button className="btn btn-sm" type="submit">Salva</button>
                  </div>
                </form>
              </div>
            )}

            {/* contatore per pagina: resta visibile mentre si scorre la tabella */}
            {consortium && (
              <div className="contatore-pagine">
                <strong style={{ fontSize: 12.5 }}>Voci per pagina:</strong>
                <a className={`pill ${filtriPagina.length === 0 ? "pill-blue" : "pill-gray"}`} href={hrefPagina("")} title="Tutte le pagine">tutte</a>
                {pagineVolantino.map((p) => (
                  <a key={p.id} className={`pill ${filtriPagina.includes(p.id) ? "pill-blue" : "pill-green"}`} href={hrefPagina(p.id)}
                    title="Clic per vedere solo questa pagina; clic su più pagine per vederle insieme">
                    {filtriPagina.includes(p.id) ? "✓ " : ""}{p.nome} <strong>{vociPerPagina(p.id)}</strong>
                  </a>
                ))}
                <a className={`pill ${filtriPagina.includes("_nessuna") ? "pill-blue" : "pill-amber"}`} href={hrefPagina("_nessuna")}>
                  {filtriPagina.includes("_nessuna") ? "✓ " : ""}da assegnare <strong>{vociPerPagina("_nessuna")}</strong>
                </a>
                <a className={`pill ${filtriPagina.includes(NO_VOLANTINO) ? "pill-blue" : "pill-gray"}`} href={hrefPagina(NO_VOLANTINO)}>
                  {filtriPagina.includes(NO_VOLANTINO) ? "✓ " : ""}no volantino <strong>{vociPerPagina(NO_VOLANTINO)}</strong>
                </a>
                {filtriPagina.length > 1 && <span className="hint">{filtriPagina.length} pagine insieme</span>}
                {pagineVolantino.length === 0 && <span className="hint">Le pagine si creano in Crea Volantino.</span>}
              </div>
            )}

            {/* filtri in alto: una riga, il modulo si apre solo quando serve */}
            <details className="card filtri-compatti" style={{ marginBottom: 10, padding: "8px 12px" }} open={Boolean(animale || caratt || sp.marca || sp.fornitore || filtroPagina)}>
              <summary style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", cursor: "pointer", listStyle: "none" }}>
                <span className="hint" style={{ flex: 1, fontSize: 12 }}>
                  {offers.length} offerte in {gruppi.length} voci{gruppi.length > RIGHE_MAX ? ` (mostrate le prime ${RIGHE_MAX}: restringi con i filtri)` : ""}
                  {spunte ? " · spunta più righe (anche Shift+clic) per agire in blocco" : ""} · clic sulle intestazioni per ordinare
                </span>
                <span className="btn btn-outline btn-sm">⚲ Filtri{Boolean(animale || caratt || sp.marca || sp.fornitore || filtroPagina) ? " (attivi)" : ""}</span>
              </summary>
              <div style={{ marginTop: 10 }}>
              <FiltriMobile id="filtri-volantino" scelte={[animale, caratt, sp.marca, sp.fornitore,
                filtriPagina.length > 0 && filtriPagina.map(nomeFiltroPagina).join(" + ")]}>
              <form method="get" style={{ display: "grid", gridTemplateColumns: `repeat(${consortium ? 5 : 4}, minmax(0, 1fr)) auto`, gap: 10, alignItems: "end" }}>
                <input type="hidden" name="scope" value={scopeParam} />
                {schedaFilter && <input type="hidden" name="scheda" value={schedaFilter} />}
                <label className="field" style={{ marginBottom: 0 }}>Animale
                  <select name="animale" defaultValue={animale}>
                    <option value="">Tutti</option>
                    {ANIMALI.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </label>
                <label className="field" style={{ marginBottom: 0 }}>Caratteristica
                  <select name="caratt" defaultValue={caratt}>
                    <option value="">Tutte</option>
                    {carattsProdotto.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="field" style={{ marginBottom: 0 }}>Marca
                  <select name="marca" defaultValue={sp.marca ?? ""}>
                    <option value="">Tutte</option>
                    {marche.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
                <label className="field" style={{ marginBottom: 0 }}>Fornitore
                  <select name="fornitore" defaultValue={sp.fornitore ?? ""}>
                    <option value="">Tutti</option>
                    {fornitori.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
                {consortium && (
                  <label className="field" style={{ marginBottom: 0 }}>Pagina
                    <select name="pagina" defaultValue={filtroPagina}>
                      <option value="">Tutte</option>
                      {pagineVolantino.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                      <option value="_nessuna">da assegnare</option>
                      <option value={NO_VOLANTINO}>no volantino</option>
                    </select>
                  </label>
                )}
                <button className="btn btn-sm" type="submit">Filtra</button>
              </form>
              </FiltriMobile>
              </div>
            </details>

            <div>
            <ShiftChecks />
            {sp.votate && <div className="alert alert-green">✓ Voto registrato su {sp.votate} offerte.</div>}
            {/* le spunte in tabella appartengono a questo form via attributo form="bulkform" */}
            <form id="bulkform" />
            {spunte && (
              <BarraFissa>
                <VotoSpuntate scopeParam={scopeParam} formId="bulkform" vota={vota} consortium={consortium}
                  focus={consortium ? focusEsistenti : undefined}>
                  {consortium && <UnisciNelVolantino formId="bulkform" />}
                </VotoSpuntate>
              </BarraFissa>
            )}
            <div className="card table-wrap">
              <ColumnTools tableId="tab-volantino" />
              <table className="data tabella-stretta" id="tab-volantino">
                <thead>
                  <tr>
                    {spunte && <th style={{ width: 30 }}></th>}
                    <th style={{ width: 56 }}>Foto</th>
                    <th><a href={sortHref("descrizione")} style={{ textDecoration: "none", color: "inherit" }}>Offerta{sortArrow("descrizione")}</a></th>
                    <th className="col-opz"><a href={sortHref("fornitore")} style={{ textDecoration: "none", color: "inherit" }}>Fornitore{sortArrow("fornitore")}</a></th>
                    <th className="col-opz"><a href={sortHref("marca")} style={{ textDecoration: "none", color: "inherit" }}>Marca{sortArrow("marca")}</a></th>
                    <th><a href={sortHref("animale")} style={{ textDecoration: "none", color: "inherit" }}>Animale{sortArrow("animale")}</a></th>
                    {consortium && <th>Caratteristica</th>}
                    <th><a href={sortHref("prezzo")} style={{ textDecoration: "none", color: "inherit" }}>Prezzo{sortArrow("prezzo")}</a></th>
                    {consortium && <th>Pagina volantino</th>}
                    {consortium && <th>Focus</th>}
                    {consortium && <th>Etichetta</th>}
                    <th>Voti dei PV</th>
                    {vota && <th className="no-print">Il tuo voto</th>}
                    {consortium && <th>Seleziona pagina volantino</th>}
                  </tr>
                </thead>
                <tbody>
                  {gruppi.length === 0 && <tr><td colSpan={7 + (spunte ? 1 : 0) + (vota ? 1 : 0) + (consortium ? 5 : 0)} className="empty">Nessuna offerta {schedaFilter ? "assegnata a questa scheda" : "in campagna"}.</td></tr>}
                  {gruppiVisibili.map((g) => {
                    const { parent, offs } = g;
                    const first = offs[0];
                    const isGroup = offs.length > 1;
                    const product = prodOf(first);
                    const animaliOfferta = animaliDi(db, parent?.caratteristiche ?? []);
                    // una riga = un prezzo (padre + prezzo): partenza, sconto e tipologia vengono dalla prima offerta
                    const dati = datiPrezzoOfferta(db, first, scope, academyDb);
                    const carattProdotto = caratteristicheProdottoDi(db, parent?.caratteristiche ?? []);
                    // già in altri volantini (escluso questo): per non riproporre sempre gli stessi prodotti
                    const giaVisti = [...new Map(offs.flatMap((o) => storico.get(o.ean)?.volantino ?? [])
                      .filter((v) => v.campaign.id !== campaign.id).map((v) => [v.campaign.id, v])).values()];
                    // voti aggregati: PV distinti che hanno votato almeno una variante del gruppo
                    const groupVotes = offs.flatMap((o) => votesByOffer.get(o.id) ?? []);
                    const pref = [...new Map(groupVotes.filter((v) => v.tipo === "preferita").map((v) => [v.userId, v])).values()];
                    const non = [...new Map(groupVotes.filter((v) => v.tipo === "nontrattato").map((v) => [v.userId, v])).values()];
                    const myPref = pref.some((v) => v.userId === user.id);
                    const myNon = non.some((v) => v.userId === user.id);
                    const scheda = campaign.schede.find((s) => s.id === first.schedaId);
                    const ids = offs.map((o) => o.id);
                    return (
                      <tr key={parent ? `${parent.id}~${chiavePrezzo(first)}` : first.id} style={offs.every((o) => o.selezionata) ? { background: "#f4faf4" } : undefined}>
                        {spunte && (
                          <td>
                            {/* la spunta porta l'id della prima offerta: l'azione in blocco estende
                                il voto a tutte le varianti dello stesso padre */}
                            <input type="checkbox" name="zsel" value={first.id} form="bulkform"
                              title={isGroup
                                ? `Spunta per agire in blocco su tutte le ${offs.length} varianti (Shift+clic per intervalli)`
                                : "Spunta per agire in blocco (Shift+clic per intervalli)"} />
                          </td>
                        )}
                        <td>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <FotoMini src={zooImageUrl(product, parent)} style={{ width: 44, height: 44, objectFit: "contain", background: "#fff", borderRadius: 6, border: "1px solid #eee" }} />
                        </td>
                        <td>
                          {/* titolo e descrizione del volantino: si correggono qui (nel padre valgono ovunque) */}
                          {consortium ? (
                            <div className="titolo-modificabile">
                              <InlineEdit value={parent ? effectiveParentText(db, scope, parent, "nome", academyDb).value : first.descrizione}
                                placeholder="titolo…"
                                onSave={parent
                                  ? updateParentFieldInline.bind(null, parent.id, "nome", scopeParam)
                                  : updateOfferFieldInline.bind(null, first.id, "descrizione")} />
                            </div>
                          ) : (
                            <strong style={{ fontSize: 13 }}>
                              {parent ? effectiveParentText(db, scope, parent, "nome", academyDb).value : first.descrizione}
                            </strong>
                          )}
                          {parent && (consortium ? (
                            <div style={{ fontSize: 11.5 }}>
                              <InlineEdit value={effectiveParentText(db, scope, parent, "descVolantino", academyDb).value}
                                multiline placeholder="descrizione per il volantino…"
                                onSave={updateParentFieldInline.bind(null, parent.id, "descVolantino", scopeParam)} />
                            </div>
                          ) : (
                            <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{effectiveParentText(db, scope, parent, "descVolantino", academyDb).value}</div>
                          ))}
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>
                            {product?.marca}
                            {isGroup ? ` · ${offs.length} varianti` : ` · EAN ${first.ean}`}
                          </div>
                          {giaVisti.length > 0 && (
                            <div style={{ marginTop: 3 }}>
                              <span className="pill pill-purple" style={{ fontSize: 10.5 }}
                                title={giaVisti.map((v) => `${v.campaign.nome} (${periodoBreve(v.campaign)})${v.pagina ? ` — ${v.pagina}` : ""}`).join("\n")}>
                                ↺ già in volantino: {giaVisti.slice(0, 2).map((v) => periodoBreve(v.campaign)).join(", ")}{giaVisti.length > 2 ? ` +${giaVisti.length - 2}` : ""}
                              </span>
                            </div>
                          )}
                          {first.unioneVolantino && (() => {
                            const u = db.unioniVolantino.find((x) => x.id === first.unioneVolantino);
                            const righe = new Set(allOffers.filter((x) => x.unioneVolantino === first.unioneVolantino)
                              .map((x) => `${parentOf(x)?.id ?? x.id}~${chiavePrezzo(x)}`)).size;
                            return (
                              <div style={{ marginTop: 3, display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                                <span className="pill pill-purple" style={{ fontSize: 10.5 }} title="Solo per il volantino: i cartelli restano separati per prezzo">
                                  ⛓ nel volantino unita con altre {righe - 1}{u?.titolo ? `: «${u.titolo}»` : ""} · {u?.prezzoTesto ?? "a partire da"}
                                </span>
                                {consortium && (
                                  <PulsanteAzione azione={separaUnioneVolantino.bind(null, first.unioneVolantino)} className="mini-btn"
                                    conferma="Separare di nuovo le voci unite nel volantino?">separa</PulsanteAzione>
                                )}
                              </div>
                            );
                          })()}
                          {!isGroup && (
                            <div style={{ display: "flex", gap: 4, marginTop: 3, flexWrap: "wrap" }}>
                              {first.label && <span className="pill pill-orange">{first.label}</span>}
                              {first.gruppo && <span className="pill pill-blue" title={first.gruppoDescrizione}>{first.gruppo}</span>}
                              {first.tieniVicinoA && <span className="pill pill-gray" title="da tenere adiacente a un'altra offerta">adiacente</span>}
                              {scheda && <span className="pill pill-green">{scheda.nome}</span>}
                            </div>
                          )}
                          <details style={{ marginTop: 4 }}>
                            <summary style={{ cursor: "pointer", fontSize: 11.5, color: "var(--green-700)", fontWeight: 600 }}>
                              Vedi {offs.length > 1 ? `i ${offs.length} articoli inclusi` : "l'articolo"}
                            </summary>
                            <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 11.5, color: "var(--muted)" }}>
                              {offs.map((o) => (
                                <li key={o.id}>
                                  {o.descrizione}
                                  <span style={{ opacity: 0.75 }}> · EAN {o.ean} · € {o.prezzoPromo}</span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        </td>
                        <td className="col-opz" style={{ fontSize: 12.5 }}>{product?.fornitore || "—"}</td>
                        <td className="col-opz" style={{ fontSize: 12.5 }}>{product?.marca || "—"}</td>
                        <td>
                          {consortium && parent ? (
                            <InlineSelect value={animaliOfferta[0] ?? ""} options={db.settings.categorieAnimali}
                              onSave={setParentTagInline.bind(null, parent.id, "animale")} />
                          ) : (
                            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{animaliOfferta.join(", ") || "—"}</span>
                          )}
                        </td>
                        {consortium && (
                          <td>
                            {parent ? (
                              <InlineSelect value={carattProdotto[0] ?? ""} options={db.settings.caratteristicheProdotto}
                                onSave={setParentTagInline.bind(null, parent.id, "prodotto")} />
                            ) : <span className="hint">senza padre</span>}
                          </td>
                        )}
                        <td style={{ whiteSpace: "nowrap" }}>
                          <strong>{dati.prezzo ? `€ ${dati.prezzo}` : "—"}</strong>
                          {dati.listino && <div style={{ fontSize: 11.5, color: "var(--muted)" }} title="prezzo di partenza">da € {dati.listino}</div>}
                          {dati.sconto && <span className="pill pill-green" style={{ fontSize: 10 }}>{dati.sconto}</span>}
                          {dati.tipi.length > 0 && <div style={{ fontSize: 10.5, color: "#274b7a", fontWeight: 700 }}>{dati.tipi.join(" · ")}</div>}
                        </td>
                        {consortium && (
                          <td style={{ whiteSpace: "nowrap" }}>
                            {first.paginaId === NO_VOLANTINO
                              ? <span className="pill pill-gray">✕ no volantino</span>
                              : first.paginaId
                                ? <span className="pill pill-green">✓ {nomePagina.get(first.paginaId) ?? first.paginaId}</span>
                                : <span className="pill pill-amber">da assegnare</span>}
                          </td>
                        )}
                        {consortium && (
                          <td style={{ minWidth: 140 }}>
                            <InlineEdit value={first.focus ?? ""} placeholder="focus…" suggerimenti={focusEsistenti}
                              onSave={updateOfferGroupFieldInline.bind(null, ids, "focus")} />
                          </td>
                        )}
                        {consortium && (
                          <td>
                            <InlineSelect value={first.label ?? ""} options={db.settings.labels}
                              onSave={updateOfferGroupFieldInline.bind(null, ids, "label")} />
                          </td>
                        )}
                        <td style={{ fontSize: 12 }}>
                          {pref.length > 0 && (
                            <div title={pref.map((v) => `${v.userName} (${v.scopeLabel})`).join(", ")}>
                              {pref.length}: {pref.map((v) => v.scopeLabel).slice(0, 3).join(", ")}{pref.length > 3 ? "…" : ""}
                            </div>
                          )}
                          {non.length > 0 && (
                            <div style={{ color: "#a33" }} title={non.map((v) => `${v.userName} (${v.scopeLabel})`).join(", ")}>
                              non trattato da {non.length}: {non.map((v) => v.scopeLabel).slice(0, 3).join(", ")}{non.length > 3 ? "…" : ""}
                            </div>
                          )}
                          {pref.length === 0 && non.length === 0 && <span style={{ color: "var(--muted)" }}>—</span>}
                        </td>
                        {vota && (
                        <td className="no-print" style={{ whiteSpace: "nowrap" }}>
                          <VotoOfferta ids={ids} scopeParam={scopeParam} proposta={myPref} nonTrattata={myNon} />{" "}
                          <details className="flag-details" style={{ display: "inline-block" }}>
                            <summary className="mini-btn" title="Segnala un errore o un'incongruenza su questa offerta">⚑</summary>
                            <form action={sendZooSuggestion.bind(null, scopeParam)} className="flag-popover">
                              <input type="hidden" name="offerId" value={first.id} />
                              <input type="hidden" name="back" value="/stampe/zoo/volantino" />
                              <input type="text" name="message" required placeholder="Descrivi l'errore o l'incongruenza" />
                              <button className="btn btn-sm" type="submit">Invia al Consorzio</button>
                            </form>
                          </details>
                        </td>
                        )}
                        {consortium && (
                          <td>
                            {/* la pagina scelta mette l'offerta nel volantino; «✕ no» la toglie */}
                            <PaginaRapida value={first.paginaId ?? ""} tutte={pagineVolantino} noVolantino={NO_VOLANTINO}
                              suggerite={pagineVolantino.filter((p) => animaliOfferta.some((a) => paginaPerAnimale(p.nome, a)))}
                              onSave={updateOfferGroupFieldInline.bind(null, ids, "paginaId")} />
                            {!isGroup && (
                              <a className="hint" style={{ display: "inline-block", marginTop: 3 }}
                                href={`/stampe/zoo/volantino?scope=${scopeParam}${schedaFilter ? `&scheda=${schedaFilter}` : ""}&offerta=${first.id}`}>
                                modifica l&apos;offerta…
                              </a>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </div>

            {/* proposte di correzione dai PV */}
            {consortium && openSuggestions.length > 0 && (
              <div className="section" style={{ marginTop: 16 }}>
                <div className="section-head">
                  <h2>Proposte di correzione dai PV ({openSuggestions.length})</h2>
                </div>
                <div className="card table-wrap">
                  <table className="data">
                    <thead><tr><th>Riferimento</th><th>Messaggio</th><th>Da</th><th></th></tr></thead>
                    <tbody>
                      {openSuggestions.map((s) => {
                        const parent = s.parentId ? db.parents.find((p) => p.id === s.parentId) : undefined;
                        const offer = s.offerId ? db.offers.find((o) => o.id === s.offerId) : undefined;
                        return (
                          <tr key={s.id}>
                            <td style={{ fontSize: 12.5 }}>{parent?.nome ?? offer?.descrizione ?? "—"}</td>
                            <td style={{ maxWidth: 320 }}>{s.message}</td>
                            <td style={{ fontSize: 12.5 }}>
                              {s.userName}
                              <div style={{ fontSize: 11, color: "var(--muted)" }}>{s.scopeLabel} · {new Date(s.date).toLocaleDateString("it-IT")}</div>
                            </td>
                            <td>
                              <form action={resolveZooSuggestion.bind(null, s.id)}>
                                <button className="btn btn-outline btn-sm" type="submit">✓ Risolta</button>
                              </form>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
