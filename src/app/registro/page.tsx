import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { gestisce, isAcademyAdmin, SITE_NAME } from "@/lib/types";
import { canManageUsers } from "@/lib/logic";
import { leggiRegistro, ultimiMesi, type AreaRegistro } from "@/lib/registro";

/*
 * Registro delle modifiche: chi ha cambiato offerte, titoli, descrizioni,
 * prodotti, corsi e utenti, con il valore di prima e quello di dopo. Ognuno
 * vede le aree che gestisce; l'amministratore di sistema tutte.
 */
const NOMI: Record<AreaRegistro, string> = { zoo: "Offerte Zoo", arredo: "Cartelli Arredo", academy: "Academy", utenti: "Utenti e ruoli" };

export default async function RegistroPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const db = await getDb();
  const visibili = (Object.keys(NOMI) as AreaRegistro[]).filter((a) =>
    user.role === "system_admin" ||
    (a === "zoo" && gestisce(user, "zoo")) ||
    (a === "arredo" && gestisce(user, "arredo")) ||
    (a === "academy" && isAcademyAdmin(user) && gestisce(user, "academy")) ||
    (a === "utenti" && canManageUsers(db, user)));
  if (visibili.length === 0) redirect("/scegli");
  const sp = await searchParams;
  const mesi = ultimiMesi(6);
  const mese = sp.mese && mesi.includes(sp.mese) ? sp.mese : "";
  const tutte = await leggiRegistro(mese ? [mese] : mesi.slice(0, 2));
  const area = (sp.area && visibili.includes(sp.area as AreaRegistro) ? sp.area : "") as AreaRegistro | "";
  const chi = sp.chi ?? "";
  const q = (sp.q ?? "").trim().toLowerCase();
  const nelleMie = tutte.filter((v) => visibili.includes(v.area));
  const persone = [...new Map(nelleMie.map((v) => [v.chi, v.chiNome])).entries()].sort((a, b) => a[1].localeCompare(b[1], "it"));
  const voci = nelleMie.filter((v) => (!area || v.area === area) && (!chi || v.chi === chi)
    && (!q || `${v.cosa} ${v.oggetto} ${v.prima ?? ""} ${v.dopo ?? ""} ${v.ambito ?? ""}`.toLowerCase().includes(q)));
  const quando = (iso: string) => new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });
  const nomeMese = (m: string) => new Date(`${m.replace("_", "-")}-01T12:00:00`).toLocaleDateString("it-IT", { month: "long", year: "numeric" });
  const MAX = 600;

  return (
    <div>
      <header className="site-header">
        <div className="site-header-inner">
          <div className="header-top">
            <Link href="/scegli" className="brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <span className="brand-logo"><img src={db.settings.logoUrl} alt={SITE_NAME} /></span>
              <span className="area-name">Registro modifiche</span>
            </Link>
            <Link href="/scegli" className="cambia-area">⇄ Cambia area</Link>
          </div>
        </div>
      </header>
      <div className="container">
        <h1 style={{ marginBottom: 4 }}>Registro modifiche</h1>
        <p className="subtitle">Chi ha cambiato cosa, con il valore di prima e quello di dopo{visibili.length < 4 ? `: ${visibili.map((a) => NOMI[a]).join(", ")}` : ""}. Le modifiche si registrano dal 13 ottobre 2026.</p>

        <form method="get" className="card rt-filtro" style={{ position: "static" }}>
          <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Cerca: prodotto, titolo, valore…" style={{ flex: "1 1 220px" }} />
          {visibili.length > 1 && (
            <select name="area" defaultValue={area}>
              <option value="">Tutte le aree</option>
              {visibili.map((a) => <option key={a} value={a}>{NOMI[a]}</option>)}
            </select>
          )}
          <select name="chi" defaultValue={chi}>
            <option value="">Tutte le persone</option>
            {persone.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
          </select>
          <select name="mese" defaultValue={mese}>
            <option value="">Ultimi due mesi</option>
            {mesi.map((m) => <option key={m} value={m}>{nomeMese(m)}</option>)}
          </select>
          <button className="btn btn-sm" type="submit">Filtra</button>
          <span className="hint" style={{ marginLeft: "auto" }}>{voci.length} {voci.length === 1 ? "modifica" : "modifiche"}{voci.length > MAX ? ` (le ultime ${MAX})` : ""}</span>
        </form>

        <div className="card table-wrap" style={{ padding: 0 }}>
          <table className="data rt-tab">
            <thead><tr><th>Quando</th><th>Chi</th><th>Area</th><th>Cosa</th><th>Su</th><th>Prima</th><th>Dopo</th></tr></thead>
            <tbody>
              {voci.length === 0 && <tr><td colSpan={7} className="empty">Nessuna modifica con questi filtri.</td></tr>}
              {voci.slice(0, MAX).map((v, i) => (
                <tr key={`${v.il}_${i}`}>
                  <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>{quando(v.il)}</td>
                  <td style={{ whiteSpace: "nowrap", fontSize: 12.5 }}><strong>{v.chiNome}</strong>{v.ambito && <span className="hint" style={{ display: "block", fontSize: 11 }}>{v.ambito}</span>}</td>
                  <td style={{ fontSize: 12 }}>{NOMI[v.area]}</td>
                  <td style={{ fontSize: 12.5 }}>{v.cosa}</td>
                  <td style={{ fontSize: 12.5, maxWidth: 260 }}>{v.oggetto}</td>
                  <td style={{ fontSize: 12, color: "var(--muted)", maxWidth: 260, whiteSpace: "pre-line" }}>{v.prima || "—"}</td>
                  <td style={{ fontSize: 12, maxWidth: 260, whiteSpace: "pre-line" }}>{v.dopo || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
