# Copia completa del sito GT One / Academy GT in \\srvdoc\ai_backup\gtone\<data>:
#   codice.bundle      tutto il repository git (ogni ramo, ogni commit)
#   segreti\env.local  le chiavi (Supabase, segreti dei cookie, Zoho…): NON condividere
#   dati\              l'ultimo backup notturno di database + file (tabelle.json.gz, storage\)
#   manifest.json      cosa c'è dentro, da quale commit, quando
#   LEGGIMI.md         come si rimette in piedi il sito da questa cartella
# Tiene le ultime 6 copie. Si lancia a mano o pianificato (vedi docs/BACKUP-E-RIPRISTINO.md).
#
#   powershell -ExecutionPolicy Bypass -File scripts\copia-sito.ps1

$ErrorActionPreference = "Stop"
$progetto = Split-Path -Parent $PSScriptRoot
$base = "\\srvdoc\ai_backup\gtone"
$bollo = Get-Date -Format "yyyy-MM-dd-HH-mm"
$dest = Join-Path $base $bollo
Set-Location $progetto

New-Item -ItemType Directory -Force (Join-Path $dest "segreti") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $dest "dati") | Out-Null

# 1. codice: un bundle git contiene tutta la storia, si riapre con "git clone codice.bundle"
$commit = (git rev-parse HEAD).Trim()
$ramo = (git rev-parse --abbrev-ref HEAD).Trim()
$nonSalvate = git status --porcelain
git bundle create (Join-Path $dest "codice.bundle") --all
if ($nonSalvate) {
    # modifiche non ancora in un commit: le si mette a parte, così non vanno perse
    git diff HEAD | Out-File -Encoding utf8 (Join-Path $dest "modifiche-non-salvate.diff")
}

# 2. segreti
Copy-Item (Join-Path $progetto ".env.local") (Join-Path $dest "segreti\env.local")

# 3. dati: l'ultimo backup notturno (database + file)
$ultimo = Get-ChildItem "\\srvdoc\ai\backup" -Directory -Filter "academy-gt-backup-*" | Sort-Object Name | Select-Object -Last 1
if ($ultimo) {
    robocopy $ultimo.FullName (Join-Path $dest "dati") /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy dei dati fallito (codice $LASTEXITCODE)" }
}

# 4. manifest
$dimensione = (Get-ChildItem $dest -Recurse -File | Measure-Object Length -Sum).Sum
$manifest = [ordered]@{
    creato_il        = (Get-Date).ToString("s")
    commit           = $commit
    ramo             = $ramo
    modifiche_non_salvate = [bool]$nonSalvate
    backup_dati      = if ($ultimo) { $ultimo.Name } else { $null }
    file_storage     = if ($ultimo) { (Get-ChildItem (Join-Path $dest "dati\storage") -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count } else { 0 }
    dimensione_mb    = [math]::Round($dimensione / 1MB, 1)
    sito             = "https://gardenteam.vercel.app"
    github           = (git remote get-url origin).Trim()
}
$manifest | ConvertTo-Json | Out-File -Encoding utf8 (Join-Path $dest "manifest.json")

# 5. istruzioni
@'
# Come rimettere in piedi GT One da questa cartella

Serve un PC con Node.js (versione 20 o più recente) e Git.

## 1. Codice
    git clone codice.bundle gtone
    cd gtone
    npm install

## 2. Chiavi
Copia `segreti\env.local` dentro la cartella `gtone` col nome `.env.local`.
Le stesse variabili vanno messe nel progetto Vercel (Settings → Environment Variables)
se il progetto Vercel va ricreato: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_COOKIE_SECRET,
SSO_SHARED_SECRET, CRON_SECRET, ARTICOLI_INBOUND_SECRET, RESEND_API_KEY e le altre che trovi nel file.

## 3. Dati
Se il database Supabase c'è ancora: niente da fare, i dati sono lì.
Se è andato perso o è da riportare indietro: crea un progetto Supabase, esegui `data/supabase-schema.sql`
nel suo SQL Editor, metti le nuove chiavi in `.env.local`, poi

    node --env-file=.env.local scripts/ripristina-database.mjs "<questa cartella>\dati" --storage --esegui

(senza `--esegui` fa solo una prova e dice cosa farebbe).

## 4. Online
    npx vercel --prod --yes

Il dominio e il cron (controllo casella Articoli) sono in vercel.json e nelle impostazioni del progetto Vercel.

Guida completa: docs/BACKUP-E-RIPRISTINO.md dentro il codice.
'@ | Out-File -Encoding utf8 (Join-Path $dest "LEGGIMI.md")

# 6. tiene le ultime 6 copie
Get-ChildItem $base -Directory | Sort-Object Name -Descending | Select-Object -Skip 6 | ForEach-Object {
    Remove-Item $_.FullName -Recurse -Force
}

Write-Output "Copia fatta in $dest ($([math]::Round($dimensione / 1MB, 1)) MB, commit $($commit.Substring(0,7)))"
