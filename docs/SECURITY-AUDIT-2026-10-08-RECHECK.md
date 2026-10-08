# Security-Audit — Nachprüfung am 8. Oktober 2026

> Diese Nachprüfung gilt für den unten gepinnten Stand vor den Fixes. Die Umsetzung und Verifikation stehen in [SECURITY-FIXES-2026-10-09.md](./SECURITY-FIXES-2026-10-09.md).

Diese Nachprüfung präzisiert den [ursprünglichen Bericht](./SECURITY-AUDIT-2026-10-08.md). Für die aktuelle Revision gelten die Status- und Reichweitenangaben hier; historische Beobachtungen des Erstberichts bleiben historische Belege.

- Geprüfter Produktstand: `b431efb2632462828e1a7e468932a7e76a50e198`. Während des Audits wechselte HEAD durch einen anderen Lauf auf `a6bd7c2c12630e3464cdaee7aeba1eded3680a89`; dieser Commit ergänzt nur den Erstbericht und enthält keinen Produktcode-Unterschied zu `b431efb`. Der Reproduktionsrunner ist ausdrücklich auf `b431efb` gepinnt.
- Zeitpunkt der Belegsicherung: 2026-10-08, ca. 21:58 UTC.
- Umfang: Audit, Verifikation und Dokumentation. Keine Produkt-Fixes, Commits, Pushes oder Deployments.
- Dynamik: separate Quellkopie mittels `git archive` des geprüften Commits, eigene leere/migrierte SQLite-DBs, künstliche Konten, Upload-Marker und Secrets. Abhängigkeiten nur über vorhandene `node_modules` verlinkt. Kein Paketinstallationsnachweis.
- Keine Produktionsdaten als Testdaten, keine Produktionsrequests, kein Worker/MCP/Webdienst-/Remote-Neustart. Testcode importiert Handler/Dispatcher; nur der eigene Provider-Stub lauscht kurzzeitig auf einem zufälligen Loopback-Port und wird durch den Test geschlossen.

## Laufkonfiguration: angefordert und beobachtet

Angefordert war GPT-6.1-Sol mit `effort=high`. Audit-Chat: `67d1d6f9-72aa-4e75-99c3-45382d310e5e`; erster Audit-Job: `bef1aa28-9f19-4f4b-bfde-069d4c9224b0`. Die folgenden Metadaten beschreiben diesen historischen ersten Lauf.

Die eng begrenzte, nur lesende Prüfung von Chat-/Job-Modellmetadaten und Provider-Turn-Metadaten bestätigt `gpt-6.1-sol`. Chat und Job enthalten kein `modelParams`. Die Prozess-Abstammung ordnet den laufenden Codex-Prozess dem genannten Job zu; seine Argumente enthalten `--model gpt-6.1-sol`, aber keinen expliziten `model_reasoning_effort`. Die Turn-Metadaten enthalten `collaboration_mode.settings.reasoning_effort: null`.

**High wurde in diesem Run nicht explizit übernommen und ist nicht nachgewiesen.** Aus einem fehlenden Argument wird kein konkreter Provider-Default abgeleitet. Andere parallel laufende Codex-Prozesse mit High belegen die Konfiguration dieses Jobs nicht. Eine Laufkonfigurationskorrektur wurde nicht behauptet oder durch Prozess-/Dienstneustart erzwungen.

Beleg: [runtime-metadata.json](./security-audit-2026-10-08-evidence/runtime-metadata.json). Reproduzierbare Metadatenprüfung, solange der Job aktiv ist:

```bash
python3 docs/security-audit-2026-10-08-evidence/runtime-metadata.py bef1aa28-9f19-4f4b-bfde-069d4c9224b0
```

Das Skript gibt nur Modell/Reasoning-Argumente aus, keine Prompts, Provider-Zugangsdaten oder MCP-Token.

## Lifecycle-Nachprüfung und High-Korrektur am 9. Oktober 2026

Der Elternagent hat die gepinnte isolierte Reproduktion erneut ausgeführt: alle Audit-Assertions und **19/19 Regressionstests** bestanden. Die fünf Performance-Produktdateien sind gegenüber `b431efb` bytegleich; `git diff --check` ist erfolgreich. Diese zusätzliche Ledger-Prüfung ergab **2/2 VERIFIED**. Parallel laufende Security-Fixes wurden weder zurückgesetzt noch als geprüft freigegeben.

