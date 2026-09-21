"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type Esito = { ok: boolean; error?: string };

/**
 * Un modulo che si salva da solo, senza ricaricare la pagina: le tendine, le
 * spunte e i file partono subito, i testi un attimo dopo che si smette di
 * scrivere (o quando si esce dal campo). Accanto compare "Salvo…" e poi
 * "✓ Salvato", o l'errore. Prima ogni "Salva" rimandava alla pagina da capo.
 *
 * `azione` è un'azione server che riceve il modulo e risponde { ok, error }.
 */
export default function ModuloAutoSalva({
  azione, children, className, style, aggiorna = true,
}: {
  azione: (fd: FormData) => Promise<Esito>;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Ridisegna la pagina dopo il salvataggio (serve se altrove si legge il dato, es. il logo). */
  aggiorna?: boolean;
}) {
  const router = useRouter();
  const rif = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [stato, setStato] = useState<"" | "salvo" | "ok" | "errore">("");
  const [errore, setErrore] = useState("");
  const inCorso = useRef(false);
  const ancora = useRef(false);

  const salva = async () => {
    const form = rif.current;
    if (!form) return;
    // un salvataggio alla volta: se nel frattempo si è scritto ancora, si risalva alla fine
    if (inCorso.current) { ancora.current = true; return; }
    inCorso.current = true;
    setStato("salvo");
    let r: Esito;
    try {
      r = await azione(new FormData(form));
    } catch {
      r = { ok: false, error: "Non sono riuscito a salvare: controlla la connessione e riprova." };
    }
    inCorso.current = false;
    setStato(r.ok ? "ok" : "errore");
    setErrore(r.ok ? "" : r.error ?? "Non salvato");
    if (r.ok) {
      // i file appena caricati non vanno rimandati al salvataggio successivo
      for (const f of form.querySelectorAll<HTMLInputElement>('input[type="file"]')) f.value = "";
      if (aggiorna) router.refresh();
    }
    if (ancora.current) { ancora.current = false; void salva(); }
  };

  const piuTardi = (ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void salva(), ms);
  };

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <form
      ref={rif}
      className={className}
      style={style}
      onSubmit={(e) => { e.preventDefault(); piuTardi(0); }}
      onChange={(e) => {
        const t = e.target as unknown as HTMLInputElement;
        const subito = t.tagName === "SELECT" || ["checkbox", "radio", "file", "color"].includes(t.type);
        piuTardi(subito ? 0 : 900);
      }}
      onBlur={(e) => {
        const t = e.target as unknown as HTMLInputElement;
        if (t.tagName === "TEXTAREA" || t.tagName === "INPUT") {
          if (timer.current) piuTardi(0);
        }
      }}
    >
      {children}
      <div className="autosalva-stato" aria-live="polite">
        {stato === "salvo" && <span className="hint">Salvo…</span>}
        {stato === "ok" && <span className="salvato">✓ Salvato</span>}
        {stato === "errore" && <span className="errore">{errore}</span>}
        {stato === "" && <span className="hint">Le modifiche si salvano da sole.</span>}
      </div>
    </form>
  );
}
