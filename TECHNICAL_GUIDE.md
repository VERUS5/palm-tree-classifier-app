# مصنف النخيل (Palm Classifier) — Technical Architecture & Deployment Guide

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Code Audit & Security Review](#2-code-audit--security-review)
3. [Model Architecture Analysis](#3-model-architecture-analysis)
4. [Gemini Integration Points (AOI)](#4-gemini-integration-points-aoi)
5. [Project File Map](#5-project-file-map)
6. [Database Schema](#6-database-schema)
7. [API Reference](#7-api-reference)
8. [RAG Pipeline Details](#8-rag-pipeline-details)
9. [Deployment on a Private Server](#9-deployment-on-a-private-server)
10. [Monitoring & Maintenance](#10-monitoring--maintenance)

---

## 1. System Overview

Palm Classifier is a bilingual (Arabic/English) mobile application that:

- Accepts a photo of a date palm tree or its fruit via camera or gallery
- Classifies the variety (Khalas, Razeez, or Shishi) using Google Gemini Vision
- Provides expert agricultural advice via a RAG-powered chat backed by a PostgreSQL knowledge base
- Streams AI responses in real time using Server-Sent Events (SSE)

### Architecture Diagram (Text)

```
┌──────────────────────────────────────────────────────────┐
│                 MOBILE CLIENT (Expo)                     │
│  ┌───────────┐  ┌───────────┐  ┌──────────────────────┐ │
│  │ Home      │  │ Chat      │  │ I18n Context         │ │
│  │ Screen    │→ │ Screen    │  │ (Arabic/English)     │ │
│  │ index.tsx │  │ [id].tsx  │  │ lib/i18n.tsx         │ │
│  └─────┬─────┘  └─────┬─────┘  └──────────────────────┘ │
│        │              │                                   │
│   base64 image    SSE stream                             │
│        │              │                                   │
└────────┼──────────────┼───────────────────────────────────┘
         │              │
         ▼              ▼
┌──────────────────────────────────────────────────────────┐
│               EXPRESS.JS BACKEND (:5000)                 │
│                                                          │
│  ┌─────────────────┐  ┌──────────────────────────────┐  │
│  │ POST /api/      │  │ POST /api/sessions/:id/chat  │  │
│  │ classify        │  │ (SSE streaming)              │  │
│  │                 │  │                              │  │
│  │ Gemini Vision   │  │ RAG Context → Gemini Chat    │  │
│  │ gemini-2.5-flash│  │ gemini-2.5-flash             │  │
│  └────────┬────────┘  └──────┬────────┬──────────────┘  │
│           │                  │        │                  │
│           ▼                  ▼        ▼                  │
│  ┌────────────────┐  ┌────────────────────────────┐     │
│  │ Google Gemini  │  │ PostgreSQL Database         │     │
│  │ API (Remote)   │  │ ┌──────────┐ ┌───────────┐ │     │
│  │                │  │ │documents │ │chat_      │ │     │
│  │ Auth: API Key  │  │ │chunks    │ │sessions   │ │     │
│  │ via env var    │  │ │          │ │messages   │ │     │
│  └────────────────┘  │ └──────────┘ └───────────┘ │     │
│                      └────────────────────────────┘     │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │ server/models/                                   │    │
│  │ ├── convnext_small_fold1_best.pth (189 MB)      │    │
│  │ ├── convnext_small_fold2_best.pth (189 MB)      │    │
│  │ ├── convnext_small_fold3_best.pth (189 MB)      │    │
│  │ ├── convnext_small_fold4_best.pth (189 MB)      │    │
│  │ └── convnext_small_fold5_best.pth (189 MB)      │    │
│  │ (Stored for future PyTorch integration)          │    │
│  └─────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer        | Technology                                          |
|--------------|-----------------------------------------------------|
| Frontend     | Expo React Native (v54), expo-router (file-based)   |
| Backend      | Express.js v5, TypeScript, tsx runtime               |
| Database     | PostgreSQL via Drizzle ORM                           |
| AI Provider  | Google Gemini API (`gemini-2.5-flash`) via `@google/genai` |
| Streaming    | Server-Sent Events (SSE) over HTTP                   |
| Fonts        | Inter (Google Fonts via @expo-google-fonts/inter)     |
| State        | React Query (@tanstack/react-query) + React Context   |

---

## 2. Code Audit & Security Review

### 2.1 Secrets Management

| Finding | Severity | Location | Details |
|---------|----------|----------|---------|
| API key loaded from environment | OK | `server/routes.ts:14` | `AI_INTEGRATIONS_GEMINI_API_KEY` read from `process.env`. Not hardcoded. |
| Database URL from environment | OK | `server/db.ts:4` | `DATABASE_URL` read from `process.env`. Throws if missing. |
| No `.env` in repo | OK | `.gitignore` | `.env` is not committed (verified). |
| Session secret exists | OK | Replit secrets | `SESSION_SECRET` stored as encrypted secret. |

**Status: PASS** — No hardcoded secrets found.

### 2.2 Input Validation

| Finding | Severity | Location | Recommendation |
|---------|----------|----------|----------------|
| No body size validation beyond Express limit | LOW | `server/index.ts:57` | Body limited to 10 MB — acceptable for base64 images. |
| No input sanitization on chat content | MEDIUM | `server/routes.ts:161` | User-supplied `content` is passed directly to Gemini. Add length validation (e.g., max 4000 chars). |
| `parseInt` on route params without NaN check | LOW | `server/routes.ts:135,146,158` | `parseInt(req.params.id)` could yield `NaN`. Add validation: `if (isNaN(id)) return res.status(400)...` |
| No rate limiting | MEDIUM | All endpoints | No middleware to prevent abuse. Recommend `express-rate-limit`. |
| JSON response parsing from Gemini not defensive | LOW | `server/routes.ts:96` | `JSON.parse(jsonMatch[0])` could throw if Gemini returns malformed JSON. Currently caught by try/catch. |

### 2.3 Dependencies

| Package | Version | Status |
|---------|---------|--------|
| `express` | 5.0.1 | Current (v5 stable) |
| `@google/genai` | 1.40.0 | Current |
| `drizzle-orm` | 0.39.3 | Current |
| `pg` | 8.16.3 | Current |
| `expo` | 54.0.27 | Current |

**Status: PASS** — No deprecated or known-vulnerable packages.

### 2.4 CORS Policy

```typescript
// server/index.ts:16-53
// Allows: Replit dev domains + localhost origins (any port)
// Rejects: All other origins
```

**Finding:** CORS is properly restricted to Replit domains and localhost. For production on your own server, you must update this to include your actual domain.

---

## 3. Model Architecture Analysis

### 3.1 Current AI Approach: Remote Gemini API

The system does **NOT** run local inference. It makes **remote API calls** to Google's Gemini API:

```typescript
// server/routes.ts:12-19
const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});
```

- **Model used:** `gemini-2.5-flash` (multimodal — accepts text + images)
- **Authentication:** API key via environment variable
- **Base URL:** Configurable (currently Replit's proxy at `AI_INTEGRATIONS_GEMINI_BASE_URL`)
- **No local GPU/TPU required** — all inference happens on Google's servers

### 3.2 Stored PyTorch Models (.pth Files)

Five ConvNeXt Small models are stored in `server/models/`:

```
convnext_small_fold1_best.pth  (189 MB)
convnext_small_fold2_best.pth  (189 MB)
convnext_small_fold3_best.pth  (189 MB)
convnext_small_fold4_best.pth  (189 MB)
convnext_small_fold5_best.pth  (189 MB)
Total: ~945 MB
```

These are **5-fold cross-validation** checkpoints of a ConvNeXt Small model (from the `timm` library), originally trained in PyTorch/Python for classifying palm tree varieties.

**Current status:** Stored but **not actively used** by the Node.js backend. The system uses Gemini Vision instead for classification.

**Future integration path:** To use these models, you would need:
1. A Python inference server (Flask/FastAPI) with PyTorch and `timm`
2. Load all 5 folds, run inference on each, and ensemble the predictions
3. The Node.js backend would call this Python service instead of (or in addition to) Gemini

### 3.3 Why Gemini Instead of Local PyTorch

| Aspect | Gemini API | Local PyTorch |
|--------|-----------|---------------|
| Infrastructure | No GPU needed | Requires CUDA GPU (4+ GB VRAM) |
| Setup | API key only | Python, PyTorch, CUDA, timm |
| Latency | ~1-3s (network) | ~0.1-0.5s (GPU local) |
| Cost | Pay per request | Fixed GPU cost |
| Flexibility | Can describe what it sees, handle edge cases | Fixed 3-class classifier |
| Offline | No | Yes |

---

## 4. Gemini Integration Points (AOI)

### 4.1 Integration Point 1: Image Classification

**File:** `server/routes.ts`, lines 51-106
**Endpoint:** `POST /api/classify`
**AOI Location:** JSON request body

```json
{
  "base64": "<base64-encoded-image>",
  "mimeType": "image/jpeg",
  "lang": "ar"          // ← AOI: Language affects description output
}
```

**How the AOI affects behavior:**
- The `lang` field routes to a language-specific prompt suffix:
  - `"ar"` → `"Write the description in Arabic."`
  - `"en"` (default) → `"Write the description in English."`
- The Gemini prompt is a structured instruction requiring JSON output with `isPalm`, `class`, `confidence`, and `description` fields
- The system prompt constrains classification to exactly 3 varieties: Khalas, Razeez, Shishi

**Prompt template (lines 74-90):**
```
You are an expert agricultural botanist specializing in date palm identification.
Analyze this image and determine if it shows a date palm tree or dates fruit.

If it IS a date palm or dates, classify it as one of these varieties:
"Khalas", "Razeez", or "Shishi".

Respond ONLY with valid JSON in this exact format:
{
  "isPalm": true/false,
  "class": "Khalas" | "Razeez" | "Shishi" | "Unknown",
  "confidence": 0.0-1.0,
  "description": "Brief description..."
}
```

### 4.2 Integration Point 2: RAG Chat

**File:** `server/routes.ts`, lines 156-260
**Endpoint:** `POST /api/sessions/:id/chat`
**AOI Location:** JSON request body

```json
{
  "content": "How should I water this tree?",
  "lang": "ar"          // ← AOI: Routes to Arabic or English system prompt
}
```

**How the AOI affects behavior:**

1. **Language routing** — The `lang` parameter selects between two entirely different system prompts:
   - Arabic (`"ar"`): Full Arabic system instruction with Arabic guidelines
   - English (`"en"`): Full English system instruction

2. **RAG context injection** — The `treeClass` stored in the session determines which knowledge base documents are retrieved:
   - Session with `treeClass: "Khalas"` → retrieves Khalas-specific chunks
   - The user's question keywords determine which topic chunks are injected (irrigation, harvest, pests, soil, nutrition)

3. **Context flow:**
```
User Question → Keyword Match → Retrieve Chunks → Build System Prompt → Gemini Chat
                                                          ↑
                                                    lang parameter
                                                    (Arabic/English)
```

### 4.3 AOI Configuration Summary

| AOI Field | Location | Format | Values | Effect |
|-----------|----------|--------|--------|--------|
| `lang` | POST body | string | `"ar"`, `"en"` | Selects language for AI responses |
| `content` | POST body | string | Free text | User question for RAG retrieval |
| `treeClass` | Session DB | string | `"Khalas"`, `"Razeez"`, `"Shishi"`, `"Unknown"` | Determines which knowledge base to query |
| `mimeType` | POST body | string | `"image/jpeg"`, `"image/png"` | Tells Gemini the image format |

### 4.4 RAG Retrieval Logic

```typescript
// server/routes.ts:21-46 — retrieveContext()
// Keyword-based topic matching:
//   "water"/"irrigat" → irrigation chunks
//   "harvest"/"pick"/"ripe" → harvest chunks
//   "pest"/"bug"/"disease" → pest chunks
//   "soil"/"ground"/"plant" → soil chunks
//   "fertil"/"nutri"/"feed" → nutrition chunks
//   No match → general + irrigation chunks (fallback)
```

---

## 5. Project File Map

```
palm-classifier/
├── app.json                     # Expo config (app name مصنف النخيل, Android package)
├── package.json                 # Dependencies and scripts
├── tsconfig.json                # TypeScript config with path aliases
├── drizzle.config.ts            # Drizzle ORM config (PostgreSQL)
├── replit.md                    # Project documentation
│
├── app/                         # Expo Router screens (frontend)
│   ├── _layout.tsx              # Root layout (providers: Query, I18n, Keyboard)
│   ├── index.tsx                # Home screen (classify + sessions list)
│   └── chat/
│       └── [id].tsx             # Chat screen (SSE streaming, RTL support)
│
├── lib/
│   ├── i18n.tsx                 # Bilingual context (Arabic/English strings + RTL)
│   └── query-client.ts          # React Query client + API helpers
│
├── constants/
│   └── colors.ts                # Theme palette (forest green #1B4332 / cream #FAF3E0)
│
├── components/
│   └── ErrorBoundary.tsx        # React error boundary
│
├── shared/
│   └── schema.ts                # Drizzle schema (documents, chunks, sessions, messages)
│
├── server/
│   ├── index.ts                 # Express app entry (CORS, body parsing, logging)
│   ├── routes.ts                # All API endpoints (classify, chat, sessions, models)
│   ├── db.ts                    # PostgreSQL connection pool
│   ├── seed.ts                  # Knowledge base seeder (3 varieties × 6 topics)
│   ├── templates/
│   │   └── landing-page.html    # Landing page served at / for browsers
│   └── models/                  # PyTorch model storage
│       ├── convnext_small_fold1_best.pth
│       ├── convnext_small_fold2_best.pth
│       ├── convnext_small_fold3_best.pth
│       ├── convnext_small_fold4_best.pth
│       ├── convnext_small_fold5_best.pth
│       └── README.md
│
├── assets/images/               # App icons and splash screen
└── migrations/                  # Drizzle migration output
```

---

## 6. Database Schema

### Tables

```sql
-- Knowledge Base
CREATE TABLE documents (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  category    TEXT NOT NULL,           -- "Khalas", "Razeez", "Shishi"
  content_type TEXT NOT NULL DEFAULT 'text',
  metadata    JSONB,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE chunks (
  id          SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  topic       TEXT NOT NULL,           -- "irrigation", "harvest", "pests", "soil", "nutrition", "general"
  content     TEXT NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Chat System
CREATE TABLE chat_sessions (
  id          SERIAL PRIMARY KEY,
  tree_class  TEXT,                    -- Classification result
  image_data  TEXT,                    -- Reserved for image storage
  title       TEXT NOT NULL DEFAULT 'New Session',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE chat_messages (
  id          SERIAL PRIMARY KEY,
  session_id  INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,           -- "user" or "assistant"
  content     TEXT NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

### Knowledge Base Data (Seeded)

| Category | Topics (6 each) |
|----------|-----------------|
| Khalas   | irrigation, harvest, pests, soil, nutrition, general |
| Razeez   | irrigation, harvest, pests, soil, nutrition, general |
| Shishi   | irrigation, harvest, pests, soil, nutrition, general |

Total: 3 documents, 18 chunks.

---

## 7. API Reference

### POST /api/classify

Classifies a palm tree image using Gemini Vision.

```bash
curl -X POST http://localhost:5000/api/classify \
  -H "Content-Type: application/json" \
  -d '{
    "base64": "<base64-image-data>",
    "mimeType": "image/jpeg",
    "lang": "ar"
  }'
```

**Response:**
```json
{
  "isPalm": true,
  "class": "Khalas",
  "confidence": 0.85,
  "description": "تظهر الصورة نخلة تمر من نوع خلاص..."
}
```

### POST /api/sessions

Creates a new chat session.

```bash
curl -X POST http://localhost:5000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"treeClass": "Khalas", "title": "نخلة خلاص"}'
```

### GET /api/sessions

Lists all chat sessions (sorted by newest first).

### DELETE /api/sessions/:id

Deletes a session and all its messages.

### GET /api/sessions/:id/messages

Returns all messages for a session.

### POST /api/sessions/:id/chat

Sends a message and receives a streaming AI response via SSE.

```bash
curl -X POST http://localhost:5000/api/sessions/1/chat \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"content": "كم تحتاج النخلة من الماء؟", "lang": "ar"}'
```

**Response (SSE stream):**
```
data: {"content":"تحتاج نخلة "}
data: {"content":"الخلاص إلى "}
data: {"content":"ري معتدل..."}
data: [DONE]
```

### GET /api/models

Lists PyTorch model files stored in `server/models/`.

```json
{
  "directory": "/path/to/server/models",
  "models": [
    {
      "name": "convnext_small_fold1_best.pth",
      "size": 197960875,
      "sizeFormatted": "188.8 MB",
      "modified": "2026-02-11T18:47:00.000Z"
    }
  ]
}
```

### GET /api/knowledge-base

Returns all documents with their chunks.

---

## 8. RAG Pipeline Details

### Flow

```
1. User sends message → POST /api/sessions/:id/chat
2. Server looks up session → gets treeClass (e.g., "Khalas")
3. Server queries documents table → finds Khalas document
4. Server queries chunks table → gets all 6 topic chunks
5. retrieveContext() runs keyword matching:
   - User says "water" → returns irrigation chunk
   - User says "harvest" → returns harvest chunk
   - No keyword match → returns general + irrigation (fallback)
6. Matched chunks are injected into system prompt
7. Full chat history is loaded from chat_messages table
8. Gemini receives: system prompt + RAG context + chat history
9. Response streams back via SSE
10. Full response is saved to chat_messages table
```

### Prompt Construction

```
System Prompt = [
  Role description (agricultural advisor)
  + Tree identification context (what tree was classified)
  + RAG knowledge base context (matched chunks)
  + Response guidelines (language, tone, scope)
]
```

---

## 9. Deployment on a Private Server

### Prerequisites

- Linux server (Ubuntu 22.04 LTS recommended)
- Minimum: 2 vCPUs, 4 GB RAM, 20 GB SSD (no GPU needed — Gemini is remote)
- If using PyTorch models locally: 4+ vCPUs, 8+ GB RAM, NVIDIA GPU with 4+ GB VRAM
- A Google Gemini API key (get one at https://aistudio.google.com/apikey)
- A PostgreSQL database (local or managed like Neon, Supabase, or AWS RDS)
- A domain name (optional, for HTTPS)

### Step-by-Step Deployment

#### Step 1: Provision and Prepare the Server

```bash
# SSH into your server
ssh user@your-server-ip

# System updates
sudo apt update && sudo apt upgrade -y

# Install Node.js 20 (LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version   # Should show v20.x
npm --version    # Should show 10.x

# Install PostgreSQL (if running locally)
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

#### Step 2: Set Up PostgreSQL Database

```bash
# Create database and user
sudo -u postgres psql <<EOF
CREATE USER palmapp WITH PASSWORD 'your-secure-password';
CREATE DATABASE palm_classifier OWNER palmapp;
GRANT ALL PRIVILEGES ON DATABASE palm_classifier TO palmapp;
EOF
```

Your DATABASE_URL will be:
```
postgresql://palmapp:your-secure-password@localhost:5432/palm_classifier
```

#### Step 3: Clone and Configure the Project

```bash
# Clone your repository
git clone https://your-repo-url.git /opt/palm-classifier
cd /opt/palm-classifier

# Install dependencies
npm install

# Create environment file
cat > .env << 'EOF'
# Database
DATABASE_URL=postgresql://palmapp:your-secure-password@localhost:5432/palm_classifier

# Google Gemini API
GEMINI_API_KEY=your-gemini-api-key-here

# Server
PORT=5000
NODE_ENV=production

# Session
SESSION_SECRET=generate-a-random-string-here
EOF

# IMPORTANT: Ensure .env is in .gitignore
echo ".env" >> .gitignore
```

#### Step 4: Modify the Server for Direct Gemini API Access

On Replit, the Gemini API is accessed via a proxy (`AI_INTEGRATIONS_GEMINI_BASE_URL`). On your own server, you connect directly to Google's API.

Edit `server/routes.ts` — change the GoogleGenAI initialization:

```typescript
// BEFORE (Replit-specific):
const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

// AFTER (Direct Google API):
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});
```

Also update `server/index.ts` CORS to allow your domain:

```typescript
// Add your production domain to allowed origins
origins.add("https://yourdomain.com");
```

#### Step 5: Update the Frontend API URL

Edit `lib/query-client.ts` to use your server's domain:

```typescript
export function getApiUrl(): string {
  // For production on your own server:
  if (process.env.NODE_ENV === 'production') {
    return "https://yourdomain.com/";
  }
  // Development
  let host = process.env.EXPO_PUBLIC_DOMAIN;
  if (!host) throw new Error("EXPO_PUBLIC_DOMAIN is not set");
  return `https://${host}/`;
}
```

#### Step 6: Push Database Schema and Seed Data

```bash
cd /opt/palm-classifier

# Push the Drizzle schema to PostgreSQL
npx drizzle-kit push

# The knowledge base seeds automatically on first server start
```

#### Step 7: Build and Start the Server

```bash
# Build the server
npm run server:build

# Start in production mode
NODE_ENV=production node server_dist/index.js
```

#### Step 8: Set Up as a System Service

```bash
sudo cat > /etc/systemd/system/palm-classifier.service << 'EOF'
[Unit]
Description=Palm Classifier API Server
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/palm-classifier
EnvironmentFile=/opt/palm-classifier/.env
ExecStart=/usr/bin/node server_dist/index.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable palm-classifier
sudo systemctl start palm-classifier

# Check status
sudo systemctl status palm-classifier
sudo journalctl -u palm-classifier -f
```

#### Step 9: Set Up Nginx Reverse Proxy with HTTPS

```bash
sudo apt install -y nginx certbot python3-certbot-nginx

# Create Nginx config
sudo cat > /etc/nginx/sites-available/palm-classifier << 'EOF'
server {
    listen 80;
    server_name yourdomain.com;

    # Increase body size for base64 image uploads
    client_max_body_size 15M;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # SSE support (disable buffering for streaming)
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/palm-classifier /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Obtain SSL certificate
sudo certbot --nginx -d yourdomain.com
sudo systemctl restart nginx
```

#### Step 10: Build the Expo Mobile App

```bash
cd /opt/palm-classifier

# Set the API domain for the mobile app
export EXPO_PUBLIC_DOMAIN=yourdomain.com

# Build the static web version
npm run expo:static:build

# For Android APK (requires EAS or local Android SDK):
# npx eas build --platform android --profile preview
```

#### Step 11: Verify Everything Works

```bash
# Test the classify endpoint
curl -X POST https://yourdomain.com/api/classify \
  -H "Content-Type: application/json" \
  -d '{"base64":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==","mimeType":"image/png","lang":"en"}'

# Test the models endpoint
curl https://yourdomain.com/api/models

# Test the knowledge base
curl https://yourdomain.com/api/knowledge-base

# Test session creation
curl -X POST https://yourdomain.com/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"treeClass":"Khalas","title":"Test Session"}'

# Test chat (SSE streaming)
curl -N -X POST https://yourdomain.com/api/sessions/1/chat \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"content":"How do I water Khalas palms?","lang":"en"}'
```

---

## 10. Monitoring & Maintenance

### Log Monitoring

```bash
# View real-time logs
sudo journalctl -u palm-classifier -f

# View last 100 lines
sudo journalctl -u palm-classifier -n 100
```

### Database Backup

```bash
# Manual backup
pg_dump -U palmapp palm_classifier > backup_$(date +%Y%m%d).sql

# Automated daily backup (add to crontab)
crontab -e
# Add: 0 2 * * * pg_dump -U palmapp palm_classifier > /opt/backups/palm_$(date +\%Y\%m\%d).sql
```

### Security Hardening Checklist

- [ ] Run as non-root user (www-data in systemd)
- [ ] `.env` file has 600 permissions: `chmod 600 /opt/palm-classifier/.env`
- [ ] Firewall configured: `sudo ufw allow 80,443/tcp && sudo ufw enable`
- [ ] SSL certificate auto-renewal: `sudo certbot renew --dry-run`
- [ ] Rate limiting added to Express (install `express-rate-limit`)
- [ ] Input validation on chat content (max length)
- [ ] Regular dependency updates: `npm audit && npm update`

### Optional: Adding Rate Limiting

```bash
npm install express-rate-limit
```

```typescript
// Add to server/index.ts
import rateLimit from 'express-rate-limit';

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,                  // 100 requests per window
  message: { error: "Too many requests, please try again later" }
});

app.use('/api/', apiLimiter);
```

### Optional: Future PyTorch Integration

If you want to use the ConvNeXt models locally instead of Gemini Vision:

1. Create a Python inference server:

```python
# inference_server.py
from fastapi import FastAPI, File, UploadFile
import torch
from timm import create_model
from PIL import Image
import io, json

app = FastAPI()
CLASSES = ["Khalas", "Razeez", "Shishi"]
models = []

for i in range(1, 6):
    model = create_model('convnext_small', pretrained=False, num_classes=3)
    model.load_state_dict(torch.load(f'server/models/convnext_small_fold{i}_best.pth', map_location='cpu'))
    model.eval()
    models.append(model)

@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    image = Image.open(io.BytesIO(await file.read())).convert('RGB')
    # Add preprocessing (resize, normalize, to tensor)
    # Run ensemble prediction across all 5 folds
    # Return { "class": "Khalas", "confidence": 0.92 }
```

2. Run alongside Node.js: `uvicorn inference_server:app --port 8001`
3. Update `server/routes.ts` to call `http://localhost:8001/predict` instead of Gemini for classification.

---

*Document generated for Palm Classifier v1.0.0 — February 2026*
