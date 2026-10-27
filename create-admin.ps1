# Legt den lokalen Admin-Benutzer (local.admin@ts.berlin / LocalAdmin123!) direkt im laufenden lokalen Supabase an
$ErrorActionPreference = "Stop"

$serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
$headers = @{
    "apikey"        = $serviceRoleKey
    "Authorization" = "Bearer $serviceRoleKey"
    "Content-Type"  = "application/json"
}

$email = "local.admin@ts.berlin"
$password = "LocalAdmin123!"

Write-Host "Prüfe/Erstelle lokalen Admin-Benutzer ($email)..." -ForegroundColor Cyan

$usersResponse = Invoke-RestMethod -Uri "http://127.0.0.1:54321/auth/v1/admin/users" -Method Get -Headers $headers
$existingUser = $usersResponse.users | Where-Object { $_.email -eq $email } | Select-Object -First 1

if ($existingUser) {
    $userId = $existingUser.id
    $updateBody = @{
        password      = $password
        email_confirm = $true
    } | ConvertTo-Json
    Invoke-RestMethod -Uri "http://127.0.0.1:54321/auth/v1/admin/users/$userId" -Method Put -Headers $headers -Body $updateBody | Out-Null
    Write-Host "[OK] Passwort für bestehenden Benutzer $email ($userId) auf '$password' aktualisiert." -ForegroundColor Green
} else {
    $createBody = @{
        email         = $email
        password      = $password
        email_confirm = $true
        user_metadata = @{
            first_name = "Local"
            last_name  = "Admin"
        }
    } | ConvertTo-Json
    $created = Invoke-RestMethod -Uri "http://127.0.0.1:54321/auth/v1/admin/users" -Method Post -Headers $headers -Body $createBody
    $userId = $created.id
    Write-Host "[OK] Neuer Benutzer $email ($userId) angelegt." -ForegroundColor Green
}

# In application_admins eintragen
$adminHeaders = $headers.Clone()
$adminHeaders["Prefer"] = "resolution=merge-duplicates"
$adminBody = @{ user_id = $userId } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:54321/rest/v1/application_admins" -Method Post -Headers $adminHeaders -Body $adminBody | Out-Null

Write-Host "[OK] Benutzer als Admin in 'application_admins' hinterlegt." -ForegroundColor Green
Write-Host ""
Write-Host "Du kannst jetzt im Browser (http://localhost:5173) sofort auf 'Lokaler Direkt-Login (Admin)' klicken!" -ForegroundColor Green

