import ModuloRegistrazione from "@/components/ModuloRegistrazione";

/**
 * Iscrizione come corsista dell'Academy: stesso modulo, ma la richiesta si
 * approva nel pannello Academy (Collaboratori) e non in Utenti e ruoli.
 * La pagina c'è ma non è ancora pubblicizzata: l'Academy non è attiva.
 */
export default async function IscrizioneAcademyPage({
  searchParams,
}: {
  searchParams: Promise<{ errore?: string; inviata?: string; minuti?: string }>;
}) {
  return <ModuloRegistrazione sp={await searchParams} academy />;
}
