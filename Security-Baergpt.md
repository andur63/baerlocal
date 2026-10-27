# Security-Audit: BärGPT – Container-Isolation & Dateisystem-Zugriffe

**Datum:** 27.10.2026  
**Projekt:** BärGPT (`baergpt`)  
**Prüfungsgegenstand:**  
1. Überprüfung des Backends auf Erreichbarkeit von Host-Verzeichnissen über den Docker-Container.  
2. Projektweite Sicherheitsanalyse auf Schwachstellen, die einen Zugriff auf lokale, Container- oder externe Dateisysteme (Host, S3/Storage, Drittsysteme) erlauben.

---

## Teil 1: Sind Host-Verzeichnisse über den Backend-Docker-Container erreichbar?

**Ergebnis:** Nein, über den **Backend-Docker-Container (`baergpt-backend`)** sind **keine Host-Verzeichnisse** erreichbar.

### 1.1 Lokales Docker-Setup (`compose.yml`)
* **Keine Verzeichnis-Mounts:** In `compose.yml` (Zeilen 19–20) wird unter `volumes` lediglich eine **einzelne Datei** schreibgeschützt (`:ro`) in den Container eingebunden:
  ```yaml
  volumes:
    - ./apps/backend/.env:/app/apps/backend/.env:ro
  ```
  *Hinweis zum Verhalten von Docker:* Falls die Datei `./apps/backend/.env` auf dem Host-System vor dem Ausführen von `docker compose up` noch nicht existiert, legt der Docker-Daemon standardmäßig ein leeres Verzeichnis unter diesem Pfad auf dem Host an und mountet dieses. Im regulären Betrieb (wenn `.env` als Datei vorliegt) ist im Container ausschließlich diese einzelne Konfigurationsdatei sichtbar.
* **Port-Binding nur auf Loopback:** Der Container-Port `3000` wird in `compose.yml` (Zeile 18) explizit nur an `127.0.0.1:3000:3000` gebunden, sodass der lokale Entwicklungs-Container nicht im lokalen Netzwerk (LAN) exponiert ist.
* **Netzwerk-Zugriff statt Dateisystem-Zugriff (`extra_hosts`):** Über `extra_hosts: - "host.docker.internal:host-gateway"` (`compose.yml`, Zeilen 22–23) kann der Container Netzwerkdienste auf dem Host erreichen (insbesondere die lokal über die Supabase-CLI gestartete Instanz unter `http://host.docker.internal:54321`). Dies gewährt jedoch keinerlei Zugriff auf das Dateisystem des Hosts.

### 1.2 Docker-Image, Build-Kontext & Laufzeit (`apps/backend/Dockerfile` & `.dockerignore`)
* **Strikte Filterung des Build-Kontexts (`.dockerignore`):** Da der Docker-Build mit dem Repository-Root als Kontext ausgeführt wird, schließt `.dockerignore` sensible Verzeichnisse und Dateien bereits vor dem Kopieren in die Build-Stage aus:
  * Versionsverwaltung und CI/CD: `.git`, `.github`
  * Umgebungsdateien und Secrets: `**/.env`, `**/.env.*`
  * Abhängigkeiten und Build-/Test-Artefakte: `**/node_modules`, `**/dist`, `**/.turbo`, `**/.next`, `**/coverage`, `**/playwright-report`, `**/test-results`
  * Docker-Dateien: `**/Dockerfile`, `**/.dockerignore`
* **Monorepo-Pruning (`turbo prune`):** In `apps/backend/Dockerfile` (Zeilen 9–14) reduziert `turbo prune baergpt-backend --docker` den Quellcode auf das Paket `baergpt-backend` und dessen unmittelbare Monorepo-Abhängigkeiten. In der `builder`-Stage werden nach dem Build die Dev-Dependencies via `npm prune --omit=dev` entfernt (Zeile 25).
* **Keine `VOLUME`-Deklarationen & unprivilegierter Laufzeit-User:** Das `Dockerfile` definiert keine `VOLUME`-Mountpoints. In der `runner`-Stage (Zeilen 28–38) wird ein dedizierter System-Benutzer ohne Root-Rechte angelegt und aktiviert:
  ```dockerfile
  RUN groupadd --system --gid 1001 nodejs \
      && useradd --system --uid 1001 --gid nodejs hono
  COPY --from=builder --chown=hono:nodejs /app ./
  USER hono
  ```
  Es werden weder `privileged: true` noch zusätzliche Linux-Capabilities (`cap_add`) verwendet.
