"use client";

import { useState, useTransition } from "react";

/**
 * Carica più foto direttamente dal browser a Supabase Storage (URL firmati via
 * /api/zoo-foto/sign), senza farle transitare per il server: con centinaia di
 * foto in alta risoluzione, un upload passato dalla funzione serverless supera
 * il limite di dimensione del body e fallisce con un errore generico lato
 * client. Finito il caricamento dei byte, `finalize` (una server action) fa
 * solo l'abbinamento automatico per EAN/codice e reindirizza come prima.
 */
export default function PhotoUploader({
  back, scopeParam, finalize,
}: {
  back: string;
  scopeParam: string;
  finalize: (back: string, scopeParam: string, fileNames: string[]) => Promise<void>;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sanitize = (name: string) => name.toLowerCase().replace(/[^a-z0-9._-]/g, "_");

  const onUpload = async () => {
    if (files.length === 0) return;
    setError(null);
    setProgress({ done: 0, total: files.length });

    let uploaded: string[] = [];
    try {
      const names = files.map((f) => sanitize(f.name));
      const res = await fetch("/api/zoo-foto/sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileNames: names }),
      });
      if (!res.ok) throw new Error(`Richiesta degli URL di caricamento fallita (${res.status}).`);
      const { urls } = (await res.json()) as { urls: { fileName: string; signedUrl: string | null }[] };
      const byName = new Map(urls.map((u) => [u.fileName, u.signedUrl]));

      const done: string[] = [];
      const CONCURRENCY = 4;
      let idx = 0;
      const worker = async () => {
        for (;;) {
          const i = idx++;
          if (i >= files.length) return;
          const file = files[i];
          const name = sanitize(file.name);
          const signedUrl = byName.get(name);
          if (signedUrl) {
            try {
              const put = await fetch(signedUrl, {
                method: "PUT",
                headers: { "content-type": file.type || "application/octet-stream" },
                body: file,
              });
              if (put.ok) done.push(name);
            } catch {
              // una foto fallita non deve bloccare le altre: si ricarica singolarmente dopo
            }
          }
          setProgress((p) => (p ? { done: p.done + 1, total: p.total } : p));
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
      uploaded = done;
      if (uploaded.length === 0) throw new Error("Nessuna foto è stata caricata.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore durante il caricamento.");
      setProgress(null);
      return;
    }

    // fuori dal try: se finalize() reindirizza, l'eccezione di navigazione non va intercettata come errore
    startTransition(() => {
      finalize(back, scopeParam, uploaded);
    });
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <input
        type="file" accept="image/*" multiple
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        disabled={!!progress || pending}
      />
      <button className="btn btn-sm" type="button" disabled={files.length === 0 || !!progress || pending} onClick={onUpload}>
        Carica {files.length > 0 ? `${files.length} foto` : "foto"}
      </button>
      {progress && <span className="hint">Caricamento {progress.done}/{progress.total}…</span>}
      {error && <span style={{ color: "#a33", fontSize: 12.5 }}>{error}</span>}
    </div>
  );
}
