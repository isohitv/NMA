# Sentinel Network Management (MERN)

Sentinel is a MERN web dashboard for local network operations. It includes a dark responsive UI with:

- Dashboard metrics, per-interface traffic sampling, alerts, and ARP discovery
- IP Watchlist with concurrent ICMP ping sweeps
- AP Monitor with SNMP v2c/v3 polling primitives
- SSH, Telnet, and raw TCP terminal sessions backed by xterm.js

## Requirements

- Node.js 18 or newer
- npm
- Optional: `arp-scan` on Linux/macOS for richer discovery (the app falls back to the native `arp` table)
- Administrator privileges may be required for richer ARP scans on some operating systems.

## Run

### Windows (portable Node.js setup)

From PowerShell:

```powershell
cd C:\Users\sohit\Python\NMA
Set-ExecutionPolicy -Scope Process Bypass
.\run-dev.ps1
```

The launcher adds the local `.node` directory to PATH so Vite and Electron can find `node.exe`.

### Standard Node.js installation

```bash
npm install
npm run dev       # Vite renderer + Electron with DevTools
```

Build and launch the packaged assets:

```bash
npm run build
npm start
```

With the portable setup, use `.\run-build.ps1` to build, then `.\.node\npm.cmd start` with PATH set as above.

The Electron bridge keeps Node networking APIs out of the renderer. SNMP defaults to the standard `public` community and the terminal form accepts password-based SSH authentication; use a private-key configuration when extending the session form for production deployments.

## Architecture

- `server/index.ts` owns the Express API and networking routes.
- `server/models.ts` contains MongoDB models.
- `src/main/services/` contains portable traffic, ICMP/TCP, ARP, SNMP, and terminal adapters reused by the API.
- `src/renderer/App.tsx` contains the dashboard modules and xterm.js integration.

MongoDB is optional during development. Without `MONGODB_URI`, watchlist entries use in-memory storage and all networking routes remain available. Set `MONGODB_URI` later to enable persistence. The browser terminal UI is scaffolded; use a WebSocket gateway around `TerminalSession` for production SSH/Telnet streaming.
