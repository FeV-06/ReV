# ReV Daemon Lifecycle & Autostart Specification

This document specifies the background daemon installation, service packaging, data boundaries, and automatic startup lifecycle for **ReV (Relaying to Everyone Virtually)** on Linux and Windows.

---

## 1. Runtime Environment & Data Isolation

### 1.1 Requirements
* **Node.js:** `>= 22.0.0` (native ES modules, Web Streams, crypto).
* **Rust Core:** `crates/rev-core` compiled binary (`target/release/rev-core` or bundled in `dist/bin/rev-core`).
* **Git:** `>= 2.30.0` (for `--git-common-dir`, `--absolute-git-dir`, safe directory inspections).

### 1.2 Storage Locations & Permissions
All daemon state, databases, credentials, and scan checkpoints are isolated strictly within user space. In addition, the daemon runtime automatically loads `.env.local` directly via `process.loadEnvFile('.env.local')` if present in the workspace root, while respecting pre-exported process environment variables.

| Platform | Default Path | Environment Variable | Permission Mode |
|---|---|---|---|
| **Linux / POSIX** | `~/.rev-data` | `REV_DATA_DIR` | `0700` (user read/write/execute only) |
| **Windows** | `%USERPROFILE%\.rev-data` | `REV_DATA_DIR` | User ACL inheritance (no admin required) |

* **Lockfile:** `$REV_DATA_DIR/daemon.lock/` (directory lock with atomic `owner.json` containing PID, protocol, and launch nonce).
* **Token:** `$REV_DATA_DIR/daemon.token` (`0600` permission, random 256-bit hex bearer token).
* **Metadata:** `$REV_DATA_DIR/daemon.json` (`0600` permission, bound loopback port, PID, SHA-256 token hash).
* **Database:** `$REV_DATA_DIR/pglite/` (PGlite embedded relational store with `projects`, `project_snapshots`, `runs`, `graph_events`).
* **Logs:** Never log tokens, passwords, API keys, or raw code contents. On Linux, output routes to `systemd-journald`. On Windows, standard output/error redirect to `$REV_DATA_DIR/daemon.log`.

---

## 2. Linux Autostart Architecture (`systemd --user`)

### 2.1 Service Unit Definition
On modern Linux systems (including Arch Linux, Debian/Ubuntu, Fedora), user services are managed via `systemd --user`. No `sudo` or root privileges are required to install or run the service.

**Unit File Path:** `~/.config/systemd/user/rev-daemon.service`

```ini
[Unit]
Description=ReV Continuous Capture & Handover Daemon
Documentation=https://github.com/FeV-06/ReV
After=network.target

[Service]
Type=simple
WorkingDirectory=%h/GitRepos/ReV
ExecStart=/usr/bin/node dist/daemon/entry.js
Restart=on-failure
RestartSec=3s
TimeoutStopSec=15s
KillMode=mixed
Environment=REV_DATA_DIR=%h/.rev-data
Environment=NODE_ENV=production

# Security sandbox
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=%h/.rev-data %h/GitRepos
NoNewPrivileges=true

[Install]
WantedBy=default.target
```

### 2.2 User Session vs. System Boot (Linger)
* **Default Behavior:** `systemd --user` starts when the user logs in (graphical or TTY/SSH) and stops when the user's last session closes.
* **Boot-Time Background Execution (Linger):** To enable 24/7 background operation across machine boot without requiring an active graphical desktop login, user lingering is enabled via `loginctl`:
  ```bash
  loginctl enable-linger $USER
  ```
  *(Note: Elevated or polkit action executed by the user).*

### 2.3 Explicit Operator Commands
* **Inspect Status:** `systemctl --user status rev-daemon`
* **View Live Logs:** `journalctl --user -u rev-daemon -f`
* **Stop Service:** `systemctl --user stop rev-daemon`
* **Disable Autostart:** `systemctl --user disable rev-daemon`
* **Uninstall Service:** `rm ~/.config/systemd/user/rev-daemon.service && systemctl --user daemon-reload`

### 2.4 Daemon API Endpoints
The daemon exposes authenticated local HTTP endpoints:
* `GET /v1/health` - Daemon health and version check
* `GET /v1/projects` & `POST /v1/projects` - Project registration and inspection
* `GET /v1/runs` & `POST /v1/runs` - Handover run orchestration
* `POST /v1/runs/:id/ask` - Cited successor Q&A assistant (validates question against approved sources and interview answers via Rust `answer_successor` core operation)
* `POST /v1/runs/:id/actions` - Run state progression (`scope`, `generate`, `prepare_interview`, `answer_gap`, `approve`, `export`)
* `GET /v1/runs/:id/export` - Verifiable Markdown export

---

## 3. Windows Autostart Architecture

### 3.1 Non-Elevated User Autostart
On Windows 10/11, background user processes must execute without requiring UAC administrator elevation.

ReV provides two standard user-space mechanisms:
1. **User Startup Folder (VBS wrapper):**
   * Path: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\rev-daemon.vbs`
   * Launches `node.exe dist\daemon\entry.js` with window style `0` (hidden/no visible console prompt).
2. **User Registry Run Key:**
   * Key: `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
   * Value: `ReVDaemon = wscript.exe "%USERPROFILE%\.rev-data\rev-daemon.vbs"`
3. **Scheduled Task (Alternative):**
   * Non-elevated logon task:
     ```cmd
     schtasks /Create /TN "ReVDaemon" /TR "wscript.exe \"%USERPROFILE%\\.rev-data\\rev-daemon.vbs\"" /SC ONLOGON /F
     ```

### 3.2 Windows Process Lifecycle
* Starts upon user logon.
* Shuts down cleanly on logoff or system shutdown via Windows console control handler (`SIGINT` / `SIGTERM` emulation).
* If crashed, the next invocation detects stale locks via PID validation and resumes indexing.

---

## 4. Crash Recovery & Resilience Rules

1. **Stale Lock Cleanup:** If `daemon.lock` exists but the recorded PID is not running, the daemon safely reclaims the lock after validating process absence.
2. **Sleep / Wake Honesty:** ReV does not operate while the host machine is suspended, asleep, or powered off. Upon wake, the capture loop triggers a reconciliation tick against registered Git worktrees.
3. **Idempotent Registration:** Re-running installation scripts updates unit configurations cleanly without duplicating entries or interrupting running instances unnecessarily.