* **Produktives Cloud-Foundry-Deployment (`apps/backend/manifest.yml`):** Auf STACKIT Cloud Foundry wird das Docker-Image als isolierte App (`baergpt-backend-((space))`) ohne Host-Volume-Mounts betrieben. Sämtliche Secrets und Umgebungsvariablen werden zur Laufzeit aus 1Password über `cf set-env` injiziert.

### 1.3 Backend-Anwendungscode (`apps/backend/src/`)
* Im gesamten produktiven Hono-Backend (`apps/backend/src/index.ts`, `routes/documents.ts`, `routes/admin.ts`, `routes/llms.ts`, `routes/favicon.ts`) wird weder das Node.js-Dateisystemmodul (`node:fs` / `fs`) importiert noch ein Verzeichnis für statische Dateien (`serveStatic`) bereitgestellt.
* Die einzigen Verwendungen von `readFileSync` und `node:path` unter `apps/backend/` befinden sich in den Integrationstests (`apps/backend/src/integration/*.test.ts`) sowie in administrativen CLI-Skripten (`apps/backend/supabase/scripts/`).
* Hochgeladene Dokumente werden im Arbeitsspeicher (`Uint8Array` / `Buffer`) verarbeitet und über die Supabase-Storage-API in den S3-kompatiblen Object Storage hochgeladen.

---

## Teil 2: Projektweite Überprüfung auf Sicherheitslücken für Dateisystem-Zugriffe

### 2.1 Bereits abgesicherte Bereiche im Hono-Backend & Supabase Storage

1. **Schutz vor Path Traversal bei Dokumenten-Uploads (`ValidationService`):**
   * In `apps/backend/src/services/validation-service.ts` (Zeilen 90–91) übernimmt das Backend niemals vom Client gesendete Pfadnamen für die Speicherung im Storage-Bucket (`documents` bzw. `public_documents`).
   * Stattdessen wird `sourceUrl` serverseitig deterministisch konstruiert:
     ```typescript
     const prefix = sourceType === "personal_document" ? userId : accessGroupId;
     const sourceUrl = `${prefix}/${crypto.randomUUID()}.${fileExtension}`;
     ```
   * Dabei stammt `userId` aus dem verifizierten JWT des authentifizierten Nutzers (`c.get("authenticatedUserId")`), `accessGroupId` wird durch Zod als UUID validiert (`z.uuid()` in `apps/backend/src/schemas/document-process-schema.ts`, Zeile 12), und der Dateiname im Bucket ist immer eine frisch generierte UUID.
2. **Row-Level Security (RLS) auf `storage.objects`:**
   * In `apps/backend/supabase/migrations/20260908140558_check_user_deleted.sql` (Zeilen 435–523) erzwingen die Postgres-RLS-Policies für den Bucket `documents` bei `INSERT`, `SELECT`, `UPDATE` und `DELETE`:
     * `bucket_id = 'documents'`
     * `owner_id = (SELECT auth.uid())::TEXT`
     * `(storage.foldername(name))[1] = (SELECT auth.uid())::TEXT`
     * `NOT public.is_current_user_banned_or_deleted()`
   * Dadurch kann ein authentifizierter Nutzer auch bei direkter Nutzung der Supabase-Storage-API (mit dem `anon`-Key und eigenem JWT) ausschließlich auf seinen eigenen Mandanten-Ordner `<user_id>/...` zugreifen.
3. **Favicon-Proxy (`apps/backend/src/routes/favicon.ts`):**
   * Der Endpunkt `GET /favicon?domain=...` prüft in Zeile 10 `if (!domain || domain.includes("://") || domain.includes("/"))` und kodiert den Parameter zusätzlich mit `encodeURIComponent(domain)` innerhalb einer fest verdrahteten URL (`https://www.google.com/s2/favicons?domain=...`). Ein Zugriff auf lokale Dateien oder interne Dienste (SSRF) ist hier ausgeschlossen.

---

### 2.2 Erkannte Sicherheitsrisiken & Schwachstellen im Gesamtprojekt

Bei der Betrachtung des gesamten Repositories (inklusive Dokumenten-Konvertierung und Infrastruktur unter `infra/`) sind **drei konkrete Sicherheitsrisiken** erkennbar, die einen unautorisierten Zugriff auf Container- oder Host-Dateisysteme ermöglichen können:

