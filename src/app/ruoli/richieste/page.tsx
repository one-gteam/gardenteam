import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import RuoliHeader from "@/components/RuoliHeader";
import RichiesteRegistrazione from "@/components/RichiesteRegistrazione";
import { canManageUsers } from "@/lib/logic";
import { richiesteVisibili } from "@/lib/registrazioni-riepilogo";

/*
 * Utenti e ruoli → Richieste: chi ha chiesto un account GT One dalla pagina
 * /registrati. Le iscrizioni dei corsisti dell'Academy (/registrati/academy)
 * restano nel pannello Academy.
 */
export default async function RichiestePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const db = await getDb();
  if (!canManageUsers(db, user)) redirect("/scegli");
  const sp = await searchParams;
  const richieste = richiesteVisibili(db, user);
  return (
    <div>
      <RuoliHeader user={user} active="richieste" />
      <div className="container">
        <h1 style={{ marginBottom: 4 }}>Richieste di registrazione</h1>
        <p className="subtitle">Chi ha chiesto un account GT One dalla pagina di registrazione. Scegli reparto, ruolo e aree, poi approva o rifiuta.</p>
        {sp.errore === "ruolo" && <div className="alert alert-amber">Questo ruolo non lo puoi assegnare dal tuo profilo: scegline un altro.</div>}
        {sp.approvato && <div className="alert alert-green">✓ Richiesta approvata: la persona è stata creata e ha ricevuto l&apos;email di benvenuto.</div>}
        {sp.rifiutato && <div className="alert alert-amber">Richiesta rifiutata.</div>}
        {richieste.length > 0
          ? <RichiesteRegistrazione db={db} user={user} richieste={richieste}
              nota="All'approvazione la persona viene creata col ruolo e le aree scelti. Corsisti e capi reparto contano come neoassunti (percorsi di onboarding)." />
          : <div className="card"><p className="empty" style={{ margin: 0 }}>Nessuna richiesta in attesa.</p></div>}
      </div>
    </div>
  );
}
