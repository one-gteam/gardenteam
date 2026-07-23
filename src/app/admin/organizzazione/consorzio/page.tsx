import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import Header from "@/components/Header";
import { updateSettings } from "@/lib/actions";
import { FONT_OPTIONS } from "@/lib/types";

export default async function ConsorzioPage({
  searchParams,
}: {
  searchParams: Promise<{ salvato?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "system_admin") redirect("/admin");
  const { salvato } = await searchParams;

  const db = await getDb();
  const s = db.settings;

  return (
    <div>
      <Header user={user} active="organizzazione" />
      <div className="container" style={{ maxWidth: 780 }}>
        <div style={{ marginBottom: 8 }}>
          <Link href="/admin/organizzazione">← Torna all&apos;organizzazione</Link>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={s.logoUrl} alt={s.portalName} style={{ height: 48, maxWidth: 170, objectFit: "contain", background: "#fff", borderRadius: 10, padding: "4px 10px", border: "1px solid var(--line)" }} />
          <h1 style={{ margin: 0 }}>Scheda Consorzio</h1>
        </div>
        <p className="subtitle" style={{ marginTop: 6 }}>
          Il branding globale del portale: vale per tutte le insegne, dove non personalizzato.
        </p>

        {salvato && <div className="alert alert-green">✓ Impostazioni salvate e applicate a tutto il portale.</div>}

        <div className="card">
          <h2>Identità del portale</h2>
          <form action={updateSettings}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label className="field">
                Nome del portale
                <input type="text" name="portalName" defaultValue={s.portalName} required />
              </label>
              <label className="field">
                Logo del consorzio (PNG/JPG/SVG)
                <input type="file" name="logo" accept="image/*" style={{ marginTop: 4 }} />
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, alignItems: "end" }}>
              <label className="field">
                Colore principale (header, pulsanti)
                <input type="color" name="colorPrimary" defaultValue={s.colorPrimary} style={{ width: "100%", height: 40, padding: 2, border: "1.5px solid var(--line)", borderRadius: 9 }} />
              </label>
              <label className="field">
                Colore accento (barre, evidenze)
                <input type="color" name="colorAccent" defaultValue={s.colorAccent} style={{ width: "100%", height: 40, padding: 2, border: "1.5px solid var(--line)", borderRadius: 9 }} />
              </label>
              <label className="checkbox-row" style={{ marginBottom: 14 }}>
                <input type="checkbox" name="resetColors" /> Ripristina i verdi Garden Team
              </label>
            </div>
            <label className="field" style={{ maxWidth: 420 }}>
              Font del portale
              <select name="font" defaultValue={s.font ?? "system"}>
                {FONT_OPTIONS.map((f) => (
                  <option key={f.id} value={f.id}>{f.label} — {f.desc}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Messaggio del consorzio per tutti gli studenti
              <textarea name="welcome" rows={2} defaultValue={s.welcome ?? ""} placeholder="Compare in evidenza nella home di ogni studente, di qualsiasi insegna" />
            </label>
            <label className="field" style={{ maxWidth: 340 }}>
              Email di supporto del consorzio
              <input type="email" name="supportEmail" defaultValue={s.supportEmail ?? ""} placeholder="es. academy@gardenteam.biz" />
            </label>
            <button className="btn" type="submit">💾 Salva impostazioni portale</button>
          </form>
        </div>

        <div className="section">
          <div className="card" style={{ background: "var(--green-50)" }}>
            <h3 style={{ marginTop: 0 }}>Come si applicano</h3>
            <ul style={{ fontSize: 13.5, color: "var(--muted)", margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
              <li><strong>Nome e logo</strong> compaiono nell&apos;header, nel login e nelle pagine di registrazione/attivazione.</li>
              <li><strong>I colori</strong> ridisegnano l&apos;intero portale (header, pulsanti, barre, grafici) per tutte le insegne.</li>
              <li><strong>Il messaggio</strong> è la voce del consorzio: appare a tutti gli studenti sopra i messaggi di insegna e punto vendita.</li>
              <li>L&apos;email di supporto viene mostrata nel piè di pagina dell&apos;area studente.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
