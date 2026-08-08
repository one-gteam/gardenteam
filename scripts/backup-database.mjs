#!/usr/bin/env node
// Backup periodico e GRATUITO dell'intero database + file di Storage (foto
// prodotti, sfondi cartelli, loghi, copertine corsi...). Il piano Supabase
// gratuito non offre backup scaricabili: questo script è il sostituto,
// pianificato con l'Utilità di pianificazione di Windows sul server AI
// (\\srvdoc\ai), così gira anche senza nessun PC utente acceso.
//
// Ogni esecuzione crea UNA cartella con timestamp, dentro:
//   - tabelle.json.gz   (tutte le righe di tutte le tabelle, oggi solo app_data)
//   - storage/<bucket>/<percorso>   (copia di ogni file nei bucket Storage)
// La cartella viene copiata in \\srvdoc\ai\backup, e le cartelle più vecchie
// di RITENZIONE_GIORNI vengono cancellate.
//
// Lo schema (struttura delle tabelle) è in data/supabase-schema.sql: questo
// backup copre i DATI e i FILE, che cambiano di continuo.
//
// Uso:
//   1. npm install (nella cartella del progetto, se non già fatto)
//   2. node --env-file=.env.local scripts/backup-database.mjs
//   3. Pianificato con l'Utilità di pianificazione di Windows sul server AI
//      ogni giorno:
//      Azione = "node.exe"
//      Argomenti = --env-file=".env.local" "scripts\backup-database.mjs"
//      Directory di partenza = "\\srvdoc\ai\Progetti AI\Academy GT\academy-gt"
//
// Tabelle e bucket vengono elencati dal database a ogni esecuzione (non
// scritti a mano), così un domani un dominio o un bucket nuovo finisce nel
// backup automaticamente, senza dover ricordarsi di aggiornare questo file.

import { createClient } from "@supabase/supabase-js";
import { gzipSync } from "node:zlib";
import {
  writeFileSync, mkdirSync, readdirSync, statSync, rmSync, cpSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Mancano SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY nell'ambiente.");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function elencaTabelle() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!r.ok) throw new Error(`Impossibile elencare le tabelle: HTTP ${r.status}`);
  const spec = await r.json();
  return Object.keys(spec.definitions || {}).sort();
}

async function elencaBucket() {
  const { data, error } = await supabase.storage.listBuckets();
  if (error) throw new Error(`Impossibile elencare i bucket: ${error.message}`);
  return (data || []).map((b) => b.name);
}

const PAGINA = 1000; // limite righe per richiesta PostgREST

async function esportaTabella(nome) {
  const righe = [];
  let da = 0;
  for (;;) {
    const { data, error } = await supabase.from(nome).select("*").range(da, da + PAGINA - 1);
    if (error) {
      if (/does not exist|not find the table/i.test(error.message)) return { nome, righe: null, saltata: true };
      throw new Error(`Tabella "${nome}": ${error.message}`);
    }
    righe.push(...data);
    if (data.length < PAGINA) break;
    da += PAGINA;
  }
  return { nome, righe, saltata: false };
}

// Elenca ricorsivamente tutti i file di un bucket (list() di Supabase non è
// ricorsiva: le cartelle compaiono come voci con id null).
async function elencaRicorsivo(bucket, prefisso = "") {
  const { data, error } = await supabase.storage.from(bucket).list(prefisso, { limit: 1000 });
  if (error) throw new Error(`Bucket "${bucket}" (${prefisso || "/"}): ${error.message}`);
  let file = [];
  for (const voce of data || []) {
    const p = prefisso ? `${prefisso}/${voce.name}` : voce.name;
    if (voce.id === null) file = file.concat(await elencaRicorsivo(bucket, p));
    else file.push(p);
  }
  return file;
}

async function copiaBucket(bucket, cartellaDest) {
  const file = await elencaRicorsivo(bucket, "");
  let ok = 0;
  for (const percorso of file) {
    const { data, error } = await supabase.storage.from(bucket).download(percorso);
    if (error) {
      console.error(`  Storage ${bucket}/${percorso}: ${error.message}`);
      continue;
    }
    const dest = path.join(cartellaDest, bucket, percorso);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, Buffer.from(await data.arrayBuffer()));
    ok++;
  }
  return ok;
}

const PREFISSO_CARTELLA = "academy-gt-backup-";
const DESTINAZIONI = [
  { etichetta: "Rete (\\\\srvdoc\\ai\\backup)", cartella: "//srvdoc/ai/backup" },
];
const RITENZIONE_GIORNI = 60;

