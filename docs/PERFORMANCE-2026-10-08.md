# Performance-Untersuchung – 8. Oktober 2026

Vier gezielte Produktänderungen reduzieren wiederholte SQLite-Arbeit, Scheduler-Speicherbindung und unnötiges SSE-Polling. Keine Änderung an Deployment-Ressourcen, Provider-Vorgaben oder Produktionsdiensten; kein Deployment, Commit oder Push.

## Architektur und Auswahl

Basis: Commit `b97e22889505f342d647806bef5cecca8d097b5c`. Gelesen: AGENTS, Build Discipline, README/Installation, Architektur-Audit, Production Audit, WORKER, DEPLOY, RELEASE-TESTING und MCP-Gateway-Dokumentation. Historische Audit-Aussagen wurden am aktuellen Code geprüft.

| Bereich | Aktueller Pfad / Untersuchung |
| --- | --- |
| Frontend/API | Next 15 / React 19, App-Shell, Markdown, paginierte Chat-API, lazy Tool-Ergebnisse, begrenzte Client-Caches und 64-ms-Text-Batching. Lange Verläufe rendern die geladenen Seiten; keine vollständige Listenvirtualisierung. |
| Worker/Provider | Queue/Leases in SQLite, Worker startet einen Prozess je Run, getrennte Cursor-/alternative Adapter, Heartbeats, Watchdog, Checkpoints. Scheduler wartet auf Prozess-Promises. |
| Persistenz/Streaming | Synchrones SQLite in WAL-Modus, Chat-JSON plus Sidebar-Projektion; persistierte Run-Events werden über SSE gepollt. Vorhandener kombinierter Event-Index wurde durch optionale OR-Prädikate nicht zum Run-Seek genutzt. |
| MCP/Browser/Remote | Eigener Gateway-Prozess; Browser-/Remote-WebSockets im Custom Server. Browser-Frames haben bereits einen bufferedAmount-Schutz und zusammengefasste Pushes. Bestehende Remote-, Browser-, Lease-, Recovery- und Isolationsregressionen wurden mitgeprüft. Kein Test an echten Remote-Geräten. |

Die separat geprüfte Timeline-Implementierung ist derzeit nicht in einer Komponente eingebunden; ihr Wachstum wurde deshalb nicht als belegter Engpass der aktiven Oberfläche behandelt. Keine neue Daten-Cache-Schicht und keine neue Bibliothek wurden eingeführt; der schwach referenzierte Job-Observer lebt nur so lange wie das zugehörige Promise.

## Änderungen und Ursachen

1. **Scheduler – `lib/worker-scheduler.ts`:** Wiederholte `Promise.race(active)`-Aufrufe behielten pro Poll neue Reaktionen bis zum Ende jedes langen Jobs. Eine WeakMap registriert jetzt genau einen Settlement-Handler je Job. Poll-Listener und Timer werden in `finally` entfernt. Fehler werden weitergereicht; Kapazitäts- und Prioritätsregeln bleiben erhalten.
2. **Event-Abfrage – `lib/db-jobs.ts`:** Gebundene, bedarfsgerecht hinzugefügte Gleichheitsbedingungen erlauben den vorhandenen Index `run_events_chat_job_id`. Nutzerfilter, Reihenfolge und Cursor bleiben erhalten. Ein begrenzter Seitenparameter erlaubt dem Stream kleine Batches; andere Aufrufer behalten 500 als Standard.
3. **SSE – `lib/run-event-stream.ts`, `app/api/runs/route.ts`:** Pull-basierter Stream statt unbeschränktem Enqueue/Polling. Ohne Reader-Nachfrage keine Abfrage; höchstens 32 geladene Events je Verbindung. Cancel/Abort entfernt den wartenden Timer. Vollständiger Rückstand wird vor dem terminalen Fallback ausgeliefert, einschließlich eines erneuten Reads nach beobachtetem Job-Abschluss. Der Fallback prüft Chat und Eigentümer. Explizite Fehler, Heartbeats, Snapshot-Opt-in und Reconnect bleiben erhalten.
4. **Datenbankstart – `lib/sqlite.ts`:** Der historische Titel-Lock-Backfill parste bei jedem Prozessstart erneut Chat-JSON. Ein persistierter Migrationsmarker mit atomarer Transaktion und erneuter Markerprüfung nach Lock-Erwerb führt ihn einmalig aus. Fehlende Sidebar-Zeilen werden weiterhin ergänzt; normale Änderungen verwenden weiterhin die vorhandene Projektion.

