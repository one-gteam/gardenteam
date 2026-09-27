import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import ArticoliHeader from "@/components/articoli/ArticoliHeader";
import ArticoloForm from "@/components/articoli/ArticoloForm";
import SceltaDestinatari from "@/components/articoli/SceltaDestinatari";
import { getArticoliDb, pubblicaArticoli, gestisceArticoli } from "@/lib/articoli";

export default async function NuovoArticoloPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [db, academy] = await Promise.all([getArticoliDb(), getDb()]);
  if (!pubblicaArticoli(user, db)) redirect("/articoli");
  return (
    <div>
      <ArticoliHeader user={user} active="nuovo" pubblica gestisce={gestisceArticoli(user, db)} />
      <div className="container" style={{ maxWidth: 900 }}>
        <h1>Nuovo articolo</h1>
        <p className="subtitle">
          Titolo, descrizione e allegati. {db.email.attiva && db.email.indirizzo && <>Oppure spedisci un&apos;email a <strong>{db.email.indirizzo}</strong>: l&apos;oggetto diventa il titolo, il corpo la descrizione, gli allegati restano allegati.</>}
        </p>
        <ArticoloForm categorie={db.categorie} gestore={gestisceArticoli(user, db)} modelli={db.modelli}
          destinatari={<SceltaDestinatari prefisso="dest" academy={academy} vuotoVuolDire="tutti quelli che hanno accesso agli articoli" conTutti={false} />} />
      </div>
    </div>
  );
}
