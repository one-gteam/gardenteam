"use client";

/**
 * Le schede in cima a Stampa cartelli: Stampa, Liste, Regole. Sono link alla
 * stessa pagina con `tab=…`, e si portano dietro i parametri che ci sono in
 * quel momento nell'indirizzo — anche la selezione, che il riquadro dei
 * selezionati aggiorna nell'indirizzo senza passare dal server.
 */
export interface Scheda {
  id: string;
  label: string;
  /** contatori da mostrare accanto al nome, solo quelli maggiori di zero */
  pillole?: { n: number; label: string; classe: string }[];
}

export default function SchedeStampa({ attiva, schede }: { attiva: string; schede: Scheda[] }) {
  const vai = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const url = new URL(window.location.href);
    if (id === "stampa") url.searchParams.delete("tab"); else url.searchParams.set("tab", id);
    window.location.assign(url.toString());
  };
  return (
    <nav className="schede">
      {schede.map((s) => (
        <a key={s.id} href={`?tab=${s.id}`} className={s.id === attiva ? "attiva" : ""} onClick={(e) => vai(e, s.id)}>
          {s.label}
          {(s.pillole ?? []).filter((p) => p.n > 0).map((p) => (
            <span key={p.label} className={`pill ${p.classe}`} title={p.label}>{p.n} {p.label}</span>
          ))}
        </a>
      ))}
    </nav>
  );
}
