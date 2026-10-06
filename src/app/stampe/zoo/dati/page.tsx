import { redirect } from "next/navigation";

/** Il Database prodotti è la vista "catalogo" di Prodotti: i vecchi link arrivano lì. */
export default async function VecchiaDatiPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const params = new URLSearchParams({ vista: "catalogo" });
  for (const [k, v] of Object.entries(sp)) if (v && k !== "vista") params.set(k, v);
  redirect(`/stampe/zoo/prodotti?${params.toString()}`);
}
