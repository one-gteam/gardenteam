"use client";

import { useEffect, useRef, useState } from "react";
import { trackScorm } from "@/lib/actions";
import { ScormPackage } from "@/lib/types";

/* Il pacchetto SCORM gira isolato (vedi /api/scorm): l'API dell'LMS la
   definisce uno script iniettato nel pacchetto stesso, che a ogni Commit/Terminate
   manda qui con postMessage il modello dati CMI. Il player legge stato e
   punteggio e li registra sul server. Accetta solo i messaggi del suo canale. */


function num(v: string | undefined): number | null {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function ScormPlayer({
  courseId,
  lessonId,
  pkg,
  gettone,
  canale,
  initialStatus,
}: {
  courseId: string;
  lessonId: string;
  pkg: ScormPackage;
  /** Accesso firmato ai file del pacchetto (lib/scorm-accesso). */
  gettone: string;
  /** Identifica i messaggi di QUESTO pacchetto aperto. */
  canale: string;
  initialStatus?: string;
}) {
  const [done, setDone] = useState(
    initialStatus === "completed" || initialStatus === "passed"
  );
  const [statusLabel, setStatusLabel] = useState(initialStatus ?? "");
  const lastSent = useRef("");

  // stato e punteggio dal modello dati CMI che il pacchetto ci manda
  useEffect(() => {
    const report = (data: Record<string, string>) => {
      let status = "";
      let scorePercent: number | undefined;
      if (pkg.version === "1.2") {
        status = data["cmi.core.lesson_status"] ?? "";
        const raw = num(data["cmi.core.score.raw"]);
        const max = num(data["cmi.core.score.max"]) ?? 100;
        if (raw !== null && max) scorePercent = (raw / max) * 100;
      } else {
        const success = data["cmi.success_status"] ?? "";
        const completion = data["cmi.completion_status"] ?? "";
        status = success === "passed" || success === "failed" ? success : completion;
        const scaled = num(data["cmi.score.scaled"]);
        if (scaled !== null) scorePercent = scaled * 100;
        else {
          const raw = num(data["cmi.score.raw"]);
          const max = num(data["cmi.score.max"]) ?? 100;
          if (raw !== null && max) scorePercent = (raw / max) * 100;
        }
      }
      const sig = `${status}|${scorePercent ?? ""}`;
      if (sig === lastSent.current) return; // niente di nuovo
      lastSent.current = sig;
      trackScorm(courseId, lessonId, {
        status,
        scorePercent: scorePercent === undefined ? undefined : Math.round(scorePercent),
      }).then((res) => {
        if (res.ok) {
          setStatusLabel(status);
          if (status === "completed" || status === "passed") setDone(true);
          if (res.justCompleted) window.dispatchEvent(new CustomEvent("lesson-completed"));
        }
      });
    };
    const onMessage = (e: MessageEvent) => {
      const m = e.data as { scormGtOne?: string; dati?: Record<string, unknown> } | null;
      if (!m || m.scormGtOne !== canale || !m.dati || typeof m.dati !== "object") return;
      const dati: Record<string, string> = {};
      for (const [k, v] of Object.entries(m.dati)) if (typeof k === "string") dati[k] = String(v ?? "");
      report(dati);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [canale, courseId, lessonId, pkg.version]);

  const entry = pkg.entry.split("?")[0].split("/").map(encodeURIComponent).join("/");
  const src = `/api/scorm/${encodeURIComponent(gettone)}/${entry}${pkg.entry.includes("?") ? "?" + pkg.entry.split("?")[1] : ""}`;

  const STATUS_LABEL: Record<string, string> = {
    completed: "✓ completato", passed: "✓ superato", failed: "✗ non superato",
    incomplete: "in corso", browsed: "consultato", "not attempted": "non iniziato", unknown: "in corso",
  };

  return (
    <div>
      {(
        <iframe
          className="scorm-frame"
          src={src}
          title="Contenuto SCORM"
          sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock"
          allow="autoplay; fullscreen"
        />
      )}
      <div className="watch-bar" style={{ marginTop: 8 }}>
        <span className={`pill ${done ? "pill-green" : "pill-gray"}`}>
          {done ? "✓ Lezione completata dal contenuto" : `Stato: ${STATUS_LABEL[statusLabel] || "in corso"}`}
        </span>
        <span className="watch-label">
          Il completamento è deciso dal contenuto SCORM: prosegui fino alla fine per registrarlo.
        </span>
      </div>
    </div>
  );
}
