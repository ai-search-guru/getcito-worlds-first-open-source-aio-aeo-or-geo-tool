# Development Environment Health Check
# Diagnoses common Windows Node.js development issues

Write-Host "Development Environment Health Check" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor White

# Check Node.js and npm versions
Write-Host ""
Write-Host "Package Versions:" -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    Write-Host "Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "Node.js: NOT FOUND" -ForegroundColor Red
}

try {
    $npmVersion = npm --version
    Write-Host "npm: $npmVersion" -ForegroundColor Green
} catch {
    Write-Host "npm: NOT FOUND" -ForegroundColor Red
}

# Check port availability
Write-Host ""
Write-Host "Port Status:" -ForegroundColor Yellow
$ports = @(3000, 3001, 3002, 3003)
foreach ($port in $ports) {
    try {
        $connection = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        if ($connection) {
            $process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
            $processName = if ($process) { $process.ProcessName } else { "Unknown" }
            Write-Host "Port ${port}: OCCUPIED by $processName (PID: $($connection.OwningProcess))" -ForegroundColor Red
        } else {
            Write-Host "Port ${port}: AVAILABLE" -ForegroundColor Green
        }
    } catch {
        Write-Host "Port ${port}: AVAILABLE" -ForegroundColor Green
    }
}

# Check project structure
Write-Host ""
Write-Host "Project Structure:" -ForegroundColor Yellow

# Check package.json
if (Test-Path "package.json") {
    Write-Host "package.json: EXISTS" -ForegroundColor Green
} else {
    Write-Host "package.json: MISSING" -ForegroundColor Red
}

# Check node_modules
if (Test-Path "node_modules") {
    Write-Host "node_modules: EXISTS" -ForegroundColor Green
} else {
    Write-Host "node_modules: MISSING" -ForegroundColor Red
}

# Check .next directory
if (Test-Path ".next") {
    Write-Host ".next directory: EXISTS" -ForegroundColor Yellow
} else {
    Write-Host ".next directory: NOT FOUND (Clean)" -ForegroundColor Green
}

# Check for problematic files
Write-Host ""
Write-Host "Problem Files:" -ForegroundColor Yellow

# Check for trace file locks
if (Test-Path ".next\trace") {
    Write-Host "Trace file: EXISTS (potential lock cause)" -ForegroundColor Red
} else {
    Write-Host "Trace file: CLEAN" -ForegroundColor Green
}

# Check for lock files
$lockFiles = @("package-lock.json", "yarn.lock", "pnpm-lock.yaml")
foreach ($lockFile in $lockFiles) {
    if (Test-Path $lockFile) {
        Write-Host "${lockFile}: EXISTS" -ForegroundColor Green
    }
}

# Check running processes
Write-Host ""
Write-Host "Running Processes:" -ForegroundColor Yellow
$nodeProcesses = Get-Process node* -ErrorAction SilentlyContinue
if ($nodeProcesses) {
    Write-Host "Node.js processes running:" -ForegroundColor Red
    $nodeProcesses | ForEach-Object {
        Write-Host "  PID: $($_.Id) | Name: $($_.ProcessName)" -ForegroundColor Yellow
    }
} else {
    Write-Host "No Node.js processes running" -ForegroundColor Green
}

# Recommendations
Write-Host ""
Write-Host "Recommendations:" -ForegroundColor Cyan
Write-Host "1. If ports are occupied, run: npm run dev:clean" -ForegroundColor White
Write-Host "2. If trace file exists, delete .next directory" -ForegroundColor White
Write-Host "3. Add project folder to Windows Defender exclusions" -ForegroundColor White
Write-Host "4. Consider using WSL2 for better Node.js development" -ForegroundColor White

Write-Host ""
Write-Host "Health Check Complete" -ForegroundColor Green 