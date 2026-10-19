import type { ReactNode } from "react";
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
import { ConnettoreZoo, ConnettoreArredo, ConnettoreSso, ConnettoreLettura, ConnettoreFox, ConnettoreLetturaArredo } from "@/components/connettori/ConnettoriClient";
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
          <h3 style={{ marginTop: 0 }}>Due modi di collegare il gestionale</h3>
          <p style={{ margin: "0 0 10px", fontSize: 13.5 }}>
            Valgono sia per le <strong>Offerte Zoo</strong> (giacenze e prezzo di vendita: il prezzo diventa il prezzo di partenza dell&apos;insegna e le offerte in percentuale si ricalcolano su quello)
            sia per i <strong>Cartelli Arredo</strong> (le quantità del catalogo online). Basta un modo; se ci sono tutti e due, vale A.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, fontSize: 13.5 }}>
            <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
              <strong style={{ fontSize: 15 }}>A · GT One legge dal vostro gestionale</strong>
              <p style={{ margin: "4px 0 8px" }}>Il gestionale pubblica un indirizzo internet (https) con i dati. <strong>Qui</strong>: si incolla l&apos;indirizzo e si prova. GT One poi lo legge da solo.</p>
              <div className="hint" style={{ fontWeight: 700, color: "var(--ink, #222)" }}>Offerte Zoo: chiesto quando serve (cartelli, Bozza)</div>
              <code style={{ fontSize: 11, display: "block", whiteSpace: "pre-wrap", background: "#f6f6f4", padding: 6, borderRadius: 6, margin: "4px 0 8px" }}>{`GET https://vostro-indirizzo?ean=800…,800…
→ { "giacenze": { "800…": { "giacenza": 4, "prezzo": 19.9 } } }`}</code>
              <div className="hint" style={{ fontWeight: 700, color: "var(--ink, #222)" }}>Cartelli Arredo: letto ogni mattina</div>
              <code style={{ fontSize: 11, display: "block", whiteSpace: "pre-wrap", background: "#f6f6f4", padding: 6, borderRadius: 6, margin: "4px 0 8px" }}>{`GET https://vostro-indirizzo
→ { "righe": [ { "codice": "AB123", "quantita": 4 } ] }   oppure testo  codice;quantita`}</code>
            </div>
            <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
              <strong style={{ fontSize: 15 }}>B · Il vostro gestionale invia i dati a GT One</strong>
              <p style={{ margin: "4px 0 8px" }}><strong>Qui</strong>: si crea una chiave e la si dà al gestionale. Il gestionale manda i dati quando vuole (es. ogni ora o ogni notte).</p>
              <div className="hint" style={{ fontWeight: 700, color: "var(--ink, #222)" }}>Offerte Zoo</div>
              <code style={{ fontSize: 11, display: "block", whiteSpace: "pre-wrap", background: "#f6f6f4", padding: 6, borderRadius: 6, margin: "4px 0 8px" }}>{`GET  ${origine}/api/connettori/fox   → { "eans": [ … ] }  gli EAN che servono
POST ${origine}/api/connettori/fox
Authorization: Bearer gtf_…
{ "righe": [ { "ean": "800…", "giacenza": 4, "prezzo": 19.9 } ] }`}</code>
              <div className="hint" style={{ fontWeight: 700, color: "var(--ink, #222)" }}>Cartelli Arredo</div>
              <code style={{ fontSize: 11, display: "block", whiteSpace: "pre-wrap", background: "#f6f6f4", padding: 6, borderRadius: 6, margin: "4px 0 8px" }}>{`POST ${origine}/api/arredo-giacenze
Authorization: Bearer gt_…
{ "righe": [ { "codice": "AB123", "quantita": 4 } ] }   oppure text/csv  codice;quantita`}</code>
              <details style={{ fontSize: 13 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>Avete il gestionale Fox? C&apos;è lo script pronto</summary>
                <p style={{ margin: "6px 0" }}>
                  <a href="/connettori/GTOne-Fox.ps1" download><strong>GTOne-Fox.ps1</strong></a> è un file di testo (si legge col Blocco note): legge in <strong>sola lettura</strong> ARTICOLI.CSV e BARCODE.CSV della cartella «db» di Fox
                  e manda giacenza e prezzo di vendita dei soli articoli dello Zoo. Il prezzo d&apos;acquisto non viene letto. Niente da installare, niente diritti di amministratore.
                </p>
                <ol style={{ margin: "4px 0", paddingLeft: 18, lineHeight: 1.6 }}>
                  <li>Qui sotto, nella colonna Offerte Zoo → B, «＋ Crea chiave» e copiatela.</li>
                  <li>Salvate GTOne-Fox.ps1 in una cartella di un PC che vede quella di Fox (es. <code>\\server\areabyte\db</code>).</li>
                  <li>In quella cartella: tasto destro su uno spazio vuoto con Maiusc premuto → «Apri finestra PowerShell qui», e scrivete<br />
                    <code>powershell -ExecutionPolicy Bypass -File .\GTOne-Fox.ps1</code></li>
                  <li>Indicate la cartella di Fox e incollate la chiave: prova la lettura, manda e, se volete, pianifica l&apos;invio ogni ora.</li>
                </ol>
                <p className="hint" style={{ margin: "4px 0 0" }}>
                  C&apos;è anche la versione programma, <a href="/connettori/GTOne-Fox.exe" download>GTOne-Fox.exe</a>, ma non avendo una firma digitale molti antivirus la bloccano: meglio lo script.
                </p>
              </details>
            </div>
          </div>
          <p className="hint" style={{ margin: "10px 0 0" }}>
            Ogni collegamento si può <strong>spegnere</strong> senza perderlo: lo Zoo torna ai prezzi del Consorzio e senza giacenze, l&apos;Arredo tiene le ultime quantità. Ogni cambiamento finisce nel Registro modifiche.
            Errori: 401 = manca la chiave, 403 = chiave sbagliata o collegamento spento.
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
                      <th style={{ width: "18%" }}>Dove</th>
                      <th>Offerte Zoo</th>
                      <th>Cartelli Arredo</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>Tutta l&apos;insegna</strong><div className="hint" style={{ fontSize: 11.5 }}>vale per i punti vendita senza un collegamento proprio</div></td>
                      <td>
                        <Modo lettera="A" testo="GT One legge"><ConnettoreZoo tipo="tenant" id={t.id} url={zt?.url} nome={zt?.nome} attivo={zt?.attivo !== false} provatoIl={zt?.provatoIl} esito={zt?.esito} /></Modo>
                        <Modo lettera="B" testo="Il gestionale invia">{fox("tenant", t.id)}</Modo>
                      </td>
                      <td><span className="hint">Si collega punto vendita per punto vendita</span></td>
                    </tr>
                    {negozi.map((st) => {
                      const zs = zooDi("store", st.id);
                      const a = arredoDi(st.id);
                      return (
                        <tr key={st.id}>
                          <td><strong>{st.name}</strong>{st.city && <div className="hint" style={{ fontSize: 11.5 }}>{st.city}</div>}</td>
                          <td>
                            <Modo lettera="A" testo="GT One legge">
                              {zs
                                ? <ConnettoreZoo tipo="store" id={st.id} url={zs.url} nome={zs.nome} attivo={zs.attivo !== false} provatoIl={zs.provatoIl} esito={zs.esito} />
                                : zt?.url
                                  ? <div><span className="hint">Usa quello dell&apos;insegna</span> <ConnettoreZoo tipo="store" id={st.id} attivo /></div>
                                  : <ConnettoreZoo tipo="store" id={st.id} attivo />}
                            </Modo>
                            <Modo lettera="B" testo="Il gestionale invia">{fox("store", st.id)}</Modo>
                          </td>
                          <td>
                            <Modo lettera="A" testo="GT One legge"><ConnettoreLetturaArredo storeId={st.id} url={a?.url} attivo={a?.urlAttivo !== false} provatoIl={a?.provatoIl} esito={a?.esito} /></Modo>
                            <Modo lettera="B" testo="Il gestionale invia"><ConnettoreArredo storeId={st.id} token={a?.token} apiAttiva={a?.apiAttiva !== false} aggiornatoIl={a?.aggiornatoIl} fonte={a?.fonte} nQuantita={Object.keys(a?.quantita ?? {}).length} /></Modo>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: "10px 14px", borderTop: "1px solid var(--line)" }}>
                <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>Accesso diretto (SSO) · {t.name}</div>
                <p className="hint" style={{ margin: "0 0 6px" }}>Il vostro portale (intranet, gestionale) fa entrare i collaboratori in GT One senza password, con un link firmato con questa chiave.</p>
                <ConnettoreSso tenantId={t.id} chiave={t.ssoSecret} attivo={t.ssoAttivo !== false} storeId={t.ssoStoreId} negozi={negozi.map((n) => ({ id: n.id, nome: n.name }))} />
                {t.ssoSecret && (
                  <details style={{ marginTop: 8, fontSize: 13 }}>
                    <summary style={{ cursor: "pointer" }}>Cosa deve fare il vostro sistema</summary>
                    <ol style={{ margin: "6px 0 0", paddingLeft: 20, lineHeight: 1.7 }}>
                      <li>Quando il collaboratore clicca «Formazione» (o simile) sul vostro portale, preparate i suoi dati: <code>email</code>, <code>nome</code>, <code>cognome</code>, e se li avete <code>reparto</code> (col nome di uno dei reparti di GT One) e <code>assunzione</code> (aaaa-mm-gg); più <code>iat</code>, i secondi Unix di adesso.</li>
                      <li><code>body</code> = il JSON in base64url. <code>firma</code> = HMAC-SHA256 di <code>body</code> con la chiave qui sopra, in base64url.</li>
                      <li>Mandate il browser a <code>{origine}/sso?token=</code><code>body</code>.<code>firma</code>. Il link vale 90 secondi: va generato al clic, non salvato.</li>
                      <li>Alla prima volta GT One crea l&apos;account come corsista di <strong>{t.name}</strong>{t.ssoStoreId ? <> nel PV <strong>{negozi.find((n) => n.id === t.ssoStoreId)?.name}</strong></> : ""}, con l&apos;area Formazione; le volte dopo fa solo entrare. Non apre mai account da amministratore. Ruoli e aree in più si danno poi da Utenti e ruoli.</li>
                    </ol>
                  </details>
                )}
              </div>
              <details style={{ padding: "10px 14px", borderTop: "1px solid var(--line)", fontSize: 13 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>In più: il vostro gestionale scarica le offerte Zoo (per stampare i cartelli dal vostro programma)</summary>
                <p style={{ margin: "6px 0" }}>
                  Con questa chiave il gestionale legge le offerte del volantino in corso e di quello in preparazione, già con i valori dei cartelli:
                  <code> GET {origine}/api/zoo/offerte</code> con <code>Authorization: Bearer gtz_…</code>.
                  Parametri facoltativi: <code>campagna=corso|lavorazione</code>, <code>volantino=si|no</code>, <code>ean=800…,800…</code>, <code>formato=za4|za5|za6</code>, <code>layout=1</code>, <code>giacenze=0</code>.
                </p>
                <table className="data" style={{ fontSize: 13 }}>
                  <tbody>
                    <tr>
                      <td style={{ width: "18%" }}><strong>Tutta l&apos;insegna</strong></td>
                      <td>{(() => { const l = letturaDi("tenant", t.id); return <ConnettoreLettura tipo="tenant" id={t.id} token={l?.token} attivo={l?.attivo !== false} creataIl={l?.creataIl} />; })()}</td>
                    </tr>
                    {negozi.map((st) => (
                      <tr key={st.id}>
                        <td><strong>{st.name}</strong></td>
                        <td>{(() => { const l = letturaDi("store", st.id); return <ConnettoreLettura tipo="store" id={st.id} token={l?.token} attivo={l?.attivo !== false} creataIl={l?.creataIl} />; })()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
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

/** Un modo di collegamento dentro la cella: «A · GT One legge» o «B · Il gestionale invia». */
function Modo({ lettera, testo, children }: { lettera: "A" | "B"; testo: string; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 8, alignItems: "start", padding: "6px 0", borderTop: lettera === "B" ? "1px dashed var(--line)" : undefined }}>
      <span title={testo} style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", minWidth: 92, paddingTop: 3 }}>{lettera} · {testo}</span>
      <div>{children}</div>
    </div>
  );
}
