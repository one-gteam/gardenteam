"use client";

import { useRef, useState } from "react";

/** La galleria della scheda: foto a scorrimento col dito, puntini, miniature e contatore. */
export default function Galleria({ foto, alt, novita }: { foto: string[]; alt: string; novita?: string }) {
  const rif = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0);
  const aggiorna = () => { const el = rif.current; if (el) setK(Math.round(el.scrollLeft / el.clientWidth)); };
  const vai = (n: number) => { const el = rif.current; if (el) el.scrollTo({ left: n * el.clientWidth, behavior: "smooth" }); };
  return (
    <section className="sp-galleria">
      <div className="sp-scorri" ref={rif} onScroll={() => window.requestAnimationFrame(aggiorna)}>
        {foto.map((u, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={u} src={u} alt={i === 0 ? alt : ""} loading={i === 0 ? "eager" : "lazy"} />
        ))}
      </div>
      {novita && <span className="sp-novita">{novita}</span>}
      {foto.length > 1 && (
        <>
          <span className="sp-conta">{k + 1} / {foto.length}</span>
          <div className="sp-punti">{foto.map((u, i) => <span key={u} className={i === k ? "on" : ""} />)}</div>
          <div className="sp-mini">
            {foto.map((u, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={u} src={u} alt="" className={i === k ? "on" : ""} onClick={() => vai(i)} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
