import Link from "next/link";
import { redirect } from "next/navigation";
import { Plug } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getZooDb } from "@/lib/zoo";
import { getStampeDb } from "@/lib/stampe";
import { permessoRuolo, SITE_NAME } from "@/lib/types";
import { saveSsoDefaults } from "@/lib/actions";
import ModuloAutoSalva from "@/components/ModuloAutoSalva";
import { ConnettoreZoo, ConnettoreArredo, ConnettoreSso, ConnettoreLettura, ConnettoreFox } from "@/components/connettori/ConnettoriClient";
import { leggiConnettoriFox } from "@/lib/fox-connettore";

/*
 * Connettori: i collegamenti fra GT One e i sistemi delle insegne e dei punti
 * vendita, in una pagina sola. Entra chi ha il permesso del ruolo
 * (Utenti e ruoli → Permessi): l'amministratore d'insegna vede la sua,
 * l'amministratore di sistema tutte. Le stesse impostazioni si vedono anche
 * dentro le aree (Zoo → Impostazioni, Arredo → Catalogo online), una per volta.
 */
export default async function ConnettoriPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!permessoRuolo(user.role, "accesso_connettori")) redirect("/scegli");
  const sistema = user.role === "system_admin";
  if (!sistema && !user.tenantId) redirect("/scegli");
  const [db, zoo, stampe] = await Promise.all([getDb(), getZooDb(), getStampeDb()]);
  const insegne = (sistema ? db.tenants : db.tenants.filter((t) => t.id === user.tenantId))
    .slice().sort((a, b) => a.name.localeCompare(b.name, "it"));
  const zooDi = (tipo: "tenant" | "store", id: string) => zoo.giacenze.find((g) => g.scopeType === tipo && g.scopeId === id);
  const arredoDi = (storeId: string) => stampe.giacenze.find((g) => g.storeId === storeId);
  const letturaDi = (tipo: "tenant" | "store", id: string) => zoo.letture.find((g) => g.scopeType === tipo && g.scopeId === id);
  const connettoriFox = await leggiConnettoriFox();
  const foxDi = (tipo: "tenant" | "store", id: string) => connettoriFox.find((g) => g.scopeType === tipo && g.scopeId === id);
  const fox = (tipo: "tenant" | "store", id: string) => {
    const f = foxDi(tipo, id);
    return <ConnettoreFox tipo={tipo} id={id} chiave={f?.chiave} attivo={f?.attivo !== false} ultimoInvio={f?.ultimoInvio} righe={f?.righe} fileAl={f?.fileAl} />;
  };
  const origine = process.env.NEXT_PUBLIC_SITE_URL || "https://gardenteam.vercel.app";
  const s = db.settings;

  return (
    <div>
      <header className="site-header" style={{ background: "linear-gradient(120deg, #1f3b2d, #2f6b4a)" }}>
        <div className="site-header-inner">
          <div className="header-top">
            <Link href="/scegli" className="brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <span className="brand-logo"><img src={s.logoUrl} alt={SITE_NAME} /></span>
              <span className="area-name" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Plug size={16} /> Connettori</span>
            </Link>
            <Link href="/scegli" className="cambia-area">⇄ Cambia area</Link>
          </div>
        </div>
      </header>
      <div className="container">
        <h1 style={{ marginBottom: 4 }}>Connettori</h1>
        <p className="subtitle">
          {sistema
            ? "Come ogni insegna e punto vendita si collega al proprio gestionale e fa entrare i suoi collaboratori."
            : `I collegamenti di ${insegne[0]?.name ?? "questa insegna"}: gestionale per giacenze e prezzi, chiavi dei punti vendita, accesso diretto dei collaboratori.`}
        </p>

        <div className="card" style={{ marginBottom: 14 }}>
          <h3 style={{ marginTop: 0 }}>Le modalità</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, fontSize: 13.5 }}>
            <div>
              <strong>1 · Offerte Zoo: GT One interroga il gestionale</strong>
              <p style={{ margin: "4px 0" }}>Il gestionale espone un indirizzo che, dati i codici a barre, risponde con giacenza e prezzo di vendita. GT One lo chiama quando serve (cartelli, Bozza, reparto). Il prezzo diventa il <em>prezzo di partenza</em> dell&apos;insegna; le offerte in percentuale si ricalcolano su quello.</p>
              <code style={{ fontSize: 11, display: "block", whiteSpace: "pre-wrap", background: "#f6f6f4", padding: 6, borderRadius: 6 }}>{`GET https://…/giacenze/CHIAVE?ean=800…,800…
→ { "giacenze": { "800…": { "giacenza": 4, "prezzo": 19.9, "codice": "00067973", "al": "2026-10-14" } } }`}</code>
            </div>
            <div>
              <strong>2 · Cartelli Arredo: il gestionale manda le quantità</strong>
              <p style={{ margin: "4px 0" }}>Per il catalogo online. Il gestionale del punto vendita invia le quantità a GT One con la sua chiave, quando vuole (es. ogni notte). Senza gestionale: Excel o a mano, da Stampe → Catalogo online.</p>
              <code style={{ fontSize: 11, display: "block", whiteSpace: "pre-wrap", background: "#f6f6f4", padding: 6, borderRadius: 6 }}>{`POST ${origine}/api/arredo-giacenze
Authorization: Bearer gt_…
{ "righe": [ { "codice": "AB123", "quantita": 4 } ], "modo": "sostituisci" }
oppure text/csv:  codice;quantita`}</code>
            </div>
            <div>
              <strong>2b · Offerte Zoo: il gestionale legge le offerte</strong>
              <p style={{ margin: "4px 0" }}>Il verso opposto della modalità 1: con la chiave della colonna «Il gestionale legge» il vostro programma scarica le offerte Zoo del volantino in corso e di quello in preparazione, già con i valori dei cartelli. Serve per stampare i cartelli dal proprio gestionale e per controllare a scaffale la promo del giorno dopo, che nel gestionale arriva solo quando la si carica.</p>
              <code style={{ fontSize: 11, display: "block", whiteSpace: "pre-wrap", background: "#f6f6f4", padding: 6, borderRadius: 6 }}>{`GET ${origine}/api/zoo/offerte?volantino=si&formato=za5
Authorization: Bearer gtz_…
→ { "campagne": [ … ], "offerte": [ { "ean": "800…", "descrizione": "…",
    "prezzoPromo": "19,79", "prezzoListino": "21,99", "volantino": true,
    "valori": { "titolo": "…", "prezzoPromo": "€ 19,79", … } } ] }`}</code>
            </div>
            <div>
              <strong>1b · Offerte Zoo: il programma Fox manda giacenze e prezzi</strong>
              <p style={{ margin: "4px 0" }}>Per chi usa il gestionale <strong>Fox</strong> ma non Linfa. Un programmino Windows, <a href="/connettori/GTOne-Fox.exe" download>GTOne-Fox.exe</a> (20 KB, senza installazione), legge in <strong>sola lettura</strong> la cartella «db» di Fox (ARTICOLI.CSV e BARCODE.CSV, che Fox riscrive da solo) e manda a GT One giacenza e prezzo di vendita dei soli articoli dello Zoo. Il prezzo d&apos;acquisto non viene nemmeno letto. Vale come la modalità 1: prezzo di partenza dell&apos;insegna e giacenze nei cartelli.</p>
              <ol style={{ margin: "4px 0", paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6 }}>
                <li>Qui sotto, «＋ Programma Fox» sull&apos;insegna o sul PV: copia la chiave.</li>
                <li>Copia GTOne-Fox.exe su un PC che vede la cartella di Fox (es. <code>\\server\areabyte\db</code>) e aprilo.</li>
                <li>Scegli la cartella, incolla la chiave, «Prova la lettura», poi «Invia adesso».</li>
                <li>«Invio automatico ogni ora…» crea un&apos;attività di Windows per l&apos;utente, senza diritti di amministratore.</li>
              </ol>
            </div>
            <div>
              <strong>3 · Accesso diretto (SSO): il vostro sistema fa entrare i collaboratori</strong>
              <p style={{ margin: "4px 0" }}>Intranet, portale del personale o gestionale: un link firmato con la chiave dell&apos;insegna apre GT One senza password. Al primo ingresso crea l&apos;account come corsista dell&apos;insegna (area Formazione); poi fa solo entrare. Non apre mai account da amministratore.</p>
              <code style={{ fontSize: 11, display: "block", whiteSpace: "pre-wrap", background: "#f6f6f4", padding: 6, borderRadius: 6 }}>{`dati  = { "email": "…", "nome": "…", "cognome": "…", "reparto": "…", "assunzione": "2025-03-01", "iat": secondi Unix adesso }
body  = base64url(JSON dati)
firma = base64url(HMAC-SHA256(chiave, body))
apri  ${origine}/sso?token=body.firma      (vale 90 secondi)`}</code>
            </div>
          </div>
          <details style={{ marginTop: 10, fontSize: 13 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Come collegare il vostro gestionale alle offerte Zoo (istruzioni per il vostro tecnico)</summary>
            <ol style={{ margin: "6px 0 0", paddingLeft: 20, lineHeight: 1.7 }}>
              <li><strong>Chiave.</strong> Qui sotto, nella colonna «Offerte Zoo · il gestionale legge», premete «＋ Crea chiave» sull&apos;insegna (vale per tutti i punti vendita) o sul singolo punto vendita (vede anche le sue offerte proprie). Copiatela e datela solo al gestionale: chi ha la chiave legge le offerte.</li>
              <li><strong>Richiesta.</strong> <code>GET {origine}/api/zoo/offerte</code> con l&apos;intestazione <code>Authorization: Bearer gtz_…</code>. Parametri facoltativi: <code>campagna=corso</code> (solo il volantino a scaffale) o <code>campagna=lavorazione</code> (quello in preparazione: la promo di domani), <code>volantino=si|no</code>, <code>ean=800…,800…</code> (solo questi codici), <code>formato=za4|za5|za6</code> (i valori del cartello per quel formato), <code>layout=1</code> (anche la grafica dei cartelli), <code>giacenze=0</code> (senza chiedere giacenze e prezzi al vostro gestionale).</li>
              <li><strong>Risposta</strong> (JSON): <code>campagne</code> (id, nome, dal, al, stato) e <code>offerte</code>: per ognuna <code>ean</code>, <code>descrizione</code>, <code>prezzoPromo</code>, <code>prezzoListino</code>, <code>meccanica</code> («3x2»), <code>sconto</code> (%), <code>condizioni</code>, <code>volantino</code> (vero se va sul volantino), <code>propria</code> (offerta dell&apos;insegna/PV, non del Consorzio) e <code>valori</code>: i campi del cartello già calcolati come in Stampa cartelli (titolo, marca, prezzo, prezzo di partenza, «A SOLI», validità, EAN, condizioni…).</li>
              <li><strong>Quando.</strong> Quando serve: all&apos;apertura della pagina dei cartelli, o una volta al giorno. Non serve chiamarla di continuo: le offerte cambiano quando il Consorzio prepara il volantino.</li>
              <li><strong>Prezzi.</strong> Se avete collegato anche la modalità 1 (giacenze e prezzi), il prezzo di partenza dei cartelli è il vostro e le offerte in percentuale sono ricalcolate su quello.</li>
              <li><strong>Errori.</strong> 401 = manca la chiave; 403 = chiave sbagliata o collegamento spento qui. Ogni creazione, rigenerazione e spegnimento finisce nel Registro modifiche.</li>
            </ol>
          </details>
          <p className="hint" style={{ margin: "10px 0 0" }}>
            Un connettore <strong>spento</strong> resta configurato ma non viene usato: lo Zoo torna ai prezzi del Consorzio e senza giacenze, l&apos;Arredo rifiuta gli invii, l&apos;SSO rimanda al login. Ogni cambiamento finisce nel Registro modifiche.
          </p>
        </div>

        {insegne.map((t) => {
          const negozi = db.stores.filter((st) => st.tenantId === t.id);
          const zt = zooDi("tenant", t.id);
          return (
            <div key={t.id} className="card" style={{ marginBottom: 14, padding: 0 }}>
              <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 8 }}>
                {t.logoUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={t.logoUrl} alt="" style={{ height: 22 }} />
                  : <span>{t.emoji}</span>}
                <h2 style={{ margin: 0, fontSize: 17 }}>{t.name}</h2>
                <span className="hint">{negozi.length} {negozi.length === 1 ? "punto vendita" : "punti vendita"}</span>
              </div>
              <div className="table-wrap">
                <table className="data" style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ width: "22%" }}>Ambito</th>
                      <th>Offerte Zoo · giacenze e prezzi (GT One interroga)</th>
                      <th>Offerte Zoo · il gestionale legge</th>
                      <th>Cartelli Arredo · quantità catalogo (il gestionale manda)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>Tutta l&apos;insegna</strong><div className="hint" style={{ fontSize: 11.5 }}>vale per i PV che non hanno il proprio</div></td>
                      <td><ConnettoreZoo tipo="tenant" id={t.id} url={zt?.url} nome={zt?.nome} attivo={zt?.attivo !== false} provatoIl={zt?.provatoIl} esito={zt?.esito} />{fox("tenant", t.id)}</td>
                      <td>{(() => { const l = letturaDi("tenant", t.id); return <ConnettoreLettura tipo="tenant" id={t.id} token={l?.token} attivo={l?.attivo !== false} creataIl={l?.creataIl} />; })()}</td>
                      <td><span className="hint">La chiave è del singolo punto vendita</span></td>
                    </tr>
                    {negozi.map((st) => {
                      const zs = zooDi("store", st.id);
                      const a = arredoDi(st.id);
                      return (
                        <tr key={st.id}>
                          <td><strong>{st.name}</strong>{st.city && <div className="hint" style={{ fontSize: 11.5 }}>{st.city}</div>}</td>
                          <td>
                            {zs
                              ? <ConnettoreZoo tipo="store" id={st.id} url={zs.url} nome={zs.nome} attivo={zs.attivo !== false} provatoIl={zs.provatoIl} esito={zs.esito} />
                              : zt?.url
                                ? <div><span className="hint">Usa quello dell&apos;insegna</span> <ConnettoreZoo tipo="store" id={st.id} attivo /></div>
                                : <ConnettoreZoo tipo="store" id={st.id} attivo />}
                            {fox("store", st.id)}
                          </td>
                          <td>{(() => { const l = letturaDi("store", st.id); return <ConnettoreLettura tipo="store" id={st.id} token={l?.token} attivo={l?.attivo !== false} creataIl={l?.creataIl} />; })()}</td>
                          <td><ConnettoreArredo storeId={st.id} token={a?.token} apiAttiva={a?.apiAttiva !== false} aggiornatoIl={a?.aggiornatoIl} fonte={a?.fonte} nQuantita={Object.keys(a?.quantita ?? {}).length} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: "10px 14px", borderTop: "1px solid var(--line)" }}>
                <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>Accesso diretto (SSO) · {t.name}</div>
                <ConnettoreSso tenantId={t.id} chiave={t.ssoSecret} attivo={t.ssoAttivo !== false} storeId={t.ssoStoreId} negozi={negozi.map((n) => ({ id: n.id, nome: n.name }))} />
                {t.ssoSecret && (
                  <details style={{ marginTop: 8, fontSize: 13 }}>
                    <summary style={{ cursor: "pointer" }}>Cosa deve fare il vostro sistema</summary>
                    <ol style={{ margin: "6px 0 0", paddingLeft: 20, lineHeight: 1.7 }}>
                      <li>Quando il collaboratore clicca «Formazione» (o simile) sul vostro portale, preparate i suoi dati: <code>email</code>, <code>nome</code>, <code>cognome</code>, e se li avete <code>reparto</code> (col nome di uno dei reparti di GT One) e <code>assunzione</code> (aaaa-mm-gg); più <code>iat</code>, i secondi Unix di adesso.</li>
                      <li><code>body</code> = il JSON in base64url. <code>firma</code> = HMAC-SHA256 di <code>body</code> con la chiave qui sopra, in base64url.</li>
                      <li>Mandate il browser a <code>{origine}/sso?token=</code><code>body</code>.<code>firma</code>. Il link vale 90 secondi: va generato al clic, non salvato.</li>
                      <li>Alla prima volta GT One crea l&apos;account come corsista di <strong>{t.name}</strong>{t.ssoStoreId ? <> nel PV <strong>{negozi.find((n) => n.id === t.ssoStoreId)?.name}</strong></> : ""}, con l&apos;area Formazione; le volte dopo fa solo entrare. Ruoli e aree in più si danno poi da Utenti e ruoli.</li>
                    </ol>
                  </details>
                )}
              </div>
            </div>
          );
        })}

        {sistema && (
          <div className="card" style={{ marginBottom: 14 }}>
            <h3 style={{ marginTop: 0 }}>Accesso da My Rosaflor (chiave condivisa di sistema)</h3>
            <p className="hint" style={{ margin: "0 0 10px" }}>
              Il link della Formazione su My Rosaflor è firmato con la chiave di sistema (variabile <code>SSO_SHARED_SECRET</code>, {process.env.SSO_SHARED_SECRET ? "configurata" : "mancante"}).
              Chi arriva da lì senza un account viene creato con questa insegna e questo punto vendita; il reparto si abbina per nome.
              Le altre insegne usano la propria chiave, qui sopra.
            </p>
            <ModuloAutoSalva azione={saveSsoDefaults} style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <label className="field" style={{ marginBottom: 0, maxWidth: 260 }}>
                Insegna assegnata
                <select name="ssoDefaultTenantId" defaultValue={s.ssoDefaultTenantId ?? ""}>
                  <option value="">— nessuna —</option>
                  {db.tenants.map((t) => <option key={t.id} value={t.id}>{t.emoji} {t.name}</option>)}
                </select>
              </label>
              <label className="field" style={{ marginBottom: 0, maxWidth: 260 }}>
                Punto vendita assegnato
                <select name="ssoDefaultStoreId" defaultValue={s.ssoDefaultStoreId ?? ""}>
                  <option value="">— nessuno —</option>
                  {db.stores.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                </select>
              </label>
            </ModuloAutoSalva>
          </div>
        )}
      </div>
    </div>
  );
}
