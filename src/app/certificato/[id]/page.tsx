import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import Header from "@/components/Header";

export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;

  const db = await getDb();
  const cert = db.certificates.find((c) => c.id === id);
  if (!cert) notFound();

  const owner = db.users.find((u) => u.id === cert.userId);
  const course = db.courses.find((c) => c.id === cert.courseId);
  if (!owner || !course) notFound();

  // visibile al titolare e agli amministratori
  const isAdmin = user.role !== "student";
  if (cert.userId !== user.id && !isAdmin) redirect("/studente");

  const tenant = db.tenants.find((t) => t.id === owner.tenantId);
  const prog = db.progress.find((p) => p.userId === owner.id && p.courseId === course.id);

  return (
    <div>
      <Header user={user} active="studente" />
      <div className="container">
        <div className="no-print" style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "center" }}>
          <Link href="/studente">← Torna alla dashboard</Link>
        </div>
        <div className="certificate">
          <div style={{ fontSize: 40 }}>🌿</div>
          <div className="cert-title">Consorzio Garden Team · Academy GT</div>
          <div style={{ marginTop: 26, fontSize: 14, color: "var(--muted)" }}>Si certifica che</div>
          <div className="cert-name">
            {owner.firstName} {owner.lastName}
          </div>
          {tenant && (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              {tenant.emoji} {tenant.name}
            </div>
          )}
          <div style={{ marginTop: 18, fontSize: 14, color: "var(--muted)" }}>
            ha completato con successo il corso
          </div>
          <div className="cert-course">
            {course.emoji} {course.title}
          </div>
          {prog?.quizScore !== undefined && (
            <div className="pill pill-green">Valutazione finale: {prog.quizScore}%</div>
          )}
          <div className="cert-foot">
            <div>
              <strong>Data</strong>
              <br />
              {new Date(cert.issuedAt).toLocaleDateString("it-IT")}
            </div>
            <div>
              <strong>N° certificato</strong>
              <br />
              {cert.id.toUpperCase()}
            </div>
            <div>
              <strong>Il Direttore</strong>
              <br />
              Consorzio Garden Team
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
