import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import RuoliHeader from "@/components/RuoliHeader";
import ModuloAutoSalva from "@/components/ModuloAutoSalva";
import { PulsanteAzione } from "@/components/AzioneSenzaRicarica";
import ProvaProfilo from "@/components/ProvaProfilo";
import { livelloGestioneUtenti } from "@/lib/logic";
import {
  PERMESSI_AREA, PERMESSI_PREDEFINITI, PERMESSI_RUOLO, ROLE_LABELS, permessoRuolo,
  type PermessoRuolo, type Role, type SiteId,
} from "@/lib/types";
import { CATALOGO, RUOLI_CONFIGURABILI, type Capacita } from "@/lib/permessi-catalogo";
import { salvaPermessoRuolo, ripristinaPermessiRuoli } from "@/lib/actions";

/*
 * Utenti e ruoli → Permessi: cosa può fare ogni ruolo, area per area, e con
 * quale condizione. La vede chi gestisce utenti (per capire cosa sta dando a
 * una persona); la modifica solo l'amministratore di sistema.
 */
export default async function PermessiPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const db = await getDb();
  if (!livelloGestioneUtenti(db, user)) redirect("/scegli");
  const modifica = user.role === "system_admin";

  const tutti: Role[] = ["system_admin", ...RUOLI_CONFIGURABILI];
  const chiavi = [...PERMESSI_AREA.map((p) => p.chiave), ...PERMESSI_RUOLO.map((p) => p.chiave)];
  const matrice = Object.fromEntries(
    tutti.map((r) => [r, Object.fromEntries(chiavi.map((k) => [k, permessoRuolo(r, k)]))])
  ) as Record<Role, Record<PermessoRuolo, boolean>>;
  const cambiati = chiavi.some((k) => RUOLI_CONFIGURABILI.some((r) => matrice[r][k] !== PERMESSI_PREDEFINITI[r][k]));

  /** La casella di un permesso: modificabile per l'amministratore di sistema, altrimenti solo ✓/—. */
  const casella = (r: Role, k: PermessoRuolo, etichetta: string) => {
    const acceso = matrice[r][k];
    const diverso = acceso !== PERMESSI_PREDEFINITI[r][k];
    if (!modifica) return <span className={acceso ? "si" : "no"}>{acceso ? "✓" : "—"}</span>;
    return (
      <span title={diverso ? "Diverso dal predefinito" : undefined} className={diverso ? "diverso" : undefined}>
        <ModuloAutoSalva azione={salvaPermessoRuolo.bind(null, r, k)} style={{ display: "inline-block" }}>
          <input type="checkbox" name="v" defaultChecked={acceso} aria-label={`${etichetta} — ${ROLE_LABELS[r]}`} />
        </ModuloAutoSalva>
      </span>
    );
  };

  /** Cosa c'è scritto nella cella "ruolo × capacità": dipende dalla condizione. */
  const cella = (c: Capacita, area: SiteId | "articoli" | "portale", r: Role) => {
    const gestisceRuolo = area !== "articoli" && area !== "portale" && matrice[r][`gestisce_${area}` as PermessoRuolo];
    switch (c.condizione) {
      case "accesso": return <span className="si">✓</span>;
      case "ambito": return <span className="si" title="lavorando per la propria insegna o il proprio PV">✓ insegna/PV</span>;
      case "gestione":
        return gestisceRuolo ? <span className="si">✓</span> : r === "manager" ? <span className="forse">se la gestisce</span> : <span className="no">—</span>;
      case "layout":
        return gestisceRuolo || r === "grafico"
          ? <span className="si" title={r === "grafico" ? "nel suo ambito: Consorzio, insegna o PV" : undefined}>✓{r === "grafico" ? " nel suo ambito" : ""}</span>
          : r === "manager" ? <span className="forse">se la gestisce</span> : <span className="no">—</span>;
      case "consorzio":
        return gestisceRuolo || r === "manager"
          ? <span className="forse" title="solo chi è collocato al Consorzio">al Consorzio{!gestisceRuolo ? ", se la gestisce" : ""}</span>
          : <span className="no">—</span>;
      case "volantino":
        return <span className="forse">{gestisceRuolo || r === "manager" ? "al Consorzio o editor" : "se editor"}</span>;
      case "insegna": return r === "group_admin" ? <span className="si">✓</span> : <span className="no">—</span>;
      case "sistema": return <span className="no">—</span>;
      case "articoli-vede": case "articoli-pubblica": case "articoli-gestisce":
        return <span className="forse">Articoli → Gestione</span>;
      default: {
        const k = c.condizione as PermessoRuolo;
        if (!matrice[r][k]) return <span className="no">—</span>;
        if (k === "organizzazione" && r !== "group_admin" && r !== "store_admin") return <span className="no">—</span>;
        if (k === "corsi" && r !== "group_admin" && r !== "store_admin" && !matrice[r].gestisce_academy) return <span className="forse">se gestisce la Formazione</span>;
        return <span className="si">✓</span>;
      }
    }
  };

  return (
    <div>
      <RuoliHeader user={user} active="permessi" />
      <div className="container">
        <h1 style={{ marginBottom: 4 }}>Permessi dei ruoli</h1>
        <p className="subtitle">
          Cosa può fare una persona dipende da tre cose: il <strong>ruolo</strong>, <strong>dove è collocata</strong>
          {" "}(Consorzio, insegna o punto vendita: lavora sempre dentro quell&apos;ambito) e le <strong>aree</strong> che le sono
          abilitate. Qui sotto trovi cosa sblocca ogni ruolo in ogni area; con «Prova un profilo» vedi il risultato per una persona.
          {modifica ? " Le spunte si salvano da sole; l'amministratore di sistema ha sempre tutto." : " Li modifica l'amministratore di sistema."}
        </p>

        <div className="card" style={{ padding: 14, marginBottom: 18 }}>
          <h2 style={{ marginTop: 0 }}>🧪 Prova un profilo</h2>
          <ProvaProfilo matrice={matrice} etichetteRuoli={ROLE_LABELS} />
        </div>

        <div className="legenda-permessi">
          <span><span className="si">✓</span> sì</span>
          <span><span className="si">✓ insegna/PV</span> lavorando per la propria insegna o il proprio PV</span>
          <span><span className="forse">al Consorzio</span> solo chi è collocato al Consorzio</span>
          <span><span className="forse">se la gestisce</span> il gestore, per le aree spuntate come «gestisce» nella sua scheda</span>
          <span><span className="no">—</span> no</span>
        </div>

        {CATALOGO.map((sez) => {
          const permessoArea = PERMESSI_AREA.find((p) => p.area === sez.area);
          return (
            <div key={sez.area} className="card table-wrap" style={{ marginBottom: 16, padding: 14 }}>
              <h2 style={{ marginTop: 0 }}>{sez.icona} {sez.titolo}</h2>
              {sez.area === "articoli" && (
                <p className="hint" style={{ marginTop: -6 }}>
                  Chi vede, chi pubblica e chi gestisce gli Articoli si sceglie in <a href="/articoli/gestione">Articoli → Gestione</a>, per ruolo, gruppo, insegna o persona.
                </p>
              )}
              <table className="data permessi-ruoli">
                <thead>
                  <tr>
                    <th>Cosa si può fare</th>
                    {RUOLI_CONFIGURABILI.map((r) => <th key={r} style={{ textAlign: "center" }}>{ROLE_LABELS[r]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {permessoArea && (
                    <tr className="riga-permesso">
                      <td>
                        <strong>{permessoArea.etichetta}</strong>
                        <div className="hint" style={{ fontSize: 11.5 }}>
                          Per tutto il ruolo. Per il gestore, se è spento, vale la scelta fatta persona per persona (gestisce / usa).
                        </div>
                      </td>
                      {RUOLI_CONFIGURABILI.map((r) => <td key={r} style={{ textAlign: "center" }}>{casella(r, permessoArea.chiave, permessoArea.etichetta)}</td>)}
                    </tr>
                  )}
                  {sez.capacita.map((c) => (
                    <tr key={c.testo}>
                      <td>{c.testo}{c.nota && <div className="hint" style={{ fontSize: 11 }}>{c.nota}</div>}</td>
                      {RUOLI_CONFIGURABILI.map((r) => <td key={r} style={{ textAlign: "center", fontSize: 12 }}>{cella(c, sez.area, r)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}

        <div className="card table-wrap" style={{ padding: 14, marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>⚙️ Permessi generali</h2>
          <table className="data permessi-ruoli">
            <thead>
              <tr>
                <th>Permesso</th>
                {RUOLI_CONFIGURABILI.map((r) => <th key={r} style={{ textAlign: "center" }}>{ROLE_LABELS[r]}</th>)}
              </tr>
            </thead>
            <tbody>
              {PERMESSI_RUOLO.map((p) => (
                <tr key={p.chiave}>
                  <td><strong>{p.etichetta}</strong><div className="hint" style={{ fontSize: 11.5, maxWidth: 440 }}>{p.spiegazione}</div></td>
                  {RUOLI_CONFIGURABILI.map((r) => <td key={r} style={{ textAlign: "center" }}>{casella(r, p.chiave, p.etichetta)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {modifica && cambiati && (
            <div style={{ marginTop: 10 }}>
              <PulsanteAzione azione={ripristinaPermessiRuoli} conferma="Tornare ai permessi predefiniti per tutti i ruoli?">
                Ripristina i permessi predefiniti
              </PulsanteAzione>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