---

#### Befund 1 (Risiko: Mittel–Hoch): Lokaler Dateisystem-Zugriff (LFI) im Gotenberg-Container bei der `.docx`→`.pdf`-Konvertierung & ungefilterter Dateiname

* **Betroffene Dateien:**
  * `apps/backend/src/services/document-extraction-service.ts` (Zeilen 117–157: `WordDocumentExtractionService.convertWordToPdf`)
  * `apps/backend/src/services/db-service/base-db-service.ts` (Zeilen 91–107: `uploadFileToStorage` und Zeilen 275–298: `savePdfPreview`)
  * `apps/backend/src/services/validation-service.ts` (Zeilen 69–75: `validateDocumentRequest`)
  * `infra/gotenberg/Dockerfile` (Zeilen 1–10)
  * `infra/gotenberg/manifest.yml` (Zeilen 1–13)

* **Technische Detailanalyse & Angriffsmechanismus:**
  1. **Rückkanal zum Nutzer über PDF-Vorschau:**
     Wenn ein Nutzer über `POST /documents/process` eine `.docx`-Datei hochlädt, speichert `uploadFileToStorage` zunächst die `.docx`-Datei im Bucket und ruft anschließend `savePdfPreview` auf:
     ```typescript
     if (/\.(docx?)$/i.test(sourceUrl)) {
         await this.savePdfPreview({ file, sourceUrl, bucket });
     }
     ```
     `savePdfPreview` sendet den Dateiinhalt an Gotenberg (`/forms/libreoffice/convert`) und lädt das zurückgegebene PDF unter `<prefix>/<uuid>.pdf` in denselben Storage-Bucket hoch. Der Nutzer hat über seine regulären Leserechte im Bucket direkten Lese-/Download-Zugriff auf dieses konvertierte PDF.
  2. **Local File Inclusion (LFI) über externe OOXML-Referenzen in LibreOffice:**
     Eine `.docx`-Datei ist ein ZIP-Archiv mit XML-Dokumenten (`word/document.xml`, `word/_rels/document.xml.rels`). LibreOffice unterstützt beim Konvertieren von Dokumenten externe Verknüpfungen (`TargetMode="External"` mit `Target="file:///..."` oder `http://...`, z. B. über Felder wie `INCLUDETEXT`, `INCLUDEPICTURE`, Writer-Bereiche/Frames, OLE-Objekte oder XInclude).
     Wird eine präparierte `.docx`-Datei an Gotenberg gesendet, liest LibreOffice während der PDF-Generierung lokale Dateien aus dem Dateisystem des Gotenberg-Containers aus und rendert deren Inhalt sichtbar in das erzeugte PDF.
     Obwohl der Gotenberg-Container als Non-Root-User `gotenberg` (`uid 1001`) läuft und keine Host-Volumes mountet, sind im Container sensible Dateien wie `/etc/passwd` oder `/proc/self/environ` lesbar. Über `/proc/self/environ` lassen sich sämtliche Umgebungsvariablen des Gotenberg-Prozesses auslesen – einschließlich `GOTENBERG_API_BASIC_AUTH_USERNAME`, `GOTENBERG_API_BASIC_AUTH_PASSWORD` und Cloud-Foundry-Metadaten (`VCAP_APPLICATION`).
  3. **Ungefilterte Weitergabe von `file.name` bei reiner MIME-Type-Prüfung:**
     In `ValidationService.validateDocumentRequest` (`apps/backend/src/services/validation-service.ts`, Zeile 69) wird der Dateityp ausschließlich anhand des vom Client gesendeten HTTP-Headers `Content-Type` (`file.type`) bestimmt:
     ```typescript
     const fileExtension = EXTENSION_BY_MIME[file.type];
     ```
     Die tatsächliche Dateiendung von `file.name` wird nicht geprüft. In `savePdfPreview` (`base-db-service.ts`, Zeile 287) und `convertWordToPdf` (`document-extraction-service.ts`, Zeile 134) wird jedoch der **ungefilterte Client-Dateiname `file.name`** im Multipart-Form-Request an Gotenberg übergeben:
     ```typescript
     form.append("files", blob, fileName);
     ```
     Ein Angreifer kann im Upload-Request `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document` setzen (sodass `sourceUrl` auf `.docx` endet und `mammoth` ein valides ZIP-Polyglot akzeptiert), aber als `filename` im Multipart-Header z. B. `exploit.fodt`, `exploit.html` oder `exploit.xhtml` mitsenden. Gotenberg legt die Datei unter diesem Namen im Arbeitsverzeichnis ab, wodurch LibreOffice zusätzliche Parser (wie Flat-XML-ODF oder HTML/XHTML) aktiviert.
  4. **Exponierte Gotenberg-Instanz mit aktivem Chromium-Modul:**
     In `infra/gotenberg/manifest.yml` (Zeile 13) ist `default-route: true` gesetzt. Die Instanz ist durch Basic Auth (`--api-enable-basic-auth`) geschützt. Falls die Basic-Auth-Zugangsdaten (etwa über LFI auf `/proc/self/environ` oder ein Credential-Leak) bekannt werden, sind auch alle Chromium-Konvertierungsendpunkte (`/forms/chromium/convert/url`, `/forms/chromium/convert/html`) erreichbar, da weder `--chromium-disable-routes` noch `--chromium-deny-list` (zum Blockieren von `file:///...`-URLs in Chromium) konfiguriert sind.

