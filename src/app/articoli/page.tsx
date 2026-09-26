import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import ArticoliHeader from "@/components/articoli/ArticoliHeader";
import FormAutoInvia from "@/components/stampe/FormAutoInvia";
import { CasellaNewsletter } from "@/components/articoli/StrumentiArticolo";
import { PulsanteAzione } from "@/components/AzioneSenzaRicarica";
import { pubblicaBozza, eliminaArticolo } from "@/lib/articoli-actions";
import {
  getArticoliDb, vedeArticoli, pubblicaArticoli, gestisceArticoli, articoliVisibili, soloTesto, dataItaliana, testoDestinatari, modificaArticolo,
} from "@/lib/articoli";
import { ROLE_LABELS } from "@/lib/types";

/** L'elenco degli articoli, come un blog: i più recenti in alto, quelli in evidenza prima. */
export default async function ArticoliPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; q?: string; nonletti?: string; bozze?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [db, academy] = await Promise.all([getArticoliDb(), getDb()]);
  if (!vedeArticoli(user, db)) redirect("/scegli");
  const sp = await searchParams;
  const pubblica = pubblicaArticoli(user, db);
  const gestisce = gestisceArticoli(user, db);

  const q = (sp.q ?? "").trim().toLowerCase();
  const tutti = articoliVisibili(user, db);
  const elenco = tutti.filter((a) =>
    (!sp.cat || a.categoriaId === sp.cat)
    && (!q || `${a.titolo} ${soloTesto(a.testo, 5000)} ${a.autoreNome}`.toLowerCase().includes(q))
    && (sp.nonletti !== "1" || !a.letture[user.id])
  );
  const nonLetti = tutti.filter((a) => !a.letture[user.id]).length;
  /* le bozze (anche quelle arrivate per email da rivedere) le vede chi pubblica: le proprie, o tutte se gestisce */
  const bozze = pubblica ? db.articoli.filter((a) => a.stato === "bozza" && modificaArticolo(user, a, db)) : [];
  const cadenza = db.newsletter.ogni === "giorno" ? "ogni giorno" : db.newsletter.ogni === "mese" ? "ogni mese" : "ogni settimana";
  const categoria = (id?: string) => db.categorie.find((c) => c.id === id);

  return (
    <div>
      <ArticoliHeader user={user} active="articoli" pubblica={pubblica} gestisce={gestisce} />
      <div className="container">
        <div className="stampa-testata">
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0 }}>Articoli</h1>
            <p className="subtitle">Comunicazioni, schede e novità del Consorzio e delle insegne.{nonLetti > 0 && <> <strong>{nonLetti} da leggere.</strong></>}</p>
          </div>
          {db.newsletter.attiva && <CasellaNewsletter iscritto={db.newsletter.iscritti.includes(user.id)} cadenza={cadenza} />}
          {pubblica && <a className="btn" href="/articoli/nuovo">＋ Nuovo articolo</a>}
        </div>

        {bozze.length > 0 && (
          <div className="card" style={{ marginBottom: 16, background: "var(--amber-bg)", borderColor: "var(--amber)" }}>
            <strong>{bozze.length === 1 ? "Una bozza da rivedere" : `${bozze.length} bozze da rivedere`}</strong>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
              {bozze.map((a) => (
                <div key={a.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13.5 }}>
                  <a href={`/articoli/${a.id}/modifica`}><strong>{a.titolo}</strong></a>
                  <span className="hint">{a.origine === "email" ? `arrivato per email da ${a.mittenteEmail}` : `di ${a.autoreNome}`} · {dataItaliana(a.creato)}</span>
                  <span style={{ flex: 1 }} />
                  <PulsanteAzione azione={pubblicaBozza.bind(null, a.id)} className="btn btn-sm">Pubblica</PulsanteAzione>
                  <a className="btn btn-outline btn-sm" href={`/articoli/${a.id}/modifica`}>Modifica</a>
                  <PulsanteAzione azione={eliminaArticolo.bind(null, a.id)} conferma={`Eliminare la bozza «${a.titolo}»?`}
                    style={{ color: "var(--red)", borderColor: "var(--red)" }}>Elimina</PulsanteAzione>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="filtri-riquadro">
          <FormAutoInvia className="filtri-stampa">
            <label className="field">Cerca<input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="titolo, testo, autore — poi Invio" /></label>
            <label className="field">
              Categoria
              <select name="cat" defaultValue={sp.cat ?? ""}>
                <option value="">Tutte</option>
                {db.categorie.map((c) => <option key={c.id} value={c.id}>{c.emoji ? `${c.emoji} ` : ""}{c.nome}</option>)}
              </select>
            </label>
            <label className="interruttore-grande" style={{ alignSelf: "end" }}>
              <input type="checkbox" name="nonletti" value="1" defaultChecked={sp.nonletti === "1"} />
              Solo da leggere
            </label>
          </FormAutoInvia>
        </div>

        {elenco.length === 0 && (
          <div className="card"><p className="empty" style={{ margin: 0 }}>
            {tutti.length === 0 ? "Nessun articolo pubblicato, per ora." : "Nessun articolo con questi filtri."}
          </p></div>
        )}
        <div className="articoli-griglia">
          {elenco.map((a) => {
            const cat = categoria(a.categoriaId);
            const letto = !!a.letture[user.id];
            return (
              <a key={a.id} href={`/articoli/${a.id}`} className={`articolo-scheda ${a.inEvidenza ? "evidenza" : ""} ${letto ? "" : "nuovo"}`}>
                {a.copertina ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.copertina} alt="" className="articolo-foto" />
                ) : (
                  <div className="articolo-foto senza">{cat?.emoji ?? "📄"}</div>
                )}
                <div className="articolo-corpo">
                  <div className="chips">
                    {a.inEvidenza && <span className="pill pill-orange">In evidenza</span>}
                    {cat && <span className="pill pill-green">{cat.emoji ? `${cat.emoji} ` : ""}{cat.nome}</span>}
                    {!letto && <span className="pill pill-blue">Nuovo</span>}
                    {a.allegati.length > 0 && <span className="pill pill-gray">📎 {a.allegati.length}</span>}
                  </div>
                  <h3>{a.titolo}</h3>
                  <p>{soloTesto(a.testo, 160) || "(senza descrizione)"}</p>
                  <div className="articolo-meta">
                    {dataItaliana(a.pubblicato ?? a.creato)} · {a.autoreNome}
                    {pubblica && !(a.destinatari.tutti) && testoDestinatari(a.destinatari, academy, ROLE_LABELS) !== "tutti" && (
                      <> · <span title={`Lo vedono: ${testoDestinatari(a.destinatari, academy, ROLE_LABELS)}`}>🔒 riservato</span></>
                    )}
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}
