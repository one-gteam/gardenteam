# GT One - Fox: manda a GT One giacenza e prezzo di vendita degli articoli dello Zoo,
# letti in SOLA LETTURA dalla cartella "db" del gestionale Fox (Areabyte):
#   ARTICOLI.CSV  codice;descrizione;listino;qtamag;...   (si leggono solo codice, listino, qtamag)
#   BARCODE.CSV   barcode;codice
# Il prezzo d'acquisto e le altre colonne non vengono lette. Si mandano solo gli
# articoli che GT One chiede (il catalogo Zoo), non l'anagrafica intera.
#
# E' un file di testo: si puo' aprire col Blocco note e leggere tutto prima di usarlo.
#
# Uso (da PowerShell, nella cartella dove avete salvato il file):
#   powershell -ExecutionPolicy Bypass -File .\GTOne-Fox.ps1            configura e prova
#   powershell -ExecutionPolicy Bypass -File .\GTOne-Fox.ps1 -Invia     invio silenzioso (per la pianificazione)
#   powershell -ExecutionPolicy Bypass -File .\GTOne-Fox.ps1 -Verifica  legge i file senza mandare niente
#
# Impostazioni in GTOne-Fox.ini e registro in GTOne-Fox.log, accanto a questo file.

param([switch]$Invia, [switch]$Verifica)

$ErrorActionPreference = "Stop"
$Versione = "ps-1.0"
$Indirizzo = "https://gardenteam.vercel.app"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Qui = Split-Path -Parent $MyInvocation.MyCommand.Path
$Ini = Join-Path $Qui "GTOne-Fox.ini"
$Log = Join-Path $Qui "GTOne-Fox.log"

