# BärGPT – Vollständige Anleitung für den lokalen Betrieb mit LM Studio (`run-Baergpt`)

**Erstellt am:** 27.10.2026  
**Projektverzeichnis:** `c:\dev\baergpt`  
**Lokaler KI-Server:** LM Studio (`http://localhost:1234/v1`)

---

## Inhaltsverzeichnis

1. [Architektur-Überblick des lokalen BärGPT-Stacks](#1-architektur-überblick-des-lokalen-bärgpt-stacks)
2. [Voraussetzungen](#2-voraussetzungen)
3. [LM Studio einrichten & Modellempfehlungen (aus deinem lokalen Cache)](#3-lm-studio-einrichten--modellempfehlungen-aus-deinem-lokalen-cache)
   - [3.1 Bereits heruntergeladene Chat-Modelle im Vergleich](#31-bereits-heruntergeladene-chat-modelle-im-vergleich)
   - [3.2 Bereits heruntergeladenes Embedding-Modell für Dokumentensuche (RAG)](#32-bereits-heruntergeladenes-embedding-modell-für-dokumentensuche-rag)
   - [3.3 Schritt-für-Schritt: Modell & Server in LM Studio starten](#33-schritt-für-schritt-modell--server-in-lm-studio-starten)
   - [3.4 Optional: Zwei Modelle gleichzeitig für „Schnell“ (`fast`) und „Präzise“ (`precise`) nutzen](#34-optional-zwei-modelle-gleichzeitig-für-schnell-fast-und-präzise-precise-nutzen)
4. [Starten des lokalen BärGPT-Webhosts (3 Varianten)](#4-starten-des-lokalen-bärgpt-webhosts-3-varianten)
   - [4.1 Variante A (Empfohlen): Komplett-Stack über PowerShell-Skript (`start-local.ps1`) oder Docker Compose](#41-variante-a-empfohlen-komplett-stack-über-powershell-skript-start-localps1-oder-docker-compose)
   - [4.2 Variante B (Entwicklermodus mit Hot-Reload): Supabase in Docker + Backend & Frontend nativ über npm](#42-variante-b-entwicklermodus-mit-hot-reload-supabase-in-docker--backend--frontend-nativ-über-npm)
   - [4.3 Variante C: Nur das Backend als Docker-Container (`compose.yml`)](#43-variante-c-nur-das-backend-als-docker-container-composeyml)
5. [Erreichbare lokale URLs, Ports & Login-Zugangsdaten](#5-erreichbare-lokale-urls-ports--login-zugangsdaten)
   - [5.1 Übersicht aller Endpunkte](#51-übersicht-aller-endpunkte)
   - [5.2 Anmeldung am BärGPT-Chat (1-Klick Direkt-Login vs. E-Mail/OTP)](#52-anmeldung-am-bärgpt-chat-1-klick-direkt-login-vs-e-mailotp)
6. [Technische Details aller vorgenommenen Anpassungen für den Offline-/Lokalbetrieb](#6-technische-details-aller-vorgenommenen-anpassungen-für-den-offline-lokalbetrieb)
   - [6.1 OpenAI-/LM-Studio-Adapter & Vektor-Normalisierung (`llm-provider.ts`)](#61-openai-lm-studio-adapter--vektor-normalisierung-llm-providerts)
   - [6.2 Lokale System-Prompts ohne Cloud-Langfuse (`prompt-provider.ts`)](#62-lokale-system-prompts-ohne-cloud-langfuse-prompt-providerts)
   - [6.3 Lokale PDF-Textextraktion ohne Cloud-Mistral-OCR (`document-extraction-service.ts`)](#63-lokale-pdf-textextraktion-ohne-cloud-mistral-ocr-document-extraction-servicets)
   - [6.4 Deaktivierung von Cloud-Telemetrie (`instrumentation.ts` & `config.ts`)](#64-deaktivierung-von-cloud-telemetrie-instrumentationts--configts)
   - [6.5 Lokaler Supabase-Stack & Datenbank-Initialisierung (`compose.local.yml`, `init-baergpt.sh`, `kong.yml`)](#65-lokaler-supabase-stack--datenbank-initialisierung-composelocalyml-init-baergptsh-kongyml)
   - [6.6 1-Klick-Admin-Login im Frontend (`apps/frontend/src/routes/login-page/index.tsx`)](#66-1-klick-admin-login-im-frontend-appsfrontendsrcrouteslogin-pageindextsx)
7. [Vollständige Referenz der lokalen Konfigurationsdateien](#7-vollständige-referenz-der-lokalen-konfigurationsdateien)
   - [7.1 `apps/backend/.env`](#71-appsbackendenv)
   - [7.2 `apps/frontend/.env`](#72-appsfrontendenv)
   - [7.3 `start-local.ps1`](#73-start-localps1)
8. [Wartung, Nützliche Befehle & Fehlerbehebung (Troubleshooting)](#8-wartung-nützliche-befehle--fehlerbehebung-troubleshooting)

---

## 1. Architektur-Überblick des lokalen BärGPT-Stacks

Im ursprünglichen Cloud-Setup benötigt BärGPT externe Dienste wie die **Mistral Cloud API** (für Chat, OCR und 1024-dimensionale Embeddings), **Langfuse Cloud** (zum Abrufen der System-Prompts), **Sentry** (Error-Tracking), **Gotenberg** (Dokumentenkonvertierung) und eine **Supabase-Instanz**.

Für den vollständigen **lokalen Betrieb auf deinem PC** wurde das Projekt so erweitert, dass **keinerlei externe Cloud-API-Schlüssel** mehr benötigt werden:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Dein Windows-Host-System                        │
│                                                                         │
│  ┌──────────────────────────┐         ┌──────────────────────────────┐  │
│  │        LM Studio         │         │        Browser (User)        │  │
│  │  http://localhost:1234   │         │    http://localhost:5173     │  │
│  │  - Chat-Modell (GGUF)    │         └──────────────┬───────────────┘  │
│  │  - Embedding-Modell      │                        │                  │
│  └────────────▲─────────────┘                        ▼                  │
│               │               ┌──────────────────────────────────────┐  │
│               │               │   Docker Stack (compose.local.yml)   │  │
│               │               │                                      │  │
│               │               │  ┌────────────────────────────────┐  │  │
│               │               │  │ baergpt-frontend (Port 5173)   │  │  │
│               │               │  └───────────────┬────────────────┘  │  │
│               │               │                  ▼                   │  │
│               │  OpenAI API   │  ┌────────────────────────────────┐  │  │
│               └───────────────┼──┤ baergpt-backend  (Port 3000)   │  │  │
│        host.docker.internal   │  │ - Lokale Prompts (integriert)  │  │  │
│             :1234/v1          │  │ - Lokale PDF-Analyse (unpdf)   │  │  │
│                               │  │ - 1024-Dim Vektor-Normalisierer│  │  │
│                               │  └───────────────┬────────────────┘  │  │
│                               │                  ▼                   │  │
│                               │  ┌────────────────────────────────┐  │  │
│                               │  │ Lokales Supabase (Port 54321)  │  │  │
│                               │  │ - Kong API-Gateway             │  │  │
│                               │  │ - Postgres 15 + pgvector       │  │  │
│                               │  │ - GoTrue Auth + Mailpit (54324)│  │  │
│                               │  │ - Supabase Storage + PostgREST │  │  │
│                               │  └────────────────────────────────┘  │  │
│                               └──────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Voraussetzungen

1. **LM Studio** (installiert auf deinem Windows-System).
2. **Docker Desktop für Windows** (muss gestartet sein, damit die lokale PostgreSQL-Datenbank mit `pgvector`, Supabase Auth/Storage sowie optional Backend/Frontend als Container laufen können).
3. *Optional (nur für Variante B – native Entwicklung ohne Backend/Frontend-Docker-Container):* **Node.js (v24 empfohlen)** und **npm**.

---

## 3. LM Studio einrichten & Modellempfehlungen (aus deinem lokalen Cache)

In deinem lokalen LM-Studio-Modellverzeichnis (`C:\Users\andur\.cache\lm-studio\models`) befinden sich bereits mehrere heruntergeladene GGUF-Modelle. Du musst also **nichts neu herunterladen**, sondern kannst direkt eines der vorhandenen Modelle aktivieren.

### 3.1 Bereits heruntergeladene Chat-Modelle im Vergleich

| Modell im lokalen Cache (`C:\Users\andur\.cache\lm-studio\models`) | Datei & Quantisierung | Ca. Speicherbedarf (VRAM/RAM) | Eignung für BärGPT |
| :--- | :--- | :--- | :--- |
| **`lmstudio-community/gemma-4-12B-it-QAT-GGUF`** *(Empfehlung für den Alltag)* | `gemma-4-12B-it-QAT-Q4_0.gguf` | ~7,5 – 8,5 GB | **Beste Balance aus Geschwindigkeit und Deutsch-Qualität.** Sehr flüssiges Verwaltungsdeutsch, hohe Instruktionstreue und durch QAT (Quantization-Aware Training) kaum Qualitätsverlust trotz `Q4_0`. |
| **`lmstudio-community/Qwen3.5-9B-GGUF`** *(Schneller Allrounder)* | `Qwen3.5-9B-Q4_K_M.gguf` | ~6,0 – 7,0 GB | **Schnellstes vollwertiges Allround-Modell.** Sehr stark bei strukturierten Ausgaben (JSON für BärGPT-Tagging, Kurzzusammenfassungen und Zitate-Extraktion) sowie beim Tool-Calling. |
| **`lmstudio-community/Qwen3.8-27B-GGUF`** *(Maximale Qualität & Reasoning)* | `Qwen3.8-27B-Q4_K_M.gguf` | ~17,5 – 20 GB | **Höchste Text- und Analyse-Qualität.** Ideal für komplexe Aufgaben, lange Dokumenten-Analysen, Reasoning/Thinking-Spuren und anspruchsvolle Zusammenfassungen (sofern genügend GPU-VRAM oder System-RAM vorhanden ist). |
| **`lmstudio-community/Qwen3.6-27B-GGUF`** | `Qwen3.6-27B-Q4_K_M.gguf` | ~17,5 – 20 GB | Sehr starkes 27B-Modell; der Nachfolger `Qwen3.8-27B` im selben Cache ist jedoch vorzuziehen. |
| **`lmstudio-community/Muse-Glimmer-30B-GGUF`** | `Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf` | ~18 – 20 GB | Kreatives/allgemeines 30B-Modell, für sachliche Berliner Verwaltungstexte sind `gemma-4-12B` oder `Qwen3.8-27B` jedoch präziser. |
| **`thebbg/Ma7ee7-Qwen3.8_4B_Distilled-v2`** | `Ma7ee7-Qwen3.8_4B_Distilled-v2.Q4_K_M.gguf` | ~3,0 GB | Extrem leichtgewichtiges Modell bei knappen Hardwareressourcen. |
| **`TheBloke/deepseek-coder-6.7B-instruct-GGUF`** | `deepseek-coder-6.7b-instruct.Q4_K_S.gguf` | ~4,5 GB | Reines Programmier-Modell älterer Generation – für den deutschsprachigen BärGPT-Verwaltungsassistenten **nicht empfohlen**. |

---

### 3.2 Bereits heruntergeladenes Embedding-Modell für Dokumentensuche (RAG)

In deinem Cache liegt außerdem bereits ein dediziertes Embedding-Modell:
* **`nomic-ai/nomic-embed-text-v1.5-GGUF`** (`nomic-embed-text-v1.5.Q8_0.gguf`, nur ~150 MB)

**Warum ist das wichtig?**
Wenn du in BärGPT PDF- oder DOCX-Dokumente hochlädst, zerlegt das Backend diese in Textabschnitte (Chunks) und berechnet dafür Vektor-Embeddings zur semantischen Suche in PostgreSQL (`pgvector`).
* Lädst du `nomic-embed-text-v1.5` in LM Studio **parallel** zu deinem Chat-Modell, nutzt BärGPT automatisch echte semantische Vektoren über `http://localhost:1234/v1/embeddings`.
* Da BärGPT in der Datenbank 1024 Dimensionen (`vector(1024)`) erwartet und `nomic-embed-text-v1.5` 768 Dimensionen liefert, normiert unser Adapter in [`apps/backend/src/services/llm-provider.ts`](file:///c:/dev/baergpt/apps/backend/src/services/llm-provider.ts) den Vektor automatisch verlustfrei auf die Länge 1024 (inklusive L2-Normalisierung).
* **Fallback:** Selbst wenn du *kein* Embedding-Modell in LM Studio geladen hast, stürzt der Dokumenten-Upload nicht ab – [`llm-provider.ts`](file:///c:/dev/baergpt/apps/backend/src/services/llm-provider.ts) erzeugt in diesem Fall automatisch ein deterministisches lokales Hash-Embedding mit 1024 Dimensionen.

---

### 3.3 Schritt-für-Schritt: Modell & Server in LM Studio starten

1. **LM Studio öffnen.**
2. Links in der Seitenleiste auf das **Developer-Symbol (`>_`)** klicken (Tab *Local Server*).
3. Oben in der Leiste auf **"Select a model to load"** klicken:
   * Wähle z. B. **`gemma-4-12B-it-QAT`** (oder **`Qwen3.5-9B`** bzw. **`Qwen3.8-27B`**) aus und warte, bis der Ladebalken bei 100 % ist.
   * *(Optional für RAG/Dokumentensuche)* Klicke daneben auf das Plus-/Modell-Menü, um zusätzlich **`nomic-embed-text-v1.5`** als Embedding-Modell zu laden.
4. Prüfe links unter **Server Port**, dass **`1234`** eingestellt ist (Standard).
5. Aktiviere bei Bedarf **CORS** (Cross-Origin Resource Sharing) in den Server-Einstellungen (unser Backend kommuniziert zwar direkt Server-zu-Server mit LM Studio, aktiviertes CORS schadet aber nicht).
6. Stelle den Schalter oben links auf **Status: Running (Grün)**.
7. **Schnelltest in PowerShell (optional):**
   ```powershell
   Invoke-RestMethod -Uri "http://localhost:1234/v1/models"
   ```
   Hier sollten nun deine geladenen Modelle aufgelistet werden.

---

### 3.4 Optional: Zwei Modelle gleichzeitig für „Schnell“ (`fast`) und „Präzise“ (`precise`) nutzen

BärGPT besitzt im Chat-Eingabefeld einen Umschalter zwischen:
* **Schnelle Antwort** (`FAST_MODEL_IDENTIFIER`)
* **Komplexe Aufgaben** (`PRECISE_MODEL_IDENTIFIER`)

Standardmäßig sind in [`apps/backend/.env`](file:///c:/dev/baergpt/apps/backend/.env) beide Werte auf `local-model` gesetzt:
```env
FAST_MODEL_IDENTIFIER=local-model
PRECISE_MODEL_IDENTIFIER=local-model
```
**Vorteil von `local-model`:** Unser Adapter fragt vor jedem Aufruf `GET http://localhost:1234/v1/models` ab und wählt automatisch das aktuell in LM Studio geladene Chat-Modell aus (Embedding-Modelle mit `embed`/`nomic`/`bge` im Namen werden dabei automatisch herausgefiltert). Du kannst in LM Studio also jederzeit das Modell wechseln, ohne die `.env`-Datei anzupassen.

**Wenn du stattdessen zwei Modelle gleichzeitig in LM Studio lädst** (z. B. `Qwen3.5-9B` für schnelle Antworten + `Qwen3.8-27B` für komplexe Aufgaben), kannst du in [`apps/backend/.env`](file:///c:/dev/baergpt/apps/backend/.env) die exakten Modell-IDs eintragen, die LM Studio unter `/v1/models` meldet:
```env
FAST_MODEL_IDENTIFIER=qwen3.5-9b
PRECISE_MODEL_IDENTIFIER=qwen3.8-27b
```

---

## 4. Starten des lokalen BärGPT-Webhosts (3 Varianten)

### 4.1 Variante A (Empfohlen): Komplett-Stack über PowerShell-Skript (`start-local.ps1`) oder Docker Compose

Diese Variante startet **alle Komponenten** (PostgreSQL + pgvector, GoTrue Auth, Mailpit, Storage, PostgREST, Kong Gateway, Datenbank-Migrationen, Admin-Seeding, Hono-Backend und React-Frontend) vollautomatisch in Docker.

1. Stelle sicher, dass **Docker Desktop** und der **LM Studio Server (Port 1234)** laufen.
2. Öffne eine PowerShell im Projektverzeichnis `c:\dev\baergpt` und führe aus:
   ```powershell
   .\start-local.ps1
   ```
   *(Alternativ direkt über Docker Compose:)*
   ```powershell
   docker compose -f compose.local.yml up --build
   ```
3. Beim allerersten Start werden die Docker-Images geladen und alle 54 SQL-Migrationen aus `apps/backend/supabase/migrations/` durch den Container `baergpt-local-db-init` automatisch ausgeführt. Außerdem legt das Backend beim Start automatisch den lokalen Admin-Account `local.admin@ts.berlin` an.
4. Sobald im Terminal die Meldungen von `baergpt-backend` (`Server is running on http://localhost:3000`) und `baergpt-frontend` (`VITE v... ready`) erscheinen, öffne im Browser:
   * **http://localhost:5173**

---

### 4.2 Variante B (Entwicklermodus mit Hot-Reload): Supabase in Docker + Backend & Frontend nativ über npm

Wenn du am Quellcode von Backend oder Frontend arbeitest und Änderungen sofort ohne Docker-Build sehen möchtest:

1. **Nur die lokalen Supabase-Basisdienste in Docker starten:**
   ```powershell
   docker compose -f compose.local.yml up -d db mailpit auth rest realtime storage kong db-init
   ```
2. **Lokalen Admin-Benutzer und Beispieldaten einmalig seeden (optional):**
   ```powershell
   npm --prefix apps/backend run db:seed
   ```
3. **Backend nativ starten (Terminal 1):**
   ```powershell
   npm --prefix apps/backend run dev
   ```
   *(Liest automatisch `apps/backend/.env`, verbindet sich mit `http://127.0.0.1:54321` und LM Studio unter `http://localhost:1234/v1`.)*
4. **Frontend nativ starten (Terminal 2):**
   ```powershell
   npm --prefix apps/frontend run dev
   ```
   *(Startet Vite auf `http://localhost:5173`.)*

---

### 4.3 Variante C: Nur das Backend als Docker-Container (`compose.yml`)

Falls du Supabase bereits anderweitig (z. B. über `npx supabase start`) betreibst und lediglich das Backend im Container testen möchtest:
```powershell
docker compose up --build
```
Die Datei [`compose.yml`](file:///c:/dev/baergpt/compose.yml) wurde bereits mit `LOCAL_LLM_ENABLED: "true"` und `LLM_BASE_URL: http://host.docker.internal:1234/v1` vorkonfiguriert.

---

## 5. Erreichbare lokale URLs, Ports & Login-Zugangsdaten

### 5.1 Übersicht aller Endpunkte

| Dienst | Lokale URL | Beschreibung |
| :--- | :--- | :--- |
| **BärGPT Chat (Frontend)** | **http://localhost:5173** | Die Web-Oberfläche von BärGPT im Browser |
| **BärGPT Backend (Hono API)** | **http://localhost:3000** | REST- & Streaming-API (`/ai/chat`, `/health`, `/documents`) |
| **Backend Healthcheck** | **http://localhost:3000/health** | Gibt `200 OK` zurück, sobald das Backend läuft |
| **Supabase API Gateway (Kong)** | **http://127.0.0.1:54321** | Lokaler Endpunkt für Auth, REST und Storage |
| **Mailpit Web-UI (Lokale E-Mails)** | **http://localhost:54324** | Zeigt alle lokal versendeten E-Mails (z. B. 10-stellige OTP-Codes bei Registrierung/Passwort-Reset) |
| **PostgreSQL Datenbank** | `127.0.0.1:54322` | Direkter DB-Zugang (`User: postgres`, `Passwort: postgres`, `DB: postgres`) |
| **LM Studio Server** | **http://localhost:1234/v1** | Lokaler OpenAI-kompatibler KI-Server auf dem Host |

---

### 5.2 Anmeldung am BärGPT-Chat (1-Klick Direkt-Login vs. E-Mail/OTP)

Auf **http://localhost:5173/login** stehen dir zwei Wege zur Verfügung:

#### Weg 1: 1-Klick „Lokaler Direkt-Login (Admin)“ (Schnellster Weg)
Auf der Login-Seite befindet sich unterhalb des normalen Formulars der Button **„Lokaler Direkt-Login (Admin)“**:
* Ein Klick darauf versucht zuerst eine direkte Anmeldung mit `local.admin@ts.berlin` / `LocalAdmin123!`.
* Falls der Benutzer in einer frischen Datenbank noch nicht existiert, legt der Button ihn automatisch über den lokalen Service-Role-Key in Supabase Auth an, bestätigt die E-Mail-Adresse sofort ohne OTP-Umweg und meldet dich direkt im Chat an.

#### Weg 2: Manuelle Anmeldung mit E-Mail & Passwort
* **E-Mail:** `local.admin@ts.berlin`
* **Passwort:** `LocalAdmin123!`

*(Hinweis: Wenn du über „Registrieren“ einen komplett neuen Account mit einer `@ts.berlin`- oder `@berlin.de`-Adresse anlegst, findest du den 10-stelligen Bestätigungscode sofort lokal in **Mailpit** unter **http://localhost:54324**.)*

---

## 6. Technische Details aller vorgenommenen Anpassungen für den Offline-/Lokalbetrieb

Damit BärGPT vollständig lokal mit LM Studio funktioniert, wurden folgende Dateien erstellt bzw. erweitert:

### 6.1 OpenAI-/LM-Studio-Adapter & Vektor-Normalisierung ([`apps/backend/src/services/llm-provider.ts`](file:///c:/dev/baergpt/apps/backend/src/services/llm-provider.ts))
* **Chat & Streaming (`createLocalLanguageModel`):**
  * Implementiert das `LanguageModelV4`-Interface des Vercel AI SDK (`doGenerate` und `doStream`) direkt gegen die OpenAI-kompatible Schnittstelle von LM Studio (`POST /v1/chat/completions`).
  * **Automatische Modellerkennung (`resolveLocalModelId`):** Ist als Modellname `local-model` (oder leer) konfiguriert, ruft das Backend `GET /v1/models` bei LM Studio ab, filtert reine Embedding-Modelle heraus und verwendet automatisch das erste geladene Sprachmodell.
  * **Unterstützung für Reasoning-/Thinking-Modelle:** Unterstützt neben `delta.content` auch `delta.reasoning_content` / `delta.reasoning` (z. B. für Qwen3-Thinking-Modelle oder DeepSeek-R1) und leitet diese als `reasoning-delta` an das BärGPT-Frontend weiter.
  * **Tool-Calling:** Übersetzt JSON-Schema-Tools des AI SDKs in OpenAI-`function`-Tools und verarbeitet Streaming- sowie Non-Streaming-`tool_calls`.
* **Embeddings & 1024-Dim-Normalisierung (`createLocalEmbeddingModel`):**
  * Implementiert `EmbeddingModelV4` gegen `POST /v1/embeddings`.
  * Da die PostgreSQL-Tabelle `document_chunks` eine feste Spaltendefinition `embedding vector(1024)` besitzt, lokale Modelle in LM Studio aber oft 384, 768 (wie `nomic-embed-text-v1.5`) oder 1536 Dimensionen ausgeben, transformiert die Funktion `normalizeDimensions(vec, 1024)` jeden Vektor auf exakt 1024 Dimensionen und führt anschließend eine L2-Normierung durch.
  * Ist in LM Studio kein Embedding-Modell geladen, greift automatisch `createDeterministicFallbackEmbedding(text, 1024)`, sodass Dokumenten-Uploads auch mit einem reinen Chat-Modell niemals fehlschlagen.

### 6.2 Lokale System-Prompts ohne Cloud-Langfuse ([`apps/backend/src/services/prompt-provider.ts`](file:///c:/dev/baergpt/apps/backend/src/services/prompt-provider.ts))
Im Normalbetrieb lädt BärGPT bei jeder Anfrage System-Prompts von einem externen Langfuse-Server (`langfuse.getPrompt(...)`). Ohne gültige Cloud-Keys würde jeder Chat-Start mit einem Fehler abbrechen.
* Sobald `LOCAL_LLM_ENABLED=true` gesetzt ist (oder Langfuse nicht erreichbar ist), liefert `getLocalPrompt()` direkt die im Code hinterlegten deutschen BärGPT-Systemprompts aus:
  * `free-chat-basic` (Systemprompt für den Berliner Verwaltungsassistenten BärGPT)
  * `summary` (Vollständige Dokumenten-Zusammenfassung)
  * `one-sentence-summary` (1-Satz-Kurzbeschreibung beim Dokumenten-Upload)
  * `tagging` (Automatische Extraktion von bis zu 5 Schlagworten beim Dokumenten-Upload)
  * `document-citation-extraction`, `web-citation-extraction`, `open-data-citation-extraction`
  * `tool-instruction-rag`, `tool-instruction-parla`, `tool-instruction-websearch`, `tool-instruction-opendata`, `tool-instruction-datawrapper`

### 6.3 Lokale PDF-Textextraktion ohne Cloud-Mistral-OCR ([`apps/backend/src/services/document-extraction-service.ts`](file:///c:/dev/baergpt/apps/backend/src/services/document-extraction-service.ts))
Standardmäßig schickt BärGPT hochgeladene PDFs an die kostenpflichtige Mistral Cloud OCR API (`client.ocr.process`).
* Im lokalen Modus (`LOCAL_LLM_ENABLED=true`) wird stattdessen die Funktion `extractPdfLocally()` aufgerufen, die mithilfe der bereits im Projekt enthaltenen Bibliothek `unpdf` den Text seitenweise lokal im Arbeitsspeicher aus der PDF-Datei extrahiert.
* Für `.docx`-Dateien wird weiterhin `mammoth` lokal verwendet. Falls kein Gotenberg-Container für die DOCX-zu-PDF-Vorschau läuft, fängt ein Fallback den Fehler ab und speichert einen gültigen lokalen PDF-Platzhalter, damit der Upload-Prozess erfolgreich durchläuft.

### 6.4 Deaktivierung von Cloud-Telemetrie ([`apps/backend/src/monitoring/instrumentation.ts`](file:///c:/dev/baergpt/apps/backend/src/monitoring/instrumentation.ts) & [`apps/backend/src/config.ts`](file:///c:/dev/baergpt/apps/backend/src/config.ts))
* [`config.ts`](file:///c:/dev/baergpt/apps/backend/src/config.ts) setzt über `applyLocalLlmDefaults()`, sobald `LOCAL_LLM_ENABLED=true` aktiv ist, automatisch gültige lokale Standardwerte für optionale Drittanbieter-Variablen (Langfuse, Sentry, Gotenberg, Mistral), damit die Zod-Umgebungsvalidierung beim Start nicht wegen fehlender Cloud-Keys abbricht.
* [`instrumentation.ts`](file:///c:/dev/baergpt/apps/backend/src/monitoring/instrumentation.ts) überspringt die Initialisierung von `LangfuseExporter` und `Sentry.init()`, wenn `LOCAL_LLM_ENABLED=true` gesetzt ist.

### 6.5 Lokaler Supabase-Stack & Datenbank-Initialisierung
* [`compose.local.yml`](file:///c:/dev/baergpt/compose.local.yml): Definiert den kompletten lokalen Stack inkl. Supabase Postgres (`supabase/postgres:15.8.1.085`), GoTrue (`supabase/gotrue:v2.180.0`), PostgREST (`postgrest/postgrest:v13.0.8`), Realtime, Storage API, Kong Gateway (`kong:2.8.5`), Mailpit (`axllent/mailpit:v1.22`), `db-init`, `backend` und `frontend`.
* [`infra/local-supabase/init-baergpt.sh`](file:///c:/dev/baergpt/infra/local-supabase/init-baergpt.sh): Wartet beim Containerstart auf Postgres, spielt alle SQL-Migrationen aus `apps/backend/supabase/migrations/` in alphabetischer Reihenfolge ein und legt die benötigten Storage-Buckets (`documents` und `public_documents`) an.
* [`infra/local-supabase/kong.yml`](file:///c:/dev/baergpt/infra/local-supabase/kong.yml): Deklaratives Routing für Kong auf Port `54321` (`/auth/v1/`, `/rest/v1/`, `/storage/v1/`, `/realtime/v1/`) inklusive CORS-Freigabe.
* [`apps/backend/supabase/scripts/local-seed.ts`](file:///c:/dev/baergpt/apps/backend/supabase/scripts/local-seed.ts): Erlaubt lokale Hosts (`kong`, `host.docker.internal`, `127.0.0.1`, `localhost`) und vergibt für `local.admin@ts.berlin` das feste Passwort `LocalAdmin123!`.

### 6.6 1-Klick-Admin-Login im Frontend ([`apps/frontend/src/routes/login-page/index.tsx`](file:///c:/dev/baergpt/apps/frontend/src/routes/login-page/index.tsx))
* Zeigt im lokalen Entwicklungsmodus (`VITE_VERCEL_ENV=development` oder `local`) auf der Login-Seite den Button **„Lokaler Direkt-Login (Admin)“** an (`handleLocalQuickLogin`), der den Benutzer `local.admin@ts.berlin` bei Bedarf anlegt und direkt einloggt.

---

## 7. Vollständige Referenz der lokalen Konfigurationsdateien

### 7.1 [`apps/backend/.env`](file:///c:/dev/baergpt/apps/backend/.env)

```env
NODE_ENV=development
PORT=3000

# Lokale KI (LM Studio OpenAI-kompatibler Server)
LOCAL_LLM_ENABLED=true
LLM_BASE_URL=http://localhost:1234/v1

# Modell-Konfiguration (bei "local-model" wird automatisch das in LM Studio geladene Modell genutzt)
MODEL_TEMPERATURE=0.3
FAST_MODEL_IDENTIFIER=local-model
PRECISE_MODEL_IDENTIFIER=local-model
DEFAULT_DOCUMENT_PROCESSING_MODEL=fast
UPLOAD_FILE_SIZE_LIMIT_MB=20
PRESENCE_PENALTY=0
FREQUENCY_PENALTY=0

# Mistral / Embedding-Einstellungen (im lokalen Modus automatisch auf 1024 Dimensionen normiert)
MISTRAL_API_KEY=lm-studio
MISTRAL_EMBEDDING_MODEL=local-embedding
MISTRAL_EMBED_MAX_CONTEXT_TOKENS=8192
MISTRAL_EMBED_MAX_TOTAL_TOKENS_PER_REQUEST=16384
MISTRAL_EMBED_MAX_DOCUMENTS_PER_REQUEST=16
MISTRAL_EMBEDDING_DIMENSIONS=1024
MISTRAL_MAX_RPS=10

# Lokale Supabase-Verbindung (Standard-Keys für lokale Supabase CLI & compose.local.yml)
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
SUPABASE_JWT_KEY=super-secret-jwt-token-with-at-least-32-characters-long

# Langfuse (im lokalen Modus nicht erforderlich, da lokale Prompts genutzt werden)
LANGFUSE_SECRET_KEY=local
LANGFUSE_PUBLIC_KEY=local
LANGFUSE_BASEURL=http://localhost:3000

# Sentry (im lokalen Modus deaktiviert)
SENTRY_DSN=https://local@localhost/1
SENTRY_AUTH_TOKEN=local
SENTRY_ORG=local
SENTRY_PROJECT=local

# Gotenberg (im lokalen Modus optional; fällt bei Nichterreichbarkeit auf lokalen PDF-Stub zurück)
GOTENBERG_API_BASIC_AUTH_USERNAME=local
GOTENBERG_API_BASIC_AUTH_PASSWORD=local
GOTENBERG_URL=http://localhost:3001

# Feature Flags
FEATURE_FLAG_MCP_PARLA_ALLOWED=false
MCP_PARLA_URL=
FEATURE_FLAG_WEB_SEARCH_ALLOWED=false
BRAVE_SEARCH_API_KEY=
BRAVE_SEARCH_MAX_RPS=1
BRAVE_SEARCH_API_URL=https://api.search.brave.com/res/v1/llm/context
FEATURE_FLAG_MCP_OPEN_DATA_ALLOWED=false
OPEN_DATA_MCP_URL=
FEATURE_FLAG_MCP_DATAWRAPPER_ALLOWED=false
DATAWRAPPER_MCP_URL=
FEATURE_FLAG_MEMORY_LOG=false
FEATURE_FLAG_EXPERIMENTAL_MODEL_ALLOWED=false
EXPERIMENTAL_MODEL_IDENTIFIER=local-model
```

---

### 7.2 [`apps/frontend/.env`](file:///c:/dev/baergpt/apps/frontend/.env)

```env
VERCEL_ENV=development
VITE_VERCEL_ENV=development
VITE_PORT=5173
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
VITE_API_URL=http://localhost:3000
VITE_MAX_TOTAL_FILES_UPLOADED=100
VITE_UPLOAD_FILE_SIZE_LIMIT_MB=20
VITE_MAX_PARALLEL_FILE_UPLOADS=5
VITE_TEST_SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
VITE_ADMIN_URL=http://localhost:5174
VITE_SENTRY_URL=http://localhost:3000
VITE_SENTRY_DSN=https://local@localhost/1
VITE_SENTRY_ORG=local
VITE_SENTRY_PROJECT=local
VITE_TRACE_PROPAGATION_TARGETS=http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:54321
SENTRY_AUTH_TOKEN=local
VITE_MATOMO_URL=
VITE_MATOMO_SITE_ID=
VITE_DEFAULT_DOCUMENT_PROCESSING_MODEL=fast
VITE_FEATURE_FLAG_MCP_PARLA_ALLOWED=false
VITE_FEATURE_FLAG_MCP_OPEN_DATA_ALLOWED=false
VITE_FEATURE_FLAG_MCP_DATAWRAPPER_ALLOWED=false
VITE_FEATURE_FLAG_WEB_SEARCH_ALLOWED=false
VITE_FEATURE_FLAG_SPLASH_SCREEN_ALLOWED=false
VITE_FEATURE_FLAG_EXPERIMENTAL_MODEL_ALLOWED=false
VITE_FEATURE_FLAG_EXTENDED_THINKING_ALLOWED=true
VITE_SPLASH_CONTENT_URL=http://localhost:5173
VITE_SPLASH_API_COMMIT_URL=http://localhost:5173
```

---

### 7.3 [`start-local.ps1`](file:///c:/dev/baergpt/start-local.ps1)

```powershell
# Startet den lokalen BärGPT-Stack mit LM Studio (http://localhost:1234)
$ErrorActionPreference = "Stop"

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  BärGPT Lokaler Webhost (LM Studio + Docker Stack)" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

# 1. Prüfe LM Studio Server auf Port 1234
try {
    $models = Invoke-RestMethod -Uri "http://localhost:1234/v1/models" -TimeoutSec 3
    $loadedCount = ($models.data | Measure-Object).Count
    Write-Host "[OK] LM Studio Server erreichbar auf http://localhost:1234 ($loadedCount Modell(e) verfügbar)" -ForegroundColor Green
} catch {
    Write-Host "[HINWEIS] LM Studio Server unter http://localhost:1234 noch nicht erreichbar." -ForegroundColor Yellow
    Write-Host "          Bitte in LM Studio unter 'Developer / Local Server' den Server auf Port 1234 starten" -ForegroundColor Yellow
    Write-Host "          und ein Sprachmodell laden." -ForegroundColor Yellow
}

# 2. Prüfe Docker Engine
try {
    docker info *> $null
    Write-Host "[OK] Docker Engine läuft." -ForegroundColor Green
} catch {
    Write-Host "[FEHLER] Docker Desktop läuft noch nicht. Bitte starte zuerst Docker Desktop." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Starte BärGPT-Stack (Supabase + Backend + Frontend)..." -ForegroundColor Cyan
Write-Host "  -> Chat-Oberfläche: http://localhost:5173" -ForegroundColor Green
Write-Host "  -> Direkt-Login:    Button 'Lokaler Direkt-Login (Admin)' auf der Login-Seite" -ForegroundColor Green
Write-Host "  -> Mailpit (OTPs):  http://localhost:54324" -ForegroundColor Green
Write-Host ""

docker compose -f compose.local.yml up --build
```

---

## 8. Wartung, Nützliche Befehle & Fehlerbehebung (Troubleshooting)

### Stack im Hintergrund starten / stoppen / Logs ansehen
* **Im Hintergrund (Detached Mode) starten:**
  ```powershell
  docker compose -f compose.local.yml up -d --build
  ```
* **Live-Logs des Backends verfolgen:**
  ```powershell
  docker logs -f baergpt-backend
  ```
* **Stack sauber stoppen (Datenbank-Inhalte bleiben erhalten):**
  ```powershell
  docker compose -f compose.local.yml down
  ```
* **Datenbank & Storage komplett zurücksetzen (inkl. Volumes löschen):**
  ```powershell
  docker compose -f compose.local.yml down -v
  ```

### Häufige Fehlerbilder & Lösungen

1. **Fehler im Chat: `LM Studio Fehler (404/400): No models loaded...`**
   * **Ursache:** Der LM Studio Local Server läuft zwar auf Port `1234`, es wurde aber oben in der Auswahlliste noch kein Modell in den Speicher geladen (oder LM Studio hat das Modell nach einem Timeout automatisch entladen).
   * **Lösung:** In LM Studio unter **Developer** oben ein Modell wie `gemma-4-12B-it-QAT` oder `Qwen3.5-9B` auswählen und ggf. den *Idle Unload Timer* (automatisches Entladen) in LM Studio deaktivieren.

2. **Docker-Container `baergpt-backend` erreicht LM Studio auf dem Host nicht (`ECONNREFUSED 127.0.0.1:1234` oder `host.docker.internal:1234`)**
   * **Ursache:** In LM Studio ist unter *Server Settings* die Option **„Serve on Local Network“** deaktiviert und LM Studio bindet nur strikt an `127.0.0.1`, wodurch Zugriffe über die Docker-Bridge (`host.docker.internal`) abgewiesen werden können.
   * **Lösung:** Aktiviere in LM Studio im Tab **Developer** rechts unter **Settings** die Option **Serve on Local Network** (oder starte das Backend nativ mit `npm --prefix apps/backend run dev`, da es dann direkt über `localhost:1234` zugreift).

3. **Port-Konflikt beim Start von `compose.local.yml` (`Bind for 127.0.0.1:54321 failed: port is already allocated`)**
   * **Ursache:** Es läuft bereits eine lokale Supabase-CLI-Instanz (`npx supabase start`) auf denselben Ports (`54321`–`54324`).
   * **Lösung:** Entweder die bestehende Supabase-Instanz mit `npx supabase stop` beenden oder direkt Variante B/C nutzen, da das Backend und Frontend mit jeder lokalen Supabase-Instanz auf Port `54321` kompatibel sind.

