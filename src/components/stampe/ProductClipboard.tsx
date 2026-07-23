"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { autosaveField } from "@/lib/stampe-actions";
import { readClipboard } from "./FieldEditor";

const CLIP_KEY = "stampe_clipboard";

/** Copia/incolla dell'intero prodotto tramite gli appunti locali. */
export default function ProductClipboard({
  productId,
  scopeParam,
  fields,
  canEdit,
}: {
  productId: string;
  scopeParam: string;
  fields: Record<string, string>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState("");

  const copy = () => {
    localStorage.setItem(CLIP_KEY, JSON.stringify({ type: "product", fields }));
    setMsg("✓ Prodotto copiato negli appunti");
    setTimeout(() => setMsg(""), 2000);
  };

  const paste = async () => {
    const clip = readClipboard();
    if (!clip || clip.type !== "product" || !clip.fields) {
      setMsg("Nessun prodotto negli appunti");
      setTimeout(() => setMsg(""), 2000);
      return;
    }
    setMsg("Incollo…");
    for (const [fieldId, value] of Object.entries(clip.fields)) {
      if (["foto", "logoAzienda", "logoInsegna", "codice"].includes(fieldId)) continue;
      await autosaveField(productId, fieldId, scopeParam, value);
    }
    setMsg("✓ Dati incollati");
    router.refresh();
    setTimeout(() => setMsg(""), 2000);
  };

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <button type="button" className="btn btn-outline btn-sm" onClick={copy} title="Copia tutti i campi del prodotto">
        ⧉ Copia prodotto
      </button>
      {canEdit && (
        <button type="button" className="btn btn-outline btn-sm" onClick={paste} title="Incolla i campi copiati su questo prodotto">
          📋 Incolla qui
        </button>
      )}
      {msg && <span style={{ fontSize: 12, color: "var(--green-700)", fontWeight: 700 }}>{msg}</span>}
    </span>
  );
}
