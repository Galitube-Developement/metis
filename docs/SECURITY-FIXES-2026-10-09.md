# Security-Audit: Umsetzung und Regressionen

Dieser Nachtrag behebt die Findings des [Audits](SECURITY-AUDIT-2026-10-08.md) und der [Nachprüfung](SECURITY-AUDIT-2026-10-08-RECHECK.md). Die historischen Berichte und ihre auf den alten Commit gepinnten Reproduktionen bleiben erhalten.

| Finding | Verhalten nach dem Fix | Nachweis |
| --- | --- | --- |
| MA-01 | Erstaccount verlangt ein Betreiber-Token; Prüfung, Account und Verbrauch liegen in einer SQLite-Transaktion. Kein Header-/Loopback-Bypass. Startup erstellt die private Datei vor Listeneröffnung. | setup-security: echte Handler, Rollback, drei konkurrierende Prozesse, alternative Account-Erstellung, Neustart und vollständige Account-Löschung; HTTP-Smoke |
| MA-02 / H2 | Direkte Clients werden anhand des Socket-Peers begrenzt. Nur explizit konfigurierte Proxy-IP/CIDRs dürfen XFF/Proto liefern; die Kette endet beim ersten untrusted Hop. Signierte interne Metadaten verhindern Header-Spoofing auch zwischen Server und gebündelten Next-Routen. | request-network: echter HTTP-Socket, IPv4/IPv6/CIDR/Ketten, kaputte Signatur; auth/share-security; HTTP-Smoke |
| MA-03 / H4 | Root standardmäßig aus, nur explizite Host-Admins dürfen optieren. Neue/aktualisierte und bestehende Ausführungs-Mappings verlangen Isolation; Docker verwendet keinen gemeinsamen UID-Fallback. | root-agent-config, admin-users, user-execution-isolation, echter POSIX-Berechtigungsprobe |
| MA-04 | Unreferenzierte Generierungsroute entfernt; keine anonymen LLM-Anfragen darüber. | auth-security und HTTP-Smoke: 404 |
| MA-05 | OS-Konten und Home-Pfade nur mit Host-Admin-Session; anonymes Setup liefert keine Liste oder vorgeschlagenen Namen. | setup-security und HTTP-Smoke |
| H1 | Browser-Stream prüft einen vorhandenen, nicht-null, exakt erlaubten Origin vor der Cookie-Authentifizierung. | Origin-Matrix und echte WebSocket-Handshakes im HTTP-Smoke |
| H3 | Logout löscht den Session-Hash; erneuter Login widerruft den präsentierten alten Token. Passwortänderungen widerrufen alle Sessions atomar mit dem Passwortwechsel. | auth-security: mehrere Sessions, Wiederverwendung, Rotation und Passwortwechsel |

## Zusätzliche geschlossene Ausführungspfade innerhalb MA-03

Der Gateway-Test führt einen tatsächlichen lokalen Tool-Aufruf unter einer vorhandenen unprivilegierten Linux-UID aus, ausschließlich in einem temporären Workspace mit künstlichen Daten:

- UID/GID und Supplementärgruppen sind unprivilegiert; kein globales MCP-Bearer-, Secret- oder Shell-Injection-Environment wird übernommen.
- Lokales `edit_file` läuft im Zielprozess unter der gemappten Identität. Ein Workspace-Symlink auf eine künstliche geschützte Datei erlaubt keinen Schreibzugriff.
- Alte Nichtadmin-Root-Claims fallen nicht auf globale Gateway-Root-Einstellungen zurück. Der globale Host-Admin-Env-Schalter kann einen expliziten Nichtadmin-Kontext nicht hochstufen.
- Gemeinsame Repository-Indizes und gemeinsame stdio-MCP-Server werden für Nichtadmins gesperrt, solange diese Pfade keinen eigenen isolierten Prozess verwenden. Workspace-Shelltools bleiben unter der geprüften OS-Identität verfügbar.

## Betrieb und Kompatibilität

