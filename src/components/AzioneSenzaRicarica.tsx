"use client";

import { useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type Esito = { ok: boolean; error?: string };

/**
 * Un modulo "una tantum" (aggiungi reparto, aggiungi membro, nuovo punto
 * vendita) che invia, svuota i campi e ridisegna la pagina sul posto, senza
 * rimandare da capo. Con `conferma` chiede prima di procedere (le eliminazioni).
 */
export function ModuloInvio({
  azione, children, className, style, svuota = true, conferma,
}: {
  azione: (fd: FormData) => Promise<Esito>;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  svuota?: boolean;
  conferma?: string;
}) {
  const router = useRouter();
  const rif = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [errore, setErrore] = useState("");
  return (
    <form
      ref={rif}
      className={className}
      style={style}
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        if (conferma && !window.confirm(conferma)) return;
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          const r = await azione(fd).catch(() => ({ ok: false, error: "Non riuscito: riprova." }));
          setErrore(r.ok ? "" : r.error ?? "Non riuscito");
          if (r.ok) {
            if (svuota) rif.current?.reset();
            router.refresh();
          }
        });
      }}
    >
      {children}
      {errore && <span className="errore-inline">{errore}</span>}
    </form>
  );
}

/** Un pulsante che fa un'azione (con conferma, se serve) e ridisegna la pagina sul posto. */
export function PulsanteAzione({
  azione, children, className = "btn btn-outline btn-sm", style, conferma, title,
}: {
  azione: () => Promise<Esito>;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  conferma?: string;
  title?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errore, setErrore] = useState("");
  return (
    <>
      <button type="button" className={className} style={style} disabled={pending} title={title}
        onClick={() => {
          if (conferma && !window.confirm(conferma)) return;
          startTransition(async () => {
            const r = await azione().catch(() => ({ ok: false, error: "Non riuscito: riprova." }));
            setErrore(r.ok ? "" : r.error ?? "Non riuscito");
            if (r.ok) router.refresh();
          });
        }}>
        {pending ? "…" : children}
      </button>
      {errore && <span className="errore-inline">{errore}</span>}
    </>
  );
}
