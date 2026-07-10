# Windows Development Issues Fix Plan

## 🚨 Issues Identified

### 1. EPERM Errors
```
Error: EPERM: operation not permitted, open 'C:\source-code\v8dashboard\.next\trace'
```

### 2. Port Conflicts
- Server keeps switching ports (3000 → 3001 → 3003)
- Multiple Node.js processes running simultaneously

### 3. File Lock Issues
- `.next\trace` file being locked by antivirus or system processes
- Preventing proper build and hot reload

## 📋 Comprehensive Fix Plan

### Phase 1: Immediate System Cleanup

#### Step 1.1: Kill All Node Processes
```powershell
# Kill all Node.js processes
taskkill /f /im node.exe

# Alternative if above doesn't work
Get-Process node* | Stop-Process -Force

# Check if any Node processes are still running
Get-Process node*
```

#### Step 1.2: Clear All Build Artifacts
```powershell
# Navigate to project directory
cd C:\source-code\v8dashboard

# Remove build directories (force delete)
Remove-Item -Path ".next" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "node_modules\.cache" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path ".nuxt" -Recurse -Force -ErrorAction SilentlyContinue

# Clear npm cache
npm cache clean --force
```

#### Step 1.3: Check Port Usage
```powershell
# Check what's using port 3000
netstat -ano | findstr :3000

# If something is using it, kill the process
# Replace XXXX with the PID from netstat
taskkill /PID XXXX /F
```

### Phase 2: System Configuration

#### Step 2.1: Antivirus Configuration
1. **Windows Defender Exclusions:**
   - Add `C:\source-code\v8dashboard` to exclusions
   - Add `C:\Users\[USERNAME]\.npm` to exclusions
   - Add `C:\Users\[USERNAME]\AppData\Local\npm-cache` to exclusions

2. **Real-time Protection:**
   - Temporarily disable during development
   - Or add Node.js to process exclusions

#### Step 2.2: Windows Permissions
```powershell
# Run PowerShell as Administrator
# Navigate to project directory
cd C:\source-code\v8dashboard

# Take ownership of the directory
takeown /f . /r /d y

# Grant full permissions
icacls . /grant Everyone:(OI)(CI)F /T
```

#### Step 2.3: File System Configuration
```powershell
# Disable file system indexing for project folder
# This reduces file locks during development
attrib +s "C:\source-code\v8dashboard"
```

### Phase 3: Development Environment Setup

#### Step 3.1: Create Development Scripts

**File: `scripts/dev-clean.ps1`**
```powershell
# Development cleanup script
Write-Host "🧹 Cleaning development environment..." -ForegroundColor Yellow

# Kill Node processes
Get-Process node* -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "✅ Killed Node processes" -ForegroundColor Green

# Clear build artifacts
Remove-Item -Path ".next" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "node_modules\.cache" -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "✅ Cleared build cache" -ForegroundColor Green

# Clear npm cache
npm cache clean --force
Write-Host "✅ Cleared npm cache" -ForegroundColor Green

# Check port availability
$port3000 = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if ($port3000) {
    Write-Host "⚠️ Port 3000 is still in use" -ForegroundColor Red
    $port3000 | Select-Object LocalAddress, LocalPort, State, OwningProcess
} else {
    Write-Host "✅ Port 3000 is available" -ForegroundColor Green
}

Write-Host "🚀 Ready to start development server" -ForegroundColor Cyan
```

**File: `scripts/dev-start.ps1`**
```powershell
# Safe development start script
param(
    [int]$Port = 3000
)

Write-Host "🚀 Starting development server..." -ForegroundColor Cyan

# Ensure clean environment
& .\scripts\dev-clean.ps1

# Start development server with specific port
$env:PORT = $Port
npm run dev
```

#### Step 3.2: Update package.json Scripts
```json
{
  "scripts": {
    "dev": "next dev",
    "dev:clean": "powershell -ExecutionPolicy Bypass -File scripts/dev-clean.ps1",
    "dev:safe": "powershell -ExecutionPolicy Bypass -File scripts/dev-start.ps1",
    "dev:port": "powershell -ExecutionPolicy Bypass -File scripts/dev-start.ps1 -Port 3001",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  }
}
```

#### Step 3.3: Create .gitignore Additions
```gitignore
# Windows-specific
.next/trace
.next/server/trace
*.log
*.pid

# Development
.env.local
.env.development.local
.env.test.local
.env.production.local

# Cache
.npm
.cache
```

### Phase 4: Next.js Configuration Optimization

