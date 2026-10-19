import ModuloRegistrazione from "@/components/ModuloRegistrazione";

/** Richiesta di un account GT One: si approva in Utenti e ruoli → Richieste. */
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ errore?: string; inviata?: string; minuti?: string }>;
}) {
  return <ModuloRegistrazione sp={await searchParams} />;
}
