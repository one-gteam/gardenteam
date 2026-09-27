"use client";

import { useState } from "react";

/**
 * Condividi la scheda: sul cellulare apre il foglio di condivisione del
 * telefono (WhatsApp, mail…); dove non c'è, copia il link negli appunti.
 */
export default function Condividi({ titolo, testo }: { titolo: string; testo: string }) {
  const [esito, setEsito] = useState("");
  const condividi = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: titolo, text: testo, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setEsito("Link copiato");
    } catch {
      // il foglio chiuso senza scegliere non è un errore da mostrare
      if (!navigator.share) setEsito("Copia l'indirizzo dalla barra del browser");
    }
    setTimeout(() => setEsito(""), 2500);
  };
  return (
    <span className="scheda-condividi">
      <button type="button" className="scheda-btn" onClick={condividi}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
          <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
        </svg>
        Condividi
      </button>
      {esito && <span className="scheda-esito">{esito}</span>}
    </span>
  );
}
