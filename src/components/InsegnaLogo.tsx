import { Tenant } from "@/lib/types";

/** Logo dell'insegna (se caricato), altrimenti l'emoji. Da usare accanto ai punti vendita. */
export default function InsegnaLogo({ tenant, height = 18 }: { tenant?: Tenant; height?: number }) {
  if (!tenant) return <span>🏛️</span>;
  if (tenant.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={tenant.logoUrl}
        alt={tenant.name}
        title={tenant.name}
        style={{ height, maxWidth: height * 3.4, objectFit: "contain", verticalAlign: "middle", background: "#fff", borderRadius: 4, padding: "1px 3px", border: "1px solid var(--line)" }}
      />
    );
  }
  return <span title={tenant.name}>{tenant.emoji}</span>;
}