* **Empfohlene Gegenmaßnahmen:**
  * **Statischer Dateiname beim Gotenberg-Aufruf:** In `convertWordToPdf` (`apps/backend/src/services/document-extraction-service.ts`, Zeile 134) niemals den vom Client stammenden `fileName` übergeben, sondern einen festen Wert wie `"document.docx"` nutzen:
    ```typescript
    form.append("files", blob, "document.docx");
    ```
  * **Validierung des `.docx`-Archivs vor der Konvertierung:** Vor dem Senden an Gotenberg prüfen, ob die Datei tatsächlich die Magic Bytes eines ZIP-Archivs (`PK\x03\x04`) besitzt und ob in den Relationship-Dateien (`_rels/*.rels`, `word/_rels/*.rels`) Attribute wie `TargetMode="External"` oder `file:`/`http:`/`https:`-Referenzen auf Dateifelder vorkommen; solche Dokumente vor der PDF-Konvertierung ablehnen oder bereinigen.
  * **Härtung der Gotenberg-Konfiguration (`infra/gotenberg/Dockerfile` & `manifest.yml`):** Nicht benötigte Routen deaktivieren, sodass nur LibreOffice aktiv ist:
    ```dockerfile
    CMD ["gotenberg", "--api-enable-basic-auth", "--chromium-disable-routes", "--pdfengines-disable-routes"]
    ```

---

#### Befund 2 (Risiko: Mittel): Vollständiger Host-Dateisystem- und Docker-Socket-Zugriff in `otel-collector` und `vector` auf der Supabase-VM

* **Betroffene Dateien:**
  * `infra/supabase/docker-compose.monitoring.yml` (Zeilen 7–26: Service `otel-collector`)
  * `infra/supabase/docker-compose.yml` (Zeilen 476–502: Service `vector`)
  * `infra/supabase/otel-config.yml` (Zeilen 16–59)

* **Technische Detailanalyse & Angriffsmechanismus:**
  1. **Root-Container mit komplettem Host-Root-Mount (`/:/hostfs:ro`):**
     In `infra/supabase/docker-compose.monitoring.yml` (Zeilen 11 und 20–26) wird `supabase-otel-collector` wie folgt gestartet:
     ```yaml
     user: "0:0"  # root needed for /proc, /sys, docker.sock, /var/lib/docker/containers
     volumes:
       - ./otel-config.yml:/etc/otel/config.yml:ro
       - /proc:/hostfs/proc:ro
       - /sys:/hostfs/sys:ro
       - /:/hostfs:ro
       - /var/run/docker.sock:/var/run/docker.sock:ro
       - /var/lib/docker/containers:/var/lib/docker/containers:ro
     ```
     Durch `/:/hostfs:ro` in Kombination mit `user: "0:0"` hat dieser Container **uneingeschränkten Lesezugriff auf das gesamte Dateisystem der Host-VM** – einschließlich `/hostfs/etc/shadow`, `/hostfs/root/.ssh/`, `/hostfs/home/migrations/.ssh/` sowie der produktiven Supabase-`.env`-Datei (`{{ supabase_dir }}/.env`), in der `POSTGRES_PASSWORD`, `JWT_SECRET`, `SERVICE_ROLE_KEY` und S3-Credentials im Klartext liegen.
  2. **Scheinsicherheit von `:ro` beim Docker-Socket (`/var/run/docker.sock:ro`):**
     Sowohl `otel-collector` (`docker-compose.monitoring.yml`, Zeile 25) als auch `vector` (`infra/supabase/docker-compose.yml`, Zeile 482, dort zusätzlich mit `security_opt: - "label=disable"`) binden `/var/run/docker.sock` mit dem Suffix `:ro` ein.
     Auf Linux-Ebene schützt ein Read-Only-Bind-Mount einer UNIX-Domain-Socket-Datei lediglich davor, die Socket-Datei selbst zu löschen oder umzubenennen. Das Senden von HTTP-`POST`-Requests über die Socket-Verbindung (`connect()` + `write()`) an die Docker-Engine API wird durch `:ro` **nicht** eingeschränkt.
     Wird `vector` oder `otel-collector` kompromittiert (z. B. über eine Schwachstelle beim Parsen manipulierter Log-Einträge oder über den exponierten Health-Check-Port), kann aus dem Container heraus über `/var/run/docker.sock` jederzeit ein neuer Container mit `-v /:/host:rw --privileged` gestartet werden, was sofortigen **Schreib- und Root-Zugriff auf das Host-Dateisystem** bedeutet.

