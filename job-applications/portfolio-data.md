# Anish Giri — Master Portfolio Data

> Single source of truth for job applications. All info gathered from the portfolio
> codebase (`src/pages`, `src/content/projects`, `src/content/case-studies`).
> Extend the project sections below as you supply more detail.

---

## 1. Personal & Contact Info

| Field | Value |
|---|---|
| **Name** | Anish Giri |
| **Title** | Software Engineer (ML/CV + Full-Stack) |
| **Location** | Nanjappa Layout, Adugodi, Bengaluru, Karnataka, 560030, India |
| **Phone** | +91 6294957979 (Mobile) |
| **Email** | anishgiri163@gmail.com |
| **LinkedIn** | https://www.linkedin.com/in/anish-giri-a4031723a |
| **GitHub** | https://github.com/Leptons1618 |

### Positioning / Pitch
- Software engineer focused on **machine learning, computer vision, and full-stack development**.
- Builds systems at the intersection of **data, inference, and user experience** — from research prototypes to production systems.
- Bias toward **clean code, scalable architecture, and measurable results**.
- Strength in turning complex ideas into practical, shipped AI-powered products where both model performance and UX matter.

### Summary (from resume)
> A curious, skeptical, and agnostic carbon-based bipedal who thrives on delving into knowledge. Strong interest in technology, at peace in the Linux environment. AI, ML, and Data Science enthusiast eager to realize these areas' full potential and leverage their transformative impact. Unshakable passion for coding and broadening programming-language vocabulary, with the ambition to make a significant contribution in AI/ML/Data Science.

---

## 2. Experience

### Axcend Automation and Software Solutions Pvt. Ltd — Software Engineer
*July 2024 – Present · Bengaluru, Karnataka, India*

Develop and maintain software for industrial automation projects. Work with network protocols for seamless device/system communication. Collaborate on designing and managing control systems and SCADA systems; hands-on with PLCs, HMIs, and other automation components. Integrate hardware and software components for efficient, reliable operation. *(Started as Trainee Engineer.)*

### Chegg India — Subject Matter Expert
*June 2023 – September 2024 (1 yr 4 mo)*

### Axcend Automation and Software Solutions Pvt. Ltd — Intern
*January 2024 – May 2024 (5 mo) · Bengaluru, Karnataka, India*

---

## 3. Education

**Pondicherry University, Puducherry** — Master's degree, Computer Science
*December 2022 – July 2024*

---

## 4. Skills

| Category | Skills |
|---|---|
| **Frameworks (top)** | Next.js, React.js, TypeScript |
| **ML / CV** | PyTorch, TensorFlow, OpenCV, scikit-learn, YOLO |
| **Languages** | Python, TypeScript, Go, Rust, SQL |
| **Web** | Astro, React, FastAPI, Node.js, Tailwind |
| **Data** | PostgreSQL, Redis, Apache Kafka, DuckDB |
| **Infra** | Docker, GitHub Actions, Cloudflare, Vercel |

**Other stacks surfaced across projects:** Flask, Express, SQLAlchemy, Supabase, ChromaDB, LlamaIndex, Ollama, MLflow, Pandas, Plotly, Streamlit, PaddleOCR, spaCy, Whisper / Faster-Whisper, PyAnnote, DeepSort, Grad-CAM, Fabric.js, Zustand, React Native, Expo, WebRTC, WebSocket, MQTT, Debezium, Kafka Connect, RabbitMQ, Prometheus, Grafana, SQLite, sqlx, Tokio, clap, Paramiko, Tkinter, TensorFlow.js, WebGL, Vite, ezdxf, lxml.

### Certifications
- Artificial Intelligence Fundamentals
- Problem Solving (Basic)
- SQL (Intermediate)
- Data Fundamentals
- SQL (Basic)

---

## 5. Projects

> 23 projects total. Flagship professional projects are listed first, then featured personal projects.
> Projects marked **★ Case study** have an extended write-up (problem/solution/achievements) folded in below.
> Status legend: `active` (in development), `stable` (complete/maintained), `wip` (work in progress), `archived`.

### 5.0 Flagship Professional Projects (full detail)

#### Face Glow Scan — AI-Powered Facial Skin Analysis & TCM Wellness Platform  `ml-cv` / `ai-llm` · 2025
**One-liner:** Production-scale AI wellness platform that performs automated facial skin analysis and Traditional Chinese Medicine (TCM) tongue diagnostics from smartphone images, returning explainable assessments, personalized recommendations, and longitudinal progress tracking.

**Role framing:** Designed and implemented the complete end-to-end distributed system — mobile app, backend microservices, AI/CV pipeline, data layer, and cloud infra.

