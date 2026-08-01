"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { trackLessonView } from "@/lib/actions";
import { VideoSource } from "@/lib/video";

/* Tipi minimi dell'IFrame API di YouTube, per non dipendere da @types esterni. */
interface YTPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  destroy(): void;
}
interface YTWindow extends Window {
  YT?: {
    Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer;
    PlayerState: { ENDED: number; PLAYING: number };
  };
  onYouTubeIframeAPIReady?: () => void;
}

/** Carica una sola volta l'IFrame API di YouTube. */
function loadYouTubeApi(): Promise<YTWindow["YT"]> {
  const w = window as YTWindow;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  return new Promise((resolve) => {
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve((window as YTWindow).YT);
    };
    if (!document.getElementById("yt-iframe-api")) {
      const s = document.createElement("script");
      s.id = "yt-iframe-api";
      s.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(s);
    }
  });
}

/**
 * Player che registra la visione reale della lezione.
 *
 * Campiona la posizione ogni secondo: somma il tempo solo quando il video
 * avanza normalmente, così trascinare la barra in avanti non gonfia il
 * conteggio. Il progresso viene salvato ogni 10 secondi e quando si mette in
 * pausa o si lascia la pagina.
 */
export default function TrackedVideo({
  courseId,
  lessonId,
  title,
  video,
  threshold,
  initialPercent,
  initialSeconds,
}: {
  courseId: string;
  lessonId: string;
  title: string;
  video: Extract<VideoSource, { kind: "iframe" } | { kind: "file" }>;
  threshold: number;
  initialPercent: number;
  initialSeconds: number;
}) {
  const [percent, setPercent] = useState(initialPercent); // % effettivamente vista
  const [done, setDone] = useState(initialPercent >= threshold);

  const watched = useRef(initialSeconds);
  const maxPercent = useRef(initialPercent);
  const lastTime = useRef<number | null>(null);
  const duration = useRef(0);
  const dirty = useRef(false);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  /** Invia al server quanto visto finora (solo se qualcosa è cambiato). */
  const flush = useCallback(async () => {
    if (!dirty.current) return;
    dirty.current = false;
    const res = await trackLessonView(courseId, lessonId, {
      maxPercent: maxPercent.current,
      secondsWatched: watched.current,
      durationSec: duration.current || undefined,
    });
    if (!res.ok) return;
    setPercent(res.seenPercent); // il server è la fonte di verità sulla quota vista
    if (res.completed) setDone(true);
    if (res.justCompleted) window.dispatchEvent(new CustomEvent("lesson-completed"));
  }, [courseId, lessonId]);

  /** Campionamento: chiamato ogni secondo con la posizione corrente. */
  const sample = useCallback((current: number, total: number) => {
    if (!total || !isFinite(total)) return;
    duration.current = total;
    const prev = lastTime.current;
    lastTime.current = current;
    // avanzamento normale (≤ 1,5 s): conta come tempo visto; oltre è un salto
    if (prev !== null && current > prev && current - prev <= 1.5) {
      watched.current += current - prev;
      dirty.current = true;
    }
    const pct = Math.min(100, (current / total) * 100);
    if (pct > maxPercent.current) {
      maxPercent.current = pct;
      dirty.current = true;
    }
    // quota realmente vista: tempo riprodotto sulla durata (i salti non contano)
    setPercent(Math.min(100, Math.round((watched.current / total) * 100)));
  }, []);

  // ---- YouTube ----
  useEffect(() => {
    if (video.kind !== "iframe" || video.provider !== "youtube") return;
    const idMatch = video.src.match(/\/embed\/([^?]+)/);
    if (!idMatch || !mountRef.current) return;

    let player: YTPlayer | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    loadYouTubeApi().then((YT) => {
      if (cancelled || !YT || !mountRef.current) return;
      player = new YT.Player(mountRef.current, {
        videoId: idMatch[1],
        host: "https://www.youtube-nocookie.com",
        playerVars: { rel: 0, modestbranding: 1 },
        events: {
          onStateChange: (e: { data: number }) => {
            if (e.data === YT.PlayerState.ENDED) {
              maxPercent.current = 100;
              setPercent(100);
              dirty.current = true;
              flush();
            }
            if (e.data !== YT.PlayerState.PLAYING) {
              lastTime.current = null; // pausa: il prossimo campione riparte pulito
              flush();
            }
          },
        },
      });
      timer = setInterval(() => {
        if (!player) return;
        try {
          sample(player.getCurrentTime(), player.getDuration());
        } catch {
          /* il player non è ancora pronto */
        }
      }, 1000);
    });

    const save = setInterval(flush, 10000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      clearInterval(save);
      flush();
      player?.destroy();
    };
  }, [video, sample, flush]);

  // ---- File video diretto (mp4/webm) ----
  useEffect(() => {
    if (video.kind !== "file") return;
    const el = videoRef.current;
    if (!el) return;
    const onTime = () => sample(el.currentTime, el.duration);
    const onPause = () => { lastTime.current = null; flush(); };
    const onEnded = () => { maxPercent.current = 100; setPercent(100); dirty.current = true; flush(); };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    const save = setInterval(flush, 10000);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      clearInterval(save);
      flush();
    };
  }, [video, sample, flush]);

  // salva anche se si chiude la scheda o si cambia pagina
  useEffect(() => {
    const onHide = () => flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, [flush]);

  const trackable = video.kind === "file" || (video.kind === "iframe" && video.provider === "youtube");

  return (
    <div>
      {video.kind === "file" ? (
        /* eslint-disable-next-line jsx-a11y/media-has-caption */
        <video ref={videoRef} className="video-embed" src={video.src} controls preload="metadata" />
      ) : video.provider === "youtube" ? (
        <div className="video-embed"><div ref={mountRef} /></div>
      ) : (
        <div className="video-embed">
          <iframe
            src={video.src}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            loading="lazy"
          />
        </div>
      )}

      {trackable ? (
        <div className="watch-bar">
          <div className="watch-track">
            <div className={`watch-fill ${done ? "done" : ""}`} style={{ width: `${percent}%` }} />
          </div>
          <span className="watch-label">
            {done
              ? "✓ Video visto per intero: lezione completata"
              : `Visto il ${percent}% — la lezione si completa da sola al ${threshold}%`}
          </span>
        </div>
      ) : (
        <p className="hint">
          Questo player esterno non consente di rilevare la visione: la lezione va segnata manualmente come completata.
        </p>
      )}
    </div>
  );
}
