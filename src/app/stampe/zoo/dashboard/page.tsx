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
  getZooDb, campagnaInLavorazione, campagnaInCorso, passiVolantino, animaliDi, prezziDelPadre,
  fotoDaAbbinare, volantinoDiFoto, focusDelVolantino, migraVolantinoPages, NO_VOLANTINO, destinazioneAnimale, vociSenzaFoto,
} from "@/lib/zoo";
import { incontriDelVolantino, correggiIncontro } from "@/lib/zoo-incontri";

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
  const piuPrezzi = padriInOfferta.filter((p) => prezziDelPadre(db, p.id, campaign.id).length > 1);
  const senzaFoto = vociSenzaFoto(db, aVolantino);
  const senzaFocus = voci(aVolantino).filter((o) => !(o.focus ?? "").trim());
  const senzaPrezzo = offerte.filter((o) => !o.prezzoPromo && !o.meccanica && !o.scontoPerc);
  const caricate = new Map(foto.map((f) => [f.nome, f.caricato]));
  const fotoLibere = fotoDaAbbinare(db, foto.map((f) => f.nome)).daAbbinare.filter((f) => volantinoDiFoto(db, caricate.get(f) ?? "")?.id === campaign.id);
  const segnalazioni = db.suggestions.filter((s) => s.status === "aperta");
  const noteAperte = db.noteBozza.filter((n) => n.campaignId === campaign.id && !n.risolta);
  const focus = focusDelVolantino(db, campaign.id);

  // incontri
  const incontri = await incontriDelVolantino(campaign.id);
  const minuti = (i: { inizio: string; fine?: string; ultimo: string }) => Math.max(0, Math.round((Date.parse(i.fine ?? i.ultimo) - Date.parse(i.inizio)) / 60000));
  const totaleMin = incontri.reduce((t, i) => t + minuti(i), 0);
  const durata = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`);
  const ore = new Map<string, number>();
  for (const i of incontri) for (const p of i.partecipanti) ore.set(p, (ore.get(p) ?? 0) + minuti(i));

  const oggi = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Rome" }) + "T00:00:00");
  const giorniA = (d?: string) => (d ? Math.round((Date.parse(`${d}T00:00:00`) - oggi.getTime()) / 86400000) : undefined);
  const gInizio = giorniA(campaign.dal), gFine = giorniA(campaign.al);

  const Lista = ({ titolo, n, href, cta, righe, tono = "amber" }: { titolo: string; n: number; href: string; cta: string; righe: string[]; tono?: "amber" | "red" | "green" }) => (
    <div className={`card dash-box ${n === 0 ? "ok" : tono}`}>
      <div className="dash-box-testa"><strong>{titolo}</strong><span className="dash-num">{n}</span></div>
      {n === 0 ? <p className="hint" style={{ margin: 0 }}>Niente da fare qui.</p> : (
        <>
          <ul>{righe.slice(0, 6).map((r, k) => <li key={k}>{r}</li>)}{righe.length > 6 && <li className="hint">… e altri {righe.length - 6}</li>}</ul>
          <a className="btn btn-outline btn-sm" href={href}>{cta} →</a>
        </>
      )}
    </div>
  );

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
        </div>

        <AvanzamentoVolantino passi={passiVolantino(db, campaign)} campaignId={campaign.id} puoSegnare={editor} />

        <div className="dash-numeri">
          <div className="card"><span className="dash-num">{offerte.length}</span><span>offerte caricate</span></div>
          <div className="card"><span className="dash-num">{voci(aVolantino).length}</span><span>voci a volantino</span></div>
          <div className="card"><span className="dash-num">{[...daCollocarePerAnimale.values()].reduce((a, b) => a + b, 0)}</span>
            <span>da collocare in pagina{daCollocarePerAnimale.size ? `: ${[...daCollocarePerAnimale].map(([a, n]) => `${a} ${n}`).join(", ")}` : ""}</span></div>
          <div className="card"><span className="dash-num">{collocate.size}</span><span>offerte già impaginate</span></div>
          <div className="card"><span className="dash-num">{focus.length}</span><span>focus</span></div>
          <div className="card"><span className="dash-num">{durata(totaleMin)}</span><span>di lavoro in {incontri.length} {incontri.length === 1 ? "incontro" : "incontri"}</span></div>
        </div>

        <h2 style={{ margin: "18px 0 8px" }}>Da sistemare a mano</h2>
        <div className="dash-griglia">
          <Lista titolo="Senza animale" n={senzaAnimale.length} href="/stampe/zoo/prodotti?vista=catalogo&senzaanimale=1" cta="Assegna l'animale" righe={senzaAnimale.map((p) => p.nome)} />
          <Lista titolo="Offerte senza padre" n={senzaPadre.length} href="/stampe/zoo/prodotti?senzapadre=1" cta="Raggruppa" righe={senzaPadre.map((o) => o.descrizione)} />
          <Lista titolo="Padri con più prezzi" n={piuPrezzi.length} href="/stampe/zoo/prodotti" cta="Dividi per prezzo" righe={piuPrezzi.map((p) => p.nome)} />
          <Lista titolo="A volantino senza foto" n={senzaFoto.length} href={`/stampe/zoo/foto?campagna=${campaign.id}`} cta="Raccolta foto" righe={senzaFoto.map(nome)} tono="red" />
          <Lista titolo="Foto caricate da abbinare" n={fotoLibere.length} href="/stampe/zoo/prodotti?vista=catalogo&abbina=1" cta="Abbina le foto" righe={fotoLibere} />
          <Lista titolo="A volantino senza focus" n={senzaFocus.length} href="/stampe/zoo/focus" cta="Pagina Focus" righe={senzaFocus.map(nome)} />
          <Lista titolo="Offerte senza prezzo" n={senzaPrezzo.length} href="/stampe/zoo/prodotti" cta="Completa i prezzi" righe={senzaPrezzo.map((o) => o.descrizione)} tono="red" />
          <Lista titolo="Segnalazioni aperte" n={segnalazioni.length} href="/stampe/zoo/volantino" cta="Vedi le offerte" righe={segnalazioni.map((s) => `${s.message} — ${s.userName}`)} />
          <Lista titolo="Note sulla bozza da risolvere" n={noteAperte.length} href="/stampe/zoo/bozza" cta="Bozza volantino" righe={noteAperte.map((n) => `${n.testo} — ${n.userName}`)} />
        </div>

        <h2 style={{ margin: "18px 0 8px" }}>Incontri di lavoro</h2>
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table className="data">
            <thead><tr><th>Quando</th><th>Durata</th><th>Chi c&apos;era</th><th>Come</th>{editor && <th></th>}</tr></thead>
            <tbody>
              {incontri.length === 0 && <tr><td colSpan={editor ? 5 : 4} className="empty">Nessun incontro ancora: si registrano da soli lavorando in Crea Volantino (o col pulsante «Avvia incontro»).</td></tr>}
              {incontri.map((i) => (
                <tr key={i.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{oraIt(i.inizio)}{i.fine ? ` → ${new Date(i.fine).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" })}` : ""}</td>
                  <td>{i.fine ? durata(minuti(i)) : <span className="pill pill-red">in corso · {durata(minuti(i))}</span>}</td>
                  <td style={{ fontSize: 12.5 }}>{i.partecipanti.map((p) => nomeUtente.get(p) ?? "?").join(", ") || "—"}</td>
                  <td style={{ fontSize: 12 }}>{i.auto ? "avviato da solo" : "col pulsante"}{i.chiusoAuto ? " · chiuso per inattività" : ""}</td>
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
        {ore.size > 0 && (
          <p className="hint" style={{ marginTop: 8 }}>
            Tempo per persona: {[...ore].sort((a, b) => b[1] - a[1]).map(([p, m]) => `${nomeUtente.get(p) ?? "?"} ${durata(m)}`).join(" · ")}
          </p>
        )}
      </div>
    </div>
  );
}