**Business problem — build an intelligent wellness system that:**
- Provides instant skin-health insights without specialized equipment (smartphone camera only).
- Delivers **explainable** AI recommendations rather than black-box outputs.
- Tracks improvement over time via repeated assessments.
- Integrates traditional wellness (TCM) with modern computer vision.
- Maintains privacy through explicit consent management and GDPR compliance.
- Supports future AI model upgrades **without** mobile app updates.

**System architecture (end-to-end distributed):**
- **Mobile layer (React Native):** camera capture, live quality validation, consent workflows, upload orchestration, scan progress visualization, history tracking, trend dashboards, comparison views, recommendation consumption.
- **Backend layer (FastAPI microservices):** authentication, upload validation, AI inference orchestration, recommendation generation, scan lifecycle management, analytics & trend computation, GDPR operations.
- **Data layer (PostgreSQL):** scan history, AI metrics, trend info, recommendation records, consent records, wellness progress.
- **Cloud (Cloudinary):** image storage, asset delivery, transformations, processing optimization.
- **Future infra:** architected to migrate from FastAPI Background Tasks → **Celery + Redis** distributed processing without API contract changes.

**AI & Computer Vision engine — hybrid analysis framework with graceful degradation:**
- **Primary:** MediaPipe Face Landmarker — 478-point 3D facial mesh, facial geometry, region-specific evaluation, symmetry analysis, landmark-based ROI generation.
- **Fallback:** OpenCV Haar Cascade detection when MediaPipe is unavailable/fails.
- **Last-chance recovery:** center-crop heuristic so scans still complete under non-ideal conditions — significantly reduced scan failures and improved UX.

**Nine independent skin analyzers (each a distinct physiological indicator):**
1. **Hydration** — CIELAB color, brightness, texture homogeneity, GLCM; bilateral cheek regions → moisture retention.
2. **Oiliness** — HSV color, specular reflection detection, high-intensity pixel segmentation; T-zone focused → oil concentration.
3. **Wrinkles** — Canny edge detection, edge density, texture contrast; forehead/eye regions → severity metrics.
4. **Pigmentation** — skin masking, Lab color variance, chromatic deviation → tone consistency scores.
5. **Dark circles** — brightness differential, regional comparison, cheek-to-eye baseline normalization → darkness levels.
6. **Pore visibility** — high-pass filtering, variance measurement, surface texture enhancement → smoothness/pore prominence.
7. **Elasticity** — texture energy, structural consistency, jawline texture → firmness characteristics.
8. **Muscle tone** — landmark pair matching, geometric deviation, bilateral balance scoring → muscle tone from symmetry.
9. **Inflammation** — Lab color space, red-channel extraction, local texture → redness/inflammation indicators.

**Composite AI scoring engine (weighted aggregation):**
- **Glow Score** — weighted combination of all nine metrics.
- **Toxin Indicator** — derived from oiliness + dark circles + glow score.
- **Overall Wellness Score** — multi-factor aggregation.
- **Skin Age Estimation** — heuristic prediction from wrinkle + elasticity metrics.

**TCM tongue analysis subsystem:**
- **Segmentation:** OpenCV GrabCut + color-based refinement, shape extraction, region isolation.
- **Classification:** tongue body color, coating color, coating thickness, moisture level, structural shape.
- **TCM interpretation engine:** maps characteristics to patterns — Damp Heat, Yin Deficiency, Blood Deficiency, Qi Deficiency, Heat in Blood — generating wellness guidance.

**Recommendation engine (rule-based, 15+ rules):**
- **Wellness tips:** sleep optimization, hydration, stress reduction, detox, nutrition.
- **Face Glow routines:** Morning Glow Routine, Facial Acupressure, Night Repair, Gua Sha Flow.
- **TCM-based guidance** from detected facial + tongue patterns.

**Mobile experience:** Vision Camera integration, image optimization, real-time quality checks (poor lighting / blur / missing face / invalid tongue capture); live scan progress (preprocessing → detection → analysis → scoring → completion); results dashboard (metric breakdowns, history, trend charts, before/after comparisons, recommendation cards); history management (filtering, pagination, comparison tools, progress monitoring).

**Privacy, security & compliance:** GDPR-compliant consent framework — explicit scan-storage / AI-training / data-processing consent; consent revocation, scan deletion, account-level data management; auditability (consent versions, IP, user-agent, grant/revoke timestamps); secure upload (MIME validation, image validation, size restrictions, auth enforcement).

