#!/usr/bin/env node
// Ripristino da un backup fatto con scripts/backup-database.mjs.
//
// Il sito tiene tutto in Supabase: la tabella app_data (una riga per "dominio":
// academy, zoo, stampe, articoli, tentativi) e i file di Storage (foto, loghi,
// sfondi). Questo script rimette a posto l'una, gli altri o entrambi, a partire
// da una cartella di backup (\\srvdoc\ai\backup\academy-gt-backup-AAAA-MM-GG-HH-MM).
//
// Senza --esegui NON scrive nulla: dice solo cosa farebbe. Prima di scrivere
// salva una copia delle righe attuali in data/prima-del-ripristino-<data>/,
// così si può tornare indietro anche dal ripristino stesso.
//
// Uso (dalla cartella del progetto):
//   node --env-file=.env.local scripts/ripristina-database.mjs "\\srvdoc\ai\backup\academy-gt-backup-2026-10-06-01-30"
//   node --env-file=.env.local scripts/ripristina-database.mjs "<cartella>" --dominio zoo --esegui
//   node --env-file=.env.local scripts/ripristina-database.mjs "<cartella>" --storage --esegui
//
// Opzioni:
//   --dominio a,b   solo questi domini di app_data (predefinito: tutti quelli nel backup)
//   --solo-tabelle  solo app_data (predefinito)
//   --storage       anche i file di Storage (sovrascrive quelli con lo stesso nome)
//   --esegui        scrive davvero; senza, è solo una prova

import { createClient } from "@supabase/supabase-js";
import { gunzipSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Mancano SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY: lancia con  node --env-file=.env.local …");
  process.exit(1);
}
const args = process.argv.slice(2);
const cartella = args.find((a) => !a.startsWith("--"));
if (!cartella || !existsSync(path.join(cartella, "tabelle.json.gz"))) {
  console.error("Indica la cartella del backup (deve contenere tabelle.json.gz).");
  process.exit(1);
}
const esegui = args.includes("--esegui");
const conStorage = args.includes("--storage");
const iDom = args.indexOf("--dominio");
const dominiScelti = iDom >= 0 ? (args[iDom + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean) : null;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const bollo = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);

async function main() {
  console.log(`${esegui ? "RIPRISTINO" : "PROVA (niente viene scritto: aggiungi --esegui)"} da ${cartella}`);
  const backup = JSON.parse(gunzipSync(readFileSync(path.join(cartella, "tabelle.json.gz"))).toString("utf8"));
  console.log(`Backup generato il ${backup.generato_il}`);

  // ===== app_data =====
  const righe = (backup.tabelle?.app_data ?? []).filter((r) => !dominiScelti || dominiScelti.includes(r.domain));
  if (righe.length === 0) console.log("Nessuna riga app_data da ripristinare con questi filtri.");
  const { data: attuali, error } = await supabase.from("app_data").select("*");
  if (error) throw new Error(`Lettura app_data: ${error.message}`);
  const attualePer = new Map((attuali ?? []).map((r) => [r.domain, r]));
  for (const r of righe) {
    const ora = attualePer.get(r.domain);
    const kbBackup = Math.round(JSON.stringify(r.data).length / 1024);
    const kbOra = ora ? Math.round(JSON.stringify(ora.data).length / 1024) : 0;
    console.log(`  ${r.domain}: backup ${kbBackup} KB (${r.updated_at}) ← al posto di ${ora ? `${kbOra} KB (${ora.updated_at})` : "niente (riga nuova)"}`);
  }
  if (esegui && righe.length > 0) {
    const copia = path.join("data", `prima-del-ripristino-${bollo}`);
    mkdirSync(copia, { recursive: true });
    for (const r of righe) {
      const ora = attualePer.get(r.domain);
      if (ora) writeFileSync(path.join(copia, `${r.domain}.json`), JSON.stringify(ora));
    }
    console.log(`  copia delle righe attuali in ${copia}`);
    for (const r of righe) {
      const { error: e } = await supabase.from("app_data").upsert(
        { domain: r.domain, data: r.data, updated_at: new Date().toISOString() },
        { onConflict: "domain" },
      );
      if (e) throw new Error(`Scrittura ${r.domain}: ${e.message}`);
      console.log(`  ✓ ${r.domain} ripristinato`);
    }
  }

  // ===== Storage =====
  if (conStorage) {
    const base = path.join(cartella, "storage");
    const bucket = existsSync(base) ? readdirSync(base) : [];
    for (const b of bucket) {
      const file = [];
      const cammina = (dir) => {
        for (const v of readdirSync(dir)) {
          const p = path.join(dir, v);
          if (statSync(p).isDirectory()) cammina(p); else file.push(p);
        }
      };
      cammina(path.join(base, b));
      console.log(`  bucket ${b}: ${file.length} file nel backup`);
      if (!esegui) continue;
      let ok = 0;
      for (const p of file) {
        const chiave = path.relative(path.join(base, b), p).split(path.sep).join("/");
        const { error: e } = await supabase.storage.from(b).upload(chiave, readFileSync(p), { upsert: true });
        if (e) console.error(`    ${chiave}: ${e.message}`); else ok++;
      }
      console.log(`  ✓ ${ok} file caricati in ${b}`);
    }
  } else {
    console.log("Storage: non toccato (aggiungi --storage per rimettere anche i file).");
  }
  console.log(esegui ? "Fatto. Il sito legge i dati nuovi al primo accesso (la copia in memoria si accorge della data cambiata)." : "Fine della prova.");
}

main().catch((err) => { console.error(`ERRORE: ${err.message}`); process.exit(1); });
