# Metis AI — Security-Audit (Code, Konfiguration, dynamisches Pentesting)

- **Datum:** 2026-10-08
- **Auditierte Revision:** `b97e22889505f342d647806bef5cecca8d097b5c` (package.json `version` 1.0.12)
- **Repository:** https://github.com/f1shyondrugs/metis.git (`/root/metis-ai`)
- **Methode:** statische Codeanalyse + Konfigurationsprüfung + dynamisches Pentesting gegen eine isolierte, frisch gebaute Testinstanz.
- **Testinstanz:** separater Baum aus `git archive b97e228`, eigene Ports (Web 3300 / MCP 8799), eigene leere SQLite-DB, Test-Secrets, Bind `127.0.0.1`. Keine Produktionsdaten verändert, keine Produktionsdienste gestoppt.
- **Scope-Grenzen eingehalten:** nur das autorisierte Metis-Projekt und die eigene Testinstanz; keine Angriffe gegen Provider, fremde Websites oder verbundene Nutzergeräte; nur künstliche Test-Accounts/Secrets; keine DoS-Tests gegen Produktion.

> Dieser Bericht dokumentiert ausschließlich. Es wurden **keine Produkt-Fixes** implementiert.

---

## 1. Architektur & Angriffsflächen

| Komponente | Rolle | Vertrauensgrenze |
| --- | --- | --- |
| Next.js App (`server.mjs`, `app/api/**`, ~125 Routen) | Web-UI + REST + WS | Session-Cookie `ai_chat_auth` (DB-Session) |
| Worker (`worker.ts`) | Agentenläufe, Tool-Ausführung | internes Bearer/Run-Lease |
| MCP-Gateway (`lib/mcp-core/*`, Port 8787) | Tool-Gateway | `MCP_BEARER_TOKEN` / signierte Metis-Session |
| Remote-Client (`remote-client/`, WS `/ws/remote-client`) | Geräte-Fernsteuerung | Enrollment-Token + Client-Credential |
| SQLite (`data/chat.sqlite`) | Chats, User, Sessions, Secrets | Dateisystem/OS |
| Installer (`install.sh`, `install/*`, `docker-compose.yml`) | Bootstrap | Host-Operator |

**Vertrauensgrenzen:** (a) anonym ↔ authentifiziert (Session-Cookie), (b) Nutzer ↔ Nutzer (`owner_id` in DB, OS-User bei Agent-Ausführung), (c) App ↔ MCP-Gateway (Bearer/Session), (d) Server ↔ Remote-Client (Enrollment/Credential), (e) Agent-Tools ↔ Host (OS-User + `allowRootAgents`).

**Bedrohungsmodell (bewertet):** nicht-authentifizierter Angreifer · gering privilegierter authentifizierter Nutzer · Nutzer-gegen-Nutzer-Zugriff · bösartige Uploads/Webseiten/Tool-Ergebnisse/MCP-Inhalte · kompromittierter Remote-Client/MCP-Server. Terminal- und Tool-Ausführung sind gewollte Features; bewertet wurde die Umgehung von Rechte-, Freigabe- und Nutzergrenzen.

---

## 2. Übersicht der Findings