* **Empfohlene Gegenmaßnahmen:**
  * **Verzicht auf `/:/hostfs:ro` in `docker-compose.monitoring.yml`:** Laut `infra/supabase/otel-config.yml` (Zeilen 54–58) liest `otel-collector` auf dem Host lediglich zwei spezifische Logdateien (`/var/log/anon-egress-blocklist.log` und `/var/log/nginx/anon-egress.log`) sowie `/proc` und `/sys`. Statt `/` komplett zu mounten, sollten nur `/var/log:/hostfs/var/log:ro`, `/proc:/hostfs/proc:ro` und `/sys:/hostfs/sys:ro` eingebunden werden.
  * **Absicherung des Docker-Sockets über einen Read-Only-Proxy:** Statt `/var/run/docker.sock` direkt in `vector` und `otel-collector` zu mounten, sollte ein minimalistischer Socket-Proxy (wie `tecnativa/docker-socket-proxy`) zwischengeschaltet werden, der auf HTTP-Ebene nur `GET`/`HEAD`-Anfragen auf `/containers/*` und `/events` erlaubt und sämtliche schreibenden `POST`/`PUT`/`DELETE`-Aufrufe blockiert.

---

#### Befund 3 (Risiko: Niedrig–Mittel): `IMGPROXY_LOCAL_FILESYSTEM_ROOT: /` in `supabase-imgproxy`

* **Betroffene Datei:**
  * `infra/supabase/docker-compose.yml` (Zeilen 270–337: Services `storage` und `imgproxy`)

* **Technische Detailanalyse & Angriffsmechanismus:**
  * In `infra/supabase/docker-compose.yml` (Zeilen 321–337) ist der Dienst `supabase-imgproxy` wie folgt konfiguriert:
    ```yaml
    imgproxy:
      container_name: supabase-imgproxy
      image: darthsim/imgproxy:v3.31.4
      restart: unless-stopped
      volumes:
        - ./volumes/storage:/var/lib/storage:z
      ...
      environment:
        IMGPROXY_BIND: ":5001"
        IMGPROXY_LOCAL_FILESYSTEM_ROOT: /
        IMGPROXY_USE_ETAG: "true"
        IMGPROXY_ENABLE_WEBP_DETECTION: ${IMGPROXY_ENABLE_WEBP_DETECTION}
    ```
  * Die Umgebungsvariable `IMGPROXY_LOCAL_FILESYSTEM_ROOT: /` schaltet in `imgproxy` die Unterstützung für `local://`-Quell-URLs frei und legt das Wurzelverzeichnis `/` des Containers als Basisverzeichnis fest (inklusive des unter `/var/lib/storage` gemounteten Host-Ordners `./volumes/storage`).
  * Gleichzeitig ist der `storage`-Service (`supabase-storage`) in Zeile 304 auf S3 konfiguriert (`STORAGE_BACKEND: s3`), und `FILE_STORAGE_BACKEND_PATH: /var/lib/storage` (Zeile 313) ist auskommentiert. Der lokale Dateisystemzugriff in `imgproxy` wird für den S3-Betrieb nicht benötigt, vergrößert aber die Angriffsfläche: Wenn ein Angreifer über SSRF im internen Docker-Netzwerk oder über eine Pfad-Manipulation in `supabase-storage` eine Anfrage an `http://imgproxy:5001/unsafe/.../plain/local:///...` absetzen kann, greift `imgproxy` direkt auf das lokale Dateisystem ab `/` zu.

