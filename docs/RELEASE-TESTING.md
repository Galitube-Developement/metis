# Release- und Upgrade-Tests

> Last reviewed: 11 Sep 2026. Index: [README.md](./README.md).

## Lokale, netzwerkfreie Vertragsprüfung

Diese Prüfung verändert keine Installation und veröffentlicht nichts:

```bash
pnpm test:release
pnpm exec tsx --test tests/release-manifest.test.ts tests/github-releases.test.ts
pnpm exec tsc --noEmit --pretty false
```

`pnpm test:release` prüft:

- Stable-Manifest für einen Testtag mit Commit
- Docker-Installer-Dry-Run ohne erzeugte `.env` oder Compose-Datei
- Ablehnung von Branchnamen statt SemVer-Tags
- SHA256-Prüfsummenformat

## Erstes echtes Release

1. `package.json.version` und Tag müssen übereinstimmen.
2. CI muss auf dem Tag erfolgreich sein.
3. `pnpm release vX.Y.Z` erstellt lokal den Tag, veröffentlicht GitHub-Assets und pusht das GHCR-Image unter dem lokal authentifizierten Account. GitHub Actions veröffentlicht keine Releases.
4. Den Installer in einem separaten Testverzeichnis ausführen:

```bash
bash metis-docker-install.sh \
  --version v1.0.0 \
  --install-dir "$HOME/metis-ai-e2e" \
  --data-dir "$HOME/metis-ai-e2e-data" \
  --workspace "$HOME/metis-ai-e2e-workspace"
```

Danach prüfen:

- `/api/system/version` meldet die erwartete Version.
- Ein Sentinel-Dokument in Daten und Workspace bleibt nach dem Upgrade erhalten.
- `docker compose ps` zeigt App, Worker und MCP als healthy/running.
- Ein Upgrade auf den nächsten Tag ändert nur den Image-Tag.
- Ein absichtlich fehlerhafter Healthcheck wird erkannt, ohne Datenverzeichnisse zu löschen.

Produktions-Metis wird für diese Tests nicht gestoppt oder neugestartet. Rollback-Tests laufen ausschließlich im separaten E2E-Installationsverzeichnis.

## Lokales Release

Die Versionsnummer in `package.json` und der Changelog werden zuerst committed.
Danach startet der Release-Befehl alle Prüfungen, erstellt den signierten Tag,
pusht ihn nach `master`, baut die Assets und veröffentlicht Release plus Docker-
Image unter dem Account von `gh auth status`:

```bash
gh auth status
pnpm release v1.0.6
```

Der lokale Git-Name und die E-Mail-Adresse werden für den Tag verwendet. Vor
dem Start muss der Arbeitsbaum sauber sein. Ein Force-Push ist nicht Teil des
Release-Prozesses.
