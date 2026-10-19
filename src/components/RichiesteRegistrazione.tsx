import { approveRegistration, rejectRegistration } from "@/lib/actions";
import { assignableRolesFor } from "@/lib/logic";
import { ROLE_LABELS, type DB, type Registration, type User } from "@/lib/types";
import RuoloApprovazione from "@/components/RuoloApprovazione";

/**
 * Le richieste di registrazione da approvare: reparto, ruolo e aree scelti da
 * chi approva. La usano Utenti e ruoli → Richieste (account GT One) e il
 * pannello Academy (iscrizioni dei corsisti).
 */
export default function RichiesteRegistrazione({ db, user, richieste, nota }: {
  db: DB; user: User; richieste: Registration[]; nota: string;
}) {
  return (
          <div className="card" style={{ marginBottom: 20, borderColor: "var(--amber)" }}>
            <h2>Richieste di registrazione in attesa ({richieste.length})</h2>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Richiedente</th><th>Punto vendita</th><th>Dati</th><th>Reparto e ruolo</th><th></th></tr>
                </thead>
                <tbody>
                  {richieste.map((r) => {
                    const store = db.stores.find((s) => s.id === r.storeId);
                    const approve = approveRegistration.bind(null, r.id);
                    const reject = rejectRegistration.bind(null, r.id);
                    return (
                      <tr key={r.id}>
                        <td>
                          <strong>{r.lastName} {r.firstName}</strong>
                          <div style={{ fontSize: 12, color: "var(--muted)" }}>{r.email}</div>
                        </td>
                        <td>{store?.name}</td>
                        <td style={{ fontSize: 12.5 }}>
                          {r.birthDate ? `Nato/a ${new Date(r.birthDate).toLocaleDateString("it-IT")}` : "—"}
                          <div style={{ color: "var(--muted)" }}>{r.taxCode || ""}</div>
                        </td>
                        <td>
                          <form action={approve} id={`approve_${r.id}`}>
                            <select name="departmentId" defaultValue={r.departmentId ?? ""}>
                              <option value="">— Reparto —</option>
                              {db.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                          </form>
                          {r.repartoAltro && (
                            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>
                              Ha scelto <strong>Altro</strong>{r.notaAltro ? <> («{r.notaAltro}»)</> : null}: scegli qui sotto il ruolo giusto.
                            </div>
                          )}
                          <RuoloApprovazione formId={`approve_${r.id}`} proposto="student"
                            ruoli={[{ value: "student", label: ROLE_LABELS.student }, ...assignableRolesFor(user).filter((x) => x !== "system_admin" && x !== "student").map((x) => ({ value: x, label: ROLE_LABELS[x] }))]} />
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button className="btn btn-sm" type="submit" form={`approve_${r.id}`}>✓ Approva</button>{" "}
                          <form action={reject} style={{ display: "inline" }}>
                            <button className="btn btn-outline btn-sm" type="submit" style={{ color: "var(--red)", borderColor: "var(--red)" }}>Rifiuta</button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "8px 0 0" }}>{nota}</p>
          </div>
  );
}