Der Audit-Chat wurde anschließend unter Prüfung derselben Kontoeigentümerschaft auf die im Elternchat bereits bestätigten Modellparameter eingestellt. Ein begrenzter Folgejob `8458fd94-08d0-4db1-a7d9-cf1d3e21b179` erhielt `effort=high` ausdrücklich sowohl im Chat als auch im Job. Der tatsächliche zu diesem Job gehörende Codex-Prozess bestätigt `--model gpt-6.1-sol` und `model_reasoning_effort="high"`; zusätzliche Laufprüfung **1/1 VERIFIED**. Beleg: [runtime-high-metadata.json](./security-audit-2026-10-08-evidence/runtime-high-metadata.json).

Der Folgejob ist abgeschlossen: Laufmetadaten und Berichtskonsistenz wurden mit High geprüft; konkrete Widersprüche zu den gesicherten Belegen wurden nicht gefunden. Abgeschlossene dynamische Tests wurden dabei nicht wiederholt. Die erste Audit-Runde wird dadurch nicht nachträglich als High-Lauf dargestellt. Für weitere Arbeit im selben Audit-Chat bleibt High explizit gespeichert. Keine Produktionsdienste wurden dafür neu gestartet und keine Kontorechte oder OS-Mappings verändert.

## Gleichzeitige fremde Änderungen im gemeinsamen Checkout

Während dieses Auftrags änderte ein anderer Lauf den gemeinsamen Arbeitsbaum. Beobachtet wurden neue Setup-Token-/Netzwerk-Helfer sowie Änderungen an Setup-Route, Wizard, Installern und später Root-Defaults/Benutzerzuordnung. Diese Änderungen stammen nicht aus dieser Nachprüfung. Sie wurden weder zurückgesetzt noch committed oder deployed.

Die Statusmatrix gilt ausdrücklich für den oben genannten **committeten Produktstand**, nicht als Freigabe des beweglichen Arbeitsbaums. Statisch beobachtete Kandidaten: Setup-Bootstrap fordert Token, anonyme OS-Liste wird geschlossen, native Unix-Installer erhalten explizites Root-Opt-in. Das reicht nicht für „behoben“: Startup-Tokeninitialisierung vor Listeneröffnung, alternative Bootstrap-Pfade, Proxy-Stempelung an allen Einstiegspunkten, Windows-Datei-/Tokenrechte, Docker-Bootstrap, erhaltene Update-Env und Mehrbenutzer-Mappings bleiben an einem stabilen Kandidatensnapshot nachzuweisen. Weitere Änderungen können nach dieser Beobachtung folgen.

Die Performance-Produktdateien dieses Audits wurden nicht verändert. Die zentrale Reproduktion importiert ausschließlich die gepinnte Testkopie und übernimmt keine fremden uncommitteten Änderungen.

## Status je Finding

| ID | Status auf aktueller Revision | Bewertung und präzise Voraussetzung |
| --- | --- | --- |
| MA-01 | Bestätigt: Route erzeugt anonym ersten Admin, zweiter Bootstrap 409 | Hoch bei Netzwerkerreichbarkeit vor dem ersten Konto. Host-Codeausführung ist eine bedingte Folgewirkung von Agent-/OS-/Tool-Konfiguration; keine getestete vollständige Takeover→Provider→Shell-Kette. |
| MA-02 | Bestätigt: konstante Adresse 10×401, dann 429; 12 rotierte Adressen 12×401 | Mittel bei direkter Erreichbarkeit oder unzuverlässiger Proxy-Header-Normalisierung. Nachgewiesen ist die Umgehung dieses lokalen Limits, kein erfolgreicher Passwortbruch oder unbegrenzter Gesamtdurchsatz. |
| MA-03 | Bestätigt für Root-Fall bis zur tatsächlichen MCP-Datei-/Shell-Ausführung | Hoch für Mehrbenutzerbetrieb ohne getrennte OS-Identitäten bei freigegebenem Root-Workspace. Zweiter Nicht-Admin liest künstlichen fremden Upload und außerhalb liegenden Marker; Ausführung tatsächlich UID 0. |
| MA-04 | Bestätigt: anonymer Route-Handler ruft lokalen Provider-Stub auf | Mittel bei passendem Key **und Modell**; alternativ `AI_GATEWAY_API_KEY`/`AI_MODEL`. Kein echter Kosten-/Quota-/DoS-Nachweis. |
| MA-05 | Bestätigt mit künstlicher Host-Benutzerliste; nach erstem Konto anonym leer | Niedrig, nur während leerer First-Run-Installation und bei Erreichbarkeit. Kein vollständiger Dump aller Systemkonten; Liste wird durch Plattform-/Benutzerfilter begrenzt. |

