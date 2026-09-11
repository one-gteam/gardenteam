import type { ReactNode } from "react";

/**
 * I filtri di una pagina elenco: da computer restano il modulo di sempre, da
 * cellulare si chiudono dietro una riga che dice cosa è selezionato, altrimenti
 * cinque campi in colonna spingono l'elenco fuori dallo schermo.
 *
 * Niente JavaScript: apre e chiude una casella nascosta, così la pagina resta
 * quella del server e non c'è lo sfarfallio dell'apertura dopo il caricamento.
 * L'id deve essere diverso per ogni modulo nella stessa pagina.
 */
export default function FiltriMobile({
  id, scelte, children,
}: {
  id: string;
  /** le voci scelte, in chiaro: si leggono a menu chiuso */
  scelte: (string | false | undefined)[];
  children: ReactNode;
}) {
  const testo = scelte.filter(Boolean).join(" · ") || "nessun filtro";
  return (
    <div className="filtri-pieghevole">
      <input type="checkbox" id={id} className="filtri-interruttore" hidden />
      <label htmlFor={id} className="filtri-etichetta">
        <strong>Filtri</strong>
        <span className="filtri-scelte">{testo}</span>
      </label>
      <div className="filtri-corpo">{children}</div>
    </div>
  );
}
