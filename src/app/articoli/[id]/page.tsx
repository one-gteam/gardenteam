import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import ArticoliHeader from "@/components/articoli/ArticoliHeader";
import { SegnaLetto } from "@/components/articoli/StrumentiArticolo";
import {
  ripulisciHtml,
  getArticoliDb, vedeArticoli, pubblicaArticoli, gestisceArticoli, modificaArticolo, dataItaliana, testoDestinatari,
  destinatarioDi, uscito, scaduto, programmato, dataOraItaliana,
} from "@/lib/articoli";
import { ROLE_LABELS } from "@/lib/types";

/** Un articolo per intero: testo, allegati, link, chi l'ha scritto e quando. */
export default async function ArticoloPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const [db, academy] = await Promise.all([getArticoliDb(), getDb()]);
  if (!vedeArticoli(user, db)) redirect("/scegli");
  const a = db.articoli.find((x) => x.id === id);
  if (!a) notFound();
  const modifica = modificaArticolo(user, a, db);
  // bozze e programmati li vede solo chi li può modificare; gli scaduti restano leggibili (archivio)
  if (!modifica && !(uscito(a) && destinatarioDi(user, a, db))) notFound();
  const cat = db.categorie.find((c) => c.id === a.categoriaId);
  const letture = Object.entries(a.letture).map(([uid, quando]) => {
    const u = academy.users.find((x) => x.id === uid);
    return { nome: u ? `${u.firstName} ${u.lastName}` : "—", quando };
  }).sort((x, y) => y.quando.localeCompare(x.quando));
  const dimensione = (b: number) => (b > 1024 * 1024 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

  return (
    <div>
      <ArticoliHeader user={user} active="articoli" pubblica={pubblicaArticoli(user, db)} gestisce={gestisceArticoli(user, db)} />
      <SegnaLetto id={a.id} />
      <div className="container" style={{ maxWidth: 860 }}>
        <div style={{ marginBottom: 8 }}><a href="/articoli">← Tutti gli articoli</a></div>
        <article className="articolo-pagina">
          <div className="chips" style={{ marginBottom: 8 }}>
            {a.stato === "bozza" && <span className="pill pill-amber">Bozza — non ancora pubblicato</span>}
            {programmato(a) && <span className="pill pill-blue">🕒 Programmato: esce il {dataOraItaliana(a.pubblicato!)}</span>}
            {scaduto(a) && <span className="pill pill-gray">In archivio — scaduto il {dataItaliana(`${a.scadenza}T12:00:00`)}</span>}
            {a.inEvidenza && <span className="pill pill-orange">In evidenza</span>}
            {cat && <span className="pill pill-green">{cat.emoji ? `${cat.emoji} ` : ""}{cat.nome}</span>}
            {a.origine === "email" && <span className="pill pill-gray" title={`Spedito da ${a.mittenteEmail}`}>✉ arrivato per email</span>}
          </div>
          <h1 style={{ margin: "0 0 6px" }}>{a.titolo}</h1>
          <p className="subtitle" style={{ marginTop: 0 }}>
            {dataItaliana(a.pubblicato ?? a.creato)} · {a.autoreNome}
            {a.aggiornato && <> · <strong>aggiornato il {dataItaliana(a.aggiornato)}</strong></>}
            {a.scadenza && !scaduto(a) && <> · valido fino al {dataItaliana(`${a.scadenza}T12:00:00`)}</>}
          </p>
          {modifica && (
            <div className="chips" style={{ marginBottom: 14 }}>
              <a className="btn btn-outline btn-sm" href={`/articoli/${a.id}/modifica`}>✎ Modifica</a>
              <span className="hint">Lo vedono: {testoDestinatari(a.destinatari, academy, ROLE_LABELS)} · letto da {letture.length}</span>
            </div>
          )}
          {a.copertina && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.copertina} alt="" className="articolo-copertina" />
          )}
          <div className="articolo-testo" dangerouslySetInnerHTML={{ __html: ripulisciHtml(a.testo) || "<p><i>Senza descrizione.</i></p>" }} />

          {a.allegati.length > 0 && (
            <div className="card" style={{ marginTop: 18 }}>
              <h3 style={{ marginTop: 0 }}>Allegati</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {a.allegati.map((x) => (
                  <a key={x.url} href={x.url} target="_blank" rel="noopener noreferrer" className="allegato-riga">
                    {x.tipo === "application/pdf" ? "📄" : "🖼"} {x.nome} <span className="hint">{dimensione(x.dimensione)}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
          {a.link.length > 0 && (
            <div className="card" style={{ marginTop: 14 }}>
              <h3 style={{ marginTop: 0 }}>Link</h3>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {a.link.map((l) => <li key={l.url}><a href={l.url} target="_blank" rel="noopener noreferrer">{l.titolo || l.url}</a></li>)}
              </ul>
            </div>
          )}
          {(a.versioni?.length ?? 0) > 0 && (
            <details className="card" style={{ marginTop: 14 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>
                Versioni precedenti ({a.versioni!.length})
              </summary>
              <p className="hint" style={{ margin: "6px 0 10px" }}>Com&apos;era prima di ogni aggiornamento: testo e allegati di allora.</p>
              {a.versioni!.map((v, i) => (
                <details key={i} className="versione">
                  <summary>
                    <strong>{dataItaliana(v.data)}</strong>
                    {v.titolo !== a.titolo && <span className="hint"> · «{v.titolo}»</span>}
                    {v.allegati.length > 0 && <span className="hint"> · 📎 {v.allegati.map((x) => x.nome).join(", ")}</span>}
                  </summary>
                  <div className="articolo-testo versione-testo" dangerouslySetInnerHTML={{ __html: ripulisciHtml(v.testo) || "<p><i>Senza descrizione.</i></p>" }} />
                  {v.allegati.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                      {v.allegati.map((x) => (
                        <a key={x.url} href={x.url} target="_blank" rel="noopener noreferrer" className="allegato-riga">
                          {x.tipo === "application/pdf" ? "📄" : "🖼"} {x.nome} <span className="hint">versione del {dataItaliana(v.data)}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </details>
              ))}
            </details>
          )}
          {modifica && letture.length > 0 && (
            <details className="card" style={{ marginTop: 14 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>Letto da {letture.length}</summary>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13.5 }}>
                {letture.map((l, i) => <li key={i}>{l.nome} <span className="hint">· {dataItaliana(l.quando)}</span></li>)}
              </ul>
            </details>
          )}
        </article>
      </div>
    </div>
  );
}