#### Step 4.1: Update next.config.js
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable file system cache on Windows to prevent EPERM errors
  experimental: {
    isrMemoryCacheSize: 0, // Disable ISR memory cache
  },
  
  // Configure webpack for Windows
  webpack: (config, { dev, isServer }) => {
    if (dev && !isServer) {
      // Reduce file system operations on Windows
      config.watchOptions = {
        poll: 1000, // Use polling instead of native file watching
        aggregateTimeout: 300,
        ignored: ['**/node_modules/**', '**/.next/**']
      };
    }
    return config;
  },
  
  // Optimize for Windows development
  onDemandEntries: {
    // Period (in ms) where the server will keep pages in the buffer
    maxInactiveAge: 25 * 1000,
    // Number of pages that should be kept simultaneously without being disposed
    pagesBufferLength: 2,
  },
}

module.exports = nextConfig;
```

#### Step 4.2: Create Windows-Specific Environment
**File: `.env.windows`**
```env
# Windows-specific development settings
NEXT_TELEMETRY_DISABLED=1
DISABLE_ESLINT_PLUGIN=true
FAST_REFRESH=true
```

### Phase 5: Alternative Solutions

#### Step 5.1: WSL2 Setup (Recommended)
```bash
# Install WSL2 for better Node.js development
wsl --install -d Ubuntu

# In WSL2 terminal:
cd /mnt/c/source-code/v8dashboard
npm install
npm run dev
```

#### Step 5.2: Docker Development Environment
**File: `docker-compose.dev.yml`**
```yaml
version: '3.8'
services:
  dev:
    build:
      context: .
      dockerfile: Dockerfile.dev
    ports:
      - "3000:3000"
    volumes:
      - .:/app
      - /app/node_modules
      - /app/.next
    environment:
      - NODE_ENV=development
    command: npm run dev
```

**File: `Dockerfile.dev`**
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]
```

### Phase 6: Monitoring and Maintenance

#### Step 6.1: Development Health Check Script
**File: `scripts/health-check.ps1`**
```powershell
Write-Host "🔍 Development Environment Health Check" -ForegroundColor Cyan

# Check Node.js version
$nodeVersion = node --version
Write-Host "Node.js: $nodeVersion" -ForegroundColor Green

# Check npm version
$npmVersion = npm --version
Write-Host "npm: $npmVersion" -ForegroundColor Green

# Check port availability
$ports = @(3000, 3001, 3002, 3003)
foreach ($port in $ports) {
    $connection = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($connection) {
        Write-Host "Port $port: OCCUPIED" -ForegroundColor Red
    } else {
        Write-Host "Port $port: AVAILABLE" -ForegroundColor Green
    }
}

# Check .next directory
if (Test-Path ".next") {
    $nextSize = (Get-ChildItem ".next" -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
    Write-Host ".next directory: ${nextSize:N2} MB" -ForegroundColor Yellow
} else {
    Write-Host ".next directory: NOT FOUND" -ForegroundColor Green
}

# Check for trace file locks
if (Test-Path ".next\trace") {
    Write-Host "Trace file: EXISTS (potential lock)" -ForegroundColor Red
} else {
    Write-Host "Trace file: CLEAN" -ForegroundColor Green
}
```

## 🚀 Execution Plan

### Immediate Actions (Today)
1. **Run as Administrator**: Open PowerShell as Administrator
2. **Execute cleanup**: Run the cleanup commands from Phase 1
3. **Configure antivirus**: Add project exclusions
4. **Test basic setup**: Try starting dev server

### Short-term Setup (This Week)
1. **Create scripts**: Implement the PowerShell scripts from Phase 3
2. **Update configurations**: Apply Next.js optimizations from Phase 4
3. **Test thoroughly**: Ensure stable development environment

### Long-term Solutions (Next Week)
1. **Consider WSL2**: Evaluate WSL2 for better Node.js development
2. **Docker option**: Set up containerized development if needed
3. **Team documentation**: Create team guidelines for Windows development

## 🛠️ Quick Fix Commands

### Emergency Reset (Copy & Paste)
```powershell
# Run in PowerShell as Administrator
cd C:\source-code\v8dashboard
taskkill /f /im node.exe
Remove-Item -Path ".next" -Recurse -Force -ErrorAction SilentlyContinue
npm cache clean --force
npm run dev
```

### Prevention Commands (Daily)
```powershell
# Quick cleanup before development
taskkill /f /im node.exe 2>$null
Remove-Item -Path ".next\trace" -Force -ErrorAction SilentlyContinue
npm run dev
```

## 📞 Escalation Plan

If issues persist after implementing this plan:

1. **Hardware Check**: Test on different Windows machine
2. **Network Issues**: Check corporate firewall/proxy settings
3. **System Update**: Ensure Windows is fully updated
4. **Node.js Reinstall**: Fresh Node.js installation via official installer
5. **WSL2 Migration**: Move development to WSL2 environment

---

## ✅ Success Criteria

Development environment is considered fixed when:
- [ ] `npm run dev` starts without EPERM errors
- [ ] Port 3000 is consistently available
- [ ] Hot reload works without issues
- [ ] No trace file locks occur
- [ ] Build process completes successfully 