import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import StampeHeader from "@/components/stampe/StampeHeader";
import AvanzamentoVolantino from "@/components/stampe/AvanzamentoVolantino";
import { ModuloInvio } from "@/components/AzioneSenzaRicarica";
import { canAccessArea, isZooEditor } from "@/lib/stampe";
import { gestisce } from "@/lib/types";
import { listStorageFilesConData } from "@/lib/supabase";
import {
  getZooDb, campagnaInLavorazione, campagnaInCorso, passiVolantino, animaliDi,
  fotoDaAbbinare, volantinoDiFoto, focusDelVolantino, migraVolantinoPages, NO_VOLANTINO, destinazioneAnimale, vociSenzaFoto,
} from "@/lib/zoo";
import { incontriDelVolantino, correggiIncontro, incontriProgrammati, eliminaProgrammato } from "@/lib/zoo-incontri";

/** Le squadre che si incontrano sul volantino: di solito persone diverse. */
const SQUADRE = ["Zoo", "Comunicazione"];
import { salvaDeadlineGrafico } from "@/lib/zoo-actions";
import ProgrammaIncontro from "@/components/stampe/ProgrammaIncontro";
import ModuloAutoSalva from "@/components/ModuloAutoSalva";
import { PulsanteAzione } from "@/components/AzioneSenzaRicarica";
import { userSites } from "@/lib/types";

/*
 * Dashboard delle Offerte Zoo per chi gestisce: a che punto è il volantino in
 * lavorazione, cosa c'è da sistemare a mano (con il link che porta dritto al
 * punto), le segnalazioni e le note aperte, e gli incontri di lavoro.
 */