Die betroffenen Setup/Auth/Share/Process-A-, Identitäts-, MCP-, Rate-Limit-, Session-, Server- und Installer-Dateien sind gegenüber `b97e228` unverändert. Der Performance-Commit verändert jedoch SQLite-Initialisierung, Event-Abfragen und Run-Streaming: deshalb wurden frische/migrierte DB und Eigentümergrenzen gezielt nachgeprüft. Vorher belegte Browser-, SSRF-, Markdown-, Enrollment- und Installerläufe wurden ohne relevante Änderung nicht vollständig wiederholt.

## MA-03: geschlossene Evidenzlücke und verbleibende Grenzen

Relevante Kette:

1. `lib/admin-users.ts:createManagedUser`: erster Account bekommt ein abgeleitetes OS-Mapping, weiterer Account ohne Eingaben erhält denselben Workspace und zunächst kein Mapping.
2. `lib/config.ts:defaultAllowRootAgents`: UID 0 plus Workspace unter `/root` aktiviert ohne explizite Gegenkonfiguration Root-Agenten.
3. `lib/user-access.ts:requireUserExecutionIdentity` ruft **vor** der Identitätsauflösung `provisionMissingAccountAccess` auf. Bei Root-Freigabe und passendem Workspace wird auch der weitere Nutzer auf root gemappt.
4. `lib/mcp.ts:getMcpServers` erzeugt mit dem künstlichen MCP-Secret einen signierten Run-Kontext für den Nicht-Admin. `trustedSessionContextFromBearer` validiert diesen Kontext; `isHostAdmin=false`, `uid=0`.
5. Der unveränderte `dispatchGatewayTool` führt `read_file` und `execute_command` aus. `runSpawn` senkt UID/GID nur für Ziel-UID > 0 ab. Eine Root-Identität bleibt UID 0.

Beobachtete Marker:

```text
MA03_SECONDARY_NONADMIN_ROOT_SHARED_WORKSPACE
MA03_SIGNED_NONADMIN_MCP_CROSS_USER_FILE_READ
MA03_DIRECT_OUTSIDE_PATH_REJECTED
MA03_SIGNED_NONADMIN_SHELL_UID0_OUTSIDE_SENTINEL_READ
```

Der erste Read betrifft eine künstliche, mit Modus 0600 angelegte Datei unter `.ai-chat-uploads/artificial-owner-a/`. Der Shell-Test gibt `id -u = 0` aus und liest ausschließlich einen künstlichen Sentinel im eigenen Datenverzeichnis außerhalb des Workspace.

**Wichtige Gegenprobe:** Direkte `read_file`-Aufrufe außerhalb des Workspace werden abgewiesen. Die bisherige Aussage, Dateitools könnten beliebige Hostdateien direkt lesen, war zu pauschal. Der Shell-Inhalt selbst wird durch den Workspace-CWD-Check nicht auf diesen Pfad beschränkt; seine Zugriffsrechte folgen der OS-Identität. Deshalb bleibt der Root-Shell-Befund trotz funktionierender direkter Pfadgrenze bestehen.

**Weitere Varianten:**

