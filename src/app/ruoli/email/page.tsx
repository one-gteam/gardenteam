import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import RuoliHeader from "@/components/RuoliHeader";
import ModuloAutoSalva from "@/components/ModuloAutoSalva";
import { PulsanteAzione } from "@/components/AzioneSenzaRicarica";
import EsitoAzione from "@/components/articoli/EsitoAzione";
import { permessoRuolo, userSites } from "@/lib/types";
import { scopeUsers } from "@/lib/logic";
import { salvaBenvenutoGtOne, ripristinaBenvenutoGtOne, provaBenvenutoGtOne } from "@/lib/actions";

/*
 * Utenti e ruoli → Email: il benvenuto di GT One, cioè la mail che riceve chi
 * viene attivato con aree diverse dalla sola formazione (Zoo, Arredo, Articoli…).
 * Chi ha soltanto la formazione riceve quello dell'Academy (Formazione → Email
 * automatiche). Il Consorzio scrive il testo comune; insegna e PV possono avere
 * la loro versione.
 */
export default async function EmailRuoliPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const puo = user.role === "system_admin" || (["group_admin", "store_admin"].includes(user.role) && permessoRuolo(user.role, "modelliEmail"));
  if (!puo) redirect("/ruoli");
  const db = await getDb();

  const comune = db.templates.find((t) => t.type === "benvenuto_gtone" && !t.tenantId && !t.storeId);
  const propria = user.role === "system_admin"
    ? comune
    : user.role === "store_admin"
      ? db.templates.find((t) => t.type === "benvenuto_gtone" && t.storeId === user.storeId)
      : db.templates.find((t) => t.type === "benvenuto_gtone" && t.tenantId === user.tenantId && !t.storeId);
  const inUso = propria ?? comune;
  const ambito = user.role === "system_admin" ? "comune a tutti" : user.role === "store_admin" ? "del tuo punto vendita" : "della tua insegna";

  // le ultime mail di benvenuto mandate a persone del proprio ambito
  const mieiUtenti = new Set(scopeUsers(db, user).map((u) => u.id));
  const inviate = db.emails
    .filter((e) => (e.type === "benvenuto_gtone" || e.type === "benvenuto") && mieiUtenti.has(e.userId))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 20);
  const personaDi = (id: string) => db.users.find((u) => u.id === id);

  return (
    <div>
      <RuoliHeader user={user} active="email" />
      <div className="container" style={{ maxWidth: 900 }}>
        <h1 style={{ marginBottom: 4 }}>Email di benvenuto GT One</h1>
        <p className="subtitle">
          La riceve chi viene attivato con aree del portale oltre alla formazione (Offerte Zoo, Cartelli Arredo, Articoli…),
          con il mittente <strong>GT One</strong>. Chi ha <em>solo</em> la formazione riceve invece il benvenuto dell&apos;Academy,
          che si scrive in <a href="/admin/email">Formazione → Email automatiche</a>.
        </p>

        {!comune ? (
          <div className="alert alert-amber">Il modello non c&apos;è ancora: ricarica la pagina.</div>
        ) : (
          <div className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
              <h2 style={{ margin: 0, flex: 1 }}>🌱 Testo {ambito}</h2>
              {comune.enabled ? <span className="pill pill-green">Attiva</span> : <span className="pill pill-red">Disattivata</span>}
              {user.role !== "system_admin" && (propria ? <span className="pill pill-blue">versione vostra</span> : <span className="pill pill-gray">usa il testo comune</span>)}
            </div>
            <ModuloAutoSalva azione={salvaBenvenutoGtOne}>
              <label className="field">
                Oggetto
                <input type="text" name="subject" defaultValue={inUso?.subject ?? ""} required />
              </label>
              <label className="field">
                Testo
                <textarea name="body" rows={7} defaultValue={inUso?.body ?? ""} required />
              </label>
              {user.role === "system_admin" && (
                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                  <input type="checkbox" name="enabled" defaultChecked={comune.enabled} /> Manda il benvenuto ai nuovi colleghi
                </label>
              )}
            </ModuloAutoSalva>
            <p className="hint" style={{ margin: "10px 0" }}>
              Variabili: <code>{"{{nome}}"}</code> <code>{"{{cognome}}"}</code> <code>{"{{piattaforma}}"}</code> · maschile e femminile:
              {" "}<code>[abilitato|abilitata]</code>. In fondo alla mail si aggiunge da solo il link per scegliere la password
              (vale 7 giorni), a chi non ne ha ancora una.
            </p>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <EsitoAzione azione={provaBenvenutoGtOne} etichetta="Mandala a me come prova" />
              {(user.role === "system_admin" || propria) && (
                <PulsanteAzione azione={ripristinaBenvenutoGtOne}
                  conferma={user.role === "system_admin" ? "Tornare al testo predefinito?" : "Togliere la vostra versione e usare il testo comune?"}>
                  {user.role === "system_admin" ? "Ripristina il testo predefinito" : "Usa il testo comune"}
                </PulsanteAzione>
              )}
            </div>
          </div>
        )}

        <div className="section-head" style={{ marginTop: 22 }}><h2>Ultimi benvenuti mandati</h2></div>
        <div className="card table-wrap">
          <table className="data">
            <thead><tr><th>Quando</th><th>A chi</th><th>Quale</th><th>Esito</th></tr></thead>
            <tbody>
              {inviate.length === 0 && <tr><td colSpan={4} className="empty">Nessuna mail di benvenuto ancora.</td></tr>}
              {inviate.map((e) => {
                const p = personaDi(e.userId);
                return (
                  <tr key={e.id}>
                    <td className="hint">{new Date(e.date).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td>{p ? `${p.firstName} ${p.lastName}` : e.to}<div className="hint">{e.to}</div></td>
                    <td>
                      {e.type === "benvenuto_gtone"
                        ? <span className="pill pill-green">GT One</span>
                        : <span className="pill pill-blue">Academy</span>}
                      {p && <div className="hint" style={{ fontSize: 11 }}>aree: {userSites(p).join(", ") || "—"}</div>}
                    </td>
                    <td>
                      <span className={`pill ${e.status === "inviata" ? "pill-green" : e.status === "errore" ? "pill-red" : "pill-gray"}`}>{e.status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