**Database engineering:** models for Face Scans, Scan Results, Recommendations, User Consents, Face Glow Routines; optimized query patterns for trend analysis, historical reporting, dashboard aggregation, recommendation retrieval, progress comparison — supporting longitudinal wellness tracking.

**Tech stack:**
- *Backend:* FastAPI, SQLAlchemy, PostgreSQL, Alembic, Redis (planned), Celery (planned)
- *AI/ML:* MediaPipe, OpenCV, NumPy, Scikit-Image, ONNX Runtime, Pillow
- *Mobile:* React Native, React Native Vision Camera, Zustand, SVG Charts
- *Cloud:* Cloudinary
- *Auth:* JWT, OAuth-ready architecture

> Design note: architected to support future migration from classical CV to deep-learning models while preserving explainability, scalability, GDPR compliance, and production readiness.

---

#### AI Perspective Builder (Ignition Copilot) — Native AI Development Copilot for Ignition  `ai-llm` / `devtools` · 2025
**One-liner:** A native, AI-powered development copilot for Inductive Automation's Ignition platform that lets engineers create, modify, analyze, and manage Perspective views, project resources, tags, and automation assets via natural language — with multi-provider LLM support and approval-gated execution.

**Role framing:** Designed and developed a multi-scope Ignition module (Designer + Gateway + shared common), deeply integrated with Ignition's Designer, Gateway, and resource-management infrastructure. Single deployable `.modl` targeting **Ignition 8.3 / Java 17**.

**Core problem:** Industrial automation developers spend substantial time on repetitive Perspective development, tag configuration, project navigation, troubleshooting, and resource management. Goal: an AI copilot that understands Ignition project structure, reads/generates/modifies Perspective views, manages tags, creates project assets, answers project-specific questions, and safely proposes changes through approval workflows — without compromising system integrity. Unlike generic chat assistants, it is deeply integrated into Ignition's internal architecture and resource model.

**System architecture — three Ignition scopes:**
- **Common module (DG scope):** shared framework — DTOs, RPC contracts, tool definitions, skill manifests, provider abstractions, serialization utilities.
- **Gateway module:** LLM orchestration, provider management, context generation, action execution, resource management, security enforcement, persistence, audit logging.
- **Designer module:** native Swing-based AI interface, context capture, resource selection, approval workflows, preview rendering, execution management.

**Multi-provider LLM infrastructure (provider-agnostic):**
- **NVIDIA NIM** — OpenAI-compatible, enterprise model serving.
- **OpenAI-compatible** — OpenAI, Azure OpenAI, LiteLLM, vLLM, custom endpoints.
- **Ollama** — local model execution, air-gapped / on-premise inference.
- **Anthropic architecture** — future integration for Claude Sonnet / Opus / Haiku via native Messages API + tool-calling.

**AI orchestration engine:** central layer coordinating users, project context, LLM providers, tools, and execution workflows —
- **Context assembly:** project metadata, selected Perspective views, folder structures, resource references, tag selections, user context.
- **Prompt construction:** dynamic system prompts with Ignition-specific instructions, capability restrictions, resource info, action schemas, project guidance.
- **Action interpretation:** transforms AI responses into executable operations.
- **Validation layer:** ensures actions conform to resource schemas, permission rules, capability constraints, project boundaries.
- **Response enrichment:** human-readable summaries, preview info, execution metadata.

**Perspective view generation & modification (flagship feature):** create views from natural language, update existing views while preserving functionality, targeted patch operations, safe delete via approval; **clone-and-patch template-based generation** for standardized/reusable screens, consistent design systems, and reduced hallucinations; schema validation against known component definitions before execution.

**Ignition resource management engine:** creation (scripts, named queries, config resources, Perspective assets), updates (incremental modifications, merge, synchronization), deletion (safe + approval-gated), discovery (project-wide search, indexing, dependency analysis).

**Tag management system:** value operations (read/write/bulk), configuration management (create/modify/update UDT instances/delete), hierarchical browsing with context-aware discovery, large-scale bulk operations through controlled workflows.

**Native tool-calling framework (provider-agnostic):** structured tools — `create_perspective_view`, `update_perspective_view`, `patch_perspective_view`, `delete_perspective_view`, `upsert_project_resource`, `delete_project_resource`, `write_tags`, `upsert_tag_configs`, `delete_tags`, `read_view`, `browse_tags`, `search_project` — converting AI tool calls into validated Ignition operations with strict separation between proposal and execution.

**Approval & safety framework (human-in-the-loop):** Proposal → Preview → Approval → Execution phases, plus undo/rollback/resource-restoration support. AI never directly modifies industrial assets without human approval.

