import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import ArticoliHeader from "@/components/articoli/ArticoliHeader";
import SceltaDestinatari from "@/components/articoli/SceltaDestinatari";
import ModuloAutoSalva from "@/components/ModuloAutoSalva";
import { ModuloInvio, PulsanteAzione } from "@/components/AzioneSenzaRicarica";
import {
  salvaCategoria, eliminaCategoria, salvaPermessiArticoli, salvaNewsletterArticoli, salvaEmailArticoli, mandaNewsletterAdesso,
} from "@/lib/articoli-actions";
import { getArticoliDb, gestisceArticoli, dataItaliana, newsletterDovuta } from "@/lib/articoli";

/** Categorie, chi vede/pubblica/gestisce, newsletter e ricezione per email. */
export default async function GestioneArticoliPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [db, academy] = await Promise.all([getArticoliDb(), getDb()]);
  if (!gestisceArticoli(user, db)) redirect("/articoli");
  const n = db.newsletter;
  const iscritti = n.iscritti.map((id) => academy.users.find((u) => u.id === id)).filter(Boolean);
  const nuoviDaUltimo = db.articoli.filter((a) => a.stato === "pubblicato" && !a.inNewsletter && (a.pubblicato ?? a.creato) > (n.ultimoInvio ?? "")).length;
  const segretoImpostato = !!process.env.ARTICOLI_INBOUND_SECRET;

  return (
    <div>
      <ArticoliHeader user={user} active="gestione" pubblica gestisce />
      <div className="container" style={{ maxWidth: 960 }}>
        <h1>Gestione articoli</h1>
        <p className="subtitle">Categorie, permessi, newsletter e ricezione per email. Le modifiche si salvano da sole.</p>

        <div className="section">
          <div className="section-head"><h2>Categorie ({db.categorie.length})</h2></div>
          <div className="grid grid-3">
            {db.categorie.map((c) => {
              const n = db.articoli.filter((a) => a.categoriaId === c.id).length;
              return (
                <div className="card" key={c.id}>
                  <ModuloAutoSalva azione={salvaCategoria.bind(null, c.id)}>
                    <div style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: 8 }}>
                      <label className="field">Emoji<input type="text" name="emoji" defaultValue={c.emoji ?? ""} maxLength={4} /></label>
                      <label className="field">Nome<input type="text" name="nome" defaultValue={c.nome} required /></label>
                    </div>
                    <span className="pill pill-blue">{n} articoli</span>
                  </ModuloAutoSalva>
                  <div style={{ marginTop: 8 }}>
                    <PulsanteAzione azione={eliminaCategoria.bind(null, c.id)} style={{ color: "var(--red)", borderColor: "var(--red)" }}
                      conferma={n > 0 ? `Eliminare «${c.nome}»? ${n} articoli resteranno senza categoria.` : `Eliminare «${c.nome}»?`}>
                      Elimina
                    </PulsanteAzione>
                  </div>
                </div>
              );
            })}
            <div className="card" style={{ background: "var(--green-50)" }}>
              <h3 style={{ marginTop: 0 }}>Nuova categoria</h3>
              <ModuloInvio azione={salvaCategoria.bind(null, null)}>
                <div style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: 8 }}>
                  <label className="field">Emoji<input type="text" name="emoji" maxLength={4} placeholder="📌" /></label>
                  <label className="field">Nome<input type="text" name="nome" required placeholder="es. Circolari, Schede prodotto, Sicurezza" /></label>
                </div>
                <button className="btn btn-sm" type="submit">Crea categoria</button>
              </ModuloInvio>
            </div>
          </div>
        </div>

        <div className="section">
          <div className="section-head"><h2>Chi vede, chi pubblica, chi gestisce</h2></div>
          <div className="card">
            <ModuloAutoSalva azione={salvaPermessiArticoli}>
              <h3 style={{ marginTop: 0 }}>Chi può entrare e leggere</h3>
              <SceltaDestinatari prefisso="acc" academy={academy} valore={db.accesso} vuotoVuolDire="tutti gli utenti del portale" />
              <h3>Chi può pubblicare</h3>
              <p className="hint" style={{ margin: "0 0 6px" }}>Scrive articoli, li corregge, li vede anche in bozza. Chi pubblica entra sempre nell&apos;area.</p>
              <SceltaDestinatari prefisso="pub" academy={academy} valore={db.pubblicatori} vuotoVuolDire="nessuno oltre a chi gestisce" conTutti={false} />
              <h3>Chi gestisce l&apos;area</h3>
              <p className="hint" style={{ margin: "0 0 6px" }}>Questa pagina: categorie, permessi, newsletter, email. L&apos;amministratore di sistema gestisce sempre.</p>
              <SceltaDestinatari prefisso="ges" academy={academy} valore={db.gestori} vuotoVuolDire="solo l'amministratore di sistema" conTutti={false} />
            </ModuloAutoSalva>
          </div>
        </div>

        <div className="section">
          <div className="section-head">
            <h2>Newsletter</h2>
            <span className="hint">{iscritti.length} {iscritti.length === 1 ? "iscritto" : "iscritti"}{n.ultimoInvio ? ` · ultimo invio ${dataItaliana(n.ultimoInvio)}` : " · mai inviata"}</span>
          </div>
          <div className="card">
            <ModuloAutoSalva azione={salvaNewsletterArticoli}>
              <label className="interruttore-grande">
                <input type="checkbox" name="attiva" defaultChecked={n.attiva} />
                Newsletter attiva
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 12 }}>
                <label className="field">
                  Ogni quanto
                  <select name="ogni" defaultValue={n.ogni}>
                    <option value="giorno">Ogni giorno</option>
                    <option value="settimana">Ogni settimana</option>
                    <option value="mese">Ogni mese</option>
                  </select>
                </label>
                <label className="field">
                  Solo se ci sono almeno … articoli nuovi
                  <input type="number" name="minimo" min={1} max={50} defaultValue={n.minimo} />
                </label>
                <label className="field">
                  Oggetto dell&apos;email <span className="hint">(vuoto = automatico)</span>
                  <input type="text" name="oggetto" defaultValue={n.oggetto ?? ""} placeholder="📰 Novità dal Consorzio" />
                </label>
              </div>
              <p className="hint" style={{ margin: "4px 0 0" }}>
                Parte ogni mattina alle 8 (ora italiana) se è passato il periodo scelto. Ognuno riceve solo gli articoli che può vedere;
                un articolo va in newsletter una volta sola. Le persone si iscrivono con la casella nella pagina Articoli.
              </p>
            </ModuloAutoSalva>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
              <PulsanteAzione azione={mandaNewsletterAdesso} className="btn btn-sm"
                conferma={`Mandare adesso la newsletter a ${iscritti.length} iscritti con ${nuoviDaUltimo} articoli nuovi?`}>
                Manda adesso
              </PulsanteAzione>
              <span className="hint">{nuoviDaUltimo} articoli nuovi dall&apos;ultimo invio{n.attiva ? (newsletterDovuta(n) ? " · il prossimo giro la manda" : " · non ancora dovuta") : ""}.</span>
            </div>
            {iscritti.length > 0 && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: "pointer", fontSize: 13 }}>Iscritti</summary>
                <div className="chips" style={{ marginTop: 6 }}>
                  {iscritti.map((u) => <span key={u!.id} className="chip on">{u!.firstName} {u!.lastName}</span>)}
                </div>
              </details>
            )}
          </div>
        </div>

        <div className="section">
          <div className="section-head"><h2>Articoli per email</h2></div>
          <div className="card">
            <ModuloAutoSalva azione={salvaEmailArticoli}>
              <label className="interruttore-grande">
                <input type="checkbox" name="attiva" defaultChecked={db.email.attiva} />
                Accetta articoli spediti per email
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginTop: 12 }}>
                <label className="field">
                  Indirizzo a cui spedire <span className="hint">(si mostra a chi pubblica)</span>
                  <input type="text" name="indirizzo" defaultValue={db.email.indirizzo ?? ""} placeholder="articoli@academy.rosaflor.it" />
                </label>
                <label className="field">
                  Email da mittenti non abilitati
                  <select name="sconosciuti" defaultValue={db.email.sconosciuti}>
                    <option value="rifiuta">Rifiutate</option>
                    <option value="bozza">Salvate come bozza da rivedere</option>
                  </select>
                </label>
              </div>
            </ModuloAutoSalva>
            <div className="hint" style={{ marginTop: 8, lineHeight: 1.6 }}>
              L&apos;oggetto diventa il titolo, il corpo la descrizione, PDF e immagini gli allegati, gli indirizzi web nel testo i link.
              Il mittente dev&apos;essere una persona che può pubblicare (si riconosce dall&apos;email dell&apos;account).
              <br />
              Collegamento tecnico: il servizio che riceve la casella deve chiamare <code>POST /api/articoli/inbound</code> con
              l&apos;intestazione <code>X-Articoli-Secret</code> — {segretoImpostato ? "segreto impostato su Vercel" : <strong style={{ color: "var(--red)" }}>segreto ARTICOLI_INBOUND_SECRET non ancora impostato su Vercel</strong>}.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