- Tatsächlicher Root-Prozess, `AI_CHAT_ALLOW_ROOT_AGENTS=false`: neuer, nicht zu einem vorhandenen OS-Konto passender Nutzer bleibt ohne Mapping; Agent-Identitätsanforderung schlägt fehl.
- Kontrolliert **simulierte** Nicht-Root-Hostidentität: `provisionMissingAccountAccess` ordnet fehlende Mappings auch dem aktuellen Nicht-Root-Hostnutzer zu. Beide App-Nutzer können dieselbe UID und denselben Workspace erhalten. Die ursprüngliche pauschale Aussage „Nicht-Root ohne Mapping wird blockiert“ ist falsch. Das ist kein nativer Nicht-Root-Shell-/ACL-Nachweis.
- Docker-Vertragsvariante mit künstlichen DB-Zeilen: `requireUserExecutionIdentity` übernimmt dieselbe Prozess-UID/GID für beide Nutzer; kein individueller OS-Wechsel. **Kein gestarteter Docker-Stack.**
- `Dockerfile` hat keine `USER`-Direktive; `docker-compose.yml` kein `user:`-Override. „Nicht-Root-Workspace“ beschreibt einen Pfad, nicht die Prozessprivilegien. Kein behaupteter Host-Ausbruch aus einem Container.

Damit ist der bisher fehlende Code→Identität→signierter Kontext→MCP-Handler→Root-Shell-Nachweis ohne Provider-Key geschlossen. Es fehlen weiterhin ein vollständiger Worker-/Provider-Lauf, HTTP-MCP-Transport/Lease-Checks, UI-Approvals und reale getrennte OS-Nutzer/ACLs. Der Test setzt keinen Host-Admin-Status; er startet aber den Dispatcher in der Testkopie direkt. Signaturprüfung und Handler-Ausführung ersetzen keinen kompletten Netzwerklauf.

## Korrekturen und Hardening

| Punkt | Korrigierte Aussage / Status |
| --- | --- |
| MA-01 Exposition | Loopback-Bind verhindert direkte externe Verbindungen, schützt aber nicht vor einem öffentlichen Reverse-Proxy oder lokalen unberechtigten Nutzern. Ein bloßer `AI_CHAT_HOST=127.0.0.1`-Check schützt keinen hinter Proxy erreichbaren Bootstrap. Ein vertrauenswürdig geprüfter Peer oder unabhängiges Einmal-Setup-Geheimnis wäre eine mögliche Maßnahme. |
| MA-02 Proxy | Das Nginx-Template überschreibt `X-Real-IP` mit `$remote_addr`; diese Variante widerlegt keine generelle Proxy-Unsicherheit. Direktzugriff auf den Backend-Port muss ausgeschlossen sein. Share-Passwort-Rate-Limit verwendet denselben Adressresolver; Bypass dort statisch belegt, hier nicht erneut dynamisch ausgeführt. |
| MA-03 Installation | Linux-Installer verwendet `$HOME/metis-ai` und `User=$USER`, nicht für jeden Host root/`/root`. Root-Ausführung des Installers aktiviert Root-Agenten explizit; Nicht-Root-Installation und bestehende OS-Mappings haben andere Voraussetzungen. |
| MA-04 Herkunft | „Dead Code“, „eingeschleust“ oder „gehört nicht zum Produkt“ sind unbelegt. Die Route ist vorhanden; ihre fachliche Zugehörigkeit entscheidet der Produktverantwortliche. Prompt-Übersteuerung auf dieser Generierungsroute ist kein belegter Host-/Cross-User-Angriff. |
| MA-H1 Origin | Fehlende Origin-Allowlist statisch bestätigt. SameSite=Lax erschwert Cross-Site-Cookie-Mitgabe, ist aber keine Same-Origin-Garantie, insbesondere bei Same-Site-Sibling-Origins. Kein dynamischer Browser-/CSWSH-Nachweis in dieser Nachprüfung. |
| MA-H2 Proxy-Trust | Weiter offene Empfehlung, eng mit MA-02 verbunden; kein zusätzlicher unabhängiger Exploit. |
| MA-H3 Logout | **Bestätigtes Verhalten:** DELETE löscht nur den Browsercookie; Wiederverwendung des zuvor kopierten Testcookies funktioniert weiter. Session bleibt bis Ablauf/Account-Löschung gültig. Login erzeugt bereits einen **neuen zufälligen Token**; „keine Rotation nach Login“ ist daher missverständlich. Keine serverseitige Revocation alter Sessions durch Login/Logout. Kein gestohlener Produktionstoken getestet. |
| MA-H4 Root | Empfehlung bleibt offen. App/Worker-systemd-Hardening bedeutet keine Trennung der App-Nutzer. Der generierte MCP-Service hat bewusst andere Hardening-Werte, u. a. `NoNewPrivileges=false`/`ProtectSystem=false`. Keine produktiven Units verändert. |