Keine Event-Retention verkürzt, Ergebnisse abgeschnitten, Prüfungen deaktiviert oder Providerlatenzen als Metis-Gewinn ausgewiesen.

## Messung

Linux x64, Node 22.16.0, pnpm 9.15.9, 8 sichtbare AMD-EPYC-Milan-vCPUs. Gemeinsamer VPS, keine garantierte CPU-Exklusivität. Produktivdaten und Secrets wurden nicht kopiert. Tests erzeugen eigene temporäre Verzeichnisse und Datenbanken; der UI-Build lief in einer separaten Quellkopie mit vorhandenen, verlinkten node_modules.

Reproduzierbare Skripte: `pnpm bench:performance`. Für die Baseline dieselben beiden Skripte in einer Quellkopie des Basis-Commits ausführen. Rohwerte: [performance-2026-10-08.json](./performance-2026-10-08.json).

Datensatz: 32 Chats × 251 Nachrichten = 8.032 Nachrichten, 54.321.068 Bytes Chat-JSON; 10.000 Events, davon 10 im gesuchten aktuellen Run. Je Messlauf 100 Event-Abfragen, 32 kalte Chat-Seiten, ein Backfill-Start und fünf weitere DB-Prozessstarts. Scheduler: 24 kontrolliert wartende Job-Promises, 1.000 Polls mit 0-ms-Timer, explizite GC vor/nach Messung. Dies beschleunigt die Poll-Anzahl; es ist kein mehrstündiger End-to-End-Agentlauf.

Nach abgeschlossenem Build drei alternierende Vorher/Nachher-Paare ohne parallelen Build ausgeführt. Tabelle: Median der drei jeweiligen Messgrößen; p95 ist das empirische Quantil pro Lauf, bei fünf Starts entsprechend wenig belastbar.

| Messgröße | Vorher | Nachher |
| --- | ---: | ---: |
| Wiederholter DB-Start, p50 / p95 | 109,06 / 123,94 ms | 4,36 / 5,41 ms |
| Event-Abfrage, p50 / p95 | 1,415 / 2,169 ms | 0,121 / 0,216 ms |
| Scheduler: angehängte Reaktionen während Polls | 24.000 | 24 |
| Scheduler: zusätzlich gebundener Heap nach GC | 3.033.072 B | 84.112 B |
| Scheduler: CPU user + system | 123,12 ms | 136,05 ms |
| Scheduler: Event-Loop-p95, 10-ms-Messauflösung | 10,42 ms | 10,51 ms |
| Leerer DB-Erststart | 25,86 ms | 27,08 ms |
| Kalte Chat-Seite, p50 / p95 | 5,54 / 7,50 ms | 5,48 / 8,36 ms |

Die Rohdaten zählen bei `reactions` zusätzlich 24 Teardown-Handler (`Promise.all`): 24.024 bzw. 48. Keine belegte CPU-, Event-Loop-, Kaltseiten- oder Erststartverbesserung; diese Werte werden ausdrücklich nicht als Erfolg gewertet.

Separater authentifizierter SSE-Routentest mit 100 synthetischen Events: Nach 1,1 s ohne Lesen **3 → 0 DB-Abfragen**; weitere 1,1 s nach Cancel **2 → 0 Abfragen**. Ein zusätzlicher Regressionstest liefert 1.201 Events vollständig vor dem synthetisierten Abschluss aus. Diese Messung umfasst Metis-Transport, keine externe Providerzeit.

## Validierung

