"use client";

import { useRouter } from "next/navigation";
import CaricaMedia from "@/components/stampe/CaricaMedia";
import { salvaBannerCatalogo } from "@/lib/stampe-actions";

/** La foto del banner in testa al catalogo: si carica o si toglie. */
export default function BannerCatalogo({ scopeParam, url, canEdit }: { scopeParam: string; url?: string; canEdit: boolean }) {
  const router = useRouter();
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" style={{ width: 160, height: 70, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }} />
      ) : <span className="hint">nessuna foto: il banner esce solo se c'è un testo, su fondo verde scuro</span>}
      {canEdit && (
        <>
          <CaricaMedia scopeParam={scopeParam} cartella="catalogo" multiplo={false} etichetta={url ? "Cambia foto" : "＋ Foto del banner"}
            onCaricati={async (m) => { await salvaBannerCatalogo(scopeParam, m[0]?.url ?? null); router.refresh(); }} />
          {url && <button type="button" className="mini-btn" onClick={() => salvaBannerCatalogo(scopeParam, null).then(() => router.refresh())}>togli</button>}
        </>
      )}
    </div>
  );
}
