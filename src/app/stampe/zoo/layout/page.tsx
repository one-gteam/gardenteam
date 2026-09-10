import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import StampeHeader from "@/components/stampe/StampeHeader";
import LayoutEditor from "@/components/stampe/LayoutEditor";
import AutoSubmitSelect from "@/components/stampe/AutoSubmitSelect";
import { canAccessArea, gestisceArea, scopesForUser, resolveScope, layoutMargins } from "@/lib/stampe";
import { gestisce } from "@/lib/types";
import {
  getZooDb, activeCampaign, zooCartelloValues, ZOO_FIELDS, ZOO_FORMATS, ZOO_TIPI_OFFERTA, pvPromoCodesFor,
  pvPromoFor, tagsOfferta,
} from "@/lib/zoo";
import {
  deleteZooLayout, uploadZooLayoutImage, deleteZooLayoutImage, copiaZooLayoutSuFormato,
} from "@/lib/zoo-actions";

/** Layout dei cartelli Offerte Zoo: stessa meccanica dell'Arredo, campi delle offerte. */
export default async function ZooLayoutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessArea(user, "zoo")) redirect("/studente");
  const sp = await searchParams;

  const db = await getZooDb();
  const academyDb = await getDb();
  const scopes = scopesForUser(user, academyDb);
  const scope = resolveScope(user, sp.scope, academyDb);
  const scopeParam = `${scope.type}:${scope.id}`;
  // il layout è di chi gestisce l'area: il capo reparto non entra proprio (il menu non glielo mostra)
  if (!gestisce(user, "zoo")) redirect("/stampe/zoo/stampa");
  const canEdit = gestisceArea(user, "zoo", scope, academyDb);

  const format = ZOO_FORMATS.find((f) => f.id === sp.formato) ?? ZOO_FORMATS[0];
  /*
   * A un layout si aggancia sia il tipo di prodotto (Cane, Umido…) sia il tipo di
   * offerta (prezzo barrato, "A SOLI", 3x2): serve un'impaginazione diversa per
   * ciascuno, e in stampa vince il layout che combacia con l'offerta in corso.
   */
  // le promozioni proprie dell'insegna/PV valgono come tipologia: un "20%" può avere il suo layout
  const promoPv = scope.type === "system" ? [] : pvPromoCodesFor(db, scope).map((c) => c.etichetta);
  const tipologieDisponibili = [
    ...db.settings.categorieAnimali, ...db.settings.caratteristicheProdotto, ...ZOO_TIPI_OFFERTA, ...promoPv,
  ];

  // layout selezionabili per questo formato: i propri, più quelli del Consorzio come base
  const scopeLayouts = db.zooLayouts.filter((l) => l.formatId === format.id && l.scopeType === scope.type && l.scopeId === scope.id);
  const systemLayouts = db.zooLayouts.filter((l) => l.formatId === format.id && l.scopeType === "system");
  const selectableLayouts = scope.type === "system" ? scopeLayouts : [...scopeLayouts, ...systemLayouts];
  /*
   * ?layout="" = "nuovo layout" scelto apposta, resta vuoto. Un id che non è tra i layout di
   * QUESTO formato (tipico se si è appena cambiato formato: la tendina "Layout" porta ancora il
   * valore di quello precedente) si ignora e si torna al primo disponibile, invece di sembrare
   * "nuovo layout" per sbaglio.
   */
  const matchedByParam = sp.layout ? selectableLayouts.find((l) => l.id === sp.layout) : undefined;
  const current = matchedByParam ?? (sp.layout === "" ? undefined : (scopeLayouts[0] ?? systemLayouts[0]));
  const isOwnCopy = !!current && current.scopeType === scope.type && current.scopeId === scope.id;

  // offerta di esempio per l'anteprima: preferisce un padre con i tag di questo layout
  const campaign = activeCampaign(db);
  const offers = campaign ? db.offers.filter((o) => o.campaignId === campaign.id) : db.offers;
  const layoutTags = current?.tipologie ?? [];
  /*
   * L'esempio si sceglie con le stesse tipologie con cui la stampa sceglie il
   * layout: non solo il tipo di prodotto (Cane, Umido…) ma anche il tipo di
   * offerta. Guardando solo il prodotto, chi disegnava il layout del 3x2 o
   * dell'«A SOLI» si ritrovava davanti un'offerta qualunque, con la meccanica
   * vuota: l'anteprima non mostrava il cartello che poi sarebbe uscito.
   */
  const tagsDiOfferta = (o: (typeof offers)[number]) => {
    const product = db.products.find((p) => p.id === o.productId);
    const parent = product?.parentId ? db.parents.find((x) => x.id === product.parentId) : undefined;
    const promoPvOfferta = pvPromoFor(db, scope, o.ean, academyDb);
    return [
      ...(parent?.caratteristiche ?? []), ...tagsOfferta(o),
      ...(promoPvOfferta ? [promoPvOfferta.etichetta] : []),
    ];
  };
  const sample = layoutTags.length > 0
    ? offers.find((o) => {
        const tags = tagsDiOfferta(o);
        // meglio un'offerta che soddisfa tutte le tipologie del layout (es. Gatto + 3x2)
        return layoutTags.every((t) => tags.includes(t));
      })
      ?? offers.find((o) => tagsDiOfferta(o).some((t) => layoutTags.includes(t)))
      ?? offers[0]
    : offers[0];
  const sampleValues = sample ? zooCartelloValues(db, sample, scope, academyDb) : {};

  const layoutOptions = [
    { value: "", label: "+ Nuovo layout" },
    ...selectableLayouts.map((l) => ({
      value: l.id,
      label: (l.nome || (l.tipologie.length ? l.tipologie.join(", ") : "Senza nome"))
        + (l.scopeType === "system" && scope.type !== "system" ? " (Consorzio)" : ""),
    })),
  ];

  return (
    <div>
      <StampeHeader user={user} active="layout" area="zoo" />
      <div className="container">
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0 }}>Layout cartelli Zoo</h1>
            <p className="subtitle" style={{ margin: "4px 0 0" }}>
              {canEdit
                ? scope.type === "system"
                  ? "Stai modificando il layout del Consorzio (comune a tutti)."
                  : `Stai personalizzando il layout di ${scope.label} — parte da quello del Consorzio.`
                : "Layout del Consorzio in sola lettura."}
              {" "}Puoi avere più layout per lo stesso formato — uno per il 3x2, uno per l&apos;«A SOLI», uno per il
              prezzo barrato: creali qui sotto e, nel pannello a destra, indica in <strong>«Quando usare questo
              layout»</strong> a quale tipo di promozione (o di prodotto) si applica. In stampa viene scelto da solo.
            </p>
          </div>
          <form method="get" style={{ display: "flex", gap: 8, alignItems: "end" }}>
            <label className="field" style={{ marginBottom: 0 }}>
              Formato
              <AutoSubmitSelect name="formato" defaultValue={format.id}
                options={ZOO_FORMATS.map((f) => ({ value: f.id, label: `${f.name} (${f.w}×${f.h} mm)` }))} />
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              Layout
              <AutoSubmitSelect name="layout" defaultValue={current?.id ?? ""} options={layoutOptions} />
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              Insegna / PV
              <select name="scope" defaultValue={scopeParam}>
                {scopes.map((s) => <option key={`${s.type}:${s.id}`} value={`${s.type}:${s.id}`}>{s.label}</option>)}
              </select>
            </label>
            <button className="btn btn-sm" type="submit">OK</button>
          </form>
        </div>

        {sp.permessi === "no" && <div className="alert alert-amber">Questo layout lo modifica chi gestisce le Offerte Zoo per l&apos;ambito scelto.</div>}
        {sp.copiato && <div className="alert alert-green no-print">✓ Layout copiato sul nuovo formato: controlla le dimensioni dei testi e salva.</div>}

        {!isOwnCopy && scope.type !== "system" && (
          <div className="alert alert-amber no-print">
            Stai vedendo il layout del Consorzio: qualsiasi modifica salvata creerà la versione personalizzata di {scope.label}.
          </div>
        )}

        <LayoutEditor
          key={`${format.id}_${scopeParam}_${current?.id ?? "new"}`}
          format={format}
          fields={ZOO_FIELDS}
          initialLayoutId={isOwnCopy ? current?.id : undefined}
          initialNome={current?.nome}
          initialItems={current?.items ?? []}
          initialItemsNoPhoto={current?.itemsNoPhoto}
          initialMargins={layoutMargins(current)}
          scopeParam={scopeParam}
          initialTipologie={current?.tipologie ?? []}
          tipologieDisponibili={tipologieDisponibili}
          tipologiePromo={[...ZOO_TIPI_OFFERTA, ...promoPv]}
          sampleValues={sampleValues}
          canEdit={canEdit}
          area="zoo"
          images={db.layoutImages
            .filter((li) => li.scopeType === scope.type && li.scopeId === scope.id)
            .map((li) => ({ name: li.name, url: li.url }))}
        />

        {canEdit && (
          <div className="card" style={{ marginTop: 14, padding: 14 }}>
            <h3 style={{ marginTop: 0 }}>Immagini fisse da riusare sui cartelli</h3>
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 8px" }}>
              Carica una volta la testata, la cornice o un logo: poi lo trovi fra i pulsanti
              «Immagini» dell&apos;editor e lo posi su qualsiasi layout, di qualsiasi formato.
            </p>
            <form action={uploadZooLayoutImage.bind(null, scopeParam)} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input type="hidden" name="formato" value={format.id} />
              <input type="file" name="image" accept="image/*" required />
              <input type="text" name="name" placeholder="Nome (es. Testata offerte)" style={{ width: 220 }} />
              <button className="btn btn-sm" type="submit">Carica immagine</button>
            </form>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
              {db.layoutImages.filter((li) => li.scopeType === scope.type && li.scopeId === scope.id).map((li) => (
                <div key={li.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 6, textAlign: "center" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={li.url} alt="" style={{ height: 44, maxWidth: 130, objectFit: "contain", display: "block" }} />
                  <div style={{ fontSize: 11, margin: "4px 0" }}>{li.name}</div>
                  <form action={deleteZooLayoutImage.bind(null, li.id, scopeParam, format.id)}>
                    <button className="btn btn-outline btn-sm" type="submit">Elimina</button>
                  </form>
                </div>
              ))}
              {db.layoutImages.filter((li) => li.scopeType === scope.type && li.scopeId === scope.id).length === 0 && (
                <span className="hint">Nessuna immagine caricata.</span>
              )}
            </div>
          </div>
        )}

        {scopeLayouts.length > 0 && (
          <div className="section">
            <div className="section-head"><h2>I tuoi layout salvati</h2></div>
            <div className="card table-wrap">
              <table className="data">
                <thead><tr><th>Formato</th><th>Nome</th><th>Tag collegati</th><th>Campi</th><th></th></tr></thead>
                <tbody>
                  {db.zooLayouts.filter((l) => l.scopeType === scope.type && l.scopeId === scope.id).map((l) => {
                    const f = ZOO_FORMATS.find((x) => x.id === l.formatId);
                    return (
                      <tr key={l.id}>
                        <td>
                          <a href={`?formato=${l.formatId}&layout=${l.id}&scope=${scopeParam}`}>{f?.name}</a>
                        </td>
                        <td style={{ fontSize: 13 }}>{l.nome || "—"}</td>
                        <td style={{ fontSize: 13 }}>{l.tipologie.length ? l.tipologie.join(", ") : "Tutti"}</td>
                        <td>{l.items.length}</td>
                        <td>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                            <form action={copiaZooLayoutSuFormato.bind(null, l.id, scopeParam)}
                              style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "nowrap" }}>
                              <select name="formatId" defaultValue="" style={{ fontSize: 12, width: 130 }} required>
                                <option value="" disabled>Copia su…</option>
                                {ZOO_FORMATS.filter((f) => f.id !== l.formatId).map((f) => (
                                  <option key={f.id} value={f.id}>{f.name}</option>
                                ))}
                              </select>
                              <button className="btn btn-outline btn-sm" type="submit"
                                style={{ whiteSpace: "nowrap", minWidth: 90 }}
                                title="Crea una copia sul formato scelto, con i corpi del testo riproporzionati">
                                Copia
                              </button>
                            </form>
                            <form action={deleteZooLayout.bind(null, l.id, scopeParam)}>
                              <button className="btn btn-outline btn-sm" type="submit" style={{ color: "var(--red)", borderColor: "var(--red)" }}>Elimina</button>
                            </form>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
