import { NextRequest, NextResponse } from "next/server";
import { publicUrlFor } from "@/lib/supabase";
import { leggiGettoneScorm, type AccessoScorm } from "@/lib/scorm-accesso";

/* Supabase Storage serve gli .html/.js come text/plain per sicurezza: qui
   ricalcoliamo il content-type dall'estensione, altrimenti il browser non
   eseguirebbe HTML e JavaScript del pacchetto SCORM. */
const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8", json: "application/json; charset=utf-8",
  xml: "application/xml; charset=utf-8", svg: "image/svg+xml", vtt: "text/vtt",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", ico: "image/x-icon", mp3: "audio/mpeg", ogg: "audio/ogg",
  wav: "audio/wav", m4a: "audio/mp4", mp4: "video/mp4", webm: "video/webm",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  pdf: "application/pdf", txt: "text/plain; charset=utf-8",
};

/*
 * I pacchetti SCORM sono HTML e JavaScript scritti da altri: girano ISOLATI.
 * Ogni file esce con "Content-Security-Policy: sandbox" senza
 * allow-same-origin, quindi il browser gli dà un'origine opaca: niente biscotti
 * del sito, niente accesso alla pagina del corso né alle azioni del server.
 * L'API SCORM (window.API / API_1484_11) la mette qui un piccolo script
 * iniettato in testa alla pagina, che manda stato e punteggio alla pagina del
 * corso con postMessage; è la pagina del corso a registrarli sul server.
 *
 * Indirizzo: /api/scorm/<gettone firmato>/<file del pacchetto>. Il gettone
 * dice di quale pacchetto si tratta e scade dopo qualche ora.
 */
const SANDBOX = "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock";

function shim(d: AccessoScorm, origine: string): string {
  const cfg = JSON.stringify({ c: d.c, v: d.v, n: d.n, o: origine }).replace(/</g, "\\u003c");
  return `<script>(function(){var cfg=${cfg};var d={};
if(cfg.v==="1.2"){d["cmi.core.student_name"]=cfg.n;d["cmi.core.lesson_status"]="not attempted";d["cmi.core.lesson_mode"]="normal";d["cmi.core.credit"]="credit";d["cmi.core.entry"]="ab-initio";d["cmi.core.score.min"]="0";d["cmi.core.score.max"]="100";}
else{d["cmi.learner_name"]=cfg.n;d["cmi.completion_status"]="unknown";d["cmi.success_status"]="unknown";d["cmi.mode"]="normal";d["cmi.credit"]="credit";d["cmi.entry"]="ab-initio";}
function send(t){try{window.top.postMessage({scormGtOne:cfg.c,tipo:t,dati:d},cfg.o);}catch(e){}}
function get(k){return d[k]==null?"":String(d[k]);}function set(k,v){d[k]=String(v);return "true";}
var ok=function(){return "true";};
window.API={LMSInitialize:ok,LMSFinish:function(){send("fine");return "true";},LMSGetValue:get,LMSSetValue:set,LMSCommit:function(){send("commit");return "true";},LMSGetLastError:function(){return "0";},LMSGetErrorString:function(){return "No error";},LMSGetDiagnostic:function(){return "";}};
window.API_1484_11={Initialize:ok,Terminate:function(){send("fine");return "true";},GetValue:get,SetValue:set,Commit:function(){send("commit");return "true";},GetLastError:function(){return "0";},GetErrorString:function(){return "No error";},GetDiagnostic:function(){return "";}};
window.addEventListener("pagehide",function(){send("commit");});
})();</script>`;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const accesso = leggiGettoneScorm(decodeURIComponent(path[0] ?? ""));
  if (!accesso) return new NextResponse("Accesso scaduto: riapri la lezione", { status: 403 });

  /*
   * Prima si decodifica e poi si controlla: controllando i pezzi ancora
   * codificati, un "%2e%2e" passava il filtro e diventava ".." nel percorso,
   * uscendo dalla cartella del pacchetto.
   */
  const pezzi = path.slice(1).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  const valido = pezzi.length > 0
    && pezzi.every((p) => p.length > 0 && p !== "." && p !== ".." && !p.includes("/") && !p.includes("\\"));
  if (!valido) return new NextResponse("Percorso non valido", { status: 400 });
  const storagePath = `${accesso.p}/${pezzi.join("/")}`;

  const upstream = await fetch(publicUrlFor(storagePath));
  if (!upstream.ok || !upstream.body) return new NextResponse("File non trovato", { status: 404 });

  const ext = (storagePath.split(".").pop() ?? "").toLowerCase().split("?")[0];
  const tipo = TYPES[ext] ?? upstream.headers.get("content-type") ?? "application/octet-stream";
  const headers = new Headers();
  headers.set("content-type", tipo);
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-security-policy", SANDBOX);
  headers.set("cache-control", "private, max-age=3600");

  if (tipo.startsWith("text/html")) {
    // l'API SCORM va definita prima di qualsiasi script del pacchetto
    const origine = new URL(req.url).origin;
    const html = await upstream.text();
    const s = shim(accesso, origine);
    const conShim = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + s) : s + html;
    return new NextResponse(conShim, { status: 200, headers });
  }
  const len = upstream.headers.get("content-length");
  if (len) headers.set("content-length", len);
  return new NextResponse(upstream.body, { status: 200, headers });
}