function Scrivi-Registro([string]$testo) {
  try {
    if ((Test-Path $Log) -and (Get-Item $Log).Length -gt 1MB) { Remove-Item $Log }
    Add-Content -Path $Log -Value ((Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "  " + $testo) -Encoding UTF8
  } catch { }
}

function Leggi-Config {
  $c = @{ cartella = ""; chiave = ""; indirizzo = $Indirizzo }
  if (Test-Path $Ini) {
    foreach ($riga in Get-Content $Ini -Encoding UTF8) {
      $i = $riga.IndexOf("=")
      if ($i -lt 0) { continue }
      $k = $riga.Substring(0, $i).Trim().ToLower(); $v = $riga.Substring($i + 1).Trim()
      if ($k -eq "cartella") { $c.cartella = $v }
      elseif ($k -eq "chiave") { $c.chiave = $v }
      elseif ($k -eq "indirizzo" -and $v.StartsWith("https://")) { $c.indirizzo = $v.TrimEnd("/") }
    }
  }
  return $c
}

function Salva-Config($c) {
  $testo = "cartella=" + $c.cartella + "`r`nchiave=" + $c.chiave + "`r`nindirizzo=" + $c.indirizzo + "`r`n"
  [IO.File]::WriteAllText($Ini, $testo, (New-Object Text.UTF8Encoding($false)))
}

# Apre il file in sola lettura lasciando che Fox continui a scriverlo.
function Apri-SoloLettura([string]$percorso) {
  $fs = New-Object IO.FileStream($percorso, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
  return New-Object IO.StreamReader($fs, [Text.Encoding]::GetEncoding(28591))
}

$Inv = [Globalization.CultureInfo]::InvariantCulture

function Colonna($testa, [string]$nome) {
  for ($i = 0; $i -lt $testa.Length; $i++) { if ($testa[$i].Trim().ToLower() -eq $nome) { return $i } }
  return -1
}

# BARCODE.CSV: barcode -> codice, tenendo solo i barcode in $servono (tutti se $null).
function Leggi-Barcode([string]$cartella, $servono) {
  $p = Join-Path $cartella "BARCODE.CSV"
  $ris = @{}
  $n = 0
  if (-not (Test-Path $p)) { return @($ris, 0) }  # senza, valgono i codici articolo uguali all'EAN
  $r = Apri-SoloLettura $p
  try {
    $testa = ("" + $r.ReadLine()).Split(";")
    $iBar = Colonna $testa "barcode"; if ($iBar -lt 0) { $iBar = 0 }
    $iCod = Colonna $testa "codice"; if ($iCod -lt 0) { $iCod = 1 }
    $max = [Math]::Max($iBar, $iCod)
    while ($null -ne ($riga = $r.ReadLine())) {
      $n++
      if ($null -eq $servono) { continue }
      $c = $riga.Split(";")
      if ($c.Length -le $max) { continue }
      $b = $c[$iBar].Trim()
      if ($servono.Contains($b) -and -not $ris.ContainsKey($b)) { $ris[$b] = $c[$iCod].Trim() }
    }
  } finally { $r.Close() }
  return @($ris, $n)
}

# ARTICOLI.CSV: codice -> (prezzo di vendita, giacenza), solo per i codici in $servono (nessuno se $null).
function Leggi-Articoli([string]$cartella, $servono) {
  $p = Join-Path $cartella "ARTICOLI.CSV"
  if (-not (Test-Path $p)) { throw "Non trovo ARTICOLI.CSV in $cartella (serve la cartella 'db' del gestionale Fox)." }
  $ris = @{}
  $n = 0
  $r = Apri-SoloLettura $p
  try {
    $testa = ("" + $r.ReadLine()).Split(";")
    $iCod = Colonna $testa "codice"; $iList = Colonna $testa "listino"; $iQta = Colonna $testa "qtamag"
    if ($iCod -lt 0 -or $iList -lt 0 -or $iQta -lt 0) { throw "ARTICOLI.CSV non ha le colonne attese (codice, listino, qtamag)." }
    $max = [Math]::Max($iCod, [Math]::Max($iList, $iQta))
    while ($null -ne ($riga = $r.ReadLine())) {
      $n++
      if ($null -eq $servono) { continue }
      $c = $riga.Split(";")
      if ($c.Length -le $max) { continue }
      $cod = $c[$iCod].Trim()
      if (-not $servono.Contains($cod)) { continue }
      $prezzo = 0.0; $qta = 0.0
      [void][double]::TryParse($c[$iList].Trim().Replace(",", "."), [Globalization.NumberStyles]::Float, $Inv, [ref]$prezzo)
      [void][double]::TryParse($c[$iQta].Trim().Replace(",", "."), [Globalization.NumberStyles]::Float, $Inv, [ref]$qta)
      $ris[$cod] = @([Math]::Round($prezzo, 2), [int][Math]::Round($qta))
    }
  } finally { $r.Close() }
  return @($ris, $n)
}

function Chiama($c, [string]$metodo, [string]$corpo) {
  $url = $c.indirizzo.TrimEnd("/") + "/api/connettori/fox"
  $h = @{ Authorization = "Bearer " + $c.chiave }
  try {
    if ($metodo -eq "GET") { return Invoke-RestMethod -Uri $url -Headers $h -UserAgent "GTOne-Fox/$Versione" -UseBasicParsing }
    $byte = [Text.Encoding]::UTF8.GetBytes($corpo)
    return Invoke-RestMethod -Uri $url -Method Post -Headers $h -Body $byte -ContentType "application/json; charset=utf-8" -UserAgent "GTOne-Fox/$Versione" -UseBasicParsing
  } catch {
    $msg = $_.Exception.Message
    try {
      $testo = $_.ErrorDetails.Message
      if (-not $testo -and $_.Exception.Response) { $testo = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() }
      $j = $testo | ConvertFrom-Json
      if ($j.error) { $msg = $j.error }
    } catch { }
    throw "GT One: $msg"
  }
}

function Esegui($c, [bool]$soloVerifica) {
  if (-not $c.cartella) { throw "Manca la cartella degli archivi Fox." }
  $t0 = Get-Date
  $fileAl = $null
  if (Test-Path (Join-Path $c.cartella "ARTICOLI.CSV")) { $fileAl = (Get-Item (Join-Path $c.cartella "ARTICOLI.CSV")).LastWriteTime }
  if ($soloVerifica) {
    $a = Leggi-Articoli $c.cartella $null
    $b = Leggi-Barcode $c.cartella $null
    return "VERIFICA: lette $($a[1]) righe di ARTICOLI.CSV e $($b[1]) di BARCODE.CSV (file del $($fileAl.ToString('dd/MM HH:mm'))) in $([int]((Get-Date) - $t0).TotalMilliseconds) ms. Nessun invio."
  }
  if (-not $c.chiave) { throw "Manca la chiave di GT One (GT One -> Connettori)." }

  # prima si chiede a GT One quali EAN servono, poi si legge solo quello
  $richiesta = Chiama $c "GET" ""
  $eans = New-Object 'Collections.Generic.HashSet[string]'
  foreach ($e in @($richiesta.eans)) { [void]$eans.Add("" + $e) }
  $b = Leggi-Barcode $c.cartella $eans
  $barcode = $b[0]
  $codici = New-Object 'Collections.Generic.HashSet[string]'
  foreach ($e in $eans) { if ($barcode.ContainsKey($e)) { [void]$codici.Add($barcode[$e]) } else { [void]$codici.Add($e) } }
  $a = Leggi-Articoli $c.cartella $codici
  $articoli = $a[0]

  $righe = New-Object Collections.ArrayList
  foreach ($ean in $eans) {
    $cod = if ($barcode.ContainsKey($ean)) { $barcode[$ean] } else { $ean }  # a volte il codice articolo e' l'EAN stesso
    if (-not $articoli.ContainsKey($cod)) { continue }
    $v = $articoli[$cod]
    [void]$righe.Add([ordered]@{ ean = $ean; codice = $cod; giacenza = $v[1]; prezzo = $v[0] })
  }
  $corpo = [ordered]@{ righe = $righe.ToArray(); fileAl = $fileAl.ToString("yyyy-MM-ddTHH:mm:ss"); versione = $Versione } | ConvertTo-Json -Depth 4 -Compress
  $esito = Chiama $c "POST" $corpo
  return "INVIATO a GT One ($($richiesta.ambito)): $($esito.righe) articoli dello Zoo su $($eans.Count) chiesti; lette $($a[1]) righe di ARTICOLI.CSV e $($b[1]) di BARCODE.CSV in $([int]((Get-Date) - $t0).TotalSeconds) s."
}

$cfg = Leggi-Config

if ($Invia -or $Verifica) {
  try { Scrivi-Registro (Esegui $cfg ([bool]$Verifica)); exit 0 }
  catch { Scrivi-Registro ("ERRORE: " + $_.Exception.Message); exit 1 }
}

# --- configurazione guidata ---
Write-Host ""
Write-Host "GT One - Fox  (versione $Versione)" -ForegroundColor Green
Write-Host "Legge ARTICOLI.CSV e BARCODE.CSV di Fox in sola lettura e manda a GT One giacenza e prezzo degli articoli dello Zoo."
Write-Host ""

$risposta = Read-Host "Cartella 'db' di Fox [$($cfg.cartella)]"
if ($risposta) { $cfg.cartella = $risposta.Trim().Trim('"') }
$mostra = if ($cfg.chiave) { $cfg.chiave.Substring(0, [Math]::Min(8, $cfg.chiave.Length)) + "..." } else { "" }
$risposta = Read-Host "Chiave di GT One (Connettori, inizia con gtf_) [$mostra]"
if ($risposta) { $cfg.chiave = $risposta.Trim() }
Salva-Config $cfg

try {
  Write-Host ""
  Write-Host "Provo la lettura..."
  $e = Esegui $cfg $true
  Write-Host $e -ForegroundColor Green
  Scrivi-Registro $e
} catch {
  Write-Host ("ERRORE: " + $_.Exception.Message) -ForegroundColor Red
  Read-Host "Premi Invio per chiudere"
  exit 1
}

if ((Read-Host "Mando adesso a GT One? (S/N)") -match "^[sS]") {
  try { $e = Esegui $cfg $false; Write-Host $e -ForegroundColor Green; Scrivi-Registro $e }
  catch { Write-Host ("ERRORE: " + $_.Exception.Message) -ForegroundColor Red; Scrivi-Registro ("ERRORE: " + $_.Exception.Message) }
}

if ((Read-Host "Invio automatico ogni ora con l'Utilita' di pianificazione? (S/N)") -match "^[sS]") {
  $percorso = $MyInvocation.MyCommand.Path
  $comando = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$percorso`" -Invia"
  schtasks.exe /Create /F /SC HOURLY /TN "GT One Fox" /TR $comando | Out-Host
  if ($LASTEXITCODE -eq 0) { Write-Host "Fatto: l'attivita' 'GT One Fox' manda i dati ogni ora (registro in $Log)." -ForegroundColor Green }
}
Read-Host "Premi Invio per chiudere"
