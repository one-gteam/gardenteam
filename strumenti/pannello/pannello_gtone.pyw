# -*- coding: utf-8 -*-
"""Pannello di controllo di GT One (25/10/2026), gemello dei Pannelli Linfa e my.rosaflor.

GT One (gardenteam.vercel.app) non gira su questo PC: il sito sta su Vercel e
i dati su Supabase, in una tabella sola (app_data) con una riga per «area»:
academy (utenti, insegne, corsi), zoo (Offerte Zoo), stampe (cartelli Arredo),
articoli, registro_AAAA_MM, ecc. Qui ci sono gli strumenti per quando qualcosa
va storto:
  · Stato: il sito risponde? l'ultima versione è in linea? il backup di
    stanotte c'è? la copia completa è recente? le attività pianificate girano?
  · Sito: tornare con un clic a una versione precedente (e poi all'ultima).
  · Dati: fare un backup adesso, fare la copia completa del sito, rimettere
    i dati di un'area da un backup (prima la prova, poi davvero).
  · Chiavetta: copia CIFRATA di backup e copia completa su una chiavetta USB.
  · Istruzioni: cosa si salva, quando, dove, e come si rimette a posto.

Sta su C:\\GTOneDati (disco locale): deve aprirsi anche se il sito è giù.
Si apre con «Pannello GT One» sul desktop. Con `--controlla` stampa i
controlli senza aprire la finestra; `--prova-finestra` si chiude da sola.
"""
import datetime
import gzip
import hashlib
import json
import os
import queue
import re
import subprocess
import sys
import threading
import time
import urllib.request
import urllib.error

DATI = r"C:\GTOneDati"
DIARIO = os.path.join(DATI, "log", "pannello.log")
PROGETTO = r"\\srvdoc\ai\Progetti AI\Academy GT\academy-gt"
# le chiavi: se un giorno si spostano fuori dalla cartella di rete, qui vince la copia locale
ENV_LOCALE = os.path.join(DATI, "segreti", ".env.local")
ENV_RETE = os.path.join(PROGETTO, ".env.local")
BACKUP = r"\\srvdoc\ai\backup"
PREFISSO_BACKUP = "academy-gt-backup-"
COPIE_SITO = r"\\srvdoc\ai_backup\gtone"
GUIDA = os.path.join(PROGETTO, "docs", "BACKUP-E-RIPRISTINO.md")
NODE = r"C:\Program Files\nodejs\node.exe"
COPIA_ESTERNA = r"C:\SicurezzaDati\copia-esterna.mjs"
CHIAVE_COPIA = r"C:\SicurezzaDati\segreti\copia-esterna.key"
FOGLIO_CHIAVE = r"C:\SicurezzaDati\segreti\CHIAVE-DA-STAMPARE.txt"
LOG_COPIA = r"C:\SicurezzaDati\log\copia-esterna.log"
SITO = "https://gardenteam.vercel.app"
VERCEL_PROGETTO = "prj_WkbEF8dStsEJlNzTDzSbzfuDCFE0"
VERCEL_TEAM = "team_P3Px3sFoJAOk1omaZCmzkb4i"
VERCEL_PANNELLO = "https://vercel.com/dashboard"
ATTIVITA = ("GT One - Backup Database", "GT One - Backup Git", "GT One - Copia completa", "Sicurezza - Copia esterna")
ATTIVITA_COPIA = "GT One - Copia completa"
SENZA_FINESTRA = 0x08000000  # CREATE_NO_WINDOW

# a cosa serve ogni area (riga di app_data), per chi deve scegliere cosa rimettere
AREE = {
    "academy": "utenti, insegne, punti vendita, corsi, impostazioni",
    "zoo": "Offerte Zoo: prodotti, volantini, offerte, layout, liste di stampa",
    "stampe": "Cartelli Arredo e impostazioni di stampa",
    "articoli": "area Articoli",
    "zoo_incontri": "incontri dello Zoo",
    "tentativi": "tentativi di accesso (non serve rimetterla)",
    "connettori_fox": "connettori del programma Fox",
}


# ----------------------------------------------------------------- utilità
def file_env():
    return ENV_LOCALE if os.path.exists(ENV_LOCALE) else ENV_RETE


def leggi_env(percorso=None):
    out = {}
    try:
        with open(percorso or file_env(), encoding="utf-8") as f:
            for r in f:
                m = re.match(r"\s*([A-Z0-9_]+)\s*=\s*(.*)$", r)
                if m:
                    out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    except OSError:
        pass
    return out


def diario(testo):
    try:
        os.makedirs(os.path.dirname(DIARIO), exist_ok=True)
        with open(DIARIO, "a", encoding="utf-8") as f:
            f.write("[%s] %s\n" % (datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), testo))
    except OSError:
        pass


def http(url, metodo="GET", headers=None, corpo=None, secondi=20):
    dati = json.dumps(corpo).encode("utf-8") if corpo is not None else None
    req = urllib.request.Request(url, data=dati, method=metodo, headers=headers or {})
    if dati is not None:
        req.add_header("Content-Type", "application/json")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=secondi) as r:
            return r.status, r.read().decode("utf-8", "replace"), int((time.time() - t0) * 1000)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), int((time.time() - t0) * 1000)
    except Exception as e:  # rete giù, DNS, timeout
        return 0, str(e), int((time.time() - t0) * 1000)