**Live preview system:** structure preview (visual hierarchy), JSON diff (current vs proposed), raw resource preview, change-impact analysis (components added/removed/modified).

**Intelligent context understanding (retrieval-augmented development):** project summarization, view analysis, tag context extraction, resource indexing — letting the AI answer project-specific questions from live project data rather than generic training knowledge.

**AI skills framework (modular, injected only when needed):** Perspective View Author, Tag Modeler, UDT Bulk Generator, Named Query Author, Project Explainer, Data Investigator — improving accuracy while reducing prompt size.

**Designer experience:** embedded dockable AI workspace, context-aware chat, mentions system (views/tags/folders/resources/queries), dynamic model/provider selection, interaction modes (Ask / Edit / Agent), streaming responses — feels like a first-party Ignition tool.

**Security & governance (enterprise):** capability-based security, per-project capability presets, Designer user-identity enforcement, data-egress controls (restrict external provider access), audit logging (user/AI actions, resource modifications, execution outcomes), mandatory human approval.

**Developer tooling & operations:** web-based provider management portal, connection testing/diagnostics, planned usage analytics (token consumption, cost, provider performance), release automation via GitHub Actions (module packaging, security scanning, artifact generation), CI/CD integration.

**Tech stack:**
- *Languages:* Java 17, JavaScript, HTML/CSS
- *Frameworks:* Ignition SDK 8.3, Swing, JIDE Docking Framework, Gradle
- *AI infra:* NVIDIA NIM, OpenAI APIs, Ollama, Anthropic Messages API architecture
- *Communication:* Gateway RPC, Protobuf, SSE streaming
- *Persistence:* Ignition PersistentRecord, internal Gateway database
- *DevOps:* GitHub Actions, Gitleaks, Docker

> Likely tied to your Axcend role (industrial automation / Ignition). Confirm whether this is work product you can publicly showcase, and whether a repo/demo can be linked.

---

### 5.1 Featured Projects

#### ★ AXCAD — *Featured #1*  `devtools` · `wip` · 2024
**Summary:** Web-based 2D CAD editor with parametric constraints and DXF export support.
**Stack:** TypeScript, React, Fabric.js, Zustand, Node.js, Express
**Repo:** https://github.com/Leptons1618/AXCAD
**Tags:** cad, parametric, constraints, dxf, typescript

**Case study — subtitle:** Browser-based CAD workspace with parametric constraints, command workflows, and export pipelines.
- **Problem:** Lightweight web drawing tools aren't suitable for precision drafting — they lack command-driven editing, constraints, and production-ready export formats.
- **Solution:** A TypeScript/React CAD editor with precision snapping, constraint-aware geometry operations, an AutoCAD-style command parser, and multi-format export for engineering handoff.

**Highlights / Achievements:**
- Full CAD workspace with snapping, history management, and precision drafting tools.
- AutoCAD-style command parser for geometry creation/editing workflows.
- Multi-format export: DXF, SVG, PDF, JSON, Excel — from a single web workspace.
- Responsive interaction in a Fabric.js canvas-based editor architecture.

---

#### ★ Markov Chain Lab — *Featured #2*  `simulation` · `stable` · 2024
**Summary:** Interactive learning platform for Markov chains, automata, and grammar conversion.
**Stack:** Next.js, React, TypeScript, Tailwind CSS, Supabase
**Repo:** https://github.com/Leptons1618/Markov-Chain-Lab
**Tags:** markov-chains, automata, simulation, education, interactive

**Case study — subtitle:** Interactive learning platform for Markov chains, automata, simulation, and grammar workflows.
- **Problem:** Students/practitioners need one place to learn theory, build automata, run simulations, and validate behavior; most tools are fragmented across static notes and disconnected utilities.
- **Solution:** A modern Next.js platform with an interactive builder, simulation/analysis tabs, grammar conversion tooling, and persisted user workspaces.

**Highlights / Achievements:**
- Visual chain builder supporting Markov chains, DFA, and NFA with interactive editing.
- Simulation & analysis: convergence, stationary distribution, and chain properties.
- Two-way grammar↔automata conversion with validation.
- Supabase-backed persistence for saved workspaces and user settings.

---

#### ★ Menu OCR — *Featured #3*  `ml-cv` · `stable` · 2023
**Summary:** OCR pipeline for extracting structured restaurant menu content from images.
**Stack:** Python, PaddleOCR, OpenCV, spaCy, FastAPI, React
**Repo:** https://github.com/Leptons1618/menu-ocr
**Tags:** ocr, computer-vision, text-extraction, image-processing, nlp

