"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Scheda aperta dal totem: il pulsante per tornare e, dopo un po' senza tocchi,
 * il ritorno da solo. Senza, il totem restava fermo per sempre sull'ultima
 * scheda aperta da un cliente.
 */
export default function TornaAlTotem({ href, secondi }: { href: string; secondi: number }) {
  const ultimo = useRef(Date.now());
  const [restano, setRestano] = useState(secondi);
  useEffect(() => {
    const tocco = () => { ultimo.current = Date.now(); };
    const eventi = ["pointerdown", "touchstart", "wheel", "scroll", "keydown"];
    for (const e of eventi) document.addEventListener(e, tocco, true);
    const i = setInterval(() => {
      const r = secondi - Math.floor((Date.now() - ultimo.current) / 1000);
      setRestano(r);
      if (r <= 0) location.href = href;
    }, 1000);
    return () => { clearInterval(i); for (const e of eventi) document.removeEventListener(e, tocco, true); };
  }, [href, secondi]);
  return (
    <a href={href} className="sp-torna-totem">← Torna al totem <span>{restano > 0 ? `fra ${restano} s` : ""}</span></a>
  );
}
