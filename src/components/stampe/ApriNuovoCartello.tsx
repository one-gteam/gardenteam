"use client";

import { EVENTO_NUOVO_CARTELLO } from "./StampaWorkspace";

/** Il pulsante "Nuovo cartello" in alto a destra: apre il pannello che vive nel riquadro di stampa. */
export default function ApriNuovoCartello() {
  return (
    <button type="button" className="btn nuovo-cartello-btn"
      title="Un cartello fuori dal volantino, fatto da zero: 3x2, promozioni vostre, articoli non in catalogo"
      onClick={() => window.dispatchEvent(new Event(EVENTO_NUOVO_CARTELLO))}>
      ＋ Nuovo cartello
    </button>
  );
}
