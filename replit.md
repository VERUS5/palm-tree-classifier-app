# مصنف النخيل (Palm Classifier)

## Overview
A bilingual (Arabic/English) mobile app for identifying date palm tree varieties (Khalas, Razeez, Shishi) using local PyTorch ConvNeXt models for classification and Gemini AI for expert agricultural advice via RAG-powered chat. Configured for Android.

## Architecture
- **Frontend**: Expo React Native with file-based routing (expo-router) — files at project root (`app/`, `lib/`, `constants/`, `components/`)
- **Backend**: Express.js with TypeScript on port 5000 — files in `backend/`
- **Inference**: Python Flask server on port 5001 (spawned by Node.js backend)
- **Database**: PostgreSQL (Neon) with Drizzle ORM
- **AI Classification**: 5-fold ConvNeXt Small ensemble (PyTorch, torchvision) for palm variety classification
- **AI Chat**: Google Gemini via Replit AI Integrations (vision descriptions + RAG chat)
- **Styling**: React Native StyleSheet with Inter font family
- **i18n**: Custom React context (lib/i18n.tsx) with Arabic/English toggle

## Classification Pipeline
1. Image sent as base64 to `/api/classify`
2. Node.js backend forwards to Python inference server (`http://127.0.0.1:5001/predict`)
3. Python server runs 5-fold ConvNeXt Small ensemble with softmax averaging
4. If confidence >= 96%, uses ConvNeXt result + Gemini for description (identified)
5. If confidence < 96%, returns "Unknown" type with low-confidence explanation and suggested questions
6. If inference server unavailable, falls back to Gemini Vision
7. Response includes `source` field: "convnext_ensemble" or "gemini_vision"
8. Chat screen shows suggested questions after welcome message (general palm questions for Unknown, specific care questions for identified types)

## Key Features
- Bilingual Arabic/English interface with RTL support
- Camera/gallery image capture for palm tree photos
- Local AI classification using 5-fold ConvNeXt Small ensemble (~189MB per fold)
- Gemini Vision as fallback classifier + description generator
- RAG chat system with PostgreSQL knowledge base
- Streaming AI responses via SSE (responds in user's selected language)
- Session-based conversation history

## Project Structure

### Frontend (project root)
- `app/` - Expo Router screens (index.tsx, chat/[id].tsx)
- `app/_layout.tsx` - Root layout with I18nProvider, QueryClient, etc.
- `lib/i18n.tsx` - Bilingual strings and language context
- `lib/query-client.ts` - API client and React Query setup
- `constants/colors.ts` - App theme (forest green #1B4332 / cream #FAF3E0 palette)
- `components/` - Shared React Native components (ErrorBoundary, etc.)

### Backend (`backend/`)
- `backend/index.ts` - Express entry point (spawns Python inference server)
- `backend/routes.ts` - All API endpoints
- `backend/db.ts` - Database connection
- `backend/seed.ts` - Knowledge base seeder
- `backend/storage.ts` - Storage utilities
- `backend/inference_server.py` - Python Flask inference server (ConvNeXt ensemble)
- `backend/models/` - 5 ConvNeXt Small .pth model files (fold1-fold5)
- `backend/templates/` - Landing page HTML template

### Shared
- `shared/schema.ts` - Drizzle schema (documents, chunks, chat_sessions, chat_messages)
- `pyproject.toml` - Python dependencies (torch, torchvision, flask, pillow)

## API Endpoints
- POST /api/classify - Image classification via ConvNeXt ensemble + Gemini fallback (accepts lang param)
- GET/POST/DELETE /api/sessions - Chat session CRUD
- GET /api/sessions/:id/messages - Get session messages
- POST /api/sessions/:id/chat - Streaming RAG chat (accepts lang param for bilingual responses)
- GET /api/knowledge-base - Browse knowledge base
- GET /api/models - List .pth model files in backend/models/

## Python Inference Server (port 5001)
- GET /health - Returns model count and status
- POST /predict - Accepts { base64: string }, returns { class, confidence, probabilities, folds_used }
- Loads all 5 ConvNeXt Small folds on startup
- Key mapping: Remaps `classifier.2.1.*` keys to `classifier.2.*` (timm -> torchvision format)
- Input: 224x224 RGB images, ImageNet normalization
- Output: Softmax-averaged probabilities across all folds

## Database Tables
- documents: Palm tree variety documents
- chunks: Knowledge base text chunks by topic
- chat_sessions: User chat sessions with tree classification
- chat_messages: Individual chat messages

## Image Upload
- Uses base64 JSON (not FormData) for cross-platform compatibility
- Server body limit: 10MB
- Format: { base64: string, mimeType: string, lang?: string }

## Android Configuration
- Package: com.palmclassifier.app
- App name: مصنف النخيل
- Permissions: CAMERA, READ_EXTERNAL_STORAGE, WRITE_EXTERNAL_STORAGE
- Adaptive icon with forest green (#1B4332) background

## User Preferences
- Theme: Earthy green/cream palette
- Font: Inter (Google Fonts)
- Default language: Arabic
- Platform focus: Android
