# مصنف النخيل (Palm Classifier)

## Overview
A bilingual (Arabic/English) mobile app for identifying date palm tree varieties (Khalas, Razeez, Shishi) using AI vision and providing expert agricultural advice via RAG-powered chat. Configured for Android.

## Architecture
- **Frontend**: Expo React Native with file-based routing (expo-router)
- **Backend**: Express.js with TypeScript on port 5000
- **Database**: PostgreSQL (Neon) with Drizzle ORM
- **AI**: Google Gemini via Replit AI Integrations (vision + chat)
- **Styling**: React Native StyleSheet with Inter font family
- **i18n**: Custom React context (lib/i18n.tsx) with Arabic/English toggle

## Key Features
- Bilingual Arabic/English interface with RTL support
- Camera/gallery image capture for palm tree photos
- AI-powered classification using Gemini Vision (gemini-2.5-flash)
- RAG chat system with PostgreSQL knowledge base
- Streaming AI responses via SSE (responds in user's selected language)
- Session-based conversation history
- Models directory for .pth files (server/models/)

## Project Structure
- `app/` - Expo Router screens (index.tsx, chat/[id].tsx)
- `app/_layout.tsx` - Root layout with I18nProvider, QueryClient, etc.
- `lib/i18n.tsx` - Bilingual strings and language context
- `server/` - Express backend with API routes
- `server/models/` - Directory for PyTorch .pth model files
- `server/db.ts` - Database connection
- `server/seed.ts` - Knowledge base seeder
- `server/routes.ts` - All API endpoints
- `shared/schema.ts` - Drizzle schema (documents, chunks, chat_sessions, chat_messages)
- `constants/colors.ts` - App theme (forest green #1B4332 / cream #FAF3E0 palette)

## API Endpoints
- POST /api/classify - Image classification via Gemini Vision (accepts lang param)
- GET/POST/DELETE /api/sessions - Chat session CRUD
- GET /api/sessions/:id/messages - Get session messages
- POST /api/sessions/:id/chat - Streaming RAG chat (accepts lang param for bilingual responses)
- GET /api/knowledge-base - Browse knowledge base
- GET /api/models - List .pth model files in server/models/

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
