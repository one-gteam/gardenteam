import FotoMini from "@/components/stampe/FotoMini";
import FiltriMobile from "@/components/FiltriMobile";
import ColumnTools from "@/components/stampe/ColumnTools";
import type { DB } from "@/lib/types";
import type { Scope } from "@/lib/stampe";
import {
  type ZooDB, type ZooCampaign, type ZooOffer, zooImageUrl, effectiveParentText, animaliDi, caratteristicheProdottoDi,
  chiavePrezzo, datiPrezzoOfferta, migraVolantinoPages, NO_VOLANTINO, marcaEffettiva,
} from "@/lib/zoo";

/**
 * Le offerte scelte per il volantino, in tabella: una riga per padre e prezzo,
 * con i filtri in alto. È la stessa lettura di Scelta offerte Volantino ma
 * senza le colonne per scegliere: serve a chi rivede la bozza e vuole scorrere
 * l'elenco invece delle pagine.
 */
export default function TabellaVolantino({
  db, academyDb, scope, scopeParam, campaign, sp, base,
}: {
  db: ZooDB; academyDb: DB; scope: Scope; scopeParam: string; campaign: ZooCampaign;
  sp: Record<string, string | undefined>;
  /** Pagina che ospita la tabella (per i link dei filtri). */
  base: string;
}) {
  const prodById = new Map(db.products.map((p) => [p.id, p]));
  const parentById = new Map(db.parents.map((p) => [p.id, p]));
  const parentOf = (o: ZooOffer) => {
    const pid = prodById.get(o.productId ?? "")?.parentId;
    return pid ? parentById.get(pid) : undefined;
  };
  const layout = db.volantinoLayouts.find((l) => l.campaignId === campaign.id);
  const pagine = layout ? migraVolantinoPages(layout.pages).map((p, i) => ({ id: p.id, nome: `${i + 1}. ${p.titolo || `Pagina ${i + 1}`}` })) : [];
  const nomePagina = new Map(pagine.map((p) => [p.id, p.nome]));

  const scelte = db.offers.filter((o) => o.campaignId === campaign.id && !o.scopeType && o.selezionata && o.paginaId !== NO_VOLANTINO);
  const marche = [...new Set(scelte.map((o) => { const p = prodById.get(o.productId ?? ""); return p ? marcaEffettiva(p) : ""; }).filter(Boolean))].sort();
  const fornitori = [...new Set(scelte.map((o) => prodById.get(o.productId ?? "")?.fornitore).filter(Boolean) as string[])].sort();
  const pagineScelte = (sp.pagina ?? "").split(",").filter(Boolean);
  const q = (sp.q ?? "").toLowerCase().trim();

  const offerte = scelte.filter((o) => {
    const prod = prodById.get(o.productId ?? "");
    const parent = parentOf(o);
    const caratts = parent?.caratteristiche ?? [];
    if (sp.animale && !caratts.includes(sp.animale)) return false;
    if (sp.caratt && !caratts.includes(sp.caratt)) return false;
    if (sp.marca && (!prod || marcaEffettiva(prod) !== sp.marca)) return false;
    if (sp.fornitore && prod?.fornitore !== sp.fornitore) return false;
    if (pagineScelte.length && !pagineScelte.includes(o.paginaId ?? "")) return false;
    if (q) {
      const testo = `${o.descrizione} ${o.ean} ${parent?.nome ?? ""} ${parent?.descVolantino ?? ""} ${prod ? marcaEffettiva(prod) : ""} ${o.focus ?? ""}`.toLowerCase();
      if (!q.split(/\s+/).every((w) => testo.includes(w))) return false;
    }
    return true;
  });

  const gruppi = (() => {
    const map = new Map<string, { parent?: ReturnType<typeof parentOf>; offs: ZooOffer[] }>();
    for (const o of offerte) {
      const parent = parentOf(o);
      const key = parent ? `${parent.id}~${chiavePrezzo(o)}` : `_o_${o.id}`;
      const g = map.get(key) ?? { parent, offs: [] };
      g.offs.push(o);
      map.set(key, g);
    }
    return [...map.values()];
  })();
  /*
   * Ordinamento per colonna (clic sull'intestazione, un secondo clic inverte):
   * di partenza per pagina, così la tabella segue il volantino.
   */
  const dir = sp.dir === "desc" ? -1 : 1;
  const campo = sp.sort || "pagina";
  const valore = (g: (typeof gruppi)[number]): string | number => {
    const o = g.offs[0];
    const product = prodById.get(o.productId ?? "");
    switch (campo) {
      case "offerta": return (g.parent ? effectiveParentText(db, scope, g.parent, "nome", academyDb).value : o.descrizione).toLowerCase();
      case "marca": return product ? marcaEffettiva(product).toLowerCase() : "";
      case "fornitore": return (product?.fornitore ?? "").toLowerCase();
      case "animale": return animaliDi(db, g.parent?.caratteristiche ?? []).join(", ");
      case "caratt": return caratteristicheProdottoDi(db, g.parent?.caratteristiche ?? []).join(", ");
      case "prezzo": return Number.parseFloat((datiPrezzoOfferta(db, o, scope, academyDb).prezzo || "0").replace(",", ".")) || 0;
      case "focus": return (o.focus ?? "").toLowerCase();
      case "etichetta": return (o.label ?? "").toLowerCase();
      case "voti": return new Set(db.votes.filter((v) => v.tipo === "preferita" && g.offs.some((x) => x.id === v.offerId)).map((v) => v.userId)).size;
      default: return nomePagina.get(o.paginaId ?? "") ?? "zzz";
    }
  };
  gruppi.sort((a, b) => {
    const va = valore(a), vb = valore(b);
    const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "it");
    return cmp * dir;
  });
  const hrefOrdina = (c: string) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "sort" && k !== "dir" && k !== "scope") params.set(k, v);
    params.set("scope", scopeParam);
    params.set("sort", c);
    params.set("dir", campo === c && dir === 1 ? "desc" : "asc");
    return `${base}?${params.toString()}`;
  };
  const Th = ({ c, children }: { c: string; children: React.ReactNode }) => (
    <th><a href={hrefOrdina(c)} style={{ textDecoration: "none", color: "inherit" }} title="Clic per ordinare (di nuovo per invertire)">
      {children}{campo === c ? (dir === 1 ? " ▲" : " ▼") : ""}
    </a></th>
  );
  const votiPer = new Map<string, number>();
  for (const v of db.votes) if (v.tipo === "preferita") votiPer.set(v.offerId, (votiPer.get(v.offerId) ?? 0) + 1);
  const attivi = Boolean(sp.animale || sp.caratt || sp.marca || sp.fornitore || sp.q || pagineScelte.length);
  const hrefPagina = (pid: string) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "pagina" && k !== "scope") params.set(k, v);
    params.set("scope", scopeParam);
    const prossime = !pid ? [] : pagineScelte.includes(pid) ? pagineScelte.filter((x) => x !== pid) : [...pagineScelte, pid];
    if (prossime.length) params.set("pagina", prossime.join(","));
    return `${base}?${params.toString()}`;
  };

  return (
    <div>
      <div className="contatore-pagine">
        <strong style={{ fontSize: 12.5 }}>Pagine:</strong>
        <a className={`pill ${pagineScelte.length === 0 ? "pill-blue" : "pill-gray"}`} href={hrefPagina("")}>tutte</a>
        {pagine.map((p) => (
          <a key={p.id} className={`pill ${pagineScelte.includes(p.id) ? "pill-blue" : "pill-green"}`} href={hrefPagina(p.id)}>
            {pagineScelte.includes(p.id) ? "✓ " : ""}{p.nome} <strong>{scelte.filter((o) => o.paginaId === p.id).length}</strong>
          </a>
        ))}
      </div>
      <details className="card filtri-compatti" style={{ marginBottom: 10, padding: "8px 12px" }} open={attivi}>
        <summary style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", cursor: "pointer", listStyle: "none" }}>
          <span className="hint" style={{ flex: 1, fontSize: 12 }}>
            {offerte.length} offerte a volantino in {gruppi.length} voci{attivi ? ` (su ${scelte.length}, filtrate)` : ""}
          </span>
          <span className="btn btn-outline btn-sm">⚲ Filtri{attivi ? " (attivi)" : ""}</span>
        </summary>
        <div style={{ marginTop: 10 }}>
          <FiltriMobile id="filtri-tabella-volantino" scelte={[sp.q && `«${sp.q}»`, sp.animale, sp.caratt, sp.marca, sp.fornitore]}>
            <form method="get" style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr)) auto", gap: 10, alignItems: "end" }}>
              <input type="hidden" name="scope" value={scopeParam} />
              <input type="hidden" name="vista" value="tabella" />
              {pagineScelte.length > 0 && <input type="hidden" name="pagina" value={pagineScelte.join(",")} />}
              <label className="field" style={{ marginBottom: 0 }}>Cerca<input type="text" name="q" defaultValue={sp.q ?? ""} /></label>
              <label className="field" style={{ marginBottom: 0 }}>Animale
                <select name="animale" defaultValue={sp.animale ?? ""}>
                  <option value="">Tutti</option>
                  {db.settings.categorieAnimali.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
              <label className="field" style={{ marginBottom: 0 }}>Caratteristica
                <select name="caratt" defaultValue={sp.caratt ?? ""}>
                  <option value="">Tutte</option>
                  {db.settings.caratteristicheProdotto.map((c) => <option key={c} value={c}>{c}</option>)}
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
              <button className="btn btn-sm" type="submit">Filtra</button>
            </form>
          </FiltriMobile>
        </div>
      </details>

      <p className="hint" style={{ margin: "0 0 6px", fontSize: 11.5 }}>
        Clic sulle intestazioni per ordinare · trascina un&apos;intestazione per spostare la colonna, il suo bordo destro per allargarla · «Colonne» per nasconderne.
      </p>
      <div className="card table-wrap">
        <ColumnTools tableId="tab-bozza-volantino" />
        <table className="data tabella-stretta" id="tab-bozza-volantino">
          <thead>
            <tr>
              <th style={{ width: 56 }}>Foto</th><Th c="offerta">Offerta</Th><Th c="marca">Marca</Th><Th c="fornitore">Fornitore</Th>
              <Th c="animale">Animale</Th><Th c="caratt">Caratteristica</Th><Th c="prezzo">Prezzo</Th><Th c="pagina">Pagina</Th>
              <Th c="focus">Focus</Th><Th c="etichetta">Etichetta</Th><Th c="voti">Voti</Th>
            </tr>
          </thead>
          <tbody>
            {gruppi.length === 0 && <tr><td colSpan={11} className="empty">Nessuna offerta a volantino con questi filtri.</td></tr>}
            {gruppi.map(({ parent, offs }) => {
              const first = offs[0];
              const product = prodById.get(first.productId ?? "");
              const dati = datiPrezzoOfferta(db, first, scope, academyDb);
              const nome = parent ? effectiveParentText(db, scope, parent, "nome", academyDb).value : first.descrizione;
              const descr = parent ? effectiveParentText(db, scope, parent, "descVolantino", academyDb).value : "";
              const voti = new Set(db.votes.filter((v) => v.tipo === "preferita" && offs.some((o) => o.id === v.offerId)).map((v) => v.userId)).size;
              return (
                <tr key={parent ? `${parent.id}~${chiavePrezzo(first)}` : first.id}>
                  <td><FotoMini src={zooImageUrl(product, parent)} style={{ width: 44, height: 44, objectFit: "contain", background: "#fff", borderRadius: 6, border: "1px solid #eee" }} /></td>
                  <td>
                    <strong style={{ fontSize: 13 }}>{nome}</strong>
                    {descr && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{descr}</div>}
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{offs.length > 1 ? `${offs.length} varianti` : `EAN ${first.ean}`}</div>
                  </td>
                  <td style={{ fontSize: 12.5 }}>{product ? marcaEffettiva(product) || "—" : "—"}</td>
                  <td style={{ fontSize: 12.5 }}>{product?.fornitore || "—"}</td>
                  <td style={{ fontSize: 12 }}>{animaliDi(db, parent?.caratteristiche ?? []).join(", ") || "—"}</td>
                  <td style={{ fontSize: 12 }}>{caratteristicheProdottoDi(db, parent?.caratteristiche ?? []).join(", ") || "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <strong>{dati.prezzo ? `€ ${dati.prezzo}` : "—"}</strong>
                    {dati.listino && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>da € {dati.listino}</div>}
                    {dati.sconto && <span className="pill pill-green" style={{ fontSize: 10 }}>{dati.sconto}</span>}
                    {dati.tipi.length > 0 && <div style={{ fontSize: 10.5, color: "#274b7a", fontWeight: 700 }}>{dati.tipi.join(" · ")}</div>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {first.paginaId ? <span className="pill pill-green">{nomePagina.get(first.paginaId) ?? first.paginaId}</span> : <span className="pill pill-amber">da assegnare</span>}
                  </td>
                  <td style={{ fontSize: 12 }}>{first.focus || "—"}</td>
                  <td>{first.label ? <span className="pill pill-orange">{first.label}</span> : "—"}</td>
                  <td style={{ fontSize: 12 }}>{voti || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
