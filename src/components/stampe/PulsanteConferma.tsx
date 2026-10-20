"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * Pulsante di un modulo che manda a un'azione diversa da quella del modulo
 * (formAction), dopo una domanda di conferma. Serve ai comandi che cancellano.
 * «{n}» nella domanda diventa quante righe sono spuntate.
 */
export default function PulsanteConferma({ azione, conferma, children, className, style, title }: {
  azione: (fd: FormData) => void | Promise<void>; conferma: string; children: ReactNode; className?: string; style?: CSSProperties; title?: string;
}) {
  return (
    <button type="submit" className={className ?? "btn btn-outline btn-sm"} style={style} title={title} formAction={azione}
      onClick={(e) => {
        const quanti = e.currentTarget.form?.querySelectorAll('input[type="checkbox"][name="coda"]:checked').length ?? 0;
        if (!confirm(conferma.replace("{n}", quanti ? `${quanti} righe spuntate` : "tutte le righe"))) e.preventDefault();
      }}>
      {children}
    </button>
  );
}