export default async function ZooDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessArea(user, "zoo")) redirect("/studente");
  if (!gestisce(user, "zoo")) redirect("/stampe/zoo/prodotti");
  const editor = isZooEditor(user);

  const [db, academyDb, foto] = await Promise.all([getZooDb(), getDb(), listStorageFilesConData("zoo-foto").catch(() => [])]);
  const campaign = campagnaInLavorazione(db) ?? campagnaInCorso(db);
  const nomeUtente = new Map(academyDb.users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
  const dataIt = (d?: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("it-IT", { day: "numeric", month: "long" }) : "—");
  const oraIt = (iso: string) => new Date(iso).toLocaleString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });

  if (!campaign) {
    return (
      <div>
        <StampeHeader user={user} active="dashboard" area="zoo" />
        <div className="container"><h1>Dashboard</h1><div className="card"><p className="empty">Nessun volantino aperto: si apre da Prodotti → Offerte in corso.</p></div></div>
      </div>
    );
  }

  const oggi = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Rome" }) + "T00:00:00");
  const giorniA = (d?: string) => (d ? Math.round((Date.parse(`${d}T00:00:00`) - oggi.getTime()) / 86400000) : undefined);
  const prodById = new Map(db.products.map((p) => [p.id, p]));
  const parentById = new Map(db.parents.map((p) => [p.id, p]));
  const offerte = db.offers.filter((o) => o.campaignId === campaign.id && !o.scopeType);
  const parentOf = (o: (typeof offerte)[number]) => { const p = prodById.get(o.productId ?? ""); return p?.parentId ? parentById.get(p.parentId) : undefined; };
  const aVolantino = offerte.filter((o) => o.selezionata && o.paginaId !== NO_VOLANTINO);
  /** Una voce per padre (o per offerta senza padre), come si ragiona sul volantino. */
  const voci = <T extends { productId?: string; id: string }>(lista: T[]) => {
    const m = new Map<string, T>();
    for (const o of lista) { const p = prodById.get(o.productId ?? ""); m.set(p?.parentId ?? o.id, m.get(p?.parentId ?? o.id) ?? o); }
    return [...m.values()];
  };
  const nome = (o: (typeof offerte)[number]) => parentOf(o)?.nome ?? o.descrizione;

  // numeri del volantino
  const layout = db.volantinoLayouts.find((l) => l.campaignId === campaign.id);
  const collocate = new Set((layout ? migraVolantinoPages(layout.pages) : []).flatMap((p) => p.blocks.flatMap((b) => b.offerIds ?? [])));
  const daCollocarePerAnimale = new Map<string, number>();
  for (const o of voci(aVolantino.filter((o) => destinazioneAnimale(o.paginaId)))) {
    const a = destinazioneAnimale(o.paginaId)!; daCollocarePerAnimale.set(a, (daCollocarePerAnimale.get(a) ?? 0) + 1);
  }

  // da sistemare a mano
  const padriInOfferta = [...new Set(offerte.map(parentOf).filter(Boolean))] as NonNullable<ReturnType<typeof parentOf>>[];
  const senzaAnimale = padriInOfferta.filter((p) => animaliDi(db, p.caratteristiche).length === 0);
  const senzaPadre = offerte.filter((o) => !parentOf(o));
  const senzaFoto = vociSenzaFoto(db, aVolantino);
  const senzaPrezzo = offerte.filter((o) => !o.prezzoPromo && !o.meccanica && !o.scontoPerc);
  const caricate = new Map(foto.map((f) => [f.nome, f.caricato]));
  const fotoLibere = fotoDaAbbinare(db, foto.map((f) => f.nome)).daAbbinare.filter((f) => volantinoDiFoto(db, caricate.get(f) ?? "")?.id === campaign.id);
  const segnalazioni = db.suggestions.filter((s) => s.status === "aperta");
  const noteAperte = db.noteBozza.filter((n) => n.campaignId === campaign.id && !n.risolta);
  const focus = focusDelVolantino(db, campaign.id);

  // incontri: quelli fatti e quelli fissati
  const [incontri, { programmati, squadre }] = await Promise.all([incontriDelVolantino(campaign.id), incontriProgrammati(campaign.id)]);
  const colleghi = academyDb.users
    .filter((u) => u.active !== false && u.email && u.role !== "student" && (u.role === "system_admin" || userSites(u).includes("zoo")))
    .map((u) => ({ id: u.id, nome: `${u.firstName} ${u.lastName}`, email: u.email }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "it"));
  const prossimi = programmati.filter((p) => Date.parse(p.quando) + p.durataMin * 60000 > Date.now());
  const gDeadline = giorniA(campaign.deadlineGrafico);
  const minuti = (i: { inizio: string; fine?: string; ultimo: string }) => Math.max(0, Math.round((Date.parse(i.fine ?? i.ultimo) - Date.parse(i.inizio)) / 60000));
  const totaleMin = incontri.reduce((t, i) => t + minuti(i), 0);
  const durata = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`);
  const ore = new Map<string, number>();
  for (const i of incontri) for (const p of i.partecipanti) ore.set(p, (ore.get(p) ?? 0) + minuti(i));

  const gInizio = giorniA(campaign.dal), gFine = giorniA(campaign.al);

  /* le cose da sistemare: una riga per voce, solo quelle che hanno qualcosa; si aprono per vedere i nomi */
  const daFare = [
    { titolo: "Voci a volantino senza foto", righe: senzaFoto.map(nome), href: `/stampe/zoo/foto?campagna=${campaign.id}`, cta: "Raccolta foto", urgente: true },
    { titolo: "Offerte senza prezzo", righe: senzaPrezzo.map((o) => o.descrizione), href: "/stampe/zoo/prodotti", cta: "Completa i prezzi", urgente: true },
    { titolo: "Padri senza animale", righe: senzaAnimale.map((p) => p.nome), href: "/stampe/zoo/prodotti?vista=catalogo&senzaanimale=1", cta: "Assegna l'animale", urgente: false },
    { titolo: "Offerte senza padre", righe: senzaPadre.map((o) => o.descrizione), href: "/stampe/zoo/prodotti?senzapadre=1", cta: "Raggruppa", urgente: false },
    { titolo: "Foto caricate da abbinare", righe: fotoLibere, href: "/stampe/zoo/prodotti?vista=catalogo&abbina=1", cta: "Abbina le foto", urgente: false },
    { titolo: "Segnalazioni aperte", righe: segnalazioni.map((x) => `${x.message} — ${x.userName}`), href: "/stampe/zoo/volantino", cta: "Vedi", urgente: false },
    { titolo: "Note sulla bozza da risolvere", righe: noteAperte.map((n) => `${n.testo} — ${n.userName}`), href: "/stampe/zoo/bozza", cta: "Bozza", urgente: false },
  ];
  const aperti = daFare.filter((d) => d.righe.length > 0);
  const aPosto = daFare.filter((d) => d.righe.length === 0);
  const totDaCollocare = [...daCollocarePerAnimale.values()].reduce((a, b) => a + b, 0);

  return (
    <div>
      <StampeHeader user={user} active="dashboard" area="zoo" />
      <div className="container">
        <div className="testata-compatta">
          <h1 style={{ margin: 0, fontSize: 24 }}>Dashboard</h1>
          <span className="hint" style={{ flex: 1 }}>
            <strong>{campaign.nome}</strong> · dal {dataIt(campaign.dal)} al {dataIt(campaign.al)}
            {gInizio !== undefined && gInizio > 0 && <> · <strong>esce tra {gInizio} {gInizio === 1 ? "giorno" : "giorni"}</strong></>}
            {gInizio !== undefined && gInizio <= 0 && gFine !== undefined && gFine >= 0 && <> · in corso, finisce tra {gFine} {gFine === 1 ? "giorno" : "giorni"}</>}
          </span>
          {/* consegna al grafico: la data e quanto manca */}
          <span className={`dash-deadline${gDeadline !== undefined && gDeadline <= 3 ? " vicina" : ""}`}>
            <strong>Invio al grafico</strong>
            {editor ? (
              <ModuloAutoSalva azione={salvaDeadlineGrafico.bind(null, campaign.id)} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <input type="date" name="deadline" defaultValue={campaign.deadlineGrafico ?? ""} style={{ marginTop: 0 }} />
              </ModuloAutoSalva>
            ) : <span>{campaign.deadlineGrafico ? dataIt(campaign.deadlineGrafico) : "non fissato"}</span>}
            <span className="hint">
              {gDeadline === undefined ? "da fissare"
                : gDeadline > 0 ? `mancano ${gDeadline} ${gDeadline === 1 ? "giorno" : "giorni"}`
                : gDeadline === 0 ? "è oggi" : `scaduta da ${-gDeadline} ${gDeadline === -1 ? "giorno" : "giorni"}`}
            </span>
          </span>
        </div>
        <p className="hint" style={{ margin: "0 0 10px" }}>
          {offerte.length} offerte caricate · <strong>{voci(aVolantino).length}</strong> voci a volantino · {collocate.size} già impaginate
          {totDaCollocare > 0 && <> · da collocare in pagina: {[...daCollocarePerAnimale].map(([a, n]) => `${a} ${n}`).join(", ")}</>}
          {" "}· {focus.length} focus
        </p>

        <AvanzamentoVolantino passi={passiVolantino(db, campaign)} campaignId={campaign.id} puoSegnare={editor} />

        <div className="dash-colonne">
          <section className="card dash-sezione">
            <h2>Da sistemare</h2>
            {aperti.length === 0 && <p className="hint" style={{ margin: 0 }}>Tutto a posto.</p>}
            {aperti.map((d) => (
              <details key={d.titolo} className={`dash-riga${d.urgente ? " urgente" : ""}`}>
                <summary>
                  <span className="dash-conto">{d.righe.length}</span>
                  <span style={{ flex: 1 }}>{d.titolo}</span>
                  <a className="mini-btn" href={d.href}>{d.cta} →</a>
                </summary>
                <ul>
                  {d.righe.slice(0, 15).map((r, k) => <li key={k}>{r}</li>)}
                  {d.righe.length > 15 && <li className="hint">… e altri {d.righe.length - 15}</li>}
                </ul>
              </details>
            ))}
            {aPosto.length > 0 && <p className="hint" style={{ margin: "8px 0 0", fontSize: 11.5 }}>A posto: {aPosto.map((d) => d.titolo.toLowerCase()).join(", ")}.</p>}
          </section>

          <section className="card dash-sezione">
            <h2>Incontri</h2>
            {prossimi.length === 0 && <p className="hint" style={{ margin: 0 }}>Nessun incontro fissato.</p>}
            <ul className="dash-prossimi">
              {prossimi.map((p) => (
                <li key={p.id}>
                  <strong>{p.squadra}</strong> · {oraIt(p.quando)} · {p.durataMin} min
                  {editor && <> <PulsanteAzione azione={eliminaProgrammato.bind(null, p.id)} className="mini-btn" conferma="Togliere questo incontro? Chi ha ricevuto la mail non viene avvisato.">togli</PulsanteAzione></>}
                  <div className="hint" style={{ fontSize: 11.5 }}>{p.partecipanti.map((id) => nomeUtente.get(id) ?? "?").join(", ")}{p.mailInviateIl ? " · mail mandata" : ""}</div>
                  {p.testo && <div style={{ fontSize: 12, whiteSpace: "pre-line" }}>{p.testo}</div>}
                </li>
              ))}
            </ul>
            {editor && (
              <details className="dash-fissa">
                <summary className="btn btn-outline btn-sm">＋ Fissa un incontro</summary>
                <ProgrammaIncontro campaignId={campaign.id} squadre={SQUADRE} ricordati={squadre} colleghi={colleghi} />
              </details>
            )}
            <details className="dash-fissa">
              <summary className="hint" style={{ cursor: "pointer" }}>
                Tempo di lavoro sul volantino: <strong>{durata(totaleMin)}</strong> in {incontri.length} {incontri.length === 1 ? "incontro" : "incontri"} ▾
              </summary>
              {ore.size > 0 && (
                <p className="hint" style={{ margin: "6px 0" }}>
                  Per persona: {[...ore].sort((a, b) => b[1] - a[1]).map(([p, m]) => `${nomeUtente.get(p) ?? "?"} ${durata(m)}`).join(" · ")}
                </p>
              )}
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Quando</th><th>Durata</th><th>Chi c&apos;era</th>{editor && <th></th>}</tr></thead>
                  <tbody>
                    {incontri.length === 0 && <tr><td colSpan={editor ? 4 : 3} className="empty">Si registrano da soli lavorando in Crea Volantino.</td></tr>}
                    {incontri.map((i) => (
                      <tr key={i.id}>
                        <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>{oraIt(i.inizio)}{i.fine ? ` → ${new Date(i.fine).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" })}` : ""}</td>
                        <td style={{ fontSize: 12 }}>{i.fine ? durata(minuti(i)) : <span className="pill pill-red">in corso · {durata(minuti(i))}</span>}</td>
                        <td style={{ fontSize: 12 }}>{i.partecipanti.map((p) => nomeUtente.get(p) ?? "?").join(", ") || "—"}</td>
                        {editor && (
                          <td>
                            <details>
                              <summary className="mini-btn" style={{ cursor: "pointer" }}>correggi</summary>
                              <ModuloInvio azione={correggiIncontro.bind(null, i.id)} style={{ display: "grid", gap: 4, marginTop: 4 }}>
                                <label className="field" style={{ marginBottom: 0 }}>Inizio<input type="datetime-local" name="inizio" /></label>
                                <label className="field" style={{ marginBottom: 0 }}>Fine<input type="datetime-local" name="fine" /></label>
                                <label style={{ fontSize: 12 }}><input type="checkbox" name="elimina" value="1" /> elimina questo incontro</label>
                                <button className="btn btn-sm" type="submit">Salva</button>
                              </ModuloInvio>
                            </details>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
        </div>
      </div>
    </div>
  );
}
