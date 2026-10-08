"use client";

import { useState } from "react";
import { FileDown, Sheet, ImageDown } from "lucide-react";

/**
 * Esportazioni del volantino per il grafico, in Bozza volantino: Excel, PDF
 * (stampa della bozza) e ZIP (Excel + foto in alta risoluzione + PDF di
 * anteprima). Il PDF dello ZIP si ricava dalle pagine della bozza così come le
 * vedono i colleghi; prima si faceva da Crea Volantino.
 */
export default function EsportaVolantino({
  campaignId, excelHref, fotoZipHref, selettorePagine,
}: {
  campaignId: string; excelHref: string; fotoZipHref: string;
  /** Le pagine da mettere nel PDF dello ZIP. */
  selettorePagine: string;
}) {
  const [pending, setPending] = useState(false);
  const [errore, setErrore] = useState("");

  const zip = async () => {
    setPending(true);
    setErrore("");
    try {
      const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import("jspdf"), import("html2canvas")]);
      const pagine = Array.from(document.querySelectorAll<HTMLElement>(selettorePagine));
      if (pagine.length === 0) throw new Error("nessuna pagina");
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      for (let i = 0; i < pagine.length; i++) {
        const canvas = await html2canvas(pagine[i], {
          scale: 2, backgroundColor: "#ffffff", useCORS: true,
          onclone: (d: Document) => { d.querySelectorAll(".no-print").forEach((el) => el.remove()); },
        });
        if (i > 0) doc.addPage();
        const w = doc.internal.pageSize.getWidth();
        doc.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, w, (canvas.height * w) / canvas.width);
      }
      const firma = await fetch("/api/zoo-volantino/sign-pdf", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaignId }),
      });
      if (!firma.ok) throw new Error("firma non riuscita");
      const { signedUrl } = (await firma.json()) as { signedUrl: string };
      const put = await fetch(signedUrl, { method: "PUT", headers: { "content-type": "application/pdf" }, body: doc.output("blob") });
      if (!put.ok) throw new Error("caricamento non riuscito");
    } catch {
      setErrore("PDF non generato: lo ZIP conterrà solo Excel e foto.");
    } finally {
      setPending(false);
      window.location.href = fotoZipHref;
    }
  };

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <a className="btn btn-outline btn-sm" href={excelHref} title="Excel per il grafico"><Sheet size={14} style={{ verticalAlign: -2 }} /> Excel per il grafico</a>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => window.print()} title="Stampa o salva in PDF le pagine della bozza">
        <FileDown size={14} style={{ verticalAlign: -2 }} /> Esporta PDF
      </button>
      <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={zip}
        title="ZIP per il grafico: Excel + foto in alta risoluzione + PDF di anteprima">
        <ImageDown size={14} style={{ verticalAlign: -2 }} /> {pending ? "Genero il PDF…" : "ZIP per il grafico"}
      </button>
      {errore && <span className="hint" style={{ color: "#a33" }}>{errore}</span>}
    </span>
  );
}
