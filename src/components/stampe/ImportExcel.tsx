"use client";

import { useState, useTransition } from "react";

/**
 * Import di un Excel letto nel browser: al server arrivano solo le colonne che
 * servono, già in JSON.
 *
 * Serve perché su Vercel una richiesta non può superare i 4,5 MB, e il file di un
 * intero assortimento li supera: caricato com'era, finiva in "Application
 * error" senza una riga di spiegazione. Così il file resta sul PC e viaggiano
 * solo i dati utili, che pesano una frazione.
 */
export default function ImportExcel({
  action,
  colonne,
  etichetta,
}: {
  /** Azione server già legata all'ambito: riceve le righe in JSON e fa il redirect. */
  action: (righeJson: string) => Promise<void>;
  /** Intestazioni accettate (minuscolo): le altre colonne non partono nemmeno. */
  colonne: string[];
  etichetta: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [stato, setStato] = useState<string>("");
  const [pending, startTransition] = useTransition();

  const importa = async () => {
    if (!file) return;
    setStato("Leggo il file…");
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const foglio = wb.Sheets[wb.SheetNames[0]];
      if (!foglio) throw new Error("Il file non ha fogli.");
      const righe = XLSX.utils.sheet_to_json<Record<string, unknown>>(foglio, { defval: "" });
      const ammesse = new Set(colonne.map((c) => c.toLowerCase()));
      const snelle = righe.map((r) => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(r)) {
          if (ammesse.has(k.trim().toLowerCase())) out[k] = String(v ?? "").trim();
        }
        return out;
      }).filter((r) => Object.values(r).some(Boolean));
      if (snelle.length === 0) {
        setStato("Nessuna colonna riconosciuta: controlla le intestazioni del file.");
        return;
      }
      setStato(`${snelle.length} righe lette, invio…`);
      startTransition(() => action(JSON.stringify(snelle)));
    } catch (e) {
      setStato(`Non riesco a leggere il file: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button className="btn btn-sm" type="button" onClick={importa} disabled={!file || pending}>
        {pending ? "Importo…" : etichetta}
      </button>
      {stato && <span className="hint">{stato}</span>}
    </div>
  );
}