Der Erstbericht bezeichnet geprüfte Negativbefunde als „robust“ und Produktgarantien. Das ist auf die jeweils geprüften Pfade/Fälle zu begrenzen: kein Nachweis vollständiger SSRF-/XSS-/Dateisystem-Sicherheit, keiner aller Upload-/Chat-/Remote-Varianten. DB-Eigentümergrenzen sind zusätzlich gezielt grün; sie verhindern nicht den belegten Read derselben Daten über gemeinsam privilegierte Shells. SHA256 vom selben Release-Kanal belegt Integrität gegen Übertragungsfehler/abweichende Assets, keine unabhängige Signatur oder Sicherheit bei kompromittiertem Release-Kanal.

## Plattformen, Erstinstallation und Update

| Plattform / Variante | Tatsächlich geprüft | Grenze |
| --- | --- | --- |
| Ubuntu 22.04.5 LTS, Linux x86_64, Node 22.16.0 | isolierte aktuelle Quellkopie; neue künstliche DB/Konten; echte UID-0-MCP-Datei-/Shell-Ausführung; lokale Provider-Anfrage; Logout; Header-Bypass | kein neuer Produktionsbuild, kein nackter Host, keine echten Provider/Remote-Geräte |
| Frische/migrierte SQLite | zwei Performance-Persistenztests: ältere Titel-Lock-Struktur, wiederholte Prozessstarts, Fremdnutzerfilter, vollständiger paginierter Replay; zusätzlicher Owner-Boundary-Test | keine vollständige Migration beliebiger historischer Installationen oder langfristige Schreiblast |
| Linux/macOS/Windows/Docker-Updateplanung | neun vorhandene `installer-update.test.ts`-Vertragsfälle, auf Linux ausgeführt: Plattformwahl, Commit-Pinning, Pfade, PrivateTmp, Runtime-Umgebung, Logstatus | keine echten Service-/LaunchAgent-/Windows-Updates |
| Nicht-Root | synthetischer Host-Identitätsvertrag plus statische Reparaturkette | keine reale neue OS-Identität/ACL-/Shell-Isolation |
| Docker | statische Dockerfile/Compose/Entrypoint-Prüfung und künstlicher Identitätsvertrag | keine Containerinstallation, kein Containerupgrade, kein Host-Ausbruch |
| Windows/macOS/ARM | statische Dokumentation und Plattform-Parser/Update-Verträge | kein nativer Sicherheitslauf, keine Remote-Client/UAC-Tests |

Die [Installer-Validierung vom 5. Oktober](./installer-validation-2026-10-05.md) dokumentiert frühere reale Ubuntu-24.04-x64-, macOS-arm64- und Windows-x64-Testinstallationen und Updates. Diese Ergebnisse werden **referenziert**, nicht als hier wiederholte Sicherheitsnachweise ausgegeben. Ebenso bleiben die vorhandenen Erststart-/Update-Belege des [Performance-Berichts](./PERFORMANCE-2026-10-08.md) erhalten.

Update-Relevanz: Beim erhaltenen Nutzerbestand bleibt Bootstrap durch `hasUsers` geschlossen. `provisionMissingAccountAccess` kann jedoch alte/fehlende OS-Zuordnungen auf eine geteilte Root- oder aktuelle Hostidentität reparieren; ein erfolgreicher Update-Healthcheck beweist keine Nutzerausführungsisolation. Der Installer übernimmt erhaltene nichtstrukturelle Env-Einstellungen, deshalb müssen Root-Freigabe, Netzwerkexposition und bestehende Mappings auch beim Upgrade geprüft werden. Diese Nachprüfung hat keine echte bestehende Installation aktualisiert.

## Priorisierte offene Nachweise

