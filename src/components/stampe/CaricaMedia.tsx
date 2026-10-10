"use client";

import { useRef, useState } from "react";

export interface MediaCaricato { url: string; tipo: "foto" | "video" }

/**
 * Carica foto e video direttamente su Supabase (URL firmato dal server), poi
 * avvisa chi lo usa con gli indirizzi pubblici. Usato dalla scheda prodotto e
 * dal totem: i video non passano dalle funzioni serverless.
 */
export default function CaricaMedia({
  scopeParam, cartella, accetta = "image/*", multiplo = true, etichetta = "Carica", onCaricati, disabilitato,
}: {
  scopeParam: string;
  cartella: string;
  accetta?: string;
  multiplo?: boolean;
  etichetta?: string;
  onCaricati: (media: MediaCaricato[]) => Promise<void> | void;
  disabilitato?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [stato, setStato] = useState("");

  const carica = async (files: File[]) => {
    if (files.length === 0) return;
    setStato(`Carico ${files.length} file…`);
    try {
      const res = await fetch("/api/arredo-media/sign", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: scopeParam, cartella, fileNames: files.map((f) => f.name) }),
      });
      if (!res.ok) throw new Error("Non autorizzato o server non raggiungibile.");
      const { urls } = (await res.json()) as { urls: { fileName: string; signedUrl: string | null; url: string | null; tipo: "foto" | "video" | null }[] };
      const fatti: MediaCaricato[] = [];
      let n = 0;
      for (const f of files) {
        const u = urls.find((x) => x.fileName === f.name);
        if (!u?.signedUrl || !u.url || !u.tipo) continue;
        const put = await fetch(u.signedUrl, { method: "PUT", headers: { "content-type": f.type || "application/octet-stream" }, body: f });
        if (put.ok) fatti.push({ url: u.url, tipo: u.tipo });
        n++; setStato(`Caricati ${n} di ${files.length}…`);
      }
      if (fatti.length === 0) throw new Error("Nessun file caricato: formato non ammesso?");
      await onCaricati(fatti);
      setStato(fatti.length === files.length ? "" : `${fatti.length} su ${files.length} caricati.`);
    } catch (e) {
      setStato(e instanceof Error ? e.message : "Caricamento non riuscito.");
    }
    if (ref.current) ref.current.value = "";
  };

  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input ref={ref} type="file" accept={accetta} multiple={multiplo} hidden onChange={(e) => carica(Array.from(e.target.files ?? []))} />
      <button type="button" className="btn btn-outline btn-sm" disabled={disabilitato} onClick={() => ref.current?.click()}>{etichetta}</button>
      {stato && <span className="hint">{stato}</span>}
    </span>
  );
}
