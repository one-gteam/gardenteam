import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, HardDrive } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import ArchivioPanel from "@/components/ArchivioPanel";
import { analizzaArchivio, cartelleGestibili, puoVedereArchivio, CARTELLE } from "@/lib/storage-audit";
import { ROLE_LABELS } from "@/lib/types";
import { logout } from "@/lib/actions";

/**
 * Archivio file: cosa occupa lo spazio di archiviazione e cosa non serve più.
 * Riservata ad amministratore di sistema, gestori dei contenuti e amministratore
 * di insegna; ognuno può ripulire solo le cartelle di propria competenza.
 */
export default async function ArchivioPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!puoVedereArchivio(user)) redirect("/scegli");

  const db = await getDb();
  const files = await analizzaArchivio();
  const gestibili = cartelleGestibili(user);

  return (
    <div>
      <header className="site-header">
        <div className="site-header-inner">
          <div className="header-top">
            <Link href="/scegli" className="brand">
              <span className="brand-logo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={db.settings.logoUrl} alt="Garden Team" />
              </span>
              <span className="area-name" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <HardDrive size={16} /> Archivio file
              </span>
            </Link>
            <Link href="/scegli" style={{ color: "#e8f3ea", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 5 }}>
              <ArrowLeft size={14} /> Cambia area
            </Link>
            <div className="user-chip">
              <div className="avatar">{user.firstName[0]}{user.lastName[0]}</div>
              <div>
                <div style={{ fontWeight: 700 }}>{user.firstName} {user.lastName}</div>
                <div style={{ opacity: 0.75, fontSize: 11 }}>{ROLE_LABELS[user.role]}</div>
              </div>
              <form action={logout}>
                <button className="logout-btn" type="submit">Esci</button>
              </form>
            </div>
          </div>
        </div>
      </header>

      <div className="container" style={{ maxWidth: 1180 }}>
        <h1>Archivio file</h1>
        <p className="subtitle">
          Tutto ciò che è stato caricato sul portale: immagini dei corsi, materiali delle lezioni, foto dei prodotti,
          sfondi dei cartelli, pacchetti SCORM e immagini del volantino. Qui si vede cosa occupa spazio e si eliminano
          i file che nessuna pagina usa più.
        </p>

        <div className="card" style={{ background: "var(--green-50)", marginBottom: 18 }}>
          <h3 style={{ marginTop: 0 }}>Come si stabilisce che un file non serve più</h3>
          <ul style={{ fontSize: 13.5, color: "var(--muted)", margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
            <li>
              Un file risulta <strong>in uso</strong> se compare in un punto qualsiasi dei dati del portale (corsi,
              cartelli, offerte, volantini). Il controllo è sul contenuto completo, non su un elenco di campi: nel
              dubbio il file viene considerato in uso e non è eliminabile.
            </li>
            <li>
              I file caricati <strong>nelle ultime 24 ore</strong> sono protetti: potrebbero appartenere a un lavoro
              ancora aperto da qualcun altro.
            </li>
            <li>
              Ogni ruolo ripulisce solo le proprie cartelle. Le tue:{" "}
              <strong>{gestibili.length > 0 ? CARTELLE.filter((c) => gestibili.includes(c.id)).map((c) => c.label).join(", ") : "nessuna"}</strong>.
            </li>
            <li>L&apos;eliminazione è definitiva: i file cancellati non si recuperano.</li>
          </ul>
        </div>

        <ArchivioPanel files={files} cartelle={CARTELLE} gestibili={gestibili} />
      </div>
    </div>
  );
}
