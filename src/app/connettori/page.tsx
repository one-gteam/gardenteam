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
import { ConnettoreZoo, ConnettoreArredo, ConnettoreSso } from "@/components/connettori/ConnettoriClient";

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
              <strong>3 · Accesso diretto (SSO): il vostro sistema fa entrare i collaboratori</strong>
              <p style={{ margin: "4px 0" }}>Intranet, portale del personale o gestionale: un link firmato con la chiave dell&apos;insegna apre GT One senza password. Al primo ingresso crea l&apos;account come corsista dell&apos;insegna (area Formazione); poi fa solo entrare. Non apre mai account da amministratore.</p>
              <code style={{ fontSize: 11, display: "block", whiteSpace: "pre-wrap", background: "#f6f6f4", padding: 6, borderRadius: 6 }}>{`dati  = { "email": "…", "nome": "…", "cognome": "…", "reparto": "…", "assunzione": "2025-03-01", "iat": secondi Unix adesso }
body  = base64url(JSON dati)
firma = base64url(HMAC-SHA256(chiave, body))
apri  ${origine}/sso?token=body.firma      (vale 90 secondi)`}</code>
            </div>
          </div>
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
                      <th>Cartelli Arredo · quantità catalogo (il gestionale manda)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>Tutta l&apos;insegna</strong><div className="hint" style={{ fontSize: 11.5 }}>vale per i PV che non hanno il proprio</div></td>
                      <td><ConnettoreZoo tipo="tenant" id={t.id} url={zt?.url} nome={zt?.nome} attivo={zt?.attivo !== false} provatoIl={zt?.provatoIl} esito={zt?.esito} /></td>
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
                          </td>
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
