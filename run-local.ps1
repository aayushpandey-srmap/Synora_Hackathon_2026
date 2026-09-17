$ErrorActionPreference = "Stop"

docker compose up -d
if ($LASTEXITCODE -ne 0) { throw "Docker Compose failed" }

$backendEnv = @{}
Get-Content "$PSScriptRoot\backend\.env" | ForEach-Object {
    if ($_ -match '^\s*([^#=\s]+)\s*=\s*(.*)\s*$') { $backendEnv[$matches[1]] = $matches[2] }
}
$backendCommand = ($backendEnv.GetEnumerator() | ForEach-Object { "`$env:$($_.Key)='$($_.Value)'" }) -join "; "
Start-Process powershell -ArgumentList "-NoExit", "-Command", "$backendCommand; Set-Location '$PSScriptRoot\backend'; go run ./cmd/server"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$PSScriptRoot\frontend'; npm install; npm run dev"

Write-Host "PostgreSQL and Redis started. Backend: http://localhost:8080. Frontend: http://localhost:5173."
