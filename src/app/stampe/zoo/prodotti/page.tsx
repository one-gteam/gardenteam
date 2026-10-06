import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessArea } from "@/lib/stampe";
import OfferteInCorso from "@/components/stampe/pagine/OfferteInCorso";
import CatalogoProdotti from "@/components/stampe/pagine/CatalogoProdotti";

/*
 * Prodotti: una pagina sola per le offerte del volantino in lavorazione (la
 * vista principale) e per tutto il catalogo (l'ex Database prodotti). Le due
 * viste condividono testata e strumenti; `?vista=catalogo` apre la seconda.
 */
export default async function ZooProdottiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessArea(user, "zoo")) redirect("/studente");
  const sp = await searchParams;
  return sp.vista === "catalogo" ? <CatalogoProdotti user={user} sp={sp} /> : <OfferteInCorso user={user} sp={sp} />;
}