def con_timeout(fn, secondi, ripiego):
    """Un controllo che non deve bloccare il pannello (cartella di rete appesa)."""
    esito = [ripiego]

    def gira():
        try:
            esito[0] = fn()
        except Exception:
            pass
    t = threading.Thread(target=gira, daemon=True)
    t.start()
    t.join(secondi)
    return esito[0]


def eta(dt):
    s = (datetime.datetime.now(datetime.timezone.utc) - dt).total_seconds()
    if s < 3600:
        return "%d minuti fa" % (s // 60)
    if s < 172800:
        return "%.0f ore fa" % (s / 3600)
    return "%d giorni fa" % (s // 86400)


def da_iso(t):
    return datetime.datetime.fromisoformat(t.replace("Z", "+00:00"))


def data_da_nome(nome, utc=False):
    """academy-gt-backup-2026-10-25-01-30 (ora UTC) / 2026-10-06-16-34 (ora italiana) → datetime locale."""
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})", nome)
    if not m:
        return None
    d = datetime.datetime(*map(int, m.groups()))
    # il backup notturno chiama la cartella con l'ora UTC: 01-30 è alle 2:30 (o 3:30 d'estate) da noi
    return d.replace(tzinfo=datetime.timezone.utc).astimezone().replace(tzinfo=None) if utc else d


# ----------------------------------------------------------------- sito
def sito_risponde():
    st, _, ms = http(SITO + "/login", secondi=15)
    return {"ok": st == 200, "stato": st, "ms": ms}


def vercel(percorso, metodo="GET"):
    token = leggi_env().get("VERCEL_TOKEN") or os.environ.get("VERCEL_TOKEN", "")
    if not token:
        return 0, {"errore": "VERCEL_TOKEN mancante (né in .env.local né nelle variabili di Windows)"}
    sep = "&" if "?" in percorso else "?"
    st, testo, _ = http("https://api.vercel.com" + percorso + sep + "teamId=" + VERCEL_TEAM, metodo,
                        {"Authorization": "Bearer " + token})
    try:
        return st, json.loads(testo)
    except ValueError:
        return st, {"errore": testo[:200]}


def versioni():
    st, j = vercel("/v6/deployments?projectId=%s&target=production&state=READY&limit=15" % VERCEL_PROGETTO)
    out = []
    for d in (j.get("deployments") or []) if st == 200 else []:
        m = d.get("meta") or {}
        out.append({"id": d["uid"], "quando": datetime.datetime.fromtimestamp(d["created"] / 1000),
                    "commit": (m.get("githubCommitSha") or "")[:7],
                    "messaggio": (m.get("githubCommitMessage") or "").split("\n")[0][:90]})
    return out


def stato_progetto():
    st, p = vercel("/v9/projects/" + VERCEL_PROGETTO)
    if st != 200:
        return {"errore": p.get("errore") or (p.get("error") or {}).get("message", "Vercel non risponde")}
    prod = (p.get("targets") or {}).get("production") or {}
    return {"in_linea": prod.get("id"), "commit": ((prod.get("meta") or {}).get("githubCommitSha") or "")[:7],
            "rollback": p.get("lastRollbackTarget")}


def torna_a(uid):
    st, j = vercel("/v9/projects/%s/rollback/%s" % (VERCEL_PROGETTO, uid), "POST")
    return st in (200, 201, 202), j


def rimetti_ultima():
    v = versioni()
    if not v:
        return False, {"errore": "nessuna versione trovata"}
    st, j = vercel("/v10/projects/%s/promote/%s" % (VERCEL_PROGETTO, v[0]["id"]), "POST")
    return st in (200, 201, 202), j


# ----------------------------------------------------------------- database (sola lettura)
def aree_adesso():
    """Le righe di app_data com'è adesso: area → data dell'ultimo salvataggio."""
    env = leggi_env()
    url, chiave = env.get("SUPABASE_URL", ""), env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not chiave:
        return None
    st, testo, _ = http(url + "/rest/v1/app_data?select=domain,updated_at",
                        headers={"apikey": chiave, "Authorization": "Bearer " + chiave})
    if st != 200:
        return None
    try:
        return {r["domain"]: r.get("updated_at") for r in json.loads(testo)}
    except (ValueError, KeyError, TypeError):
        return None


# ----------------------------------------------------------------- backup
def elenco_backup():
    def leggi():
        dd = sorted((d for d in os.listdir(BACKUP) if d.startswith(PREFISSO_BACKUP)), reverse=True)
        out = []
        for d in dd[:30]:
            p = os.path.join(BACKUP, d)
            try:
                kb = os.path.getsize(os.path.join(p, "tabelle.json.gz")) // 1024
            except OSError:
                kb = None
            out.append({"nome": d, "percorso": p, "quando": data_da_nome(d, utc=True), "kb": kb})
        return out
    return con_timeout(leggi, 12, None)


def ultima_copia_sito():
    def leggi():
        dd = sorted((d for d in os.listdir(COPIE_SITO) if os.path.isdir(os.path.join(COPIE_SITO, d))), reverse=True)
        return {"nome": dd[0], "percorso": os.path.join(COPIE_SITO, dd[0]), "quando": data_da_nome(dd[0])} if dd else {}
    return con_timeout(leggi, 12, None)


_CACHE = {}


