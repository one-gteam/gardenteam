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
  campaignId, excelHref, fotoZipHref, selettorePagine, perGrafico = false, nomeFile = "bozza-volantino",
}: {
  campaignId: string; excelHref: string; fotoZipHref: string;
  /** Le pagine da mettere nel PDF. */
  selettorePagine: string;
  /** Excel e ZIP per il grafico: solo chi cura il volantino (gli altri riceverebbero «non autorizzato»). */
  perGrafico?: boolean;
  nomeFile?: string;
}) {
  const [pending, setPending] = useState<"" | "pdf" | "zip">("");
  const [errore, setErrore] = useState("");

  /** Il PDF delle pagine della bozza, una per foglio A4 (le note restano fuori). */
  const creaPdf = async () => {
    // html2canvas-pro: la 1.4 si fermava sui colori color-mix() del portale (i verdi), e il PDF non usciva
    const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import("jspdf"), import("html2canvas-pro")]);
    const pagine = Array.from(document.querySelectorAll<HTMLElement>(selettorePagine));
    if (pagine.length === 0) throw new Error("nessuna pagina");
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    for (let i = 0; i < pagine.length; i++) {
      const canvas = await html2canvas(pagine[i], {
        scale: 2, backgroundColor: "#ffffff", useCORS: true,
        onclone: (d: Document) => { d.querySelectorAll(".no-print").forEach((el) => el.remove()); },
      });
      if (i > 0) doc.addPage();
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      // una pagina più lunga dell'A4 (celle con tanto testo) si rimpicciolisce per starci
      let w = W, h = (canvas.height * W) / canvas.width;
      if (h > H) { w = (W * H) / h; h = H; }
      doc.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", (W - w) / 2, 0, w, h);
    }
    return doc;
  };

  const pdf = async () => {
    setPending("pdf");
    setErrore("");
    try {
      const doc = await creaPdf();
      doc.save(`${nomeFile}.pdf`);
    } catch (e) {
      console.error("PDF della bozza", e);
      const motivo = e instanceof Error ? e.message : String(e);
      setErrore(motivo === "nessuna pagina"
        ? "PDF non generato: apri la vista «Pagine» e riprova."
        : `PDF non generato (${motivo.slice(0, 140)}). Riprova; se si ripete, manda questo messaggio.`);
    } finally {
      setPending("");
    }
  };

  const zip = async () => {
    setPending("zip");
    setErrore("");
    try {
      const doc = await creaPdf();
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
      setPending("");
      window.location.href = fotoZipHref;
    }
  };

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      {perGrafico && <a className="btn btn-outline btn-sm" href={excelHref} title="Excel per il grafico"><Sheet size={14} style={{ verticalAlign: -2 }} /> Excel per il grafico</a>}
      <button type="button" className="btn btn-outline btn-sm" disabled={!!pending} onClick={pdf} title="Scarica il PDF delle pagine della bozza">
        <FileDown size={14} style={{ verticalAlign: -2 }} /> {pending === "pdf" ? "Genero il PDF…" : "Esporta PDF"}
      </button>
      {perGrafico && (
        <button type="button" className="btn btn-outline btn-sm" disabled={!!pending} onClick={zip}
          title="ZIP per il grafico: Excel + foto in alta risoluzione + PDF di anteprima">
          <ImageDown size={14} style={{ verticalAlign: -2 }} /> {pending === "zip" ? "Genero il PDF…" : "ZIP per il grafico"}
        </button>
      )}
      {errore && <span className="hint" style={{ color: "#a33" }}>{errore}</span>}
    </span>
  );
}