**Case study — subtitle:** Layout-aware OCR pipeline for extracting structured menu items and prices from noisy restaurant photos.
- **Problem:** Restaurant menu images are highly inconsistent in layout, font quality, and lighting, making raw OCR output unreliable for downstream structured use.
- **Solution:** A modular OCR system combining PaddleOCR + OpenCV preprocessing, then DBSCAN-based column grouping, FSM/Viterbi hierarchy enforcement, and Hungarian matching for robust item-price pairing.

**Highlights / Achievements:**
- Modular OCR pipeline with layout-aware postprocessing and diagnostics.
- Column detection with DBSCAN + hierarchy enforcement via FSM + Viterbi decoding.
- Hungarian matching for robust global item-price association across noisy menus.
- Treated OCR as a full information-extraction problem (explicit layout + business-rule modeling).

---

#### ★ EchoScript — *Featured #4*  `ai-llm` · `active` · 2024
**Summary:** YouTube transcription and AI note-taking app with synchronized playback and search.
**Stack (project):** Python, Flask, React, OpenAI Whisper, Faster-Whisper, yt-dlp, ffmpeg
**Stack (case study):** Python, OpenAI Whisper, PyAnnote, FastAPI, React, TypeScript, WaveSurfer.js
**Repo:** https://github.com/Leptons1618/EchoScript
**Tags:** speech-recognition, youtube, transcription, whisper, summarization

> ⚠️ **Note for you to reconcile:** The project metadata describes EchoScript as a *YouTube transcription + AI note-taking* app, while the case study describes *automatic transcription with speaker diarization (Whisper + PyAnnote)*. These may be two facets of the same project or have drifted. Clarify which framing is current.

**Project highlights:**
- Transcribes YouTube content using Whisper/Faster-Whisper with configurable model settings.
- Synchronizes transcript segments with video playback for interactive review.
- Generates AI notes/summaries; exports to PDF, TXT, Notion.
- Searchable job history with transcript filtering and keyboard-driven navigation.

**Case study — subtitle:** Automatic transcription with speaker diarization using Whisper and PyAnnote.
- **Problem:** Accurate multi-speaker transcripts need both high-quality ASR and speaker attribution; Whisper alone produces accurate text but doesn't identify who is speaking.
- **Solution:** Integrated OpenAI Whisper (ASR) with PyAnnote.audio (diarization), aligning speaker labels to transcript segments via timestamp matching.
- **Achievements:** Per-speaker segments with <200 ms alignment error; SRT/VTT/plain-text export; batch processing API; React frontend with WaveSurfer.js waveform visualization.
- **Pipeline:** Preprocess (16 kHz mono, loudness normalize) → PyAnnote diarization (RTTM) → Whisper transcribes each segment → word-level timestamp alignment.

---

#### ★ StreamSQL — *Featured #5*  `systems` · `active` · 2024
**Summary:** Real-time CDC pipeline from SQL Server through Debezium/Kafka to MQTT consumers.
**Stack:** Python, Apache Kafka, Debezium, Kafka Connect, MQTT, Docker, SQL Server
**Repo:** https://github.com/Leptons1618/StreamSQL
**Tags:** sql, streaming, kafka, real-time, analytics

**Case study — subtitle:** Real-time SQL Server CDC streaming through Debezium/Kafka into MQTT subscribers.
- **Problem:** Operational analytics pipelines need low-latency change propagation from transactional DBs to event-driven consumers, but direct polling introduces delay and consistency issues.
- **Solution:** CDC-first architecture using Debezium + Kafka Connect for SQL Server change capture, with Kafka topics bridged to MQTT for low-latency downstream consumption and monitoring.
- **Architecture:** `SQL Server (CDC) → Debezium Connector → Kafka Topics → MQTT Bridge → Subscribers`

**Highlights / Achievements:**
- Near-real-time CDC propagation from SQL Server to event consumers.
- Kafka-to-MQTT bridge for subscriber-friendly fan-out.
- Reproducible local stack via Docker with Kafka UI/Connect tooling.
- Improved observability of connector and topic health.

---

### 5.2 Other Projects with Case Studies

#### ★ Ingesta  `full-stack` · `stable` · 2024
**Summary:** High-throughput data ingestion pipeline with configurable batch processing and dead-letter queuing.
**Stack:** Python, Apache Kafka, PostgreSQL, Redis, Docker, FastAPI
**Repo:** https://github.com/Leptons1618/Ingesta
**Tags:** data-pipeline, ingestion, batch-processing, kafka, python

