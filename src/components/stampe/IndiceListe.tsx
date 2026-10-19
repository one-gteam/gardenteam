"use client";

/**
 * La barra delle liste in cima alla scheda Liste di Stampa cartelli: resta
 * attaccata in alto mentre si scorre. Un clic su una lista la apre e ci porta
 * lì; «Apri tutte» / «Chiudi tutte» aprono o chiudono anche i gruppi per
 * formato (A4, A5…). Con tanti cartelli prima bisognava scendere per ritrovarle.
 */
export default function IndiceListe({ voci }: { voci: { id: string; label: string; n: number; classe: string }[] }) {
  const vai = (id: string) => {
    const el = document.getElementById(id) as HTMLDetailsElement | null;
    if (!el) return;
    el.open = true;
    const barra = document.querySelector(".indice-liste")?.getBoundingClientRect().height ?? 0;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - barra - 8, behavior: "smooth" });
  };
  const tutte = (aperte: boolean) => {
    document.querySelectorAll<HTMLDetailsElement>(".scheda-liste details.sezione").forEach((d) => { d.open = aperte; });
  };
  if (voci.length === 0) return null;
  return (
    <div className="indice-liste no-print">
      {voci.map((v) => (
        <button key={v.id} type="button" className="chip" onClick={() => vai(v.id)}>
          {v.label} <span className={`pill ${v.classe}`}>{v.n}</span>
        </button>
      ))}
      <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4 }}>
        <button type="button" className="mini-btn" onClick={() => tutte(true)}>Apri tutte</button>
        <button type="button" className="mini-btn" onClick={() => tutte(false)}>Chiudi tutte</button>
      </span>
    </div>
  );
}
