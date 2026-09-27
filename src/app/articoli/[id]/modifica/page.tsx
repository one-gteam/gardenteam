import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import ArticoliHeader from "@/components/articoli/ArticoliHeader";
import ArticoloForm from "@/components/articoli/ArticoloForm";
import SceltaDestinatari from "@/components/articoli/SceltaDestinatari";
import { getArticoliDb, pubblicaArticoli, gestisceArticoli, modificaArticolo, programmato, isoInOraRoma } from "@/lib/articoli";

export default async function ModificaArticoloPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const [db, academy] = await Promise.all([getArticoliDb(), getDb()]);
  const a = db.articoli.find((x) => x.id === id);
  if (!a) notFound();
  if (!modificaArticolo(user, a, db)) redirect(`/articoli/${id}`);
  return (
    <div>
      <ArticoliHeader user={user} active="articoli" pubblica={pubblicaArticoli(user, db)} gestisce={gestisceArticoli(user, db)} />
      <div className="container" style={{ maxWidth: 900 }}>
        <div style={{ marginBottom: 8 }}><a href={`/articoli/${id}`}>← Torna all&apos;articolo</a></div>
        <h1>Modifica articolo</h1>
        {a.origine === "email" && a.stato === "bozza" && (
          <div className="alert alert-amber">Arrivato per email da {a.mittenteEmail}: controlla titolo e testo, scegli chi lo vede, poi Pubblica.</div>
        )}
        <ArticoloForm articolo={a} categorie={db.categorie} gestore={gestisceArticoli(user, db)} modelli={db.modelli}
          programmato={programmato(a)} esceIl={programmato(a) ? isoInOraRoma(a.pubblicato) : ""}
          destinatari={<SceltaDestinatari prefisso="dest" academy={academy} valore={a.destinatari} vuotoVuolDire="tutti quelli che hanno accesso agli articoli" conTutti={false} />} />
      </div>
    </div>
  );
}