`pnpm start` initialisiert das Setup-Token in `CHAT_DATA_DIR/setup-token`. Die Datei ist unter Unix operator-owned, 0600, regulär und nicht mehrfach hart verlinkt; Symlinks und unsichere Dateien werden abgewiesen. Unter Windows schützt und prüft die native PowerShell/.NET-DACL Betreiber/SYSTEM/Administratoren, deaktivierte Vererbung und Reparse-Points. Alternativ kann der Betreiber ein zufälliges `AI_CHAT_SETUP_TOKEN` mit 32–1024 Zeichen setzen. Direkter `next dev`-Betrieb benötigt den expliziten Token oder eine vorher vom Betreiber initialisierte Datei; er bietet keine Socket-Metadaten und verwendet konservativ einen gemeinsamen Rate-Limit-Bucket.

Für lokale Nginx-Proxys `AI_CHAT_TRUSTED_PROXIES=127.0.0.1,::1` setzen. Das Template überschreibt XFF mit dem echten Proxy-Client und lässt keine vom Client angehängten Werte übernehmen. Betreiber müssen den Backend-Port vor Direktzugriffen schützen und nur kontrollierte Proxys vertrauen. Zusätzliche Browser-Origins kommen kommagetrennt in `AI_CHAT_BROWSER_ALLOWED_ORIGINS`.

Unix-Installer und publizierte Kopien liefern Root-Agenten als `false`; `--allow-root-agents` ist ein ausdrückliches Opt-in mit Warnung. Bestehende explizite Env-Werte bleiben erhalten. Keine Live-Env oder produktiven Nutzer-Mappings werden durch den Fix automatisch umgeschrieben.

Nichtadmin-Workspaces brauchen eindeutige unprivilegierte OS-Konten, privaten Besitz und keine Überschneidung. Der Prozess prüft tatsächlichen Zugriff auf Datenbank, Datenverzeichnis, MCP-State, .env-Dateien, andere Workspaces und Service-Home sowie Schreibrechte auf Installationsverzeichnisse. Ein Nichtroot-Service ohne UID-Wechselmöglichkeit kann diese Prüfung für andere OS-Konten nicht erfüllen: dann separate Instanzen/OS-Isolation verwenden. Unsichere Altzuordnungen schlagen bei Ausführung fehl. Unter Windows bleiben Nichtadmin-Agenten gesperrt, bis SID-/Restricted-Token-/ACL-Isolation nachgewiesen werden kann; ein Benutzername reicht nicht.

Rate-Limits sind pro Prozess und auf maximal 10.000 aktive Schlüssel begrenzt; volle Tabellen schlagen geschlossen fehl. Login hat zusätzlich adressunabhängige Account- und Gesamtbudgets, Share-Passwörter ein gemeinsames Zielbudget über Lesen und Klonen. Für mehrere App-Prozesse bleibt ein verteilter Proxy-/WAF-Limiter erforderlich.

## Verifikation

`pnpm test`: 872 Fälle, 862 bestanden, 10 plattform-/umgebungsbedingte Skips, 0 Fehler. Die neuen Regressionen sind im regulären Testlauf und zusätzlich in `pnpm run test:security` enthalten.

Weitere Verifikation: inaktiver Produktionsslot `.next-b`, Typprüfung und `pnpm exec tsx scripts/security-http-smoke.ts`. Der Smoke kopiert ausschließlich versionierbare Kandidatenquellen ohne Produktions-.env/DB, verwendet synthetische Secrets und eine leere DB, startet seinen eigenen Server auf einem zufälligen Loopback-Port und beendet ausschließlich diesen Testprozess. Marker und Ergebnisse werden im Verify-Work-Ledger erfasst.

Keine Behauptung vollständiger Produktsicherheit: native Windows-DACL-/Restricted-Token-, macOS- und echte Docker-Neuinstallationen sowie vollständige Provider-/Worker-/Approval-Läufe wurden hier nicht durchgeführt. Die Windows-DACL hat einen auf Linux übersprungenen nativen Regressionstest. POSIX-Dateirechte und Gateway-UID-/Gruppen-/Environment-Isolation wurden real unter Linux geprüft. Kein Deployment oder Produktionsdienst-Neustart gehört zu diesem Commit-/Push-Auftrag.

Der lange direkte Build-Aufruf überschritt das Verifier-Zeitbudget und bleibt als Timeout im Ledger erhalten. Der vollständige Build wurde anschließend mit getrenntem Supervisor und unverändertem Produktkandidaten ausgeführt: aufgezeichneter Exit-Code 0, Compiled-successfully-Marker und neues Release-Manifest. Der finale Slot besteht den isolierten HTTP-/WebSocket-Smoke. Dieser Nachweis ersetzt keine nicht durchgeführten Plattformtests.
