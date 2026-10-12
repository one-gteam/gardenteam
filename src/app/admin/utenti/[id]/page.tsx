import { redirect } from "next/navigation";
import { requireAreaUser } from "@/lib/auth";
import { isAcademyAdmin } from "@/lib/types";
import DettaglioUtente from "@/components/DettaglioUtente";

/** Il dettaglio di un collaboratore visto dall'Academy (pannello Formazione). */
export default async function EditUserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ salvato?: string }> }) {
  const admin = await requireAreaUser("academy");
  if (!isAcademyAdmin(admin)) redirect("/studente");
  const { id } = await params;
  const { salvato } = await searchParams;
  return <DettaglioUtente admin={admin} id={id} salvato={salvato} area="academy" />;
}
