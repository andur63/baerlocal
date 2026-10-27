# Startet den lokalen BärGPT-Stack mit LM Studio (http://localhost:1234)
$ErrorActionPreference = "Stop"

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  BärGPT Lokaler Webhost (LM Studio + Docker Stack)" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

# 0. Stelle sicher, dass lokale .env-Dateien existieren (z. B. nach frischem git clone)
if (-not (Test-Path "apps/backend/.env") -and (Test-Path "apps/backend/.env.local.example")) {
    Copy-Item "apps/backend/.env.local.example" "apps/backend/.env"
    Write-Host "[OK] apps/backend/.env aus Vorlage erstellt." -ForegroundColor Green
}
if (-not (Test-Path "apps/frontend/.env") -and (Test-Path "apps/frontend/.env.local.example")) {
    Copy-Item "apps/frontend/.env.local.example" "apps/frontend/.env"
    Write-Host "[OK] apps/frontend/.env aus Vorlage erstellt." -ForegroundColor Green
}

# 1. Prüfe LM Studio Server auf Port 1234
try {
    $models = Invoke-RestMethod -Uri "http://localhost:1234/v1/models" -TimeoutSec 3
    $loadedCount = ($models.data | Measure-Object).Count
    Write-Host "[OK] LM Studio Server erreichbar auf http://localhost:1234 ($loadedCount Modell(e) verfügbar)" -ForegroundColor Green
} catch {
    Write-Host "[HINWEIS] LM Studio Server unter http://localhost:1234 noch nicht erreichbar." -ForegroundColor Yellow
    Write-Host "          Bitte in LM Studio unter 'Developer / Local Server' den Server auf Port 1234 starten" -ForegroundColor Yellow
    Write-Host "          und ein Sprachmodell laden." -ForegroundColor Yellow
}

# 2. Prüfe Docker Engine
try {
    docker info *> $null
    Write-Host "[OK] Docker Engine läuft." -ForegroundColor Green
} catch {
    Write-Host "[FEHLER] Docker Desktop läuft noch nicht. Bitte starte zuerst Docker Desktop." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Starte BärGPT-Stack (Supabase + Backend + Frontend)..." -ForegroundColor Cyan
Write-Host "  -> Chat-Oberfläche: http://localhost:5173" -ForegroundColor Green
Write-Host "  -> Direkt-Login:    Button 'Lokaler Direkt-Login (Admin)' auf der Login-Seite" -ForegroundColor Green
Write-Host "  -> Mailpit (OTPs):  http://localhost:54324" -ForegroundColor Green
Write-Host ""

docker compose -f compose.local.yml up --build --force-recreate