- **Problem:** Ingesting high-volume event streams into a relational DB is error-prone when individual record failures fail entire batches; retry without backoff causes thundering-herd problems.
- **Solution:** Kafka consumer pipeline with configurable batch sizes, transactional batch inserts, DLQ routing for failed records, and exponential backoff retry.
- **Achievements:** Configurable batch inserts reducing DB round-trips by **85%**; DLQ with retry and poison-pill detection; at-least-once delivery via manual offset commit; Prometheus metrics for lag/throughput/error rates.
- **Detail:** Accumulates records up to `BATCH_SIZE` or `BATCH_TIMEOUT_MS`, single multi-row INSERT; failed records → DLQ topic with error envelope (payload, error type, timestamp); offsets committed after successful insert. Dockerized with `docker-compose` for local Kafka + PostgreSQL.

---

#### ★ QueryPilot  `ai-llm` · `active` · 2024
**Summary:** Natural-language-to-SQL assistant with schema-aware query generation.
**Stack:** Python, FastAPI, SQLAlchemy, PostgreSQL, React, TypeScript
**Repo:** https://github.com/Leptons1618/QueryPilot
**Tags:** nlp, sql, llm, text-to-sql, databases

- **Problem:** Text-to-SQL assistants often produce unsafe/invalid queries when they lack schema context and execution safeguards.
- **Solution:** Schema-aware generation pipeline that reads live metadata, produces SQL from user intent, validates before execution, and returns both query output and human-readable SQL explanations.
- **Achievements:** Reduced invalid query execution with pre-run validation; better generation via schema-aware prompts; SQL explanation output for trust/review; end-to-end FastAPI + React interface.

---

#### ★ StreamFusion  `other` · `stable` · 2023
**Summary:** Cross-platform synchronized watch-party app with realtime playback, queue, and chat.
**Stack:** React Native, Expo, TypeScript, WebRTC, Zustand, WebSocket, Node.js
**Repo:** https://github.com/Leptons1618/streamfusion
**Tags:** watch-party, realtime, webrtc, mobile, streaming

- **Problem:** Watch-party apps fail when playback drift accumulates across devices, breaking group experiences and fragmenting session state.
- **Solution:** Room-based sync architecture using WebRTC data channels + WebSocket signaling, with reconciliation logic for playback state, queue coordination, and chat delivery.
- **Achievements:** Low drift via periodic sync reconciliation; shared queue controls with multi-user conflict handling; integrated chat tied to room state; cross-platform mobile client (Expo + React Native). Separates signaling from realtime room state for recoverable, resilient sessions.

> Note: **MetaStream Mobile** (below) is a closely related / possibly earlier sibling of this project.

---

#### ★ VisionID  `ml-cv` · `active` · 2024
**Summary:** Computer vision system for real-time object identification and tracking using YOLO and DeepSort.
**Stack:** Python, PyTorch, YOLOv8, DeepSort, OpenCV, FastAPI
**Repo:** https://github.com/Leptons1618/VisionID
**Tags:** object-detection, tracking, computer-vision, yolo, real-time

- **Problem:** Tracking multiple objects across frames needs to balance detection accuracy with tracking continuity; YOLO alone loses identity across frames, naive IoU tracking fails under occlusion.
- **Solution:** YOLOv8 per-frame detection + DeepSort appearance-based re-identification, exposed via FastAPI for batch video and live stream inputs.
- **Achievements:** **25 FPS** real-time tracking on a single consumer GPU; stable per-object track IDs across occlusions; REST API with configurable thresholds; per-frame JSON (bounding boxes, class labels, track IDs).
- **API:** `POST /track/video` (returns tracking JSON), `GET /track/stream` (SSE live). Tuning: confidence 0.45, NMS IoU 0.5, track confirmation after 3 consecutive detections.

---

### 5.3 Remaining Projects (metadata only — ready to expand)

#### Comic Sudoku  `other` · `stable` · 2023
**Summary:** Sudoku game with a comic art style theme and a built-in constraint-satisfaction solver.
**Stack:** JavaScript, HTML Canvas, CSS, Backtracking, CSP · **Repo:** https://github.com/Leptons1618/Comic-Sudoku
**Tags:** game, sudoku, solver, csp, javascript
- Backtracking CSP solver with arc-consistency pruning.
- Hand-drawn comic art style UI rendered on HTML Canvas.
- Puzzle generator with difficulty classification via filled-cell count.

#### dwg2svg  `other` · `stable` · 2023
**Summary:** CAD conversion toolkit for SVG↔DXF workflows with block attributes and coordinate mapping.
**Stack:** React, Node.js, Express, Python, Flask, ezdxf, lxml · **Repo:** https://github.com/Leptons1618/dwg2svg
**Tags:** cad, dwg, dxf, svg, conversion
- 3-service architecture (React UI, Node backend, Python conversion engine).
- SVG-to-DXF block generation with ATTDEF/ATTRIB support and base-point selection.
- DXF↔SVG conversion improvements for geometry fidelity and hatch rendering.