function pulisciVecchi(cartellaBase) {
  let voci;
  try {
    voci = readdirSync(cartellaBase).filter((f) => f.startsWith(PREFISSO_CARTELLA));
  } catch {
    return 0;
  }
  const sogliaMs = Date.now() - RITENZIONE_GIORNI * 24 * 60 * 60 * 1000;
  let rimossi = 0;
  for (const f of voci) {
    const p = path.join(cartellaBase, f);
    if (statSync(p).mtimeMs < sogliaMs) {
      rmSync(p, { recursive: true, force: true });
      rimossi++;
    }
  }
  return rimossi;
}

async function main() {
  console.log(`[${new Date().toISOString()}] Avvio backup database + storage (Academy GT / GT One)...`);

  // ===== 1. Tabelle =====
  const TABELLE = await elencaTabelle();
  console.log(`Tabelle da salvare: ${TABELLE.length}`);
  const risultato = {};
  const saltate = [];
  for (const nome of TABELLE) {
    const r = await esportaTabella(nome);
    if (r.saltata) {
      saltate.push(nome);
      continue;
    }
    risultato[nome] = r.righe;
    console.log(`  tabella ${nome}: ${r.righe.length} righe`);
  }
  if (saltate.length) console.log(`Tabelle saltate (non esistono più): ${saltate.join(", ")}`);
  const json = JSON.stringify({ generato_il: new Date().toISOString(), tabelle: risultato });
  const gz = gzipSync(json);

  // ===== 2. Cartella di lavoro temporanea con tabelle + storage =====
  const bollo = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  const nomeCartella = `${PREFISSO_CARTELLA}${bollo}`;
  const tmp = path.join(os.tmpdir(), nomeCartella);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  writeFileSync(path.join(tmp, "tabelle.json.gz"), gz);
  console.log(`Tabelle: ${(gz.length / 1024 / 1024).toFixed(2)} MB compressi`);

  // ===== 1-bis. Account di login (schema auth, non raggiungibile via
  // PostgREST come le altre tabelle) — utile solo se in futuro Academy GT
  // passa da login demo a Supabase Auth vero (vedi README, sezione limiti).
  try {
    const utenti = [];
    for (let pagina = 1; ; pagina++) {
      const { data, error } = await supabase.auth.admin.listUsers({ page: pagina, perPage: 200 });
      if (error) throw error;
      utenti.push(
        ...data.users.map((u) => ({
          id: u.id,
          email: u.email,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
          email_confirmed_at: u.email_confirmed_at,
        }))
      );
      if (data.users.length < 200) break;
    }
    writeFileSync(path.join(tmp, "account-login.json"), JSON.stringify(utenti, null, 1));
    console.log(`  account di login: ${utenti.length}`);
  } catch (err) {
    console.error(`  ERRORE nel backup degli account di login: ${err.message}`);
  }

  const BUCKET_STORAGE = await elencaBucket();
  for (const bucket of BUCKET_STORAGE) {
    const n = await copiaBucket(bucket, path.join(tmp, "storage"));
    console.log(`  storage ${bucket}: ${n} file`);
  }

  // ===== 3. Copia nelle destinazioni + pulizia vecchie copie =====
  let salvatoAlmenoUnaVolta = false;
  for (const dest of DESTINAZIONI) {
    try {
      mkdirSync(dest.cartella, { recursive: true });
      cpSync(tmp, path.join(dest.cartella, nomeCartella), { recursive: true });
      const rimossi = pulisciVecchi(dest.cartella);
      salvatoAlmenoUnaVolta = true;
      console.log(`  OK -> ${dest.etichetta}${rimossi ? ` (rimosse ${rimossi} copie oltre ${RITENZIONE_GIORNI} giorni)` : ""}`);
    } catch (err) {
      console.error(`  ERRORE su ${dest.etichetta}: ${err.message}`);
    }
  }
  rmSync(tmp, { recursive: true, force: true });

  // Se nessuna destinazione ha ricevuto la copia, il backup NON esiste: va
  // segnalato come fallito, altrimenti l'Utilità di pianificazione mostra
  // "operazione completata" e il problema resta invisibile per settimane.
  if (!salvatoAlmenoUnaVolta) {
    throw new Error("nessuna destinazione raggiungibile: il backup non è stato salvato da nessuna parte");
  }
  console.log("Backup completato.");
}

main().catch((err) => {
  console.error("Backup FALLITO:", err.message);
  process.exit(1);
});
