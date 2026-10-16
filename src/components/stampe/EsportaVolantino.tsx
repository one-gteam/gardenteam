"use client";

import { useState } from "react";
import { FileDown, Sheet, ImageDown, Link2 } from "lucide-react";
import { linkGraficoVolantino } from "@/lib/zoo-actions";

/**
 * Esportazioni del volantino per il grafico, in Bozza volantino: Excel, PDF
 * (stampa della bozza), ZIP (Excel + foto in alta risoluzione + PDF di
 * anteprima) e il link per il grafico, che scarica lo stesso ZIP senza login.
 * Il PDF si ricava dalle pagine della bozza così come le vedono i colleghi.
 */
export default function EsportaVolantino({
  campaignId, excelHref, fotoZipHref, selettorePagine, perGrafico = false, nomeFile = "bozza-volantino", chiaveLink,
}: {
  campaignId: string; excelHref: string; fotoZipHref: string;
  /** Le pagine da mettere nel PDF. */
  selettorePagine: string;
  /** Excel, ZIP e link per il grafico: solo chi cura il volantino (gli altri riceverebbero «non autorizzato»). */
  perGrafico?: boolean;
  nomeFile?: string;
  /** La chiave del link per il grafico, se c'è già. */
  chiaveLink?: string;
}) {
  const [pending, setPending] = useState<"" | "pdf" | "zip" | "link">("");
  const [errore, setErrore] = useState("");
  const [chiave, setChiave] = useState(chiaveLink ?? "");
  const [copiato, setCopiato] = useState(false);
  const [statoLink, setStatoLink] = useState("");

  /** Il PDF delle pagine della bozza, una per foglio A4, con le note per il grafico. */
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
      // le note per il grafico della pagina stanno fuori dalla pagina disegnata: si scrivono sotto
      const nota = pagine[i].closest(".vol-page-wrap")?.querySelector(".nota-grafico")?.textContent?.trim() ?? "";
      doc.setFontSize(9);
      const righe: string[] = nota ? doc.splitTextToSize(nota, W - 16) : [];
      const spazio = righe.length ? righe.length * 4 + 6 : 0;
      // una pagina più lunga dell'A4 (celle con tanto testo) si rimpicciolisce per starci, note comprese
      let w = W, h = (canvas.height * W) / canvas.width;
      if (h > H - spazio) { w = (W * (H - spazio)) / h; h = H - spazio; }
      doc.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", (W - w) / 2, 0, w, h);
      if (righe.length) {
        doc.setFillColor(255, 248, 225);
        doc.rect(6, h + 2, W - 12, righe.length * 4 + 3, "F");
        doc.setTextColor(122, 90, 0);
        doc.text(righe, 8, h + 5.5);
        doc.setTextColor(0, 0, 0);
      }
    }
    return doc;
  };

  /** Genera il PDF e lo mette nell'archivio: è quello che entra nello ZIP (anche da link). */
  const caricaPdf = async () => {
    const doc = await creaPdf();
    const firma = await fetch("/api/zoo-volantino/sign-pdf", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaignId }),
    });
    if (!firma.ok) throw new Error("firma non riuscita");
    const { signedUrl } = (await firma.json()) as { signedUrl: string };
    const put = await fetch(signedUrl, { method: "PUT", headers: { "content-type": "application/pdf" }, body: doc.output("blob") });
    if (!put.ok) throw new Error("caricamento non riuscito");
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
      await caricaPdf();
    } catch {
      setErrore("PDF non generato: lo ZIP conterrà solo Excel e foto.");
    } finally {
      setPending("");
      window.location.href = fotoZipHref;
    }
  };

  /**
   * Il link per il grafico: aggiorna il PDF dentro lo ZIP, crea il link se non
   * c'è (o lo rigenera) e lo copia negli appunti. Excel e foto del link sono
   * sempre aggiornati da soli; il PDF è quello dell'ultimo clic qui.
   */
  const link = async (rigenera = false) => {
    setPending("link");
    setStatoLink("");
    try {
      try { await caricaPdf(); } catch { setStatoLink("PDF non aggiornato: nel link resta quello di prima."); }
      let k = chiave;
      if (!k || rigenera) {
        const r = await linkGraficoVolantino(campaignId);
        if (!r.ok || !r.chiave) { setStatoLink(r.error ?? "Link non creato."); return; }
        k = r.chiave;
        setChiave(k);
      }
      const url = `${window.location.origin}/grafico/${k}`;
      try {
        await navigator.clipboard.writeText(url);
        setCopiato(true);
        setTimeout(() => setCopiato(false), 2500);
      } catch {
        window.prompt("Copia il link per il grafico:", url);
      }
    } finally {
      setPending("");
    }
  };
  const spegni = async () => {
    if (!confirm("Spegnere il link? Chi ce l'ha non potrà più scaricare lo ZIP.")) return;
    const r = await linkGraficoVolantino(campaignId, true);
    if (r.ok) { setChiave(""); setStatoLink("Link spento."); } else setStatoLink(r.error ?? "Non riuscito.");
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
      {perGrafico && (
        <button type="button" className="btn btn-outline btn-sm" disabled={!!pending} onClick={() => link(false)}
          title="Un indirizzo da mandare al grafico: scarica lo ZIP (Excel, PDF e foto) senza entrare in GT One. Excel e foto sono sempre aggiornati; il PDF si aggiorna a ogni clic qui">
          <Link2 size={14} style={{ verticalAlign: -2 }} /> {pending === "link" ? "Preparo il link…" : copiato ? "Link copiato ✓" : chiave ? "Copia link per il grafico" : "Link per il grafico"}
        </button>
      )}
      {perGrafico && chiave && (
        <span className="hint" style={{ fontSize: 11.5 }}>
          <code style={{ fontSize: 11 }}>/grafico/{chiave.slice(0, 6)}…</code>{" "}
          <button type="button" className="mini-btn" disabled={!!pending} onClick={() => { if (confirm("Rigenerare il link? Quello vecchio smette di funzionare.")) link(true); }}>rigenera</button>{" "}
          <button type="button" className="mini-btn" disabled={!!pending} onClick={spegni}>spegni</button>
        </span>
      )}
      {statoLink && <span className="hint">{statoLink}</span>}
      {errore && <span className="hint" style={{ color: "#a33" }}>{errore}</span>}
    </span>
  );
}
