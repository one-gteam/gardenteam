# Rete di sicurezza: se ci sono modifiche al codice non ancora salvate su
# GitHub (es. una sessione di lavoro finita senza commit), le mette al sicuro
# da sole ogni notte. Non sostituisce i commit descrittivi fatti durante il
# lavoro: è solo un backup automatico di ciò che è rimasto indietro.
# Pianificato sul server AI (\\srvdoc\ai).
Set-Location "\\srvdoc\ai\Progetti AI\Academy GT\academy-gt"

$modifiche = git status --porcelain
if ([string]::IsNullOrWhiteSpace($modifiche)) {
    Write-Output "Nessuna modifica da salvare."
    exit 0
}

git add -A
git commit -m "Backup automatico $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
git push origin main
