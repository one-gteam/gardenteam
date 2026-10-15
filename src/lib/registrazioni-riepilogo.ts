import { getDb, saveDb } from "./db";
import { sendMail } from "./mailer";
import type { DB, Registration } from "./types";

/*
 * Richieste di registrazione in attesa: l'avviso per l'amministratore di
 * sistema (in /scegli e nel menu di Utenti e ruoli) e la mail riassuntiva una
 * volta al giorno, dal cron di Vercel. La mail parte solo se c'è qualcosa in
 * attesa e al massimo una volta per giorno (settings.riepilogoRegistrazioniIl).
 */

const ORIGINE = process.env.NEXT_PUBLIC_SITE_URL || "https://gardenteam.vercel.app";

export function richiesteInAttesa(db: DB): Registration[] {
  return db.registrations.filter((r) => r.status === "pending").sort((a, b) => b.date.localeCompare(a.date));
}

function riga(db: DB, r: Registration, nuova: boolean): string {
  const insegna = db.tenants.find((t) => t.id === r.tenantId)?.name ?? "";
  const pv = db.stores.find((s) => s.id === r.storeId)?.name ?? "";
  const reparto = r.repartoAltro
    ? `Altro${r.notaAltro ? ` («${r.notaAltro}»)` : ""}`
    : db.departments.find((d) => d.id === r.departmentId)?.name ?? "—";
  const quando = new Date(r.date).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });
  return `${nuova ? "• NUOVA " : "• "}${r.firstName} ${r.lastName} <${r.email}>\n   ${insegna}${pv && pv !== insegna ? ` · ${pv}` : ""} · reparto: ${reparto} · ${quando}`;
}

/** Manda il riepilogo agli amministratori di sistema. `forza` salta il controllo «già mandato oggi». */
export async function inviaRiepilogoRegistrazioni(forza = false): Promise<{ inviate: number; richieste: number; nota?: string }> {
  const db = await getDb();
  const oggi = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
  if (!forza && db.settings.riepilogoRegistrazioniIl === oggi) return { inviate: 0, richieste: 0, nota: "già mandato oggi" };
  const attesa = richiesteInAttesa(db);
  if (attesa.length === 0) return { inviate: 0, richieste: 0, nota: "nessuna richiesta in attesa" };

  // «nuove» = arrivate dopo l'ultimo riepilogo (o nelle ultime 24 ore, la prima volta)
  const dal = db.settings.riepilogoRegistrazioniDal ?? new Date(Date.now() - 864e5).toISOString();
  const nuove = attesa.filter((r) => r.date > dal).length;
  const destinatari = db.users.filter((u) => u.role === "system_admin" && u.active !== false && u.email?.includes("@"));
  if (destinatari.length === 0) return { inviate: 0, richieste: attesa.length, nota: "nessun amministratore di sistema con email" };

  const oggetto = nuove > 0
    ? `${nuove} ${nuove === 1 ? "nuova richiesta" : "nuove richieste"} di registrazione (${attesa.length} in attesa)`
    : `${attesa.length} ${attesa.length === 1 ? "richiesta" : "richieste"} di registrazione ancora in attesa`;
  const testo = [
    `Richieste di registrazione in attesa di approvazione: ${attesa.length}${nuove ? `, di cui ${nuove} arrivate dall'ultimo riepilogo` : ""}.`,
    "",
    ...attesa.map((r) => riga(db, r, r.date > dal)),
    "",
    `Per approvarle o rifiutarle: ${ORIGINE}/admin/utenti`,
    "",
    "Questa mail arriva una volta al giorno, solo quando ci sono richieste in attesa.",
  ].join("\n");

  let inviate = 0;
  for (const u of destinatari) {
    const r = await sendMail(u.email, oggetto, `Ciao ${u.firstName},\n\n${testo}`, { marchio: "gtone" });
    if (r.sent !== false) inviate++;
  }
  db.settings.riepilogoRegistrazioniIl = oggi;
  db.settings.riepilogoRegistrazioniDal = new Date().toISOString();
  await saveDb(db);
  return { inviate, richieste: attesa.length };
}
