"use client";

import { useEffect, useRef, useState } from "react";
import { trackScorm } from "@/lib/actions";
import { ScormPackage } from "@/lib/types";

/* Il player espone alla pagina SCORM l'API dell'LMS che il contenuto cerca su
   window.parent: API (SCORM 1.2) e API_1484_11 (SCORM 2004). Tiene un modello
   dati CMI in memoria e, a ogni Commit/Terminate, riporta stato e punteggio al
   server. Funziona perché i file sono serviti sullo stesso origine (/api/scorm). */

interface ScormApi {
  data: Map<string, string>;
  report: () => void;
}

function num(v: string | undefined): number | null {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

declare global {
  interface Window {
    API?: unknown; // SCORM 1.2
    API_1484_11?: unknown; // SCORM 2004
  }
}

export default function ScormPlayer({
  courseId,
  lessonId,
  pkg,
  learnerName,
  initialStatus,
}: {
  courseId: string;
  lessonId: string;
  pkg: ScormPackage;
  learnerName: string;
  initialStatus?: string;
}) {
  const [done, setDone] = useState(
    initialStatus === "completed" || initialStatus === "passed"
  );
  const [statusLabel, setStatusLabel] = useState(initialStatus ?? "");
  const apiRef = useRef<ScormApi | null>(null);
  const [ready, setReady] = useState(false);

  // Installa l'API PRIMA che l'iframe venga montato (initializer di useState).
  useState(() => {
    if (typeof window === "undefined") return null;

    const data = new Map<string, string>();
    // valori di default richiesti da molti contenuti
    if (pkg.version === "1.2") {
      data.set("cmi.core.student_name", learnerName);
      data.set("cmi.core.lesson_status", "not attempted");
      data.set("cmi.core.lesson_mode", "normal");
      data.set("cmi.core.credit", "credit");
      data.set("cmi.core.entry", "ab-initio");
      data.set("cmi.core.score.min", "0");
      data.set("cmi.core.score.max", "100");
    } else {
      data.set("cmi.learner_name", learnerName);
      data.set("cmi.completion_status", "unknown");
      data.set("cmi.success_status", "unknown");
      data.set("cmi.mode", "normal");
      data.set("cmi.credit", "credit");
      data.set("cmi.entry", "ab-initio");
    }

    let lastSent = "";
    const report = () => {
      let status = "";
      let scorePercent: number | undefined;
      if (pkg.version === "1.2") {
        status = data.get("cmi.core.lesson_status") ?? "";
        const raw = num(data.get("cmi.core.score.raw"));
        const max = num(data.get("cmi.core.score.max")) ?? 100;
        if (raw !== null && max) scorePercent = (raw / max) * 100;
      } else {
        const success = data.get("cmi.success_status") ?? "";
        const completion = data.get("cmi.completion_status") ?? "";
        status = success === "passed" || success === "failed" ? success : completion;
        const scaled = num(data.get("cmi.score.scaled"));
        if (scaled !== null) scorePercent = scaled * 100;
        else {
          const raw = num(data.get("cmi.score.raw"));
          const max = num(data.get("cmi.score.max")) ?? 100;
          if (raw !== null && max) scorePercent = (raw / max) * 100;
        }
      }
      const sig = `${status}|${scorePercent ?? ""}`;
      if (sig === lastSent) return; // niente di nuovo
      lastSent = sig;
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
    apiRef.current = { data, report };

    const get = (k: string) => data.get(k) ?? "";
    const set = (k: string, v: string) => { data.set(k, String(v)); return "true"; };

    // SCORM 1.2
    window.API = {
      LMSInitialize: () => "true",
      LMSFinish: () => { report(); return "true"; },
      LMSGetValue: (k: string) => get(k),
      LMSSetValue: (k: string, v: string) => set(k, v),
      LMSCommit: () => { report(); return "true"; },
      LMSGetLastError: () => "0",
      LMSGetErrorString: () => "No error",
      LMSGetDiagnostic: () => "",
    };
    // SCORM 2004
    window.API_1484_11 = {
      Initialize: () => "true",
      Terminate: () => { report(); return "true"; },
      GetValue: (k: string) => get(k),
      SetValue: (k: string, v: string) => set(k, v),
      Commit: () => { report(); return "true"; },
      GetLastError: () => "0",
      GetErrorString: () => "No error",
      GetDiagnostic: () => "",
    };
    return true;
  });

  useEffect(() => setReady(true), []);

  // salva anche se lo studente chiude la scheda mentre il contenuto è aperto
  useEffect(() => {
    const onHide = () => apiRef.current?.report();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      apiRef.current?.report();
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);

  const src = `/api/scorm/${pkg.path}/${pkg.entry.split("?")[0].split("/").map(encodeURIComponent).join("/")}${pkg.entry.includes("?") ? "?" + pkg.entry.split("?")[1] : ""}`;

  const STATUS_LABEL: Record<string, string> = {
    completed: "✓ completato", passed: "✓ superato", failed: "✗ non superato",
    incomplete: "in corso", browsed: "consultato", "not attempted": "non iniziato", unknown: "in corso",
  };

  return (
    <div>
      {ready && (
        <iframe
          className="scorm-frame"
          src={src}
          title="Contenuto SCORM"
          allow="autoplay; fullscreen; microphone; camera"
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