1. **MA-03, höchste Evidenzpriorität:** vollständiger isolierter Worker-Lauf mit lokalem Provider-/MCP-Transportstub einschließlich Leases/Approval-Policy; anschließend native Nicht-Root-Nutzer mit getrennten UID/GID/ACLs, Shared-/Distinct-Workspace-Gegenproben und Altbestand mit fehlendem Mapping. Keine echten Hostsecrets als Ziel.
2. **MA-01/MA-02:** frisch installierter isolierter Stack mit öffentlichem-Testproxy, geschlossener direkter Backend-Route und kontrollierten Headern; parallel erfolgende Bootstrap-Requests gesondert prüfen. Loopback und Proxy als getrennte Grenzen behandeln.
3. **MA-03 Portabilität:** echter Docker-Stack mit frischer Installation/Update-Sentinel sowie native macOS-/Windows-Mehrbenutzerläufe; Windows-Mapping ist nicht bereits ein Nachweis eines tatsächlichen Token-/Benutzerwechsels.
4. **MA-H1/MA-H3:** Browser-WS-Origin-/Same-Site-Sibling-Matrix; Logout/Passwortwechsel/Account-Löschung/Sessionablauf und mehrere Sessions end-to-end. Im aktuellen Test sind nur Logout-Restgültigkeit und neue Login-Token bewiesen.
5. **MA-04/sonstige Negativbefunde:** lokaler erfolgreicher strukturierter Provider-Response, Parallelitäts-/Timeout-Grenzen; SCA mit erreichbaren Pfaden und zusätzliche Symlink-/ACL-Fälle. Kein Kosten-/DoS-/CVE-Finding allein aus Vermutung.

Diese Liste ist eine priorisierte Evidenzliste, kein autorisierter Produkt-Fix-Auftrag. Die ursprüngliche Maßnahmenpriorität MA-01/MA-03 vor MA-02/MA-04 bleibt unter den beschriebenen Bedingungen nachvollziehbar.

## Reproduktion und Evidence-Ledger

Auf einem autorisierten **Linux-Root-Testhost** aus dem Repository:

```bash
bash docs/security-audit-2026-10-08-evidence/run.sh
```

Der Runner legt für jede Wiederholung einen eigenen Baum `/root/metis-security-recheck-XXXXXX` an, kopiert ausschließlich den Git-Quellstand und Audit-Skripte und startet Kinder mit `env -i`. Er lädt keine Produktions-`.env` oder Providercredentials. Die OS-Liste im Route-Test wird auf ein künstliches passwd-Set begrenzt. MA-04-Fetch ist auf genau den selbst erzeugten Loopback-Stub-Port beschränkt. Keine systemd-/LaunchAgent-/Remote-Kommandos, kein persistenter Worker/Web-/Gateway-Prozess. Testartefakte bleiben zum Nachlesen; automatische breitflächige Bereinigung findet nicht statt.

- [Route-/MCP-Reproduktion](./security-audit-2026-10-08-evidence/recheck.ts)
- [Identitätsvarianten](./security-audit-2026-10-08-evidence/identity-variants.ts)
- [Ergebnisübersicht](./security-audit-2026-10-08-evidence/summary.txt), [vollständiger Route-/MCP-Log](./security-audit-2026-10-08-evidence/recheck.txt), [Varianten](./security-audit-2026-10-08-evidence/variants.txt), [19 Regressionstests](./security-audit-2026-10-08-evidence/regressions.txt)
- [SHA256-Manifest](./security-audit-2026-10-08-evidence/SHA256SUMS)

Der erwartete Fehlerlog „synthetic provider refuses generation“ ist der absichtlich mit HTTP 400 antwortende lokale Stub. Er beweist Provider-Erreichbarkeit; der Test erwartet den Route-Status 500 und exakt einen Stub-Aufruf. Alle Audit-Assertions bestehen.

`verify_work`: **4/4 VERIFIED, allVerified=true**. Die gepinnte komplette Audit-Reproduktion und 19 Regressionen wurden im Ledger nochmals ausgeführt; Artefakt-Hashes, unveränderte Performance-Produktdateien und tatsächliche Modell-/Effort-Argumente sind bestätigt. [Ledger-Protokoll](./security-audit-2026-10-08-evidence/verify-work.txt). Keine Sicherheit der nicht getesteten Plattformen/Flows und kein Erfolg der parallelen Produkt-Fix-Kandidaten wird daraus abgeleitet.
