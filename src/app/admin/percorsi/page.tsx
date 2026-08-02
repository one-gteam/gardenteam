import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import Header from "@/components/Header";
import PathsPanel from "@/components/PathsPanel";
import { scopeCourses } from "@/lib/logic";

export default async function AdminPathsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "student" || user.role === "dept_head") redirect("/studente");

  const db = await getDb();
  const canSystem = user.role === "system_admin" || user.role === "course_manager";

  // percorsi visibili nell'ambito dell'amministratore
  const paths = db.paths.filter((p) => canSystem || (user.role === "group_admin" && p.tenantId === user.tenantId));
  const courses = scopeCourses(db, user).map((c) => ({
    id: c.id, title: c.title, emoji: c.emoji, level: c.level, tenantId: c.tenantId,
  }));
  const departments = db.departments
    .filter((d) => canSystem || (!d.tenantId && !d.storeId) || d.tenantId === user.tenantId || d.storeId === user.storeId)
    .map((d) => ({ id: d.id, name: d.name }));

  return (
    <div>
      <Header user={user} active="percorsi" />
      <div className="container" style={{ maxWidth: 920 }}>
        <h1>🧭 Percorsi formativi</h1>
        <p className="subtitle">
          Sequenze ordinate di corsi assegnate automaticamente in base al profilo del collaboratore.
          Lo studente le vede nella sua area con la barra di avanzamento.
        </p>

        {courses.length === 0 ? (
          <div className="alert alert-amber">Non ci sono ancora corsi da inserire in un percorso. Creane prima qualcuno nel Catalogo corsi.</div>
        ) : (
          <PathsPanel
            paths={paths}
            courses={courses}
            tenants={db.tenants.map((t) => ({ id: t.id, name: t.name, emoji: t.emoji }))}
            departments={departments}
            canSystem={canSystem}
            fixedTenantId={user.role === "group_admin" ? user.tenantId : undefined}
          />
        )}
      </div>
    </div>
  );
}
