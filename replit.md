# Palm Assistant

## Overview
A mobile app for identifying date palm tree varieties (Khalas, Razeez, Shishi) using AI vision and providing expert agricultural advice via RAG-powered chat.

## Architecture
- **Frontend**: Expo React Native with file-based routing (expo-router)
- **Backend**: Express.js with TypeScript on port 5000
- **Database**: PostgreSQL (Neon) with Drizzle ORM
- **AI**: Google Gemini via Replit AI Integrations (vision + chat)
- **Styling**: React Native StyleSheet with Inter font family

## Key Features
- Camera/gallery image capture for palm tree photos
- AI-powered classification using Gemini Vision (gemini-2.5-flash)
- RAG chat system with PostgreSQL knowledge base
- Streaming AI responses via SSE
- Session-based conversation history

## Project Structure
- `app/` - Expo Router screens (index.tsx, chat/[id].tsx)
- `server/` - Express backend with API routes
- `server/db.ts` - Database connection
- `server/seed.ts` - Knowledge base seeder
- `server/routes.ts` - All API endpoints
- `shared/schema.ts` - Drizzle schema (documents, chunks, chat_sessions, chat_messages)
- `constants/colors.ts` - App theme (forest green / cream palette)

## API Endpoints
- POST /api/classify - Image classification via Gemini Vision
- GET/POST/DELETE /api/sessions - Chat session CRUD
- GET /api/sessions/:id/messages - Get session messages
- POST /api/sessions/:id/chat - Streaming RAG chat
- GET /api/knowledge-base - Browse knowledge base

## Database Tables
- documents: Palm tree variety documents
- chunks: Knowledge base text chunks by topic
- chat_sessions: User chat sessions with tree classification
- chat_messages: Individual chat messages

## User Preferences
- Theme: Earthy green/cream palette
- Font: Inter (Google Fonts)