* **Empfohlene Gegenmaßnahmen:**
  * Da `STORAGE_BACKEND: s3` verwendet wird, sollte `IMGPROXY_LOCAL_FILESYSTEM_ROOT: /` aus `infra/supabase/docker-compose.yml` (Zeile 334) entfernt (oder zumindest strikt auf `/var/lib/storage` begrenzt) werden.
  * Zusätzlich kann bei reinem S3-Betrieb das Host-Volume `./volumes/storage:/var/lib/storage:z` bei `storage` (Zeile 275) und `imgproxy` (Zeile 326) entfernt werden.

---

#### Ergänzender Hinweis (Niedrig / Drittsystem-Abhängigkeit): Unvalidierte `wfs_url` im Open-Data-MCP-Tool

* **Betroffene Datei:** `apps/backend/src/tools/mcp/open-data-mcp-tools.ts` (Zeilen 95–100: `fetchGeoFeaturesInputSchema`)
* **Beschreibung:** Das Tool `fetch_geo_features` akzeptiert als Parameter `wfs_url: z.string()` ohne URL-Schema- oder Domain-Einschränkung auf Backend-Seite und leitet diesen Wert an den konfigurierten Open-Data-MCP-Server (`OPEN_DATA_MCP_URL`) weiter. Sofern der externe MCP-Server `wfs_url` nicht selbst strikt auf `https://`-Domains der Berliner Geodateninfrastruktur beschränkt, könnte das LLM (z. B. durch Prompt Injection in einem Dokument oder einer Suchanfrage) dazu gebracht werden, interne URLs (SSRF) oder `file://`-URLs auf dem MCP-Server abzufragen.
* **Empfehlung:** `wfs_url` bereits im Zod-Schema in `apps/backend/src/tools/mcp/open-data-mcp-tools.ts` auf `https://` und erlaubte Berliner WFS-Hosts einschränken.

---

## Zusammenfassungstabelle

| Bereich / Komponente | Pfad im Repository | Host-Verzeichnisse erreichbar? | Risikoeinstufung & Grund |
| :--- | :--- | :--- | :--- |
| **Backend-Container (Lokal)** | `compose.yml` | **Nein** (nur `./apps/backend/.env:ro` als Einzeldatei) | **Sicher:** Kein Verzeichnis-Mount, Port nur auf `127.0.0.1:3000`. |
| **Backend-Image & Cloud Foundry** | `apps/backend/Dockerfile`, `apps/backend/manifest.yml` | **Nein** | **Sicher:** `.dockerignore` filtert `.env`/`.git`, `turbo prune`, Non-Root-User `hono` (`1001`). |
| **Backend-Code & Storage-Pfade** | `apps/backend/src/` | **Nein** | **Sicher:** Kein `node:fs` im Produktivcode; Storage-Pfade nutzen serverseitige UUIDs + RLS. |
| **Gotenberg (`.docx` → `.pdf`)** | `apps/backend/src/services/document-extraction-service.ts`, `infra/gotenberg/` | **Nein (Host)** / **Ja (Container)** | **Mittel–Hoch:** LFI im Gotenberg-Container via OOXML-External-Links; ungefilterter `file.name` beim Upload; Chromium-Routen nicht deaktiviert. |
| **Supabase Monitoring (`otel-collector` & `vector`)** | `infra/supabase/docker-compose.monitoring.yml`, `infra/supabase/docker-compose.yml` | **Ja (`/:/hostfs:ro` & `docker.sock`)** | **Mittel:** `otel-collector` läuft als `root` mit komplettem Host-FS-Mount; `docker.sock:ro` erlaubt Container-Escape auf den Host. |
| **Supabase `imgproxy`** | `infra/supabase/docker-compose.yml` | **Ja (`./volumes/storage`) & Container `/` (`IMGPROXY_LOCAL_FILESYSTEM_ROOT: /`)** | **Niedrig–Mittel:** Lokaler Dateisystem-Zugriff ab `/` aktiviert, obwohl `STORAGE_BACKEND: s3` genutzt wird. |

