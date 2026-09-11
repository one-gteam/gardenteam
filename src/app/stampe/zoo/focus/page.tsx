import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import StampeHeader from "@/components/stampe/StampeHeader";
import { canAccessArea, resolveScope } from "@/lib/stampe";
import { gestisce } from "@/lib/types";
import { getZooDb, effectiveParentText, animaliDi, campaignStato } from "@/lib/zoo";

interface GruppoFocus {
  focus: string;
  animale: string;
  offerte: { nome: string; descrizione: string; prezzo: string; inVolantino: boolean }[];
}

/**
 * Storico dei focus: per ogni volantino uscito, i temi di comunicazione
 * (il campo "focus" delle offerte) con le offerte che li componevano,
 * suddivisi per animale. Serve a non ripetere lo stesso angolo due mesi di
 * fila e a ritrovare cosa si era detto l'anno prima nello stesso periodo.
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

  const data = (d?: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("it-IT") : "—");
  const campagne = [...db.campaigns]
    .filter((c) => campaignStato(c) !== "lavorazione" || db.offers.some((o) => o.campaignId === c.id && o.focus))
    .sort((a, b) => (b.dal ?? "").localeCompare(a.dal ?? ""));

  const perCampagna = campagne.map((c) => {
    const offerte = db.offers.filter((o) => o.campaignId === c.id && (o.focus ?? "").trim());
    // focus → animale → offerte: lo stesso testo di focus su animali diversi resta separato
    const gruppi = new Map<string, GruppoFocus>();
    for (const o of offerte) {
      const product = db.products.find((p) => p.id === o.productId);
      const parent = product?.parentId ? db.parents.find((x) => x.id === product.parentId) : undefined;
      const animale = parent ? (animaliDi(db, parent.caratteristiche)[0] ?? "Altro") : "Altro";
      const focus = o.focus!.trim();
      const key = `${animale}|${focus.toLowerCase()}`;
      const g = gruppi.get(key) ?? { focus, animale, offerte: [] };
      const nome = parent ? effectiveParentText(db, scope, parent, "nome", academyDb).value || o.descrizione : o.descrizione;
      const descrizione = parent ? effectiveParentText(db, scope, parent, "descVolantino", academyDb).value : "";
      if (!g.offerte.some((x) => x.nome === nome)) {
        g.offerte.push({ nome, descrizione, prezzo: o.prezzoPromo, inVolantino: !!o.selezionata });
      }
      gruppi.set(key, g);
    }
    const perAnimale = new Map<string, { focus: string; offerte: GruppoFocus["offerte"] }[]>();
    for (const g of gruppi.values()) perAnimale.set(g.animale, [...(perAnimale.get(g.animale) ?? []), { focus: g.focus, offerte: g.offerte }]);
    return { campagna: c, perAnimale, nFocus: gruppi.size };
  }).filter((x) => x.nFocus > 0 || sp.tutti === "1");

  const filtroAnimale = sp.animale ?? "";

  return (
    <div>
      <StampeHeader user={user} active="focus" area="zoo" />
      <div className="container">
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0 }}>Storico dei focus</h1>
            <p className="subtitle" style={{ margin: "4px 0 0" }}>
              I temi di comunicazione di ogni volantino, per animale e data di uscita: cosa si è messo in evidenza e quando.
            </p>
          </div>
          <form method="get" style={{ display: "flex", gap: 8, alignItems: "end" }}>
            <label className="field" style={{ marginBottom: 0 }}>
              Animale
              <select name="animale" defaultValue={filtroAnimale}>
                <option value="">Tutti</option>
                {db.settings.categorieAnimali.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label className="hint" style={{ display: "flex", gap: 4, alignItems: "center", paddingBottom: 6 }}>
              <input type="checkbox" name="tutti" value="1" defaultChecked={sp.tutti === "1"} /> anche i volantini senza focus
            </label>
            <button className="btn btn-sm" type="submit">Filtra</button>
          </form>
        </div>

        {perCampagna.length === 0 && (
          <div className="card"><p className="empty">Nessun focus registrato: si scrive in Offerte in corso, colonna «Focus».</p></div>
        )}

        {perCampagna.map(({ campagna, perAnimale, nFocus }) => {
          const animali = [...perAnimale.keys()].filter((a) => !filtroAnimale || a === filtroAnimale).sort();
          if (filtroAnimale && animali.length === 0) return null;
          return (
            <div key={campagna.id} className="card" style={{ padding: 14, marginBottom: 14 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", marginBottom: 8 }}>
                <strong style={{ fontSize: 15 }}>{campagna.nome}</strong>
                <span className="hint">uscita {data(campagna.dal)} → {data(campagna.al)}</span>
                <span className="pill pill-blue">{nFocus} focus</span>
                {campaignStato(campagna) === "lavorazione" && <span className="pill pill-orange">in lavorazione</span>}
              </div>
              {animali.length === 0 && <p className="hint" style={{ margin: 0 }}>Nessun focus su questo volantino.</p>}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                {animali.map((animale) => (
                  <div key={animale} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
                    <div style={{ fontWeight: 800, marginBottom: 6 }}>{animale}</div>
                    {perAnimale.get(animale)!.map((g, i) => (
                      <div key={i} style={{ marginBottom: 8 }}>
                        <div style={{ fontWeight: 700, fontSize: 13.5, color: "#274b7a" }}>{g.focus}</div>
                        <ul style={{ margin: "2px 0 0", paddingLeft: 16, fontSize: 12.5 }}>
                          {g.offerte.map((o) => (
                            <li key={o.nome}>
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