#### EchoNode  `systems` · `stable` · 2023
**Summary:** Distributed event-driven node framework for building fault-tolerant microservices.
**Stack:** Node.js, TypeScript, RabbitMQ, Redis, Docker, Prometheus · **Repo:** https://github.com/Leptons1618/EchoNode
**Tags:** distributed-systems, event-driven, microservices, nodejs, fault-tolerance
- Saga pattern for distributed transaction coordination.
- Automatic service health checks and circuit breaker via Redis TTL.
- Event replay from RabbitMQ dead-letter exchange for debugging.

#### LocalRAG  `ai-llm` · `active` · 2024
**Summary:** Local retrieval-augmented generation system using open-source LLMs and vector search.
**Stack:** Python, LlamaIndex, ChromaDB, Ollama, FastAPI, React · **Repo:** https://github.com/Leptons1618/LocalRAG
**Tags:** rag, llm, vector-search, embeddings, local-ai
- Fully local pipeline: no external API calls, runs on consumer hardware.
- Document ingestion with chunking, embedding, ChromaDB storage.
- Multiple local LLM backends via Ollama (Mistral, Llama3, Phi3).
- Context window management with source citation in responses.

#### MetaStream Mobile  `other` · `stable` · 2023
**Summary:** Cross-platform mobile watch-party app with realtime room sync, queue, and chat.
**Stack:** React Native, Expo, TypeScript, Expo Router, Zustand, WebSocket, Node.js · **Repo:** https://github.com/Leptons1618/metastream-mobile
**Tags:** mobile, watch-party, react-native, sync, chat
- Room-based synchronized playback with host-controlled realtime updates.
- Shared media queue and in-room chat over a self-hostable signal server.
- Android APK CI workflow and tag-based release publishing.

#### MLEvaluation  `devtools` · `stable` · 2024
**Summary:** Evaluation harness for ML experiments with standardized metrics and reports.
**Stack:** Python, scikit-learn, PyTorch, MLflow, Pandas, Plotly · **Repo:** https://github.com/Leptons1618/MLEvaluation
**Tags:** ml, evaluation, metrics, benchmarking, mlops
- Unified classification and regression metrics under one runner.
- MLflow tracking for run comparison and reproducibility.
- HTML reports with metric trends and confusion matrices.

#### NiceChatAI  `ai-llm` · `active` · 2024
**Summary:** Conversational AI frontend with multi-model support and conversation management.
**Stack:** React, TypeScript, OpenAI API, Zustand, Tailwind, FastAPI · **Repo:** https://github.com/Leptons1618/NiceChatAI
**Tags:** chatbot, llm, openai, conversation, react
- GPT-4, Claude, and Gemini via a unified model adapter layer.
- Conversation branching and history persistence via IndexedDB.
- Streaming response rendering with token-by-token display.
- System prompt editor with template library.

#### SIA Proto  `other` · `wip` · 2024
**Summary:** Local-first system monitoring agent with event analysis, CLI, and optional Ollama integration.
**Stack:** Rust, Tokio, SQLite, sqlx, clap, systemd, Ollama · **Repo:** https://github.com/Leptons1618/sia-proto
**Tags:** system-monitoring, rust, cli, sqlite, agent
- Background Linux agent with CPU/memory monitoring and event generation.
- Unix-socket JSON-RPC interface with a dedicated CLI for status/event inspection.
- Stores telemetry/events in SQLite; optional insight enrichment via local Ollama models.

#### SSH Key GUI  `devtools` · `stable` · 2023
**Summary:** Desktop GUI for generating, managing, and deploying SSH key pairs.
**Stack:** Python, Tkinter, Paramiko, Cryptography, subprocess · **Repo:** https://github.com/Leptons1618/ssh-key-gui
**Tags:** ssh, keygen, desktop-app, security, gui
- Generates RSA, Ed25519, and ECDSA key pairs via Python cryptography library.
- One-click deployment of public keys to remote hosts via Paramiko.
- Stores key metadata locally with optional passphrase encryption.

