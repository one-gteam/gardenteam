import { redirect } from "next/navigation";

/** Offerte in corso vive dentro Prodotti: i vecchi link (e le azioni che tornano qui) arrivano lì. */
export default async function VecchiaOffertePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v) params.set(k, v);
  const qs = params.toString();
  redirect(`/stampe/zoo/prodotti${qs ? `?${qs}` : ""}`);
}
