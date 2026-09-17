"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * Un modulo GET che si invia da solo quando si cambia una tendina o una
 * spunta: niente pulsante "Filtra" da premere dopo.
 *
 * Non riparte da zero: tiene i parametri che ci sono nell'indirizzo e che il
 * modulo non tocca — i cartelli selezionati con formati e prezzi, la scheda —
 * e sostituisce solo i suoi. Prima cambiare un filtro svuotava i selezionati.
 *
 * Un pulsante con `data-svuota="nome"` toglie tutte le spunte con quel nome.
 */
export default function FormAutoInvia({
  children, className, style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const invia = (form: HTMLFormElement) => {
    const url = new URL(window.location.href);
    const nomi = new Set(
      [...form.elements].map((el) => (el as HTMLInputElement).name).filter(Boolean)
    );
    for (const n of nomi) url.searchParams.delete(n);
    for (const [k, v] of new FormData(form)) {
      if (typeof v === "string" && v !== "") url.searchParams.append(k, v);
    }
    url.searchParams.delete("print");
    window.location.assign(url.toString());
  };

  return (
    <form
      method="get"
      className={className}
      style={style}
      onSubmit={(e) => { e.preventDefault(); invia(e.currentTarget); }}
      onChange={(e) => {
        const t = e.target as unknown as HTMLInputElement;
        if (t.tagName === "SELECT" || t.type === "checkbox" || t.type === "radio") invia(e.currentTarget);
      }}
      onClick={(e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>("[data-svuota]");
        if (!b) return;
        e.preventDefault();
        const nome = b.dataset.svuota;
        for (const el of e.currentTarget.querySelectorAll<HTMLInputElement>(`input[name="${nome}"]`)) el.checked = false;
        invia(e.currentTarget);
      }}
    >
      {children}
    </form>
  );
}