| ID | Titel | Schwere | Typ | Frische Installation betroffen | Status |
| --- | --- | --- | --- | --- | --- |
| MA-01 | Unauthentifizierte First-Run-Admin-Erstellung (Account-Takeover → Host-RCE) | **Hoch** | Schwachstelle | Ja, bei Bind ≠ localhost vor Onboarding | Bestätigt (dynamisch) |
| MA-02 | Rate-Limit-Umgehung über client-kontrolliertes `X-Real-IP`/letzter XFF-Hop | **Mittel** | Schwachstelle | Ja, bei Installation ohne vertrauenswürdigen Proxy | Bestätigt (dynamisch) |
| MA-03 | Fehlende Agent-Ausführungsisolation zwischen App-Nutzern bei Root-Installation | **Hoch** | Schwachstelle (Default-abhängig) | Ja, Standard-Root-Installation mit Mehrbenutzer | Plausibel + teilverifiziert |
| MA-04 | Unauthentifizierter LLM-Kosten-/Ressourcen-Endpunkt `/api/process-a` | **Mittel** | Schwachstelle (Dead Code) | Nur wenn `OPENAI_API_KEY` gesetzt | Bestätigt reachable |
| MA-05 | Pre-Auth-Offenlegung von Host-OS-Benutzernamen + Home-Pfaden via `/api/setup` | **Niedrig** | Info-Disclosure | Ja, während Onboarding-Fenster | Bestätigt (dynamisch) |
| MA-H1 | WS `/api/browser/stream` ohne Origin-Allowlist (nur SameSite=Lax) | Hardening | Empfehlung | — | Beobachtet |
| MA-H2 | Kein konfigurierbarer Trusted-Proxy-Hop / Header-Trust abschaltbar | Hardening | Empfehlung | — | Beobachtet |
| MA-H3 | Session-Logout invalidiert nur die aktuelle Session, keine Rotation | Hardening | Empfehlung | — | Beobachtet |
| MA-H4 | Lauf als root + `allowRootAgents`-Default für `/root`-Installationen | Hardening | Empfehlung | — | Beobachtet |

---

## 3. Findings (Belegstandard)

### MA-01 — Unauthentifizierte First-Run-Admin-Erstellung

