# Installer validation — 2026-10-05

Real isolated host installations were exercised on Windows 10.0.26200 x64, macOS 26.7.1 arm64, and Ubuntu 24.04.5 x64. Test services, application registrations, folders, databases, and ports used separate e2e names. Existing hosts and remote clients were preserved.

## Findings and changes

- The Windows one-line bootstrap called exit inside the caller's PowerShell session. It now reports errors without closing that session and cleans its temporary downloads.
- Windows npm CLI shims needed CMD's outer quoting when executable paths contain spaces or ampersands. Provider synchronization now uses that quoting directly.
- The MCP gateway compared a Windows drive-letter path with a file URL and silently exited instead of starting. Its direct-entry check now resolves native filesystem paths, including aliases.
- Windows short and long install paths produced different background-host identities. Both host backends now normalize their installation root.
- Native Windows hosts can be blocked by Application Control. The installer falls back to the installed Node runtime launched invisibly by Windows Script Host, without changing security policies. Both backends retain background startup and browser shortcuts.
- Windows startup now requires healthy worker/MCP routes and an accessible built JavaScript asset. Uninstall process matching respects directory boundaries and short-path aliases.
- Preserved NODE_ENV=development could override production mode on macOS/Linux. The installers force production after merging retained environment settings.
- Minimal Linux systems need Chromium's shared libraries as well as its downloaded browser binary. Native Linux installation uses Playwright's official dependency installer.
- Linux port preflight identifies conflicting processes before creating a checkout and rejects unrelated successful HTTP health responses.

## Exercised behavior

- Ubuntu: full fresh build/install, first administrator's OS-user mapping, service restart, update into the other production build slot, integrated browser engine, occupied-port rejection, and uninstall.
- macOS: full build/install, launchd restart, application bundle, frontend/MCP health, administrator OS mapping, occupied-port rejection, and uninstall.
- Windows: full fresh build/install with all corrections, native and script host startup, first administrator mapped to the installing Windows user, frontend assets, worker and MCP health, startup registration, browser opening, restart with account persistence, occupied-port rejection, and uninstall.
- Windows-specific automated tests additionally exercise provider shim quoting, bootstrap success/error without closing the caller, child respawn, scoped stop, and preservation of an unrelated process.
- The Remote Client AppImage was built separately with an embedded preflight and directly launched on the headless Ubuntu machine. It exits with a useful headless-client instruction before attempting to load Electron. Packaging/library diagnostics have separate tests in the remote-client repository.

## Coverage limits

Windows/macOS startup registration and restart were tested; an actual logout/login or machine reboot was not performed. Linux AppImage GUI operation was not tested on a graphical Linux desktop. The Electron Remote Client AppImage is not the headless Metis host installer. Shared runtime/browser caches and required installed dependencies remain; test-owned installations are removed.

Host installer changes can be consumed from master. The separate AppImage build is a test artifact, not a published Remote Client release.
