import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import RuoliHeader from "@/components/RuoliHeader";
import RipristinaVoce from "@/components/RipristinaVoce";
import { leggiRegistro, ultimiMesi, type AreaRegistro } from "@/lib/registro";

/*
 * Registro delle modifiche: chi ha cambiato offerte, titoli, descrizioni,
 * prodotti, corsi e utenti, con il valore di prima e quello di dopo. Solo
 * l'amministratore di sistema: vede tutto e può rimettere un valore com'era.
 */
const NOMI: Record<AreaRegistro, string> = { zoo: "Offerte Zoo", arredo: "Cartelli Arredo", academy: "Academy", utenti: "Utenti e ruoli", connettori: "Connettori" };

export default async function RegistroPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "system_admin") redirect("/scegli");
  const visibili = Object.keys(NOMI) as AreaRegistro[];
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
      <RuoliHeader user={user} active="registro" />
      <div className="container">
        <h1 style={{ marginBottom: 4 }}>Registro modifiche</h1>
        <p className="subtitle">Chi ha cambiato cosa, con il valore di prima e quello di dopo{visibili.length < 4 ? `: ${visibili.map((a) => NOMI[a]).join(", ")}` : ""}. Le modifiche si registrano dal 13 ottobre 2026; «Ripristina» c&apos;è per i campi cambiati dal 14 ottobre.</p>

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
            <thead><tr><th>Quando</th><th>Chi</th><th>Area</th><th>Cosa</th><th>Su</th><th>Prima</th><th>Dopo</th><th></th></tr></thead>
            <tbody>
              {voci.length === 0 && <tr><td colSpan={8} className="empty">Nessuna modifica con questi filtri.</td></tr>}
              {voci.slice(0, MAX).map((v, i) => (
                <tr key={`${v.il}_${i}`}>
                  <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>{quando(v.il)}</td>
                  <td style={{ whiteSpace: "nowrap", fontSize: 12.5 }}><strong>{v.chiNome}</strong>{v.ambito && <span className="hint" style={{ display: "block", fontSize: 11 }}>{v.ambito}</span>}</td>
                  <td style={{ fontSize: 12 }}>{NOMI[v.area]}</td>
                  <td style={{ fontSize: 12.5 }}>{v.cosa}</td>
                  <td style={{ fontSize: 12.5, maxWidth: 260 }}>{v.oggetto}</td>
                  <td style={{ fontSize: 12, color: "var(--muted)", maxWidth: 260, whiteSpace: "pre-line" }}>{v.prima || "—"}</td>
                  <td style={{ fontSize: 12, maxWidth: 260, whiteSpace: "pre-line" }}>{v.dopo || "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {v.ripristinataIl
                      ? <span className="pill pill-gray" title={`Ripristinata da ${v.ripristinataDa ?? ""} il ${quando(v.ripristinataIl)}`}>ripristinata</span>
                      : v.id && v.rif ? <RipristinaVoce id={v.id} il={v.il} prima={v.rif.tipo === "utente-attivo" ? (v.rif.prima ? "attivo" : "cessato") : (v.prima ?? "")} /> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