- **Schwere:** Hoch. Begründung: vollständige Account-Übernahme eines frischen Deployments; da Admin-Agenten Terminal-/Dateitools besitzen, folgt effektiv Host-RCE.
- **Betroffen:** `app/api/setup/route.ts` (`POST`, `action === "bootstrap"`), `lib/setup.ts` (`getSetupStatus`/`isSetupComplete`), `lib/admin-users.ts` (`createManagedUser`).
- **Angreiferrolle/Voraussetzung:** nicht-authentifiziert; Netzwerkerreichbarkeit der App **bevor** der Betreiber das Onboarding abgeschlossen hat. Default-Bind ist `127.0.0.1`; die `.env.example`/README nennen `AI_CHAT_HOST=0.0.0.0` aber als unterstützte LAN-Option.
- **Ursache/Datenfluss:** Der Bootstrap-Zweig ist bewusst vor dem Auth-Check platziert und nur durch `getSetupStatus().hasUsers === false` geschützt (= „es existiert noch kein Nutzer"). Es gibt **kein Out-of-Band-Geheimnis** (kein Setup-Token in Server-Log/Konsole, keine Localhost-Bindung des Bootstraps). Der erste Request gewinnt und erhält `isAdmin: true` plus gültige Session.

```47:68:app/api/setup/route.ts
  if (action === "bootstrap") {
    const status = getSetupStatus();
    if (status.hasUsers) {
      return Response.json({ error: "Setup already has an account." }, { status: 409 });
    }
    try {
      const user = createManagedUser({
        username: body.username || "",
        password: body.password || "",
        isAdmin: true,
        osUsername: body.osUsername?.trim() || undefined,
      });
      markSetupIncomplete();
      const session = authenticateUser(user.username, body.password || "");
```

- **Reproduktion (dynamisch, Testinstanz, leere DB):**
  ```bash
  curl -i -X POST http://127.0.0.1:3300/api/setup \
    -H 'Content-Type: application/json' \
    -d '{"action":"bootstrap","username":"attacker","password":"attackerpass123"}'
  ```
- **Erwartet:** First-Run nur lokal/konsolengebunden oder per Einmal-Token.
- **Beobachtet:** `HTTP/1.1 201 Created`, `Set-Cookie: ai_chat_auth=…; HttpOnly; SameSite=lax`, Body `{"ok":true,"user":{…,"isAdmin":true,"workspaceRoot":"…/workspace"}}`. Folge-Request mit dem Cookie an `/api/chats` ⇒ `200`.
- **Auswirkung/Reichweite:** Übernahme des ersten (Admin-)Accounts; Aussperren des Betreibers; über Agent-Tools Zugriff auf Host und Secrets.
- **Gültigkeit frische Installation:** ja, sobald die App vor Onboarding netzwerkerreichbar ist (dokumentierte LAN-Option, Reverse-Proxy-Setups, Container mit offenem Port).
- **Fix-Vorschläge:**
  1. Bootstrap nur zulassen, wenn der Request von Loopback kommt **oder** ein beim Erststart generiertes, ins Server-Log/`data/`-Datei geschriebenes Einmal-Setup-Token mitgegeben wird (vgl. Jupyter/Grafana-Muster).
  2. Alternativ Bootstrap an `AI_CHAT_BIND`/`AI_CHAT_HOST === 127.0.0.1` koppeln bzw. bei Nicht-Loopback einen Token erzwingen.
  3. Rate-Limit + generische Fehler auch auf `action === "bootstrap"`.
- **Regressionstest:** `tests/setup-onboarding.test.ts` erweitern: (a) Bootstrap über nicht-Loopback-Request ohne Token ⇒ 401/403; (b) mit korrektem Einmal-Token ⇒ 201; (c) zweiter Bootstrap ⇒ 409.
- **Verifikationsstatus:** Bestätigt.

---

### MA-02 — Rate-Limit-Umgehung über client-kontrollierte IP-Header

- **Schwere:** Mittel. Begründung: Login- und Share-Passwort-Rate-Limits sind als Brute-Force-Schutz dokumentiert (SECURITY.md Pkt. 8), lassen sich aber ohne vertrauenswürdigen Proxy trivial umgehen.
- **Betroffen:** `lib/rate-limit.ts` (`requestClientAddress`), `app/api/auth/route.ts`, `app/api/share/route.ts`.
- **Angreiferrolle/Voraussetzung:** nicht-authentifiziert; App ist direkt erreichbar (kein Proxy, der `x-real-ip`/XFF überschreibt).
- **Ursache/Datenfluss:** Der Limiter schlüsselt auf `x-real-ip` bzw. den **letzten** `X-Forwarded-For`-Hop. Beide Header sind bei einer Direktverbindung vollständig vom Client kontrolliert. Da auch der User-Schlüssel `auth:user:${address}:${username}` die Adresse enthält, rotiert der Angreifer einfach die IP und setzt beide Fenster zurück.

```34:43:lib/rate-limit.ts
export function requestClientAddress(req: Request) {
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 128);
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
    return (hops.at(-1) || "unknown").slice(0, 128);
  }
  return "unknown";
}
```

- **Reproduktion (dynamisch):** 35 Fehllogins mit konstantem `X-Real-IP` vs. 35 mit rotierendem `X-Real-IP`.
  ```bash
  for i in $(seq 1 35); do curl -s -o /dev/null -w '%{http_code}\n' -X POST \
    http://127.0.0.1:3300/api/auth -H 'Content-Type: application/json' \
    -H "X-Real-IP: 10.0.0.$i" -d '{"username":"admin","password":"wrong"}'; done | sort | uniq -c
  ```
- **Erwartet:** nach wenigen Versuchen `429`.
- **Beobachtet:** konstante IP ⇒ `401`×10 dann `429`×25 (Limit greift). Rotierende IP ⇒ `401`×35, **kein** `429`. Brute-Force damit ungedrosselt.
- **Auswirkung/Reichweite:** unbegrenzter Passwort-Brute-Force auf das Login (und Share-Passwörter). Schwache Passwörter werden angreifbar; die dokumentierte Schutzmaßnahme trägt nicht.
- **Gültigkeit frische Installation:** ja, für jede Direktexposition ohne Proxy, der die Header normalisiert.
- **Fix-Vorschläge:**
  1. Header-Trust nur aktivieren, wenn explizit konfiguriert (`TRUSTED_PROXY_HOPS`/`TRUST_PROXY=true`); sonst `request.socket.remoteAddress` verwenden.
  2. Bei konfiguriertem Proxy den Hop anhand bekannter Proxy-CIDRs auswählen statt blind letzten/`x-real-ip`.
  3. Zusätzlich global (nicht nur pro Adresse) ein konservatives Login-Fehler-Budget.
- **Regressionstest:** neuer Test in `tests/auth.test.ts`: ohne `TRUST_PROXY` wird `x-real-ip` ignoriert und `remoteAddress` als Key genutzt; rotierende `X-Real-IP` triggert weiterhin `429`.
- **Verifikationsstatus:** Bestätigt.

---

### MA-03 — Fehlende Agent-Ausführungsisolation zwischen App-Nutzern (Root-Installation)

- **Schwere:** Hoch für Mehrbenutzer-Installationen; nicht relevant für Einzelbenutzer. Default-abhängig.
- **Betroffen:** `lib/config.ts` (`defaultAllowRootAgents`), `lib/admin-users.ts` (`createManagedUser`), `lib/user-access.ts` (`getUserAccess`/`getUserExecutionIdentity`), `lib/uploads.ts` (`uploadsRoot` → `getAgentCwd`).
- **Angreiferrolle/Voraussetzung:** gering privilegierter, authentifizierter Nutzer (kein Admin) auf einer Instanz, die als `root` in `/root` installiert ist (so richten der Linux-Installer und die systemd-Units dieser Umgebung die App ein) und mehrere App-Nutzer hat, die vom Admin **ohne** eigenen `osUsername`/`workspaceRoot` angelegt wurden.
- **Ursache/Datenfluss:**
  - `createManagedUser` setzt für Nicht-Erst-Nutzer `osUsername = undefined` und `workspaceRoot = config.agentCwd` (geteiltes Verzeichnis).
  - `defaultAllowRootAgents()` aktiviert Root-Agenten automatisch, wenn als uid 0 in `/root` gelaufen wird.
  - `getUserExecutionIdentity` liefert dann für **jeden** Nutzer ohne OS-Mapping die Root-Identität mit demselben `workspaceRoot`.

```32:39:lib/config.ts
function defaultAllowRootAgents() {
  const flagged = env("AI_CHAT_ALLOW_ROOT_AGENTS");
  if (flagged) return booleanEnv("AI_CHAT_ALLOW_ROOT_AGENTS");
  const uid = typeof process.getuid === "function" ? process.getuid() : -1;
  const resolved = path.resolve(agentCwd);
  const rootHome = path.resolve("/root");
  return uid === 0 && (resolved === rootHome || resolved.startsWith(`${rootHome}${path.sep}`));
}
```

```165:176:lib/user-access.ts
export function getUserExecutionIdentity(userId?: string): UserExecutionIdentity | undefined {
  const access = getUserAccess(userId);
  if (!access.osUsername && config.allowRootAgents && isRootWorkspace(access.workspaceRoot)) {
    return { username: "root", uid: 0, gid: 0, home: "/root", workspaceRoot: access.workspaceRoot };
  }
  if (!access.osUsername) return undefined;
```

- **Datenbank-Isolation hält** (positiv): Chats/Notes/Memories/Uploads sind in der App-Schicht über `owner_id` getrennt (siehe MA-Negativtests). Die Lücke betrifft die **Ausführungsschicht**: über Agent-Terminal/Datei-Tools läuft Nutzer B als root im selben Workspace und liest Uploads/`chat.sqlite` (inkl. aller `owner_id`-Zeilen, Session-Token-Hashes), `.env` (Secrets) und beliebige Hostdateien — die DB-`owner_id`-Prüfung wird dadurch irrelevant.
- **Positiver Gegenbefund (fail-safe):** Ohne `allowRootAgents` und ohne OS-Mapping wirft `requireUserExecutionIdentity` („no valid OS user mapping") — dann sind Agentenläufe für solche Nutzer blockiert (sicher). Die Lücke entsteht erst durch den Root-Default.
- **Reproduktion/Beleg:** In der Testinstanz erhielten Admin `attacker` und Nicht-Admin `victimB` denselben `workspaceRoot` `/root/metis-audit/workspace` (bestätigt via `/api/setup` und `POST /api/admin/users`). Der Endnachweis eines Cross-User-Reads via Agent erfordert Worker+Provider-Key und wurde daher nicht live ausgeführt; die Code-Kette ist eindeutig.
- **Gültigkeit frische Installation:** ja, für die Standard-Root-Installation mit mehreren App-Nutzern.
- **Fix-Vorschläge:**
  1. Mehrbenutzer ohne eindeutige OS-User-Bindung verbieten (hart fehlschlagen statt auf Root zu kollabieren), sobald mehr als ein App-Nutzer existiert.
  2. `createManagedUser` sollte pro Nutzer einen distinkten `workspaceRoot` und eine verpflichtende OS-User-Bindung erzwingen (oder Agentenläufe deaktivieren).
  3. `allowRootAgents` nie implizit aus „läuft als root in /root" ableiten; nur explizit via Env, mit deutlicher Warnung.
- **Regressionstest:** `tests/user-isolation.test.ts`/`tests/owner-boundary.test.ts` erweitern: zweiter Nutzer ohne OS-Mapping bei `allowRootAgents=true` ⇒ `getUserExecutionIdentity` darf **nicht** Root mit geteiltem Workspace liefern.
- **Verifikationsstatus:** Plausibler, codebelegter Verdacht (Workspace-Sharing dynamisch bestätigt; Root-Exec-Read nicht live ausgeführt).

---

### MA-04 — Unauthentifizierter LLM-Kosten-/Ressourcen-Endpunkt `/api/process-a`

- **Schwere:** Mittel, wenn `OPENAI_API_KEY`/`OPENAI_MODEL` gesetzt sind; sonst latent.
- **Betroffen:** `app/api/process-a/route.ts`.
- **Angreiferrolle/Voraussetzung:** nicht-authentifiziert; App erreichbar; serverseitiger Provider-Key konfiguriert.
- **Ursache/Datenfluss:** Die Route hat **keinerlei** Auth-Prüfung und ruft `generateObject` (200 Objekte, temperature 0.8) mit dem Server-Key auf. Nutzer-`topic` fließt direkt in den Prompt.

```16:32:app/api/process-a/route.ts
export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const apiKey = process.env.OPENAI_API_KEY || process.env.AI_GATEWAY_API_KEY;
    const modelId = process.env.OPENAI_MODEL || process.env.AI_MODEL;
    if (!apiKey || !modelId) {
      return Response.json({ error: "Process A is missing OPENAI_API_KEY and OPENAI_MODEL in the environment." }, { status: 503 });
    }
    const provider = createOpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL });
    const { object } = await generateObject({ model: provider(modelId), schema: resultSchema, temperature: 0.8, prompt: `…"${input.topic}"…` });
```

- **Reproduktion:** `curl -X POST http://127.0.0.1:3300/api/process-a -H 'Content-Type: application/json' -d '{"topic":"abc","languages":["en"]}'` ⇒ in der Testinstanz `503` (kein Key), d. h. **erreichbar ohne Auth**; mit Key würde jede Anfrage eine teure LLM-Generierung auslösen.
- **Auswirkung:** unauthentifizierter Kosten-/Quota-Verbrauch (Rechnung des Betreibers), Ressourcen-DoS; Prompt-Injection über `topic` (geringe Wirkung, eigener Key).
- **Gültigkeit frische Installation:** nur bei gesetztem Provider-Key in der Server-Umgebung. Wirkt wie eingeschleuster, produktfremder „Influencer-Outreach"-Code.
- **Fix-Vorschläge:** Route entfernen (gehört nicht zum Produkt) oder hinter `isAuthenticated` + Rate-Limit stellen.
- **Regressionstest:** Test, der sicherstellt, dass `/api/process-a` ohne Session `401` liefert (bzw. die Route nicht existiert).
- **Verifikationsstatus:** Bestätigt (unauth erreichbar).

---

### MA-05 — Pre-Auth-Offenlegung von Host-OS-Benutzern via `/api/setup`

- **Schwere:** Niedrig.
- **Betroffen:** `app/api/setup/route.ts` (`GET`), `lib/user-access.ts` (`listHostOsUsers`).
- **Ursache/Datenfluss:** Vor dem ersten Nutzer (`needed && !hasUsers`) liefert `GET /api/setup` unauthentifiziert die Liste der Host-OS-Benutzer inkl. Home-Pfade.

```24:35:app/api/setup/route.ts
export async function GET(req: Request) {
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  const status = getSetupStatus(ownerId);
  const canListOsUsers = status.needed && (!status.hasUsers || (ownerId && isHostAdmin(ownerId)));
  return Response.json({ ...status, platform: hostPlatform(),
    osUsers: canListOsUsers ? listHostOsUsers().map(({ username, home }) => ({ username, home })) : [], … });
}
```

- **Beobachtet:** Testinstanz gab unauthentifiziert `cora, f1shy312, lotb, trynocs` samt `/home/<user>` zurück.
- **Auswirkung:** Enumeration lokaler Konten/Pfade im Onboarding-Fenster; nützlich für Folgeangriffe (zusammen mit MA-01).
- **Fix-Vorschläge:** OS-User-Liste erst nach Loopback-Bootstrap/Token bzw. nur für authentifizierte Host-Admins zurückgeben.
- **Regressionstest:** Test, der prüft, dass `osUsers` bei nicht-Loopback/unauth leer ist.
- **Verifikationsstatus:** Bestätigt.

---

## 4. Hardening-Empfehlungen (keine bestätigten Schwachstellen)

- **MA-H1 — WS-Origin:** `server.mjs` `upgrade` für `/api/browser/stream` prüft Session-Cookie, aber **keinen `Origin`**. SameSite=Lax verhindert hier das Mitsenden des Cookies bei Cross-Site-WS-Handshakes (daher kein bestätigter CSWSH), dennoch empfohlen: explizite Origin-Allowlist analog `corsAllowedOrigins`.
- **MA-H2 — Trusted Proxy:** konfigurierbares Proxy-Trust-Modell statt blindem Header-Vertrauen (siehe MA-02).
- **MA-H3 — Session-Lifecycle:** `DELETE /api/auth` löscht nur das Cookie; serverseitig bleibt der Session-Datensatz 30 Tage gültig, keine Rotation nach Login. Empfehlung: Session-Row bei Logout invalidieren, optional Rotation.
- **MA-H4 — Root-Betrieb:** Betrieb als dedizierter Nicht-Root-Service-User empfehlen; `allowRootAgents` nur explizit (siehe MA-03).

---

## 5. Geprüfte Bereiche mit negativem Befund (robust)

| Bereich | Befund | Beleg |
| --- | --- | --- |
| IDOR/BOLA Chats | `owner_id`-Scoping durchgesetzt; Cross-User-Read ⇒ 404 (dynamisch), anon ⇒ 401 | `lib/db-store.ts` `getChat`/`getChatPage`; `app/api/chats/[id]/route.ts` |
| Share-Passwort | pbkdf2 + `timingSafeEqual`; `passwordHash` nie in `publicShare`/`publicChat` | `lib/db-store.ts` `verifySharePassword`/`publicShare` |
| SSRF (link-preview, voice) | Private-IP-Ranges, Metadata-Hosts, DNS-Rebinding (Re-Resolve pro Hop), Cross-Origin-Redirects blockiert; Credentials-in-URL verboten | `lib/url-security.ts` |
| Path Traversal (Uploads/Share-Attachment) | `basename`-Prüfung, `..`/`/`-Ablehnung, Prefix-Check auf Zielverzeichnis | `lib/uploads.ts` `resolveUploadPath`; `app/api/share/attachment/route.ts` |
| XSS (Markdown) | react-markdown ohne `rehype-raw` (kein Roh-HTML); `highlight.js` escaped Code | `components/markdown.tsx` |
| XSS (Mermaid) | `securityLevel: "strict"`, `htmlLabels: false`, mermaid v11 (interne DOMPurify) | `components/mermaid-diagram.tsx` |
| Secrets at rest | AES-256-GCM, Schlüssel verpflichtend (`AI_CHAT_SECRETS_KEY`), kein Default-Key | `lib/secrets.ts` |
| MCP-Gateway-Auth | Localhost ≠ Auth; Bearer/Signed-Session erforderlich; timing-safe; CORS-Allowlist | `lib/mcp-core/http-auth.mjs` |
| Remote-Enrollment | Permission-Mode an Token gebunden (`a_`/`u_`-Präfix + DB-Abgleich); Single-Use; TTL | `lib/remote-clients.ts` `consumeEnrollmentToken` |
| Remote-Authz | Modus/Capability/Allowlist/riskante-Befehle serverseitig vor WS-Aufruf | `lib/remote-clients.ts` `authorizeRemoteAction` |
| Installer-Defaults | `openssl rand` für `MCP_BEARER_TOKEN`/`AI_CHAT_SECRETS_KEY`; `.env` chmod 600; Release-SHA256-Verifikation | `install.sh`, `install/linux.sh` |
| Passwort-Hashing/Session | pbkdf2 120k, Token zufällig (32 B), nur Hash gespeichert, HttpOnly/SameSite=Lax, secure bei https | `lib/auth.ts`, `app/api/auth/route.ts` |

---

## 6. Testmatrix (frische Installation / Rollen / Varianten)

| Szenario | anon | Nutzer (gering) | Nutzer→fremde Daten | Admin | Ergebnis |
| --- | --- | --- | --- | --- | --- |
| Login (Direktexposition, ohne Proxy) | MA-02 Bypass | — | — | — | Schwachstelle |
| First-Run vor Onboarding (Bind ≠ localhost) | MA-01 Takeover | — | — | — | Schwachstelle |
| First-Run (Bind 127.0.0.1, Default) | nicht erreichbar | — | — | — | OK |
| Chat-Zugriff fremd | 401 | 404 | 404 | 404 (nur eigene) | Isolation OK |
| Agent-Ausführung (Root-Install, Mehrbenutzer) | — | läuft als root/shared WS | Cross-User möglich | — | MA-03 |
| Agent-Ausführung (Nicht-Root, kein OS-Mapping) | — | blockiert (fail-safe) | — | — | OK |
| `/api/process-a` | erreichbar (503/LLM) | — | — | — | MA-04 |
| `/api/setup` GET (Onboarding-Fenster) | OS-User-Leak | — | — | — | MA-05 |
| MCP-Gateway (localhost, kein Token) | abgelehnt | — | — | — | OK |

**Installationsvarianten bewertet:** Standard-Linux (systemd, root, `/root`) · Docker (`docker-compose.yml`, Nicht-Root-Workspace) · Bind 127.0.0.1 (Default) vs. 0.0.0.0 (LAN). **Nicht live getestet:** Windows-Per-Machine/UAC-Remote-Client (keine Windows-Umgebung), realer Agent-Lauf mit Provider-Key (MA-03-Endnachweis), macOS-Installer.

**Produktgarantien vs. Betreiberpflichten:** Das Produkt liefert selbst: Auth/Session, DB-`owner_id`-Isolation, Secret-Verschlüsselung, SSRF-/Path-/XSS-Abwehr, MCP-Bearer-Zwang, Installer-Secret-Generierung + Datei-Rechte. In Betreiberverantwortung bleiben: vertrauenswürdiger Proxy/WAF (MA-02), Netzwerkexposition erst nach Onboarding bzw. Loopback-First-Run (MA-01), OS-User-Isolation/Nicht-Root-Betrieb bei Mehrbenutzer (MA-03).

---

## 7. Priorisierte Umsetzungsreihenfolge

1. **MA-01** — Bootstrap auf Loopback/Einmal-Token beschränken (Account-Takeover, einfachster Full-Compromise).
2. **MA-03** — Mehrbenutzer ohne eindeutige OS-User-Isolation hart verbieten; `allowRootAgents` nicht implizit.
3. **MA-02** — konfigurierbares Trusted-Proxy-Modell; ohne Proxy `remoteAddress` nutzen.
4. **MA-04** — `/api/process-a` entfernen oder authentifizieren + rate-limiten.
5. **MA-05** — OS-User-Liste erst nach sicherem Bootstrap/für Admins.
6. **MA-H1–H4** — Origin-Allowlist für WS, Session-Invalidierung bei Logout, Nicht-Root-Betrieb dokumentieren/erzwingen.

---

## 8. Hinweise zu Dependencies

Keine erfundenen CVEs. Dependency-Meldungen wurden nicht als Findings gewertet, ohne erreichbaren Pfad nachzuweisen; ein erfolgreicher Scanner belegt keine Sicherheit. Für eine belastbare SCA sollte `pnpm audit --prod` gegen `pnpm-lock.yaml` mit anschließender Erreichbarkeitsprüfung je Treffer laufen (nicht Teil dieses dynamischen Audits).
