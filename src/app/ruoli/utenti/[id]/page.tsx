import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { livelloGestioneUtenti } from "@/lib/logic";
import DettaglioUtente from "@/components/DettaglioUtente";

/** Il dettaglio di una persona dentro Utenti e ruoli: stessa scheda, stessa area da cui si è arrivati. */
export default async function RuoliUtentePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ salvato?: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) redirect("/login");
  const db = await getDb();
  if (!livelloGestioneUtenti(db, admin)) redirect("/scegli");
  const { id } = await params;
  const { salvato } = await searchParams;
  return <DettaglioUtente admin={admin} id={id} salvato={salvato} area="ruoli" />;
}
