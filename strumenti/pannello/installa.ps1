# GT One: chiavi fuori dalla cartella di rete e copia completa ogni domenica (25/10/2026).
# Va lanciato UNA volta, da PowerShell «Esegui come amministratore»:
#   powershell -ExecutionPolicy Bypass -File C:\GTOneDati\installa.ps1
#
# Cosa fa (come C:\SicurezzaDati\installa.ps1 ha fatto per my.rosaflor):
#   1. il backup notturno di GT One legge le chiavi da C:\GTOneDati\segreti
#   2. crea «GT One - Copia completa» (ogni domenica alle 05:00): codice + chiavi + dati in \\srvdoc\ai_backup\gtone
#   3. toglie le chiavi di GT One dalla cartella di rete (solo se la copia locale è identica)
#   4. dice al guardiano anti-ransomware che questi cambi sono voluti
$ErrorActionPreference = 'Stop'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Write-Host 'Va lanciato come amministratore (tasto destro su PowerShell → Esegui come amministratore).' -ForegroundColor Red; exit 1 }

$utente = 'AI\admin'
$segreti = 'C:\GTOneDati\segreti'
$repo = '\\srvdoc\ai\Progetti AI\Academy GT\academy-gt'
$principale = New-ScheduledTaskPrincipal -UserId $utente -LogonType Interactive -RunLevel Limited

if (-not (Test-Path -LiteralPath "$segreti\.env.local")) { Write-Host "Manca $segreti\.env.local: mi fermo." -ForegroundColor Red; exit 1 }

# 1. Backup notturno di GT One
$t = Get-ScheduledTask -TaskName 'GT One - Backup Database'
$a = $t.Actions[0]
$a.Arguments = '--env-file="C:\GTOneDati\segreti\.env.local" "scripts\backup-database.mjs"'
Set-ScheduledTask -TaskName 'GT One - Backup Database' -Action $a | Out-Null
Write-Host '1. Backup di GT One: legge le chiavi da C:\GTOneDati\segreti' -ForegroundColor Green

# 2. Copia completa ogni domenica
$azC = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$repo\scripts\copia-sito.ps1`"" -WorkingDirectory $repo
$trC = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '05:00'
$opzC = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'GT One - Copia completa' -Action $azC -Trigger $trC -Principal $principale -Settings $opzC -Description 'Copia completa di GT One (codice + chiavi + ultimo backup dei dati) in \\srvdoc\ai_backup\gtone, tiene le ultime 6 (scripts\copia-sito.ps1).' -Force | Out-Null
Write-Host '2. Creata «GT One - Copia completa» (ogni domenica alle 05:00)' -ForegroundColor Green

# 3. Via le chiavi dalla cartella di rete, solo se la copia locale è identica
$rete = "$repo\.env.local"
if (Test-Path -LiteralPath $rete) {
  if ((Get-FileHash -LiteralPath $rete).Hash -ne (Get-FileHash -LiteralPath "$segreti\.env.local").Hash) {
    Write-Host "   $rete è diverso dalla copia locale: lo lascio, controlla a mano." -ForegroundColor Yellow
  } else {
    Remove-Item -LiteralPath $rete -Force
    Write-Host "3. Tolto dalla cartella di rete: $rete" -ForegroundColor Green
  }
} else {
  Write-Host '3. Nella cartella di rete le chiavi non ci sono già più.' -ForegroundColor Green
}

# 4. Il guardiano prende nota che questi cambi sono voluti: lo si fa girare dalla
#    sua attività, come utente normale (da amministratore elevato vedrebbe attività diverse).
$azG = (Get-ScheduledTask -TaskName 'Sicurezza - Guardiano').Actions[0]
$azA = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\SicurezzaDati\guardia.ps1" -Approva'
Set-ScheduledTask -TaskName 'Sicurezza - Guardiano' -Action $azA | Out-Null
Start-ScheduledTask -TaskName 'Sicurezza - Guardiano'
$fine = (Get-Date).AddMinutes(3)
do { Start-Sleep -Seconds 3 } while ((Get-ScheduledTask -TaskName 'Sicurezza - Guardiano').State -eq 'Running' -and (Get-Date) -lt $fine)
Set-ScheduledTask -TaskName 'Sicurezza - Guardiano' -Action $azG | Out-Null
Get-Content 'C:\SicurezzaDati\log\guardia.log' -Tail 1
Write-Host '4. Guardiano: impronte aggiornate' -ForegroundColor Green
Write-Host ''
Write-Host 'Fatto. Controlla nel Pannello GT One (Ricontrolla): deve essere tutto verde.' -ForegroundColor Cyan
Write-Host 'Da adesso, per i comandi a mano sul progetto: --env-file="C:\GTOneDati\segreti\.env.local"' -ForegroundColor Cyan