def aree_del_backup(cartella):
    """area → (data, KB) dentro tabelle.json.gz del backup."""
    if cartella not in _CACHE:
        with gzip.open(os.path.join(cartella, "tabelle.json.gz"), "rt", encoding="utf-8") as f:
            dati = json.load(f)
        righe = (dati.get("tabelle") or {}).get("app_data") or []
        _CACHE.clear()
        _CACHE[cartella] = {r.get("domain"): (r.get("updated_at"), len(json.dumps(r.get("data"))) // 1024) for r in righe}
    return _CACHE[cartella]


def info_attivita():
    nomi = ",".join("'%s'" % n for n in ATTIVITA)
    cmd = ("$ErrorActionPreference='SilentlyContinue'; foreach($n in @(%s)){ $t=Get-ScheduledTask -TaskName $n; "
           "if(-not $t){ \"$n|manca||\" } else { $i=Get-ScheduledTaskInfo -TaskName $n; "
           "\"$n|$($t.State)|$($i.LastRunTime.ToString('dd/MM HH:mm'))|$($i.LastTaskResult)\" } }" % nomi)
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-Command", cmd], capture_output=True, text=True,
                             timeout=30, creationflags=SENZA_FINESTRA).stdout
    except Exception:
        return []
    righe = []
    for r in out.splitlines():
        p = r.split("|")
        if len(p) == 4:
            righe.append({"nome": p[0], "stato": p[1], "ultima": p[2], "esito": p[3]})
    return righe


def ultima_riga(percorso):
    try:
        with open(percorso, encoding="utf-8", errors="replace") as f:
            righe = [r.strip() for r in f if r.strip()]
        return righe[-1] if righe else ""
    except OSError:
        return ""


def impronta_chiave():
    try:
        with open(CHIAVE_COPIA, encoding="utf-8") as f:
            return hashlib.sha256(bytes.fromhex(f.read().strip())).hexdigest()[:12].upper()
    except (OSError, ValueError):
        return None


# ----------------------------------------------------------------- comandi esterni
def esegui(argomenti, scrivi, cwd=None):
    """Lancia un comando e ne riporta l'uscita riga per riga nel diario."""
    try:
        p = subprocess.Popen(argomenti, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             text=True, encoding="utf-8", errors="replace", creationflags=SENZA_FINESTRA)
    except OSError as e:
        scrivi("Non parte: %s" % e)
        return False
    for r in p.stdout:
        if r.strip():
            scrivi("  " + r.rstrip())
    return p.wait() == 0


def chiavette():
    """Le unità rimovibili collegate (come nei Pannelli Linfa e my.rosaflor)."""
    import ctypes
    import shutil
    import string
    k32 = ctypes.windll.kernel32
    out = []
    maschera = k32.GetLogicalDrives()
    for i, lettera in enumerate(string.ascii_uppercase):
        if not (maschera >> i) & 1:
            continue
        radice = lettera + ":\\"
        if k32.GetDriveTypeW(radice) != 2:
            continue
        nome = ctypes.create_unicode_buffer(261)
        if not k32.GetVolumeInformationW(radice, nome, 261, None, None, None, None, 0):
            continue
        try:
            libero = shutil.disk_usage(radice).free
        except OSError:
            continue
        out.append({"radice": radice, "nome": nome.value or "senza nome", "liberi_gb": round(libero / 1e9, 1)})
    return out


# ----------------------------------------------------------------- controlli
def controlli():
    righe = []
    s = sito_risponde()
    righe.append(("ok" if s["ok"] else "ko", "Sito: %s (%s ms) — %s" % ("risponde" if s["ok"] else "NON risponde (%s)" % s["stato"], s["ms"], SITO)))
    p = stato_progetto()
    if p.get("errore"):
        righe.append(("ko", "Vercel: " + p["errore"]))
    else:
        v = versioni()
        ultima = v[0]["commit"] if v else "?"
        if p.get("rollback"):
            righe.append(("ko", "Sito FERMO su una versione precedente (%s): le nuove pubblicazioni non vanno in linea finché non premi «Rimetti l'ultima» nella scheda Sito." % p["commit"]))
        elif p["commit"] != ultima:
            righe.append(("ko", "In linea %s, ma l'ultima pubblicata è %s." % (p["commit"], ultima)))
        else:
            righe.append(("ok", "Versione in linea: %s (l'ultima)" % p["commit"]))
    a = aree_adesso()
    righe.append(("ok" if a else "ko", "Database: %s" % ("risponde, %d aree (%s)" % (len(a), ", ".join(sorted(a))) if a else "Supabase non risponde o mancano le chiavi in " + file_env())))
    bk = elenco_backup()
    if bk is None:
        righe.append(("ko", "Backup notturno: la cartella %s non risponde" % BACKUP))
    elif not bk:
        righe.append(("ko", "Backup notturno: nessuno in %s" % BACKUP))
    else:
        b = bk[0]
        ore = (datetime.datetime.now() - b["quando"]).total_seconds() / 3600 if b["quando"] else None
        righe.append(("ok" if ore is not None and ore < 30 else "ko",
                      "Ultimo backup notturno: %s (%s KB di dati; %d backup nell'elenco)%s" % (
                          b["quando"].strftime("%d/%m %H:%M") if b["quando"] else b["nome"], b["kb"], len(bk),
                          "" if ore is not None and ore < 30 else " — VECCHIO di %.0f ore" % (ore or 0))))
    c = ultima_copia_sito()
    if c is None:
        righe.append(("ko", "Copia completa del sito: la cartella %s non risponde" % COPIE_SITO))
    elif not c:
        righe.append(("ko", "Copia completa del sito: mai fatta (scheda Dati → «Fai la copia completa adesso»)"))
    else:
        giorni = (datetime.datetime.now() - c["quando"]).days if c["quando"] else None
        righe.append(("ok" if giorni is not None and giorni <= 8 else "ko",
                      "Copia completa del sito (codice + chiavi + dati): %s%s" % (
                          c["quando"].strftime("%d/%m/%Y") if c["quando"] else c["nome"],
                          "" if giorni is not None and giorni <= 8 else " — di %s giorni fa: rifalla (scheda Dati) o pianificala (scheda Istruzioni)" % giorni)))
    for t in info_attivita():
        if t["stato"] == "manca":
            if t["nome"] == ATTIVITA_COPIA:
                righe.append(("ko", "Attività «%s»: non pianificata (scheda Istruzioni → «Pianifica la copia completa ogni domenica»)" % t["nome"]))
            else:
                righe.append(("ko", "Attività «%s»: non c'è" % t["nome"]))
        else:
            ok = t["esito"] in ("0", "267009", "267011") and t["stato"] != "Disabled"
            righe.append(("ok" if ok else "ko", "Attività «%s»: %s, ultima %s, esito %s" % (t["nome"], t["stato"], t["ultima"] or "mai", t["esito"])))
    k = impronta_chiave()
    righe.append(("ok" if k else "ko", "Chiave delle copie cifrate: %s" % ("impronta " + k if k else "NON trovata in " + CHIAVE_COPIA)))
    r = ultima_riga(LOG_COPIA)
    if r:
        da_fare = "Manca" in r or "incompleto" in r or ("problemi" in r and " 0 problemi" not in r) or "ERRORE" in r
        righe.append(("ko" if da_fare else "ok", "Copia esterna della notte (anche GT One): " + r))
    return righe


ISTRUZIONI = """COSA SI SALVA, QUANDO, DOVE

1. Backup dei dati — ogni notte alle 2:30 (attività «GT One - Backup Database»)
   Tutte le aree del sito (utenti, insegne, Offerte Zoo, cartelli Arredo, Articoli, registro…),
   le foto e i file caricati, l'elenco degli account. Una cartella per notte in
   \\\\srvdoc\\ai\\backup\\academy-gt-backup-AAAA-MM-GG-HH-MM. Si tengono 60 giorni.

2. Codice — ogni notte alle 2:45 (attività «GT One - Backup Git») e a ogni modifica
   Su GitHub. Se è rimasta una modifica non salvata, la salva lei.

3. Copia completa del sito — codice + chiavi + ultimo backup dei dati, in una cartella sola
   In \\\\srvdoc\\ai_backup\\gtone\\<data>. Serve per rimettere in piedi il sito da zero.
   Si fa dalla scheda Dati («Fai la copia completa adesso») o si pianifica ogni domenica (pulsante qui sotto).

4. Copia fuori sede — ogni notte (attività «Sicurezza - Copia esterna»)
   L'ultimo backup dei dati va, cifrato, su Cloudflare R2: non si può cancellare nemmeno con la chiave.
   Serve se un virus cifra i server dell'ufficio.

5. Chiavetta — quando vuoi tu (scheda Chiavetta)
   Backup dei dati e copia completa, CIFRATI con la chiave del foglio in cassaforte (la stessa di
   my.rosaflor). Si apre su qualunque PC Windows con «APRI LA COPIA» dalla chiavetta. Consiglio:
   una volta al mese, e tenere la chiavetta lontano dall'ufficio.


COSA CONTROLLARE (2 minuti alla settimana)

· Scheda Stato: tutto verde. In particolare «Ultimo backup notturno» di stanotte e
  «Copia completa» di meno di 8 giorni.
· Il foglio della chiave in cassaforte: l'impronta stampata deve essere uguale a quella del pannello.


SE QUALCOSA VA STORTO

· Il sito non funziona dopo un aggiornamento → scheda «Sito: versioni», scegli la versione di prima,
  «Torna a questa versione». In pochi secondi il sito torna com'era; i dati non cambiano.
  Quando il problema è risolto: «Rimetti l'ultima».

· Qualcuno ha cancellato o rovinato dati di un'area (es. le offerte dello Zoo) →
  scheda Dati: scegli il backup della notte PRIMA dell'errore, scegli l'area, «Prova (non scrive)»:
  leggi il riepilogo. Se va bene, «Rimetti l'area dal backup…». Prima di scrivere il programma salva
  i dati di adesso in data\\prima-del-ripristino-<data> nella cartella del progetto: si può tornare indietro.
  ATTENZIONE: si perde tutto quello che è stato fatto in quell'area dopo il backup. Avvisa chi ci lavora,
  e fallo quando nessuno ci sta lavorando (chi salva dopo scrive sopra).

· Mancano foto o file → scheda Dati, «Rimetti anche i file (foto)…»: ricarica i file del backup.

· Il database è perso del tutto o il sito va rifatto da zero → serve la copia completa del sito
  (o la chiavetta): dentro c'è LEGGIMI.md con i passi. Di solito si fa insieme a Claude o al tecnico.


DA SAPERE

· Il piano gratuito di Supabase non ha backup propri: quello notturno è l'unico. Un errore delle 10
  del mattino si recupera allo stato della notte prima.
· Le password degli utenti stanno nell'area «academy»: rimettendo quell'area tornano quelle del backup.
· Le variabili di Vercel (chiavi del sito) sono nella copia completa (segreti\\env.local): tienila al sicuro.
· La chiave delle copie cifrate NON va mai sulla chiavetta: senza il foglio la chiavetta non si apre.
"""


# ----------------------------------------------------------------- finestra
def finestra():
    import tkinter as tk
    from tkinter import ttk, messagebox, filedialog

    root = tk.Tk()
    root.title("Pannello GT One")
    root.geometry("1040x800")
    try:
        root.iconbitmap(os.path.join(DATI, "gtone.ico"))
    except tk.TclError:
        pass
    st = ttk.Style()
    try:
        st.theme_use("vista")
    except tk.TclError:
        pass
    st.configure("Grande.TLabel", font=("Segoe UI", 14, "bold"))
    st.configure("Ok.TLabel", foreground="#15803d", font=("Segoe UI", 14, "bold"))
    st.configure("Ko.TLabel", foreground="#b91c1c", font=("Segoe UI", 14, "bold"))

    coda = queue.Queue()

    def scrivi(t):
        diario(t)
        coda.put(("diario", t))

    def in_ui(fn):
        coda.put(("ui", fn))

    def in_sfondo(fn):
        threading.Thread(target=fn, daemon=True).start()

    alto = ttk.Frame(root, padding=10)
    alto.pack(fill="x")
    lbl_stato = ttk.Label(alto, text="Controllo…", style="Grande.TLabel")
    lbl_stato.pack(side="left")
    ttk.Button(alto, text="Ricontrolla", command=lambda: in_sfondo(aggiorna)).pack(side="right")
    ttk.Button(alto, text="Apri GT One", command=lambda: os.startfile(SITO)).pack(side="right", padx=6)

    nb = ttk.Notebook(root)
    nb.pack(fill="both", expand=True, padx=10)

    # --- Stato
    f_stato = ttk.Frame(nb, padding=10)
    nb.add(f_stato, text="Stato")
    txt_stato = tk.Text(f_stato, height=18, wrap="word", font=("Segoe UI", 10), relief="flat", background="#f8fafc")
    txt_stato.tag_configure("ok", foreground="#15803d")
    txt_stato.tag_configure("ko", foreground="#b91c1c", font=("Segoe UI", 10, "bold"))
    txt_stato.pack(fill="both", expand=True)

    # --- Sito
    f_sito = ttk.Frame(nb, padding=10)
    nb.add(f_sito, text="Sito: versioni")
    ttk.Label(f_sito, wraplength=980, justify="left", text=(
        "Se dopo un aggiornamento GT One non funziona, scegli una versione precedente e premi «Torna a questa versione»: "
        "in pochi secondi il sito torna com'era. I dati non cambiano. Finché resti su una versione vecchia le nuove "
        "pubblicazioni NON vanno in linea: quando il problema è risolto premi «Rimetti l'ultima».")).pack(anchor="w")
    cols = ("quando", "commit", "messaggio")
    tv_ver = ttk.Treeview(f_sito, columns=cols, show="headings", height=12)
    for c, w in zip(cols, (140, 80, 720)):
        tv_ver.heading(c, text=c.capitalize())
        tv_ver.column(c, width=w, anchor="w")
    tv_ver.pack(fill="both", expand=True, pady=6)
    riga_sito = ttk.Frame(f_sito)
    riga_sito.pack(fill="x")
    lbl_sito = ttk.Label(riga_sito, text="")
    lbl_sito.pack(side="left")

    def carica_versioni():
        v = versioni()
        p = stato_progetto()

        def fai():
            tv_ver.delete(*tv_ver.get_children())
            for x in v:
                segno = "  ← IN LINEA" if x["commit"] == p.get("commit") else ""
                tv_ver.insert("", "end", iid=x["id"], values=(x["quando"].strftime("%d/%m %H:%M"), x["commit"], x["messaggio"] + segno))
            lbl_sito.configure(text=("⚠ Sito fermo su una versione precedente" if p.get("rollback") else "In linea: " + (p.get("commit") or "?")))
        in_ui(fai)

    def torna():
        sel = tv_ver.selection()
        if not sel:
            messagebox.showinfo("Pannello GT One", "Scegli prima una versione dall'elenco.")
            return
        voce = tv_ver.item(sel[0])["values"]
        if not messagebox.askyesno("Torna a una versione precedente",
                                   "Rimettere in linea la versione %s del %s?\n\n«%s»\n\nTutti vedranno quella versione finché non premi «Rimetti l'ultima»." % (voce[1], voce[0], voce[2])):
            return

        def fai():
            scrivi("Torno alla versione %s …" % voce[1])
            ok, j = torna_a(sel[0])
            scrivi(("✔ Fatto: in linea la versione %s." % voce[1]) if ok else "✖ Vercel ha risposto: %s — apro il pannello di Vercel, lì c'è «Instant Rollback»." % json.dumps(j)[:200])
            if not ok:
                os.startfile(VERCEL_PANNELLO)
            carica_versioni()
        in_sfondo(fai)

    def ultima():
        if not messagebox.askyesno("Rimetti l'ultima versione", "Rimettere in linea l'ultima versione pubblicata?"):
            return

        def fai():
            scrivi("Rimetto in linea l'ultima versione …")
            ok, j = rimetti_ultima()
            scrivi("✔ Fatto." if ok else "✖ Vercel ha risposto: %s — apro il pannello di Vercel." % json.dumps(j)[:200])
            if not ok:
                os.startfile(VERCEL_PANNELLO)
            carica_versioni()
        in_sfondo(fai)

    ttk.Button(riga_sito, text="Rimetti l'ultima", command=ultima).pack(side="right")
    ttk.Button(riga_sito, text="Torna a questa versione", command=torna).pack(side="right", padx=6)
    ttk.Button(riga_sito, text="Aggiorna elenco", command=lambda: in_sfondo(carica_versioni)).pack(side="right")

    # --- Dati
    f_dati = ttk.Frame(nb, padding=10)
    nb.add(f_dati, text="Dati: backup e ripristino")
    ttk.Label(f_dati, wraplength=980, justify="left", text=(
        "Ogni notte alle 2:30 si fa il backup di tutte le aree e dei file (tenuto 60 giorni). Da qui: farne uno adesso, fare "
        "la copia completa del sito, e rimettere i dati di un'area da un backup. Prima sempre «Prova (non scrive)»: dice "
        "cosa farebbe. «Rimetti l'area» sostituisce i dati di adesso con quelli del backup (prima li salva a parte).")).pack(anchor="w")
    riga_b = ttk.Frame(f_dati)
    riga_b.pack(fill="x", pady=6)
    ttk.Label(riga_b, text="Backup:").pack(side="left")
    cb_backup = ttk.Combobox(riga_b, width=46, state="readonly")
    cb_backup.pack(side="left", padx=4)
    elenco = {"voci": []}

    def carica_backup():
        bk = elenco_backup() or []

        def fai():
            elenco["voci"] = bk
            cb_backup["values"] = ["%s — %s KB di dati" % (b["quando"].strftime("%a %d/%m/%Y %H:%M") if b["quando"] else b["nome"], b["kb"]) for b in bk]
            if bk:
                cb_backup.current(0)
                in_sfondo(mostra_aree)
        in_ui(fai)

    def backup_scelto():
        i = cb_backup.current()
        return elenco["voci"][i]["percorso"] if 0 <= i < len(elenco["voci"]) else None

    def backup_adesso():
        if not messagebox.askyesno("Backup adesso", "Fare adesso un backup completo di dati e file? Ci vogliono un paio di minuti."):
            return

        def fai():
            scrivi("Backup in corso …")
            ok = esegui([NODE, "--env-file=" + file_env(), r"scripts\backup-database.mjs"], scrivi, cwd=PROGETTO)
            scrivi("✔ Backup fatto." if ok else "✖ Il backup non è riuscito: guarda le righe sopra.")
            carica_backup()
        in_sfondo(fai)

    def copia_completa():
        if not messagebox.askyesno("Copia completa del sito", "Fare adesso la copia completa (codice + chiavi + ultimo backup dei dati) in %s?\n\nCi vuole qualche minuto." % COPIE_SITO):
            return

        def fai():
            scrivi("Copia completa del sito in corso …")
            ok = esegui(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", os.path.join(PROGETTO, "scripts", "copia-sito.ps1")], scrivi, cwd=PROGETTO)
            scrivi("✔ Copia completa fatta." if ok else "✖ La copia completa non è riuscita: guarda le righe sopra.")
        in_sfondo(fai)

    ttk.Button(riga_b, text="Fai un backup adesso", command=backup_adesso).pack(side="right")
    ttk.Button(riga_b, text="Fai la copia completa adesso", command=copia_completa).pack(side="right", padx=4)
    ttk.Button(riga_b, text="Apri cartella", command=lambda: os.startfile(backup_scelto() or BACKUP)).pack(side="right")

    cols_a = ("area", "contenuto", "nel_backup", "adesso")
    tv_aree = ttk.Treeview(f_dati, columns=cols_a, show="headings", height=9, selectmode="browse")
    for c, t, w in zip(cols_a, ("Area", "Cosa c'è dentro", "Nel backup (ultimo salvataggio, dimensione)", "Adesso"), (130, 380, 260, 150)):
        tv_aree.heading(c, text=t)
        tv_aree.column(c, width=w, anchor="w")
    tv_aree.pack(fill="both", expand=True, pady=6)

    def mostra_aree():
        c = backup_scelto()
        if not c:
            return
        try:
            nel = aree_del_backup(c)
        except Exception as e:
            scrivi("✖ Non riesco a leggere il backup: %s" % e)
            return
        ora = aree_adesso() or {}

        def fai():
            tv_aree.delete(*tv_aree.get_children())
            for area in sorted(nel, key=lambda a: (a not in AREE, a)):
                quando, kb = nel[area]
                q = da_iso(quando).astimezone().strftime("%d/%m %H:%M") if quando else "?"
                o = da_iso(ora[area]).astimezone().strftime("%d/%m %H:%M") if ora.get(area) else "—"
                desc = AREE.get(area) or ("registro modifiche del mese" if area.startswith("registro_") else "")
                tv_aree.insert("", "end", iid=area, values=(area, desc, "%s, %s KB" % (q, kb), o))
        in_ui(fai)

    cb_backup.bind("<<ComboboxSelected>>", lambda e: in_sfondo(mostra_aree))

    def area_scelta():
        sel = tv_aree.selection()
        return sel[0] if sel else None

    def ripristino(davvero, con_file=False):
        c, area = backup_scelto(), area_scelta()
        if not c:
            return
        if not con_file and not area:
            messagebox.showinfo("Pannello GT One", "Scegli prima l'area dall'elenco.")
            return
        nome_b = cb_backup.get()
        if davvero:
            if con_file:
                domanda = "Ricaricare TUTTI i file (foto, loghi, allegati) del backup\n%s?\n\nI file con lo stesso nome vengono sovrascritti; quelli nuovi restano." % nome_b
            else:
                domanda = ("Rimettere l'area «%s» com'era nel backup\n%s?\n\nTutto quello che è stato fatto in quest'area DOPO il backup si perde "
                           "(i dati di adesso vengono salvati a parte, in data\\prima-del-ripristino). Avvisa chi ci lavora." % (area, nome_b))
            if not messagebox.askyesno("Ripristino", domanda) or not messagebox.askyesno("Ripristino", "Sicuro? È una modifica al sito vero."):
                return
        argomenti = [NODE, "--env-file=" + file_env(), r"scripts\ripristina-database.mjs", c]
        argomenti += ["--storage"] if con_file else ["--dominio", area]
        if davvero:
            argomenti.append("--esegui")

        def fai():
            scrivi(("Ripristino %s …" if davvero else "Prova di ripristino (non scrive) %s …") % ("dei file" if con_file else "dell'area " + area))
            ok = esegui(argomenti, scrivi, cwd=PROGETTO)
            if davvero:
                scrivi("✔ Fatto: il sito vede subito i dati rimessi." if ok else "✖ Non riuscito: guarda le righe sopra.")
            else:
                scrivi("Fine della prova: se il riepilogo va bene, premi «Rimetti l'area dal backup…»." if ok else "✖ La prova non è riuscita.")
            in_sfondo(mostra_aree)
        in_sfondo(fai)

    riga_d = ttk.Frame(f_dati)
    riga_d.pack(fill="x")
    ttk.Button(riga_d, text="Prova (non scrive)", command=lambda: ripristino(False)).pack(side="left")
    ttk.Button(riga_d, text="Rimetti l'area dal backup…", command=lambda: ripristino(True)).pack(side="left", padx=4)
    ttk.Button(riga_d, text="Rimetti anche i file (foto)…", command=lambda: ripristino(True, con_file=True)).pack(side="right")

    # --- Chiavetta
    f_usb = ttk.Frame(nb, padding=10)
    nb.add(f_usb, text="Chiavetta")
    ttk.Label(f_usb, wraplength=980, justify="left", text=(
        "Copia sulla chiavetta l'ultimo backup dei dati (con foto e file) e l'ultima copia completa del sito (codice e chiavi), "
        "CIFRATI (AES-256): chi trova la chiavetta senza la chiave non legge niente. La chiave è la stessa di my.rosaflor e "
        "NON va sulla chiavetta: tienila stampata in cassaforte. Dopo la copia il pannello riapre i file dalla chiavetta per "
        "essere sicuro che servano. Per aprirla, su qualunque PC Windows: doppio clic su «APRI LA COPIA» nella cartella "
        "GTOneBackup della chiavetta e si scrive la chiave del foglio. Servono circa 350 MB liberi (la prima volta).")).pack(anchor="w")
    lbl_chiave = ttk.Label(f_usb, text="")
    lbl_chiave.pack(anchor="w", pady=4)
    riga_u = ttk.Frame(f_usb)
    riga_u.pack(fill="x", pady=6)
    ttk.Label(riga_u, text="Chiavetta:").pack(side="left")
    cb_usb = ttk.Combobox(riga_u, width=46, state="readonly")
    cb_usb.pack(side="left", padx=4)
    usb = {"voci": []}

    def carica_usb():
        u = chiavette()

        def fai():
            usb["voci"] = u
            cb_usb["values"] = ["%s  %s  (%.1f GB liberi)" % (x["radice"], x["nome"], x["liberi_gb"]) for x in u] or ["nessuna chiavetta collegata"]
            cb_usb.current(0)
            k = impronta_chiave()
            lbl_chiave.configure(text=("Chiave delle copie: impronta %s (deve coincidere con quella stampata)" % k) if k else "⚠ Chiave non trovata: " + CHIAVE_COPIA)
        in_ui(fai)

    def scegli_cartella():
        d = filedialog.askdirectory(title="Cartella di destinazione (disco esterno)")
        if d:
            usb["voci"].insert(0, {"radice": d, "nome": "cartella scelta", "liberi_gb": 0})
            cb_usb["values"] = [d + "  (cartella scelta)"] + list(cb_usb["values"])
            cb_usb.current(0)

    def copia_usb():
        i = cb_usb.current()
        if not usb["voci"] or i < 0 or i >= len(usb["voci"]):
            messagebox.showinfo("Pannello GT One", "Collega una chiavetta e premi «Cerca chiavette» (o scegli una cartella).")
            return
        dest = usb["voci"][i]["radice"]

        def fai():
            scrivi("Copia cifrata di GT One su %s …" % dest)
            ok = esegui([NODE, COPIA_ESTERNA, "chiavetta-gtone", dest], scrivi, cwd=r"C:\SicurezzaDati")
            scrivi("✔ Copia sulla chiavetta pronta e verificata. Prima di staccarla: «Rimozione sicura dell'hardware»." if ok else "✖ Copia non riuscita: guarda le righe sopra.")
            carica_usb()
        in_sfondo(fai)

    def stampa_chiave():
        if not os.path.exists(FOGLIO_CHIAVE):
            messagebox.showwarning("Pannello GT One", "Non trovo " + FOGLIO_CHIAVE)
            return
        if messagebox.askyesno("Stampa la chiave", "Stampare adesso il foglio della chiave sulla stampante predefinita?\n\n(No = lo apro soltanto, lo stampi tu)"):
            os.startfile(FOGLIO_CHIAVE, "print")
            scrivi("Foglio della chiave mandato in stampa: mettilo in cassaforte, mai insieme alla chiavetta.")
        else:
            os.startfile(FOGLIO_CHIAVE)

    riga_u2 = ttk.Frame(f_usb)
    riga_u2.pack(fill="x")
    ttk.Button(riga_u2, text="Cerca chiavette", command=lambda: in_sfondo(carica_usb)).pack(side="left")
    ttk.Button(riga_u2, text="Scegli un'altra cartella…", command=scegli_cartella).pack(side="left", padx=4)
    ttk.Button(riga_u2, text="Copia sulla chiavetta", command=copia_usb).pack(side="right")
    ttk.Button(riga_u2, text="Stampa il foglio della chiave", command=stampa_chiave).pack(side="right", padx=6)

    # --- Istruzioni
    f_istr = ttk.Frame(nb, padding=10)
    nb.add(f_istr, text="Istruzioni")
    riga_i = ttk.Frame(f_istr)
    riga_i.pack(fill="x", pady=(0, 6))

    def apri_guida():
        try:
            os.startfile(GUIDA)
        except OSError:
            messagebox.showwarning("Pannello GT One", "Non trovo " + GUIDA + " (la cartella di rete risponde?)")

    def pianifica_copia():
        if not messagebox.askyesno("Pianifica la copia completa",
                                   "Creare l'attività «%s», ogni domenica alle 05:00, su questo PC?\n\n"
                                   "Gira quando sei collegato a Windows (come le altre del PC AI). Si può togliere dall'Utilità di pianificazione." % ATTIVITA_COPIA):
            return

        def fai():
            script = os.path.join(PROGETTO, "scripts", "copia-sito.ps1")
            azione = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%s"' % script
            ok = esegui(["schtasks", "/Create", "/F", "/SC", "WEEKLY", "/D", "SUN", "/ST", "05:00", "/TN", ATTIVITA_COPIA, "/TR", azione], scrivi)
            scrivi(("✔ Pianificata: ogni domenica alle 05:00." if ok else "✖ Non riuscito: guarda le righe sopra."))
            aggiorna()
        in_sfondo(fai)

    ttk.Button(riga_i, text="Apri la guida completa", command=apri_guida).pack(side="left")
    ttk.Button(riga_i, text="Pianifica la copia completa ogni domenica", command=pianifica_copia).pack(side="left", padx=6)
    ttk.Button(riga_i, text="Apri la cartella dei backup", command=lambda: os.startfile(BACKUP)).pack(side="right")
    ttk.Button(riga_i, text="Apri le copie complete", command=lambda: os.startfile(COPIE_SITO)).pack(side="right", padx=6)
    txt_istr = tk.Text(f_istr, wrap="word", font=("Segoe UI", 10), relief="flat", background="#f8fafc")
    barra = ttk.Scrollbar(f_istr, command=txt_istr.yview)
    txt_istr.configure(yscrollcommand=barra.set)
    barra.pack(side="right", fill="y")
    txt_istr.pack(fill="both", expand=True)
    txt_istr.tag_configure("titolo", font=("Segoe UI", 11, "bold"), foreground="#1f3b2d")
    for riga in ISTRUZIONI.split("\n"):
        txt_istr.insert("end", riga + "\n", "titolo" if riga.isupper() and riga.strip() else ())
    txt_istr.configure(state="disabled")

    # --- Diario
    ttk.Label(root, text="Diario delle azioni:", padding=(10, 6, 0, 0)).pack(anchor="w")
    txt_diario = tk.Text(root, height=9, wrap="word", font=("Consolas", 9), background="#0f172a", foreground="#e2e8f0")
    txt_diario.pack(fill="x", padx=10, pady=(0, 10))

    def aggiorna():
        in_ui(lambda: lbl_stato.configure(text="Controllo…", style="Grande.TLabel"))
        righe = controlli()

        def fai():
            txt_stato.configure(state="normal")
            txt_stato.delete("1.0", "end")
            for tipo, testo in righe:
                txt_stato.insert("end", ("✔ " if tipo == "ok" else "✖ ") + testo + "\n", tipo)
            txt_stato.configure(state="disabled")
            male = sum(1 for t, _ in righe if t == "ko")
            lbl_stato.configure(text=("● Tutto a posto" if not male else "● %d cose da guardare" % male), style="Ok.TLabel" if not male else "Ko.TLabel")
        in_ui(fai)
        carica_versioni()
        carica_backup()
        carica_usb()

    def pompa():
        try:
            while True:
                tipo, x = coda.get_nowait()
                if tipo == "diario":
                    txt_diario.insert("end", x + "\n")
                    txt_diario.see("end")
                else:
                    x()
        except queue.Empty:
            pass
        root.after(150, pompa)

    pompa()
    in_sfondo(aggiorna)
    if "--prova-finestra" in sys.argv:
        # Per provarlo da uno script: si apre, controlla, si richiude da sola.
        root.after(30000, lambda: (print(txt_stato.get("1.0", "end").strip()[:1500]), print("versioni:", len(tv_ver.get_children()), "aree:", len(tv_aree.get_children())), root.destroy()))
    root.mainloop()


if __name__ == "__main__":
    if "--controlla" in sys.argv:
        for tipo, testo in controlli():
            print(("OK  " if tipo == "ok" else "XX  ") + testo)
    else:
        finestra()
