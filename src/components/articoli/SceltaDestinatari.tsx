import type { DB, Role } from "@/lib/types";
import { ROLE_LABELS } from "@/lib/types";
import type { Destinatari } from "@/lib/articoli";

const RUOLI: Role[] = ["system_admin", "group_admin", "store_admin", "manager", "dept_head", "student"];

/**
 * Le caselle per scegliere "chi": ruoli, insegne, punti vendita, reparti,
 * gruppi, singole persone. Basta una casella spuntata perché la persona
 * rientri. Nessuna casella = come dice `vuotoVuolDire`. Si usa per i permessi
 * dell'area e per i destinatari di ogni articolo, con un prefisso diverso.
 */
export default function SceltaDestinatari({
  prefisso, academy, valore, vuotoVuolDire, conTutti = true, conPersone = true,
}: {
  prefisso: string;
  academy: DB;
  valore?: Destinatari;
  vuotoVuolDire: string;
  conTutti?: boolean;
  conPersone?: boolean;
}) {
  const v = valore ?? {};
  const n = (k: string) => `${prefisso}_${k}`;
  const Blocco = ({ titolo, children }: { titolo: string; children: React.ReactNode }) => (
    <div className="dest-blocco">
      <div className="dest-titolo">{titolo}</div>
      <div className="chips">{children}</div>
    </div>
  );
  const Casella = ({ nome, val, testo, on }: { nome: string; val: string; testo: string; on: boolean }) => (
    <label className="chip">
      <input type="checkbox" name={nome} value={val} defaultChecked={on} />
      {testo}
    </label>
  );
  const persone = [...academy.users].filter((u) => u.active !== false).sort((a, b) => a.lastName.localeCompare(b.lastName));
  return (
    <div className="dest">
      <p className="hint" style={{ margin: "0 0 6px" }}>Nessuna spunta = {vuotoVuolDire}. Basta una spunta che riguardi la persona.</p>
      {conTutti && (
        <div className="dest-blocco">
          <label className="interruttore-grande">
            <input type="checkbox" name={n("tutti")} value="1" defaultChecked={!!v.tutti} />
            Tutti
          </label>
        </div>
      )}
      <Blocco titolo="Ruoli">
        {RUOLI.map((r) => <Casella key={r} nome={n("ruoli")} val={r} testo={ROLE_LABELS[r]} on={!!v.ruoli?.includes(r)} />)}
      </Blocco>
      <Blocco titolo="Insegne">
        {academy.tenants.map((t) => <Casella key={t.id} nome={n("tenantIds")} val={t.id} testo={t.name} on={!!v.tenantIds?.includes(t.id)} />)}
      </Blocco>
      <Blocco titolo="Punti vendita">
        {academy.stores.map((s) => <Casella key={s.id} nome={n("storeIds")} val={s.id} testo={s.name} on={!!v.storeIds?.includes(s.id)} />)}
      </Blocco>
      <Blocco titolo="Reparti">
        {academy.departments.map((d) => <Casella key={d.id} nome={n("departmentIds")} val={d.id} testo={`${d.emoji} ${d.name}`} on={!!v.departmentIds?.includes(d.id)} />)}
      </Blocco>
      {academy.groups.length > 0 && (
        <Blocco titolo="Gruppi">
          {academy.groups.map((g) => <Casella key={g.id} nome={n("groupIds")} val={g.id} testo={`${g.emoji} ${g.name}`} on={!!v.groupIds?.includes(g.id)} />)}
        </Blocco>
      )}
      {conPersone && (
        <details className="dest-blocco">
          <summary className="dest-titolo" style={{ cursor: "pointer" }}>
            Singole persone{v.userIds?.length ? ` (${v.userIds.length} scelte)` : ""}
          </summary>
          <div className="chips" style={{ marginTop: 6 }}>
            {persone.map((u) => (
              <Casella key={u.id} nome={n("userIds")} val={u.id} testo={`${u.lastName} ${u.firstName}`} on={!!v.userIds?.includes(u.id)} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