- **Typecheck:** `tsc --noEmit --incremental false --pretty false` erfolgreich.
- **Produktionsbuild:** dokumentiertes `bash scripts/build-production-slot.sh .next-a` ausschließlich in der Testkopie erfolgreich; Build-ID `SPijJCboHJ0P-pLg62VJV`. Keine Live-Slot-Umschaltung. First Load JS für /: 873 kB (Bestandsaufnahme, kein Vorher/Nachher-Bundlegewinn). Next warnte über den übergeordneten Lockfile-Pfad der verschachtelten Testkopie.
- **Regression:** 132 Testdateien aus den drei package.json-Testskripten, mit zwei parallelen Testprozessen: 838 Fälle, zunächst 825 bestanden, 4 fehlgeschlagen, 9 übersprungen. Die vier Fehler sind auf dem unveränderten Basis-Commit identisch reproduzierbar: fehlende interne MCP-URL in einer komplett geleerten Umgebung. Mit synthetischem `AI_CHAT_INTERNAL_ORIGIN=http://127.0.0.1:1` bestanden alle 14 Fälle der beiden betroffenen Dateien. Damit 829 Fälle bestanden, 9 plattformbedingt übersprungen; keine behauptete fehlerfreie Erst-Runde.
- **Neue Regressionen:** Scheduler-Settlement/Fehler/Mehrfach-Waiter, langsame und abgebrochene Leser, Abort während Poll-Wartezeit, große Replays, Abschluss-Rennen, vollständige Tool-/Fehlermeldungen, Snapshot/Cursor, Heartbeat/Reconnect, Query-Plan und Fremdnutzer-Fallback. In die vorhandene Testsuite aufgenommen.
- **Erststart/Upgrade:** Leere DB ohne erfundenen Benutzer; ältere Sidebar-Tabelle ohne Titel-Lock-Spalte migriert; Wiederanlauf und Integrität geprüft. Zusätzlich zwei Starts mit getrenntem Daten-/DB-/Workspace-Pfad, einschließlich Leerzeichen und Umlaut. Release-Vertrag, Docker-Dry-Run, Versions- und Prüfsummenprüfung bestanden.

### Tatsächlich geprüfte Oberfläche

Isolierter optimierter Linux-Build über den Metis-In-App-Browser: Erststart zeigt den Setup-Assistenten, anschließend Login mit synthetischem Konto. Zwei synthetische Chats, längerer Chat mit 250 Nachrichten plus einem 2,4-MB-Tool-Ergebnis. Chat geöffnet/gewechselt; ältere Seiten bis Nachricht 213 nachgeladen; Texteingabe während eines auf 120 s begrenzten, direkt eingespeisten Event-/Checkpoint-Stubs. Entwurf blieb nach Chatwechsel und während Stream erhalten. Synthetischer 1.000.000-Byte-Upload wurde während Streaming als „Uploaded“ angezeigt. Stream endete nach 60 Schritten. Screenshots bei 390×844, 768×1024 und 1440×900 aufgenommen; kein Layout verändert.

Für den Composer existierte ausschließlich eine lokale, nicht aufrufbare Test-Providerverbindung mit synthetischem Schlüssel. Keine echten Provideranfragen und kein Produktmodell für den Test ergänzt. Dieser UI-Stub prüft Transport/Checkpoints/Rendering, nicht den vollständigen Provider-Adapter oder echte MCP-Ausführung.

## Grenzen und nächste Messungen

- Kein Browser-Profiler-Zugriff für belastbare Input-p50/p95, FPS, Layout-Shifts oder Browser-Heap; Screenshots und Interaktionen sind Funktionsnachweise. Markdown reparst während Streaming weiterhin den wachsenden Inhalt. Keine ungemessene Parser-/Virtualisierungsänderung vorgenommen.
- Große Chat-JSONs werden weiterhin bei Checkpoints verarbeitet; der serverseitige vollständige Chat-Cache ist weiterhin nicht größenbegrenzt. Das bleibt relevant für sehr große Konten und längere Last.
- Die bisherige Event-Retention/Busy-Fallback-Strategie und der separate Runtime-Timeline-SSE-Pfad bleiben unverändert. Kein Nachweis, dass sämtliche Abbruchursachen oder alle wartenden Verbindungen behoben sind.
- Tatsächlich ausgeführt: Linux-x64-Runtime, frische und migrierte SQLite-DB, manueller nativer Produktionsbuild/-start, Installer-/Update-Vertragstests mit Stubs. Keine neue Paketinstallation auf einem nackten Host, kein realer systemd-Installerlauf, kein Docker-Stack-Start, kein natives Windows/macOS/ARM, kein mehrstündiger Provider- oder Multi-Prozess-SQLite-Schreiblasttest.
- Keine Produktionskonfiguration geändert. Das optionale Deployment-Tuning wurde bewusst nicht mit portablen Produktänderungen vermischt.

## Evidence-Ledger

`verify_work`: **5/5 VERIFIED, allVerified=true**. Erneut ausgeführt: 17 gezielte Tests (17 bestanden, 0 fehlgeschlagen), Typecheck, Release-Vertrag und SSE-Abbruchbenchmark. Build-Artefakte und bytegleiche Produktdateien zwischen Testkopie und Arbeitsbaum zusätzlich bestätigt. Temporäre Testinstanz und Quellkopien nach der Validierung entfernt; Messdaten und reproduzierbare Skripte bleiben im Repository.