#### TrustNet  `other` · `stable` · 2023
**Summary:** Explainable and trust-aware image classification prototype with uncertainty and OOD analysis.
**Stack:** Python, PyTorch, Streamlit, Grad-CAM, ODIN, Mahalanobis, CIFAR-10 · **Repo:** https://github.com/Leptons1618/TrustNet
**Tags:** trust-ai, xai, uncertainty, ood-detection, computer-vision
- Uncertainty quantification and calibration for model confidence reliability.
- OOD detection via ODIN and Mahalanobis methods for trust-aware decisions.
- Grad-CAM visual explanations through an interactive Streamlit interface.

#### Vehicle Speed Estimation  `ml-cv` · `stable` · 2023
**Summary:** Computer vision pipeline for estimating vehicle speed from traffic video.
**Stack:** Python, YOLOv8, DeepSort, OpenCV, NumPy, FastAPI · **Repo:** https://github.com/Leptons1618/vehicle_speed_estimation
**Tags:** computer-vision, tracking, speed, yolo, traffic
- Vehicle velocity estimated using projected movement across calibrated scenes.
- Maintained object identity with multi-object tracking across occlusions.
- Smoothing and confidence thresholds for stable speed outputs.

#### VisionPlay  `ml-cv` · `stable` · 2023
**Summary:** Browser-based computer vision playground using TensorFlow.js for in-browser inference.
**Stack:** TypeScript, TensorFlow.js, React, WebGL, Vite · **Repo:** https://github.com/Leptons1618/VisionPlay
**Tags:** tensorflow.js, computer-vision, browser-ml, webcam, real-time
- TFJS digit classifier packaging (model.json + weights) for in-app inference.
- WebGL-accelerated inference with canvas-based video frame extraction.
- Model hot-swap at runtime without page reload.
- Mobile-compatible via MediaDevices API for camera access.

---

## 6. Project Index (quick reference)

| # | Project | Category | Status | Year | Case study | Featured |
|---|---|---|---|---|---|---|
| F1 | Face Glow Scan | ml-cv / ai-llm | — | 2025 | flagship | — |
| F2 | AI Perspective Builder (Ignition Copilot) | ai-llm / devtools | — | 2025 | flagship | — |
| 1 | AXCAD | devtools | wip | 2024 | ✓ | #1 |
| 2 | Markov Chain Lab | simulation | stable | 2024 | ✓ | #2 |
| 3 | Menu OCR | ml-cv | stable | 2023 | ✓ | #3 |
| 4 | EchoScript | ai-llm | active | 2024 | ✓ | #4 |
| 5 | StreamSQL | systems | active | 2024 | ✓ | #5 |
| 6 | Ingesta | full-stack | stable | 2024 | ✓ | — |
| 7 | QueryPilot | ai-llm | active | 2024 | ✓ | — |
| 8 | StreamFusion | other | stable | 2023 | ✓ | — |
| 9 | VisionID | ml-cv | active | 2024 | ✓ | — |
| 10 | Comic Sudoku | other | stable | 2023 | — | — |
| 11 | dwg2svg | other | stable | 2023 | — | — |
| 12 | EchoNode | systems | stable | 2023 | — | — |
| 13 | LocalRAG | ai-llm | active | 2024 | — | — |
| 14 | MetaStream Mobile | other | stable | 2023 | — | — |
| 15 | MLEvaluation | devtools | stable | 2024 | — | — |
| 16 | NiceChatAI | ai-llm | active | 2024 | — | — |
| 17 | SIA Proto | other | wip | 2024 | — | — |
| 18 | SSH Key GUI | devtools | stable | 2023 | — | — |
| 19 | TrustNet | other | stable | 2023 | — | — |
| 20 | Vehicle Speed Estimation | ml-cv | stable | 2023 | — | — |
| 21 | VisionPlay | ml-cv | stable | 2023 | — | — |

---

## 7. Open Questions / To Update
- [ ] **EchoScript framing** — reconcile "YouTube transcription + AI notes" vs "speaker diarization (PyAnnote)".
- [ ] **StreamFusion vs MetaStream Mobile** — confirm whether these are one project, a rename, or two distinct ones.
- [ ] Add quantified metrics/impact for projects that currently lack them.
- [ ] Add role/team-size/duration context per project (solo vs team, timeframe).
- [ ] Confirm Master's degree status (Dec 2022 – Jul 2024) and any thesis/specialization worth listing.
- [ ] **Face Glow Scan** — add repo/demo link (if any), confirm year, and quantified metrics (scan success rate, accuracy, latency, user numbers).
- [ ] **AI Perspective Builder (Ignition Copilot)** — confirm this is publicly showcaseable work product (likely Axcend); add repo/demo if shareable; tie to Axcend experience bullet if it's work output.
- [ ] Decide whether the two flagship projects should also be added to the live portfolio site (`src/content/projects/`), which currently has 21 entries.
