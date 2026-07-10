# Development cleanup script for Windows
# Fixes EPERM errors and port conflicts

Write-Host "Cleaning development environment..." -ForegroundColor Yellow

try {
    # Kill Node processes
    Write-Host "Stopping Node.js processes..." -ForegroundColor Cyan
    Get-Process node* -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
    Write-Host "Killed Node processes" -ForegroundColor Green
} catch {
    Write-Host "No Node processes to kill" -ForegroundColor Yellow
}

try {
    # Clear build artifacts
    Write-Host "Clearing build cache..." -ForegroundColor Cyan
    Remove-Item -Path ".next" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -Path "node_modules\.cache" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -Path ".nuxt" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Cleared build cache" -ForegroundColor Green
} catch {
    Write-Host "Some cache files could not be cleared" -ForegroundColor Yellow
}

try {
    # Clear npm cache
    Write-Host "Clearing npm cache..." -ForegroundColor Cyan
    npm cache clean --force 2>$null
    Write-Host "Cleared npm cache" -ForegroundColor Green
} catch {
    Write-Host "npm cache clean failed" -ForegroundColor Yellow
}

# Check port availability
Write-Host "Checking port availability..." -ForegroundColor Cyan
$ports = @(3000, 3001, 3002, 3003)
foreach ($port in $ports) {
    try {
        $connection = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        if ($connection) {
            Write-Host "Port ${port}: OCCUPIED" -ForegroundColor Red
            # Try to kill the process using the port
            $processId = $connection.OwningProcess
            if ($processId) {
                taskkill /PID $processId /F 2>$null
                Write-Host "  Killed process $processId" -ForegroundColor Yellow
            }
        } else {
            Write-Host "Port ${port}: AVAILABLE" -ForegroundColor Green
        }
    } catch {
        Write-Host "Port ${port}: AVAILABLE" -ForegroundColor Green
    }
}

# Remove specific trace file that causes EPERM
if (Test-Path ".next\trace") {
    try {
        Remove-Item -Path ".next\trace" -Force
        Write-Host "Removed trace file" -ForegroundColor Green
    } catch {
        Write-Host "Could not remove trace file" -ForegroundColor Yellow
    }
}

Write-Host "Ready to start development server" -ForegroundColor Cyan
Write-Host "Run 'npm run dev' to start" -ForegroundColor White 