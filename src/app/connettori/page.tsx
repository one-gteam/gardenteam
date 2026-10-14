import Link from "next/link";
import { redirect } from "next/navigation";
import { Plug } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getZooDb } from "@/lib/zoo";
import { getStampeDb } from "@/lib/stampe";
import { SITE_NAME } from "@/lib/types";
import { ConnettoreZoo, ConnettoreArredo } from "@/components/connettori/ConnettoriClient";

/*
 * Connettori: tutti i collegamenti fra GT One e i gestionali delle insegne e
 * dei punti vendita, in una pagina sola, per l'amministratore di sistema.
 * Le stesse impostazioni si vedono anche dentro le aree (Zoo → Impostazioni,
 * Arredo → Catalogo online), ma lì una per volta e con i permessi di chi gestisce.
 */
export default async function ConnettoriPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "system_admin") redirect("/scegli");
  const [db, zoo, stampe] = await Promise.all([getDb(), getZooDb(), getStampeDb()]);
  const zooDi = (tipo: "tenant" | "store", id: string) => zoo.giacenze.find((g) => g.scopeType === tipo && g.scopeId === id);
  const arredoDi = (storeId: string) => stampe.giacenze.find((g) => g.storeId === storeId);
  const nAttivi = zoo.giacenze.filter((g) => g.attivo !== false).length + stampe.giacenze.filter((g) => g.token && g.apiAttiva !== false).length;
  const origine = process.env.NEXT_PUBLIC_SITE_URL || "https://gardenteam.vercel.app";

  return (
    <div>
      <header className="site-header" style={{ background: "linear-gradient(120deg, #1f3b2d, #2f6b4a)" }}>
        <div className="site-header-inner">
          <div className="header-top">
            <Link href="/scegli" className="brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <span className="brand-logo"><img src={db.settings.logoUrl} alt={SITE_NAME} /></span>
              <span className="area-name" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Plug size={16} /> Connettori</span>
            </Link>
            <Link href="/scegli" className="cambia-area">⇄ Cambia area</Link>
          </div>
        </div>
      </header>
      <div className="container">
        <h1 style={{ marginBottom: 4 }}>Connettori ai gestionali</h1>
        <p className="subtitle">
          Come ogni insegna e punto vendita si collega al proprio gestionale per giacenze e prezzi. {nAttivi} {nAttivi === 1 ? "collegamento acceso" : "collegamenti accesi"}.
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
          </div>
          <p className="hint" style={{ margin: "10px 0 0" }}>
            Un connettore <strong>spento</strong> resta configurato ma non viene usato: lo Zoo torna ai prezzi del Consorzio e senza giacenze, l&apos;Arredo rifiuta gli invii. Ogni cambiamento finisce nel Registro modifiche.
          </p>
        </div>

        {db.tenants.map((t) => {
          const negozi = db.stores.filter((s) => s.tenantId === t.id);
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
                    {negozi.map((s) => {
                      const zs = zooDi("store", s.id);
                      const a = arredoDi(s.id);
                      return (
                        <tr key={s.id}>
                          <td><strong>{s.name}</strong>{s.city && <div className="hint" style={{ fontSize: 11.5 }}>{s.city}</div>}</td>
                          <td>
                            {zs
                              ? <ConnettoreZoo tipo="store" id={s.id} url={zs.url} nome={zs.nome} attivo={zs.attivo !== false} provatoIl={zs.provatoIl} esito={zs.esito} />
                              : zt?.url
                                ? <div><span className="hint">Usa quello dell&apos;insegna</span> <ConnettoreZoo tipo="store" id={s.id} attivo /></div>
                                : <ConnettoreZoo tipo="store" id={s.id} attivo />}
                          </td>
                          <td><ConnettoreArredo storeId={s.id} token={a?.token} apiAttiva={a?.apiAttiva !== false} aggiornatoIl={a?.aggiornatoIl} fonte={a?.fonte} nQuantita={Object.keys(a?.quantita ?? {}).length} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
