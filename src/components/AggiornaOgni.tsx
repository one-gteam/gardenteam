"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Ridisegna la pagina ogni tot secondi finché è montato: per seguire un lavoro in background. */
export default function AggiornaOgni({ secondi = 6 }: { secondi?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), secondi * 1000);
    return () => clearInterval(t);
  }, [router, secondi]);
  return null;
}
