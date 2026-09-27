import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import ArticoliHeader from "@/components/articoli/ArticoliHeader";
import ColonnaOrdinabile from "@/components/stampe/ColonnaOrdinabile";
import {
  getArticoliDb, pubblicaArticoli, gestisceArticoli, modificaArticolo, destinatarioDi, uscito, dataItaliana, FUSO_ARTICOLI,
} from "@/lib/articoli";

/*
 * Statistiche degli articoli: chi pubblica vede i suoi, chi gestisce tutti.
 * Per ogni articolo: quante persone potevano leggerlo (i suoi destinatari,
 * attivi), quante l'hanno aperto, in quanto tempo. Poi l'andamento delle
 * letture giorno per giorno e la lettura per punto vendita.
 */
export default async function StatisticheArticoliPage({
  searchParams,
}: {
  searchParams: Promise<{ giorni?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [db, academy] = await Promise.all([getArticoliDb(), getDb()]);
  if (!pubblicaArticoli(user, db)) redirect("/articoli");
  const gestisce = gestisceArticoli(user, db);
  const sp = await searchParams;
  const giorni = [30, 90, 365].includes(Number(sp.giorni)) ? Number(sp.giorni) : 90;
  const da = new Date(Date.now() - giorni * 86_400_000);

  const persone = academy.users.filter((u) => u.active !== false);
  const articoli = db.articoli
    .filter((a) => uscito(a) && modificaArticolo(user, a, db) && new Date(a.pubblicato!) >= da)
    .sort((a, b) => b.pubblicato!.localeCompare(a.pubblicato!));

  const righe = articoli.map((a) => {
    const potenziali = persone.filter((u) => destinatarioDi(u, a, db));
    const lettori = potenziali.filter((u) => a.letture[u.id]);
    const attese = lettori.map((u) => (new Date(a.letture[u.id]).getTime() - new Date(a.pubblicato!).getTime()) / 3_600_000).filter((h) => h >= 0).sort((x, y) => x - y);
    const mediana = attese.length ? attese[Math.floor(attese.length / 2)] : undefined;
    return { a, potenziali, lettori, perc: potenziali.length ? Math.round((lettori.length / potenziali.length) * 100) : 0, mediana };
  });

  const totPotenziali = righe.reduce((t, r) => t + r.potenziali.length, 0);
  const totLetture = righe.reduce((t, r) => t + r.lettori.length, 0);
  const tutteAttese = righe.map((r) => r.mediana).filter((x): x is number => x !== undefined).sort((x, y) => x - y);
  const medianaGenerale = tutteAttese.length ? tutteAttese[Math.floor(tutteAttese.length / 2)] : undefined;

  // letture per giorno (ora italiana), ultimi 30 giorni
  const chiaveGiorno = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: FUSO_ARTICOLI });
  const giorniGrafico = Array.from({ length: 30 }, (_, i) => chiaveGiorno(new Date(Date.now() - (29 - i) * 86_400_000)));
  const perGiorno = new Map(giorniGrafico.map((g) => [g, 0]));
  for (const r of righe) for (const u of r.lettori) {
    const g = chiaveGiorno(new Date(r.a.letture[u.id]));
    if (perGiorno.has(g)) perGiorno.set(g, perGiorno.get(g)! + 1);
  }
  const massimo = Math.max(1, ...perGiorno.values());

  // per punto vendita (e "Consorzio/insegna" per chi non ha un PV)
  const perPv = new Map<string, { nome: string; potenziali: number; lettori: number }>();
  for (const r of righe) for (const u of r.potenziali) {
    const chiave = u.storeId ?? `t:${u.tenantId ?? ""}`;
    const nome = u.storeId
      ? academy.stores.find((s) => s.id === u.storeId)?.name ?? "?"
      : u.tenantId ? `${academy.tenants.find((t) => t.id === u.tenantId)?.name ?? "?"} (insegna)` : "Consorzio";
    const v = perPv.get(chiave) ?? { nome, potenziali: 0, lettori: 0 };
    v.potenziali++;
    if (r.a.letture[u.id]) v.lettori++;
    perPv.set(chiave, v);
  }
  const pv = [...perPv.values()].sort((x, y) => y.potenziali - x.potenziali);
  const ore = (h?: number) => h === undefined ? "—" : h < 1 ? "meno di un'ora" : h < 48 ? `${Math.round(h)} ore` : `${Math.round(h / 24)} giorni`;

  return (
    <div>
      <ArticoliHeader user={user} active="statistiche" pubblica gestisce={gestisce} />
      <div className="container">
        <div className="stampa-testata">
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0 }}>Statistiche</h1>
            <p className="subtitle">{gestisce ? "Tutti gli articoli" : "I tuoi articoli"} usciti negli ultimi {giorni} giorni.</p>
          </div>
          <div className="chips">
            {[30, 90, 365].map((g) => (
              <a key={g} className={`chip ${g === giorni ? "on" : ""}`} href={`/articoli/statistiche?giorni=${g}`}>{g === 365 ? "un anno" : `${g} giorni`}</a>
            ))}
          </div>
        </div>

        <div className="stat-grande">
          <div className="card"><div className="num">{articoli.length}</div><div className="lab">articoli usciti</div></div>
          <div className="card"><div className="num">{totLetture}</div><div className="lab">letture (persone che li hanno aperti)</div></div>
          <div className="card"><div className="num">{totPotenziali ? `${Math.round((totLetture / totPotenziali) * 100)}%` : "—"}</div><div className="lab">letti da chi doveva leggerli</div></div>
          <div className="card"><div className="num" style={{ fontSize: 22 }}>{ore(medianaGenerale)}</div><div className="lab">tempo tipico fra uscita e lettura</div></div>
        </div>

        <div className="card" style={{ marginBottom: 18 }}>
          <h3 style={{ marginTop: 0 }}>Letture negli ultimi 30 giorni</h3>
          <div className="grafico-giorni">
            {giorniGrafico.map((g) => (
              <div key={g} style={{ height: `${(perGiorno.get(g)! / massimo) * 100}%` }}
                title={`${new Date(`${g}T12:00:00`).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" })}: ${perGiorno.get(g)} letture`} />
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>
            <span>{new Date(`${giorniGrafico[0]}T12:00:00`).toLocaleDateString("it-IT", { day: "numeric", month: "short" })}</span>
            <span>oggi</span>
          </div>
        </div>

        <div className="section-head"><h2>Per articolo</h2><span className="hint">clic sulle intestazioni per ordinare</span></div>
        <div className="card table-wrap" style={{ marginBottom: 18 }}>
          <table className="data">
            <thead>
              <tr>
                <ColonnaOrdinabile campo="titolo">Articolo</ColonnaOrdinabile>
                <ColonnaOrdinabile campo="data">Uscito</ColonnaOrdinabile>
                <ColonnaOrdinabile campo="potenziali">Destinatari</ColonnaOrdinabile>
                <ColonnaOrdinabile campo="letti">Letto da</ColonnaOrdinabile>
                <ColonnaOrdinabile campo="perc">%</ColonnaOrdinabile>
                <th>Tempo tipico</th>
              </tr>
            </thead>
            <tbody>
              {righe.length === 0 && <tr><td colSpan={6} className="empty">Nessun articolo uscito in questo periodo.</td></tr>}
              {righe.map((r) => (
                <tr key={r.a.id} data-titolo={r.a.titolo} data-data={r.a.pubblicato}
                  data-potenziali={String(r.potenziali.length).padStart(6, "0")} data-letti={String(r.lettori.length).padStart(6, "0")}
                  data-perc={String(r.perc).padStart(3, "0")}>
                  <td><a href={`/articoli/${r.a.id}`}><strong>{r.a.titolo}</strong></a><div className="hint">{r.a.autoreNome}</div></td>
                  <td>{dataItaliana(r.a.pubblicato!)}</td>
                  <td>{r.potenziali.length}</td>
                  <td>{r.lettori.length}</td>
                  <td style={{ minWidth: 130 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div className="barra-lettura" style={{ flex: 1 }}><span style={{ width: `${r.perc}%` }} /></div>
                      <strong>{r.perc}%</strong>
                    </div>
                  </td>
                  <td>{ore(r.mediana)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="section-head"><h2>Per punto vendita</h2><span className="hint">quante delle letture attese sono avvenute</span></div>
        <div className="card table-wrap">
          <table className="data">
            <thead>
              <tr>
                <ColonnaOrdinabile campo="nome">Punto vendita</ColonnaOrdinabile>
                <ColonnaOrdinabile campo="attese">Letture attese</ColonnaOrdinabile>
                <ColonnaOrdinabile campo="fatte">Fatte</ColonnaOrdinabile>
                <ColonnaOrdinabile campo="perc">%</ColonnaOrdinabile>
              </tr>
            </thead>
            <tbody>
              {pv.length === 0 && <tr><td colSpan={4} className="empty">Nessun dato.</td></tr>}
              {pv.map((v) => {
                const perc = v.potenziali ? Math.round((v.lettori / v.potenziali) * 100) : 0;
                return (
                  <tr key={v.nome} data-nome={v.nome} data-attese={String(v.potenziali).padStart(6, "0")}
                    data-fatte={String(v.lettori).padStart(6, "0")} data-perc={String(perc).padStart(3, "0")}>
                    <td>{v.nome}</td>
                    <td>{v.potenziali}</td>
                    <td>{v.lettori}</td>
                    <td style={{ minWidth: 130 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div className="barra-lettura" style={{ flex: 1 }}><span style={{ width: `${perc}%` }} /></div>
                        <strong>{perc}%</strong>
                      </div>
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
