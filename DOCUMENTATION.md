# Palm Classifier - Comprehensive Technical Documentation

**Project:** مصنف النخيل (Palm Classifier)
**Version:** 1.0.0
**Date:** February 14, 2026

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Frontend Files](#2-frontend-files)
   - [app/_layout.tsx](#app_layouttsx)
   - [app/index.tsx](#appindextsx)
   - [app/chat/[id].tsx](#appchatidtsx)
3. [Shared Libraries](#3-shared-libraries)
   - [lib/i18n.tsx](#libi18ntsx)
   - [lib/theme.tsx](#libthemetsx)
   - [lib/query-client.ts](#libquery-clientts)
   - [constants/colors.ts](#constantscolorsts)
   - [components/ErrorBoundary.tsx](#componentserrorboundarytsx)
   - [components/ErrorFallback.tsx](#componentserrorfallbacktsx)
4. [Backend Files](#4-backend-files)
   - [backend/index.ts](#backendindexts)
   - [backend/routes.ts](#backendroutests)
   - [backend/db.ts](#backenddts)
   - [backend/storage.ts](#backendstoragets)
   - [backend/seed.ts](#backendseedts)
5. [Python Inference Server](#5-python-inference-server)
   - [backend/inference_server.py](#backendinference_serverpy)
6. [Database Schema](#6-database-schema)
   - [shared/schema.ts](#sharedschemats)
7. [Configuration Files](#7-configuration-files)
   - [app.json](#appjson)
   - [tsconfig.json](#tsconfigjson)
   - [drizzle.config.ts](#drizzleconfigts)
   - [pyproject.toml](#pyprojecttoml)
8. [Data Flow Diagrams](#8-data-flow-diagrams)
9. [Security Analysis](#9-security-analysis)
10. [Performance Considerations](#10-performance-considerations)
11. [Potential Improvements](#11-potential-improvements)

---

## 1. Architecture Overview

The Palm Classifier is a full-stack mobile application with three runtime layers:

```
┌──────────────────────────────────────────────────┐
│                   Client Layer                    │
│  Expo React Native (iOS/Android/Web)             │
│  Port 8081 (dev server)                          │
│  File-based routing via expo-router              │
└──────────────────┬───────────────────────────────┘
                   │ HTTPS / JSON / SSE
┌──────────────────▼───────────────────────────────┐
│              API Gateway Layer                    │
│  Express.js + TypeScript                         │
│  Port 5000 (0.0.0.0)                             │
│  CORS, body parsing, landing page, API routes    │
└──────┬───────────────────────────┬───────────────┘
       │ Drizzle ORM              │ HTTP (internal)
┌──────▼──────────┐    ┌─────────▼──────────────┐
│   PostgreSQL    │    │  Python Flask Server    │
│   (Neon)        │    │  Port 5001 (127.0.0.1)  │
│   Drizzle ORM   │    │  PyTorch ConvNeXt       │
│                 │    │  5-fold ensemble         │
└─────────────────┘    └─────────────────────────┘
                              │
                       ┌──────▼──────┐
                       │ Gemini AI   │
                       │ (fallback + │
                       │  RAG chat)  │
                       └─────────────┘
```

**Key Technologies:**
- **Frontend:** Expo SDK, React Native, expo-router, React Query, react-native-reanimated
- **Backend:** Express.js, TypeScript, Drizzle ORM, Google Gemini AI SDK
- **Inference:** Python 3.11, Flask, PyTorch, torchvision (ConvNeXt Small)
- **Database:** PostgreSQL (Neon-backed), managed via Drizzle ORM
- **Styling:** React Native StyleSheet, Inter font family (4 weights)
- **i18n:** Custom React Context (Arabic/English with RTL support)

---

## 2. Frontend Files

---

### `app/_layout.tsx`

**Role:** Root layout file for Expo Router. Defines the navigation stack, loads fonts, and wraps the entire app in the required provider hierarchy.

**Lines 1-12 — Imports:**

```typescript
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { StatusBar } from "expo-status-bar";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider, useTheme } from "@/lib/theme";
```

| Import | Purpose |
|--------|---------|
| `QueryClientProvider` | Provides React Query client to the component tree for server state management |
| `Stack` | Expo Router's stack navigator for screen transitions |
| `SplashScreen` | Controls the native splash screen visibility during font loading |
| `GestureHandlerRootView` | Required wrapper for react-native-gesture-handler to function |
| `KeyboardProvider` | Wraps app for react-native-keyboard-controller's keyboard-aware behavior |
| `ErrorBoundary` | Class component that catches rendering errors and shows a fallback UI |
| `queryClient` | Pre-configured singleton QueryClient instance |
| `useFonts` + Inter variants | Loads four Inter font weights asynchronously |
| `StatusBar` | Controls native status bar appearance (light/dark) |
| `I18nProvider` | Provides language context (Arabic/English) to all children |
| `ThemeProvider`, `useTheme` | Provides light/dark theme context |

**Line 14 — Splash Screen Prevention:**

```typescript
SplashScreen.preventAutoHideAsync();
```

Called at module scope (before any component renders). Prevents the native splash screen from auto-hiding so we can keep it visible until fonts are loaded. This avoids a flash of unstyled text.

**Lines 16-23 — `RootLayoutNav` Component:**

```typescript
function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false, headerBackTitle: "Back" }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="chat/[id]" options={{ animation: "slide_from_right" }} />
    </Stack>
  );
}
```

- Defines two routes: the home screen (`index`) and the dynamic chat screen (`chat/[id]`).
- `headerShown: false` — The app uses custom navigation headers, so the default Expo Router header is hidden.
- `animation: "slide_from_right"` — Chat screen slides in from the right for natural navigation feel.
- `headerBackTitle: "Back"` — Fallback for iOS system back button text (not visible since headers are hidden).

**Lines 25-28 — `ThemedStatusBar` Component:**

```typescript
function ThemedStatusBar() {
  const { isDark } = useTheme();
  return <StatusBar style={isDark ? "light" : "dark"} />;
}
```

A thin wrapper that reads the current theme and sets the status bar style accordingly. Must be inside `ThemeProvider` to access `useTheme()`.

**Lines 30-62 — `RootLayout` (Default Export):**

```typescript
export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView>
          <KeyboardProvider>
            <ThemeProvider>
              <I18nProvider>
                <ThemedStatusBar />
                <RootLayoutNav />
              </I18nProvider>
            </ThemeProvider>
          </KeyboardProvider>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
```

**Font Loading (lines 31-36):** Loads four Inter font weights. Returns a boolean `fontsLoaded` when complete.

**Splash Screen Hiding (lines 38-42):** Once fonts are ready, hides the splash screen. The `useEffect` dependency on `fontsLoaded` ensures this fires exactly once.

**Guard Clause (line 44):** Returns `null` (renders nothing) while fonts are loading. The splash screen covers this empty state.

**Provider Hierarchy (lines 46-61):**

```
ErrorBoundary          ← Catches unhandled rendering errors
  └─ QueryClientProvider ← React Query server state management
       └─ GestureHandlerRootView ← Required for gesture support
            └─ KeyboardProvider ← Keyboard-aware input handling
                 └─ ThemeProvider ← Light/dark theme context
                      └─ I18nProvider ← Arabic/English language context
                           ├─ ThemedStatusBar ← Dynamic status bar
                           └─ RootLayoutNav   ← Navigation stack
```

**Design Decisions:**
- `ErrorBoundary` is outermost so it catches errors from any provider.
- `QueryClientProvider` is second so all components can use React Query.
- `ThemeProvider` and `I18nProvider` are innermost because they only affect rendering.

---

### `app/index.tsx`

**Role:** Home screen. Displays the app header with dark mode/language toggles, a hero card with camera/gallery buttons for capturing palm tree photos, and a list of recent analysis sessions.

**Lines 1-21 — Imports:**

| Import | Source | Purpose |
|--------|--------|---------|
| `useState`, `useCallback` | `react` | Local state management and memoized callbacks |
| `StyleSheet`, `Text`, `View`, `Pressable`, `FlatList`, `Alert`, `ActivityIndicator`, `Platform` | `react-native` | Core RN UI primitives |
| `useSafeAreaInsets` | `react-native-safe-area-context` | Device-specific safe area insets (notch, Dynamic Island) |
| `Ionicons`, `MaterialCommunityIcons` | `@expo/vector-icons` | Icon libraries |
| `router`, `useFocusEffect` | `expo-router` | Navigation and screen focus lifecycle |
| `ImagePicker` | `expo-image-picker` | Camera and gallery access |
| `Haptics` | `expo-haptics` | Tactile feedback on button presses |
| `LinearGradient` | `expo-linear-gradient` | Gradient backgrounds for hero card |
| `getApiUrl` | `@/lib/query-client` | Backend API base URL resolver |
| `useI18n` | `@/lib/i18n` | Internationalization context hook |
| `useTheme` | `@/lib/theme` | Theme context hook |

**Lines 22-37 — Type Definitions:**

```typescript
interface Session {
  id: number;
  treeClass: string | null;
  title: string;
  createdAt: string;
}
```

Maps to the `chat_sessions` database table. Used for the recent analyses list.

```typescript
interface ClassificationResult {
  isPalm: boolean;
  class: string;
  confidence: number;
  description: string;
  source?: string;
  probabilities?: Record<string, number>;
  folds_used?: number;
}
```

Response shape from `POST /api/classify`. The `source` field distinguishes between ConvNeXt ensemble (`"convnext_ensemble"`) and Gemini Vision fallback (`"gemini_vision"`). `probabilities` contains per-class softmax scores. `folds_used` indicates how many model folds participated.

**Lines 39-49 — Static Lookup Tables:**

```typescript
const treeIcons: Record<string, string> = {
  Khalas: "leaf",
  Razeez: "flower-outline",
  Shishi: "nutrition",
};

const treeNamesAr: Record<string, string> = {
  Khalas: "خلاص",
  Razeez: "رزيز",
  Shishi: "شيشي",
};
```

`treeIcons` maps variety names to Ionicons icon names for session cards. `treeNamesAr` provides Arabic translations of variety names for RTL display.

**Lines 51-78 — Component State & Data Fetching:**

```typescript
export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { t, lang, isRTL, toggleLanguage } = useI18n();
  const { colors, isDark, toggleTheme } = useTheme();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isClassifying, setIsClassifying] = useState(false);
```

Three state variables:
- `sessions` — List of analysis sessions from the database
- `isLoading` — True while fetching sessions (shows loading spinner)
- `isClassifying` — True while an image is being classified (shows banner + disables buttons)

```typescript
  const fetchSessions = useCallback(async () => {
    try {
      const baseUrl = getApiUrl();
      const res = await fetch(`${baseUrl}api/sessions`);
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch (e) {
      console.error("Failed to fetch sessions:", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchSessions();
    }, [fetchSessions])
  );
```

`fetchSessions` is memoized with `useCallback` (empty deps — stable reference). Calls `GET /api/sessions` and populates state.

`useFocusEffect` is an Expo Router hook that fires every time this screen gains focus. This ensures the session list refreshes when returning from the chat screen (e.g., after a new classification).

**Lines 80-109 — Image Picking:**

```typescript
  const pickImage = async (source: "camera" | "gallery") => {
```

Handles both camera and gallery image capture:

1. **Camera path (lines 82-93):**
   - Requests camera permissions via `ImagePicker.requestCameraPermissionsAsync()`
   - Shows localized alert if denied
   - Launches camera with `quality: 0.8` and `base64: true` (returns base64-encoded image data)

2. **Gallery path (lines 94-103):**
   - Requests media library permissions
   - Launches image picker with same quality/base64 settings

3. **Result handling (lines 106-108):**
   - Checks `!result.canceled` and `result.assets[0]` exists
   - Passes the asset to `classifyImage()`

**Lines 111-187 — Image Classification:**

```typescript
  const classifyImage = async (asset: ImagePicker.ImagePickerAsset) => {
```

The core classification flow:

1. **Line 113:** Triggers medium haptic feedback to confirm action
2. **Lines 118-121:** Validates that base64 data exists on the asset
3. **Lines 123-126:** Extracts MIME type from filename extension (defaults to `image/jpeg`)
4. **Lines 128-136:** Sends `POST /api/classify` with `{ base64, mimeType, lang }`
5. **Lines 142-150:** Constructs session title:
   - If identified (`isPalm: true`): "خلاص نخلة (98%)" or "Khalas Palm (98%)"
   - If low confidence with ConvNeXt: Uses `t.unknownType` ("نوع غير معروف" / "Unknown Type")
   - Otherwise: Uses `t.unidentified` ("صورة غير محددة" / "Unidentified Image")
6. **Lines 152-163:** Creates a session via `POST /api/sessions`
7. **Lines 165:** Success haptic notification
8. **Lines 167-179:** Navigates to chat screen with all classification data as route params:
   - `id`, `treeClass`, `confidence`, `description`, `isPalm`, `source`, `imageBase64`, `imageMimeType`

**Error Handling (lines 180-186):** Shows error alert, triggers error haptic, and resets `isClassifying` in the `finally` block.

**Lines 189-233 — Session Management:**

- `deleteSession(id)` — Calls `DELETE /api/sessions/:id`, removes from state, light haptic
- `confirmDelete(id)` — On web, deletes directly. On mobile, shows native Alert with cancel/delete options
- `clearAllSessions()` — Iterates all sessions and deletes each one sequentially, then clears state
- `confirmClearAll()` — Same confirmation pattern as single delete

**Lines 235-239 — Display Helper:**

```typescript
  const getTreeDisplayName = (treeClass: string | null) => {
    if (!treeClass) return "";
    if (isRTL) return treeNamesAr[treeClass] || treeClass;
    return treeClass;
  };
```

Returns the localized tree variety name.

**Lines 241-270 — Session Card Renderer:**

```typescript
  const renderSession = ({ item }: { item: Session }) => {
```

Each session card displays:
- An icon in a colored circle (variety-specific or generic help icon)
- Title and timestamp (formatted with locale-aware `toLocaleDateString`)
- Chevron arrow (direction-aware for RTL)
- `onPress` — Navigates to chat with haptic
- `onLongPress` — Triggers delete confirmation

**Lines 272-367 — JSX Layout:**

The screen layout top-to-bottom:
1. **Header bar** — App title, subtitle, dark mode toggle, language toggle
2. **Hero card** — LinearGradient with palm tree icon, description text, Camera and Gallery buttons
3. **Classifying banner** — Animated banner with spinner (shown during classification)
4. **Sessions header** — "Recent Analyses" title with Clear All button
5. **Content area** — Loading spinner, empty state, or FlatList of session cards

**Lines 371-572 — StyleSheet:**

87 style rules organized by component area. Key patterns:
- `rowReverse` and `textRTL` styles applied conditionally for Arabic RTL layout
- `sessionCardPressed` — Press feedback with `opacity: 0.7` and `scale: 0.98`
- Web platform: 67px top inset for status bar, 34px bottom inset

---

### `app/chat/[id].tsx`

**Role:** Chat screen. Displays conversation history with the AI assistant, handles streaming SSE responses, and provides suggested questions for user guidance.

**Lines 1-23 — Imports:**

Notable imports:
- `fetch` from `expo/fetch` — Required for streaming `getReader()` support on all platforms (iOS/Android/Web)
- `KeyboardAvoidingView` from `react-native-keyboard-controller` — Better keyboard handling than the default RN component
- `Animated`, `FadeIn`, `FadeInDown` from `react-native-reanimated` — Enter animations for messages

**Lines 25-36 — Types & ID Generation:**

```typescript
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  image?: string;
}
```

Frontend-only message type. The `image` field stores a data URI for the classification image thumbnail.

```typescript
let messageCounter = 0;
function generateUniqueId(): string {
  messageCounter++;
  return `msg-${Date.now()}-${messageCounter}-${Math.random().toString(36).substr(2, 9)}`;
}
```

Generates unique IDs without the `uuid` package (which crashes on iOS/Android due to missing `crypto.getRandomValues()`). Uses a combination of timestamp, monotonic counter, and random string.

**Lines 44-56 — `TypingIndicator` Component:**

```typescript
function TypingIndicator({ colors }: { colors: ThemeColors }) {
```

Displays three animated dots (opacity: 0.3, 0.5, 0.7) inside an assistant bubble. Uses `FadeIn.duration(300)` for entrance animation. Shown while waiting for the first streaming chunk.

**Lines 58-79 — `MessageBubble` Component:**

```typescript
function MessageBubble({ message, isRTL, colors }: { ... }) {
```

Extracted as a separate component to avoid hooks-in-map violations with reanimated. Renders:
- **User messages:** Right-aligned, forest green background, white text, rounded corners with flat bottom-right
- **Assistant messages:** Left-aligned, white/dark surface background, with a small palm tree avatar, rounded corners with flat bottom-left
- **Images:** If `message.image` exists, renders a 240x180 thumbnail above the text

**Lines 81-269 — `ChatScreen` (Default Export):**

**State Variables (lines 105-111):**

| Variable | Type | Purpose |
|----------|------|---------|
| `messages` | `Message[]` | All conversation messages (local state, not React Query) |
| `inputText` | `string` | Current text input value |
| `isStreaming` | `boolean` | True while SSE response is streaming |
| `showTyping` | `boolean` | True between send and first chunk (shows typing dots) |
| `isLoadingHistory` | `boolean` | True while loading message history from database |
| `inputRef` | `RefObject<TextInput>` | Ref for focusing the input after send |
| `initializedRef` | `RefObject<boolean>` | Guards against double initialization in StrictMode |

**Suggested Questions (lines 113-126):**

Two sets of suggested questions depending on whether the tree was identified:
- **Identified (`isPalm: true`):** Water, harvest, pests, fertilizer questions (specific to the variety)
- **Unknown/general:** Care, water, soil, climate, varieties questions (general palm knowledge)

**History Loading (lines 138-185):**

```typescript
useEffect(() => {
  if (initializedRef.current) return;
  initializedRef.current = true;
  loadHistory();
}, []);
```

Uses a ref guard to prevent double-loading in React StrictMode. The `loadHistory` function:

1. Fetches messages from `GET /api/sessions/:id/messages`
2. If messages exist in DB: Populates state from database (restores previous conversation)
3. If no messages but `description` param exists: Generates a welcome message with:
   - Classification result (tree name, confidence percentage, source label)
   - Image thumbnail (if available)
   - Invitation to ask questions
4. Saves the welcome message to the database via `POST /api/sessions/:id/messages` (fire-and-forget)

**Streaming Chat Handler (lines 187-269):**

```typescript
const handleSend = useCallback(async (text?: string) => {
```

The most complex function in the frontend:

1. **Lines 188-189:** Validates non-empty text and not already streaming
2. **Line 191:** Light haptic feedback
3. **Lines 194-197:** Adds user message to state, enables streaming mode, shows typing indicator
4. **Lines 203-208:** Sends `POST /api/sessions/:id/chat` with `{ content, lang }` and `Accept: text/event-stream` header
5. **Lines 212-254:** Reads the SSE stream using `ReadableStream.getReader()`:
   - Accumulates chunks in a buffer
   - Splits by newlines and processes `data: ` prefixed lines
   - Ignores `[DONE]` sentinel
   - Parses each JSON chunk for `{ content: string }`
   - First chunk: Hides typing indicator and adds new assistant message
   - Subsequent chunks: Updates the last message in-place with accumulated content
   - Handles `{ error: string }` payloads by throwing
6. **Lines 256-268:** Error handling: Shows error message if no assistant content was added. `finally` block resets streaming state.

**Rendering (lines 275-383):**

Layout structure:
- **Nav bar:** Back button (with `canGoBack` fallback), centered title with identification badge, spacer
- **KeyboardAvoidingView:** Wraps the main content area
  - **Loading state:** Centered spinner
  - **Empty state:** Welcome screen with palm tree icon and suggested questions
  - **Chat state:** Inverted FlatList with:
    - `ListHeaderComponent` — Typing indicator (appears at bottom due to inversion)
    - `ListFooterComponent` — Suggested questions (appears at top due to inversion)
    - Messages rendered via `MessageBubble` component
- **Input container:** TextInput + send button with disabled state styling

**Back Button Logic (line 278):**

```typescript
router.canGoBack() ? router.back() : router.replace("/")
```

Handles the Expo Go preview edge case where deep-linking directly to a chat screen means there's no navigation history. Falls back to replacing with the home screen.

---

## 3. Shared Libraries

---

### `lib/i18n.tsx`

**Role:** Internationalization system. Provides a React Context for bilingual (Arabic/English) text strings with RTL layout support.

**Lines 1-3 — Imports:**
- `AsyncStorage` — Persists language preference across sessions
- `I18nManager` — Imported but not actively used (RTL is handled via style props instead of the global RN RTL manager, which avoids app restarts)

**Lines 5-8 — Constants:**

```typescript
export type Language = "ar" | "en";
const LANG_KEY = "palm_classifier_lang";
```

`Language` is a union type restricting values. `LANG_KEY` is the AsyncStorage key.

**Lines 9-108 — Translation Strings:**

Two complete translation objects (`ar` and `en`) with 43 string keys each covering:
- App chrome (title, subtitle, button labels)
- Permissions (camera, gallery access messages)
- Errors (classification failure, image read failure)
- Chat (placeholder, welcome, suggested questions)
- Session management (delete, clear all, confirmations)

The `language` key is intentionally cross-lingual: Arabic mode shows `"English"` (so English speakers can switch) and English mode shows `"العربية"` (so Arabic speakers can switch).

**Lines 110-151 — Context Provider:**

```typescript
interface I18nContextValue {
  lang: Language;
  t: (typeof strings)["en"];
  isRTL: boolean;
  toggleLanguage: () => void;
}
```

- `t` is typed as the English string object shape, ensuring autocomplete for all translation keys
- `isRTL` is derived: `lang === "ar"` — used throughout the app to flip layouts

```typescript
export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Language>("ar");
```

Default language is Arabic as specified in user preferences.

```typescript
  useEffect(() => {
    AsyncStorage.getItem(LANG_KEY).then((saved) => {
      if (saved === "en" || saved === "ar") setLang(saved);
    });
  }, []);
```

On mount, reads the persisted language preference. The type guard (`saved === "en" || saved === "ar"`) prevents invalid values from corrupting state.

```typescript
  const toggleLanguage = () => {
    const next = lang === "ar" ? "en" : "ar";
    setLang(next);
    AsyncStorage.setItem(LANG_KEY, next);
  };
```

Toggles between Arabic and English, persisting immediately.

```typescript
  const value = useMemo(
    () => ({ lang, t: strings[lang], isRTL: lang === "ar", toggleLanguage }),
    [lang]
  );
```

Memoized context value to prevent unnecessary re-renders. Only recalculates when `lang` changes.

**`useI18n` Hook (lines 147-151):** Standard context consumer with a guard throw if used outside the provider.

---

### `lib/theme.tsx`

**Role:** Dark/light theme system with system preference detection and user override persistence.

**Lines 1-4 — Imports:**
- `AsyncStorage` — Persists user's theme choice
- `useColorScheme` — Detects system dark/light preference
- `Colors`, `ThemeColors` — Color palette definitions

**Lines 6-8 — Constants:**

```typescript
export type Theme = "light" | "dark";
const THEME_KEY = "palm_classifier_theme";
```

**Lines 10-15 — Context Interface:**

```typescript
interface ThemeContextValue {
  theme: Theme;
  colors: ThemeColors;
  isDark: boolean;
  toggleTheme: () => void;
}
```

**Lines 19-48 — `ThemeProvider`:**

```typescript
const systemScheme = useColorScheme();
const [userTheme, setUserTheme] = useState<Theme | null>(null);
```

`userTheme` is `null` by default, meaning "follow system preference."

```typescript
const theme: Theme = userTheme || (systemScheme === "dark" ? "dark" : "light");
```

Resolution order:
1. User's explicit choice (if they've toggled)
2. System preference
3. Fallback to "light"

```typescript
const toggleTheme = () => {
  const next = theme === "dark" ? "light" : "dark";
  setUserTheme(next);
  AsyncStorage.setItem(THEME_KEY, next);
};
```

Once toggled, the user's choice overrides system preference permanently (until toggled again).

---

### `lib/query-client.ts`

**Role:** Centralized API communication layer. Configures React Query's global QueryClient and provides helper functions for API requests.

**Line 1 — Import:**

```typescript
import { fetch } from "expo/fetch";
```

Uses Expo's polyfilled `fetch` which supports streaming `ReadableStream.getReader()` on all platforms.

**Lines 8-18 — `getApiUrl()`:**

```typescript
export function getApiUrl(): string {
  let host = process.env.EXPO_PUBLIC_DOMAIN;
  if (!host) {
    throw new Error("EXPO_PUBLIC_DOMAIN is not set");
  }
  let url = new URL(`https://${host}`);
  return url.href;
}
```

Constructs the API base URL from the environment variable `EXPO_PUBLIC_DOMAIN`. This variable is injected by the Expo build system and differs between development, preview, and production. The function always returns an HTTPS URL with a trailing slash.

**Throws** if the environment variable is missing — this is a hard requirement.

**Lines 20-25 — `throwIfResNotOk()`:**

```typescript
async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}
```

Utility that reads the response body for error details before throwing. Used by both `apiRequest` and `getQueryFn`.

**Lines 27-44 — `apiRequest()`:**

```typescript
export async function apiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
): Promise<Response> {
```

General-purpose API request function for mutations (POST, PUT, DELETE). Features:
- Auto-constructs full URL from route
- Sets `Content-Type: application/json` when data is provided
- Includes credentials (cookies) for session support
- Throws on non-2xx responses

**Lines 46-65 — `getQueryFn()`:**

```typescript
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> = ...
```

A factory function that creates React Query query functions. Supports two 401 behaviors:
- `"returnNull"` — Returns `null` on 401 (useful for optional auth checks)
- `"throw"` — Throws on 401 (forces error boundary)

Joins query key segments into a URL path (e.g., `['/api/sessions', id]` → `/api/sessions/123`).

**Lines 67-80 — `queryClient`:**

```typescript
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
```

Global defaults:
- `staleTime: Infinity` — Data never goes stale automatically (manual invalidation only)
- `refetchOnWindowFocus: false` — Prevents re-fetching when app returns to foreground
- `retry: false` — No automatic retry on failure (avoids hammering the server)

---

### `constants/colors.ts`

**Role:** Defines the complete color system for both light and dark themes.

**Lines 1-23 — Palette:**

```typescript
const palette = {
  forest: "#1B4332",       // Primary dark green
  forestLight: "#2D6A4F",  // Lighter green variant
  sage: "#52B788",         // Medium green accent
  mint: "#95D5B2",         // Light green accent
  sand: "#F5E6CC",         // Warm tan
  sandDark: "#D4A574",     // Darker tan
  cream: "#FAF3E0",        // Light background
  white: "#FFFFFF",
  black: "#0A0A0A",        // Near-black (not pure black for softer contrast)
  gray100-900: ...,        // Gray scale
  error: "#FF3B30",        // iOS red
  success: "#34C759",      // iOS green
  darkBg: "#0D1B12",       // Dark mode background (deep forest)
  darkSurface: "#162419",  // Dark mode surface
  darkSurfaceSecondary: "#1E2E23",
  darkBorder: "#2A3D30",
};
```

Design philosophy: Earthy green/cream palette inspired by palm trees and Arabian desert aesthetics. Dark mode uses deep forest greens rather than pure grays.

**Lines 25-84 — Theme Colors:**

Each theme (light/dark) maps semantic names to palette values. Key differences:

| Semantic Key | Light | Dark |
|-------------|-------|------|
| `background` | cream (#FAF3E0) | deep forest (#0D1B12) |
| `surface` | white | dark forest (#162419) |
| `tint` | forest (#1B4332) | sage (#52B788) |
| `userBubble` | forest | forestLight |
| `assistantBubble` | white | darkSurfaceSecondary |
| `inputBackground` | white | darkSurface |

**Type Export:**

```typescript
export type ThemeColors = typeof Colors.light;
```

Infers the complete color type from the light theme object structure. Both themes share the same keys.

---

### `components/ErrorBoundary.tsx`

**Role:** React error boundary class component that catches unhandled rendering errors and displays a fallback UI.

This is a class component because React only provides error boundary functionality through lifecycle methods (`componentDidCatch` and `getDerivedStateFromError`), which are not available in functional components.

**Key Members:**

| Member | Type | Purpose |
|--------|------|---------|
| `state.error` | `Error \| null` | The caught error, or null if no error |
| `getDerivedStateFromError` | Static method | Updates state when a child throws |
| `componentDidCatch` | Lifecycle | Receives error + component stack, calls optional `onError` callback |
| `resetError` | Instance method | Clears the error state (used by "Try Again" button) |
| `FallbackComponent` | Prop | Defaults to `ErrorFallback` component |

---

### `components/ErrorFallback.tsx`

**Role:** The UI displayed when an unhandled error crashes the app.

**Key Features:**
- Themed (respects system light/dark mode via `useColorScheme`)
- Safe area aware (positions elements below notch/Dynamic Island)
- "Try Again" button calls `reloadAppAsync()` from Expo to fully restart the app
- In development (`__DEV__`): Shows an additional button that opens a modal with full error details and stack trace in monospace font
- Error details are selectable text for easy copy/paste during debugging

---

## 4. Backend Files

---

### `backend/index.ts`

**Role:** Express application entry point. Sets up middleware, spawns the Python inference server, and starts listening on port 5000.

**Lines 1-10 — Setup:**

Creates Express app, aliases `console.log` to `log` for brevity. Augments the `IncomingMessage` type with `rawBody` for potential webhook verification.

**Lines 17-54 — `setupCors()`:**

Custom CORS implementation:
1. Collects allowed origins from `REPLIT_DEV_DOMAIN` and `REPLIT_DOMAINS` environment variables
2. Checks the request's `Origin` header against the allowed set
3. Additionally allows any `localhost` or `127.0.0.1` origin (for Expo web development)
4. Sets standard CORS headers only for matching origins
5. Responds to preflight `OPTIONS` requests with 200

This is more secure than `cors: { origin: '*' }` because it explicitly whitelists origins.

**Lines 56-67 — `setupBodyParsing()`:**

```typescript
app.use(express.json({ limit: "10mb", verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false, limit: "10mb" }));
```

10MB limit accommodates base64-encoded images (~7.5MB raw image). The `verify` callback stores the raw buffer for potential signature verification.

**Lines 69-100 — `setupRequestLogging()`:**

Custom request logger that:
1. Captures start time
2. Monkey-patches `res.json` to capture response body
3. On `finish` event, logs method, path, status, duration, and truncated response (max 80 chars)
4. Only logs `/api` routes to avoid noise from static file serving

**Lines 102-207 — Expo & Landing Page Setup:**

- `getAppName()` — Reads `app.json` to get the Expo app name for the landing page
- `serveExpoManifest()` — Serves platform-specific manifest files for Expo Go (checks `expo-platform` header)
- `serveLandingPage()` — Renders the HTML template with dynamic URL placeholders replaced
- `configureExpoAndLanding()` — Middleware that routes:
  - Requests with `expo-platform: ios|android` header → manifest
  - `/` without expo-platform → landing page
  - Everything else → next middleware

**Lines 230-276 — Inference Server Management:**

```typescript
let inferenceProcess: ChildProcess | null = null;

function startInferenceServer() {
```

1. Checks for `inference_server.py` and model files existence
2. Spawns `python3 inference_server.py` as a child process with inherited environment + `INFERENCE_PORT`
3. Pipes stdout/stderr to the Node.js console with `[inference]` prefix
4. Handles process exit by clearing the reference

```typescript
function stopInferenceServer() {
  if (inferenceProcess) {
    inferenceProcess.kill("SIGTERM");
    inferenceProcess = null;
  }
}

process.on("SIGTERM", () => { stopInferenceServer(); process.exit(0); });
process.on("SIGINT", () => { stopInferenceServer(); process.exit(0); });
```

Graceful shutdown: when the Node process receives SIGTERM/SIGINT, it kills the Python process first.

**Lines 278-302 — Application Bootstrap:**

```typescript
(async () => {
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);
  configureExpoAndLanding(app);
  startInferenceServer();
  const server = await registerRoutes(app);
  setupErrorHandler(app);
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen({ port, host: "0.0.0.0", reusePort: true }, () => {
    log(`express server serving on port ${port}`);
  });
})();
```

Execution order matters:
1. CORS → Must be first to handle preflight requests
2. Body parsing → Must precede route handlers
3. Request logging → Captures all subsequent requests
4. Landing page/Expo → Catches `/` before API routes
5. Inference server → Starts loading models in background
6. Route registration → Registers all `/api/*` endpoints (also seeds knowledge base)
7. Error handler → Must be last (Express 4-arg error middleware)

---

### `backend/routes.ts`

**Role:** Defines all REST API endpoints. Contains the classification pipeline, RAG-powered chat system, and CRUD operations for sessions/messages.

**Lines 1-23 — Setup & AI Configuration:**

```typescript
const MODELS_DIR = path.join(process.cwd(), "backend", "models");
const INFERENCE_URL = `http://127.0.0.1:${process.env.INFERENCE_PORT || 5001}`;
```

The inference server always runs on localhost only (not exposed externally).

```typescript
const geminiApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const geminiBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;

const aiConfig: ConstructorParameters<typeof GoogleGenAI>[0] = {
  apiKey: geminiApiKey,
};
if (geminiBaseUrl) {
  aiConfig.httpOptions = { apiVersion: "", baseUrl: geminiBaseUrl };
}
const ai = new GoogleGenAI(aiConfig);
```

Supports both Replit AI Integrations (preferred, uses `AI_INTEGRATIONS_GEMINI_*` env vars) and direct Gemini API key. When using Replit's integration, a custom base URL is provided that handles key rotation and proxying.

**Lines 25-50 — `retrieveContext()`:**

```typescript
function retrieveContext(allChunks: { topic: string; content: string }[], query: string): string {
```

A simple keyword-based RAG retrieval system:

| Query Keywords | Matched Topic |
|---------------|---------------|
| water, irrigat | irrigation |
| harvest, pick, ripe | harvest |
| pest, bug, disease, insect | pests |
| soil, ground, plant | soil |
| fertil, nutri, feed | nutrition |

If no keywords match, returns `general` + `irrigation` chunks as fallback context. This is a lightweight alternative to vector similarity search.

**Lines 55-196 — `POST /api/classify`:**

The classification pipeline has three paths:

**Path 1: ConvNeXt High Confidence (lines 84-135)**
- Confidence >= 96% (`0.96`)
- Requests Gemini to write a 2-3 sentence expert description of the image
- Falls back to hardcoded descriptions if Gemini fails
- Returns `source: "convnext_ensemble"`

**Path 2: ConvNeXt Low Confidence (lines 136-150)**
- Confidence < 96%
- Returns `class: "Unknown"`, `isPalm: false`
- Generic message: "Unknown type. Try taking a clearer photo..."
- Does NOT reveal the closest match or confidence percentage (privacy/accuracy measure)

**Path 3: Gemini Vision Fallback (lines 152-196)**
- When inference server is unavailable
- Sends image to Gemini with classification prompt
- Expects JSON response with same shape as ConvNeXt result
- Returns `source: "gemini_vision"`

**Lines 198-256 — Session & Message CRUD:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sessions` | GET | List all sessions, newest first |
| `/api/sessions` | POST | Create session with treeClass, title, imageData |
| `/api/sessions/:id` | DELETE | Delete session and all its messages (cascade) |
| `/api/sessions/:id/messages` | GET | Get all messages for a session, ordered by creation time |
| `/api/sessions/:id/messages` | POST | Save a single message (role + content) |

**Lines 258-372 — `POST /api/sessions/:id/chat` (Streaming RAG Chat):**

The most complex endpoint:

1. **Lines 260-267:** Validates session exists
2. **Line 269:** Saves user message to database
3. **Lines 271-278:** RAG retrieval — loads document chunks for the session's tree class, runs keyword matching
4. **Lines 280-285:** Loads full conversation history and maps roles (`assistant` → `model` for Gemini)
5. **Lines 287-333:** Constructs system prompt with:
   - Expert agricultural advisor persona
   - Tree class context
   - RAG knowledge base context (if available)
   - **Strict scope rule:** Only answers palm/agriculture questions. Off-topic queries get a polite refusal
   - Language-specific (full Arabic or English prompt)
6. **Lines 335-338:** Sets SSE headers (`Content-Type: text/event-stream`, `no-cache`, `X-Accel-Buffering: no`)
7. **Lines 340-357:** Streams Gemini response:
   - Uses `generateContentStream` with `gemini-2.5-flash` model
   - `temperature: 0.7` — Balanced creativity/consistency
   - `maxOutputTokens: 2048` — Generous but bounded response length
   - Streams each text chunk as `data: {"content": "..."}\n\n`
8. **Line 359:** Saves complete response to database
9. **Line 361:** Sends `data: [DONE]\n\n` sentinel
10. **Lines 363-371:** Error handling — sends error via SSE if headers already sent, otherwise 500 JSON

**Lines 374-413 — Utility Endpoints:**

- `GET /api/models` — Lists `.pth` model files with sizes and modification dates
- `GET /api/knowledge-base` — Returns all documents with their chunks (for debugging/inspection)

---

### `backend/db.ts`

**Role:** Database connection singleton.

```typescript
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool);
```

- Uses `pg.Pool` for connection pooling (reuses connections instead of creating new ones per query)
- `drizzle()` wraps the pool with the Drizzle ORM query builder
- Throws immediately if `DATABASE_URL` is not configured (fail-fast)

---

### `backend/storage.ts`

**Role:** In-memory user storage (template artifact). Defines a `MemStorage` class with Map-based user CRUD. Not actively used by the palm classifier — retained from the project template.

**Interface `IStorage`:** Defines `getUser`, `getUserByUsername`, `createUser` methods.

**Class `MemStorage`:** Implements IStorage with an in-memory Map. Uses `randomUUID()` for ID generation.

---

### `backend/seed.ts`

**Role:** Seeds the PostgreSQL knowledge base with expert agricultural data for the three palm varieties.

**Lines 5-42 — Knowledge Base Data:**

Three entries (Khalas, Razeez, Shishi), each with six topic-specific content chunks:

| Topic | Content Focus |
|-------|---------------|
| `irrigation` | Watering frequency, methods, seasonal adjustments |
| `harvest` | Timing, ripeness indicators, handling techniques |
| `pests` | Common pests, monitoring, treatment strategies |
| `soil` | Preferred soil types, pH ranges, amendments |
| `nutrition` | Fertilizer schedules, NPK ratios, micronutrients |
| `general` | Variety overview, characteristics, cultural significance |

**Lines 44-71 — `seedKnowledgeBase()`:**

```typescript
export async function seedKnowledgeBase() {
  const existingDocs = await db.select().from(documents);
  if (existingDocs.length > 0) {
    console.log("Knowledge base already seeded, skipping...");
    return;
  }
```

Idempotent seeding: only runs if the `documents` table is empty. For each knowledge base entry:
1. Creates a `documents` row with title, category, and metadata
2. Creates multiple `chunks` rows linked to the document via `documentId`

Called once during server startup from `registerRoutes()`.

---

## 5. Python Inference Server

---

### `backend/inference_server.py`

**Role:** Standalone Flask HTTP server that loads 5 ConvNeXt Small model folds and provides ensemble predictions via a REST API.

**Lines 1-11 — Imports:**

| Import | Purpose |
|--------|---------|
| `flask`, `flask_cors` | HTTP server with CORS support |
| `torch`, `torch.nn.functional` | PyTorch inference engine |
| `torchvision.models.convnext_small` | Pre-defined ConvNeXt Small architecture |
| `torchvision.transforms` | Image preprocessing pipeline |
| `PIL.Image` | Image loading and format conversion |
| `base64`, `io` | Decoding base64-encoded images |

**Lines 13-29 — Configuration:**

```python
CLASSES = ["Khalas", "Razeez", "Shishi"]
MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
NUM_FOLDS = 5

transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])
```

- 3 output classes (Khalas, Razeez, Shishi)
- 5-fold cross-validation ensemble
- ImageNet normalization (mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
- Input size: 224x224 (standard for ConvNeXt)

**Lines 32-41 — `remap_state_dict()`:**

```python
def remap_state_dict(state_dict):
    new_state = {}
    for k, v in state_dict.items():
        if k == "classifier.2.1.weight":
            new_state["classifier.2.weight"] = v
        elif k == "classifier.2.1.bias":
            new_state["classifier.2.bias"] = v
        else:
            new_state[k] = v
    return new_state
```

Remaps weight keys from timm format (used during training) to torchvision format (used for inference). The difference is in the classifier head structure:
- **timm:** `classifier.2.1.weight/bias` (Sequential with nested Linear)
- **torchvision:** `classifier.2.weight/bias` (flat Linear)

**Lines 44-62 — `load_models()`:**

Loads all 5 model folds at startup:
1. Constructs path: `backend/models/convnext_small_fold{1-5}_best.pth`
2. Creates a `convnext_small(num_classes=3)` architecture
3. Loads saved weights with `map_location="cpu"` (no GPU required)
4. `weights_only=False` — Allows loading the full checkpoint (not just tensor data)
5. Remaps keys via `remap_state_dict()`
6. Sets model to evaluation mode (`model.eval()`)
7. Appends to the global `models` list

Total memory: ~189MB per fold × 5 = ~945MB for all models.

**Lines 65-71 — Health Endpoint:**

```python
@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "models_loaded": len(models),
        "classes": CLASSES,
    })
```

Used by the Node.js backend to verify the inference server is ready.

**Lines 74-113 — Prediction Endpoint:**

```python
@app.route("/predict", methods=["POST"])
def predict():
```

1. **Validation:** Checks models are loaded (503 if not) and base64 data exists (400 if not)
2. **Image preprocessing (lines 84-90):**
   - Strips data URI prefix if present
   - Decodes base64 to bytes
   - Opens with PIL and converts to RGB
   - Applies the transform pipeline (resize → tensor → normalize)
   - Adds batch dimension with `unsqueeze(0)`
3. **Ensemble inference (lines 92-99):**
   - Iterates all loaded models
   - Runs forward pass in `torch.no_grad()` context (disables gradient computation — saves memory and time)
   - Applies softmax to get probabilities
   - Collects all probability tensors
4. **Averaging (lines 99-100):**
   - Stacks all probability tensors and averages across the fold dimension
   - Finds the class with highest average probability
5. **Response (lines 102-108):**
   - Returns predicted class name, confidence score, per-class probabilities (4 decimal places), and number of folds used

---

## 6. Database Schema

---

### `shared/schema.ts`

**Role:** Defines all database tables using Drizzle ORM's PostgreSQL schema builder. Generates Zod validation schemas and TypeScript types.

**Tables:**

#### `users` (template artifact, not actively used)

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `varchar` (PK) | Default: `gen_random_uuid()` |
| `username` | `text` | NOT NULL, UNIQUE |
| `password` | `text` | NOT NULL |

#### `documents`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `serial` (PK) | Auto-increment |
| `title` | `text` | NOT NULL |
| `category` | `text` | NOT NULL (e.g., "Khalas", "Razeez", "Shishi") |
| `contentType` | `text` | NOT NULL, default "text" |
| `metadata` | `jsonb` | Nullable (stores source info) |
| `createdAt` | `timestamp` | NOT NULL, default CURRENT_TIMESTAMP |

#### `chunks`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `serial` (PK) | Auto-increment |
| `documentId` | `integer` (FK) | NOT NULL, references documents.id, CASCADE DELETE |
| `topic` | `text` | NOT NULL (e.g., "irrigation", "harvest") |
| `content` | `text` | NOT NULL |
| `createdAt` | `timestamp` | NOT NULL, default CURRENT_TIMESTAMP |

#### `chat_sessions`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `serial` (PK) | Auto-increment |
| `treeClass` | `text` | Nullable (null for unidentified) |
| `imageData` | `text` | Nullable (not currently used — images passed via route params) |
| `title` | `text` | NOT NULL, default "New Session" |
| `createdAt` | `timestamp` | NOT NULL, default CURRENT_TIMESTAMP |

#### `chat_messages`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `serial` (PK) | Auto-increment |
| `sessionId` | `integer` (FK) | NOT NULL, references chat_sessions.id, CASCADE DELETE |
| `role` | `text` | NOT NULL ("user" or "assistant") |
| `content` | `text` | NOT NULL |
| `createdAt` | `timestamp` | NOT NULL, default CURRENT_TIMESTAMP |

**Generated Types:**

For each table, Drizzle generates:
- `InsertX` type — Used for creating new rows (omits auto-generated fields)
- `X` type — Used for reading rows (includes all fields)
- `insertXSchema` — Zod validation schema for insert operations

---

## 7. Configuration Files

---

### `app.json`

**Role:** Expo application configuration.

| Key | Value | Purpose |
|-----|-------|---------|
| `name` | "مصنف النخيل" | App display name (Arabic) |
| `slug` | "palm-classifier" | URL-friendly identifier |
| `version` | "1.0.0" | Semantic version |
| `orientation` | "portrait" | Locked to portrait mode |
| `scheme` | "palmclassifier" | Deep link URL scheme |
| `userInterfaceStyle` | "automatic" | Follows system light/dark |
| `newArchEnabled` | true | React Native New Architecture (Fabric + TurboModules) |

**Android-specific:**
- `package`: `com.palmclassifier.app`
- `adaptiveIcon`: Forest green (#1B4332) background with custom foreground/monochrome images
- `permissions`: CAMERA, READ/WRITE_EXTERNAL_STORAGE

**Plugins:**
- `expo-router` with origin `https://replit.com/`
- `expo-font` for custom font loading
- `expo-web-browser` for external link handling

**Experiments:**
- `typedRoutes: true` — Type-safe route parameters
- `reactCompiler: true` — React Compiler for automatic memoization

---

### `tsconfig.json`

Extends Expo's base TypeScript config. Adds:
- `strict: true` — Full TypeScript strict mode
- Path aliases: `@/*` → project root, `@shared/*` → shared directory

---

### `drizzle.config.ts`

Configures Drizzle Kit for database migrations:
- Output directory: `./migrations`
- Schema source: `./shared/schema.ts`
- Dialect: PostgreSQL
- Credentials: From `DATABASE_URL` environment variable

---

### `pyproject.toml`

Python dependency management:
- **Runtime dependencies:** flask, flask-cors, pillow, torch (>=2.10.0), torchvision
- **Python version:** >=3.11, <3.12
- **PyTorch index:** Uses CPU-only wheels from `https://download.pytorch.org/whl/cpu` (no GPU needed for inference)
- **uv.sources:** Extensive list of PyTorch-dependent packages mapped to the CPU index (auto-generated by the package manager)

---

## 8. Data Flow Diagrams

### Classification Flow

```
User taps Camera/Gallery
        │
        ▼
  ImagePicker returns base64 image
        │
        ▼
  POST /api/classify { base64, mimeType, lang }
        │
        ├─► Try inference server (127.0.0.1:5001/predict)
        │         │
        │         ├─ Success + confidence >= 96%
        │         │     │
        │         │     ▼
        │         │   Gemini generates description
        │         │     │
        │         │     ▼
        │         │   Return { isPalm: true, class, confidence, source: "convnext_ensemble" }
        │         │
        │         ├─ Success + confidence < 96%
        │         │     │
        │         │     ▼
        │         │   Return { isPalm: false, class: "Unknown", source: "convnext_ensemble" }
        │         │
        │         └─ Failure (server down)
        │               │
        │               ▼
        │             Fall through to Gemini Vision
        │
        └─► Gemini Vision (fallback)
                  │
                  ▼
            Return { class, confidence, source: "gemini_vision" }
```

### Chat Flow

```
User types message or taps suggested question
        │
        ▼
  POST /api/sessions/:id/chat { content, lang }
        │
        ├─► Save user message to DB
        │
        ├─► Load session tree class
        │
        ├─► RAG retrieval (keyword matching on knowledge base chunks)
        │
        ├─► Load full conversation history from DB
        │
        ├─► Construct system prompt (scope guardrails + RAG context)
        │
        ├─► Gemini generateContentStream()
        │         │
        │         ▼ (SSE stream)
        │    data: {"content": "chunk1"}
        │    data: {"content": "chunk2"}
        │    ...
        │    data: [DONE]
        │
        └─► Save complete response to DB
```

---

## 9. Security Analysis

### Strengths

1. **CORS Whitelist:** Only Replit domains and localhost are allowed — no wildcard `*`
2. **Input Validation:** Base64 presence check, session existence check, JSON parsing guards
3. **No Secret Exposure:** API keys read from environment variables, never hardcoded or logged
4. **AI Scope Guardrails:** System prompt strictly limits AI to palm/agriculture topics
5. **Internal-Only Inference:** Python server binds to `127.0.0.1` (not externally accessible)
6. **CASCADE DELETE:** Deleting a session automatically deletes all its messages
7. **Body Size Limit:** 10MB prevents oversized payloads

### Areas for Improvement

1. **No Authentication:** All endpoints are publicly accessible. Any user can read/delete any session
2. **No Rate Limiting:** Classification and chat endpoints have no throttling
3. **No Input Sanitization:** User chat messages are passed directly to Gemini without sanitization (prompt injection risk is mitigated by the scope guardrail but not eliminated)
4. **SQL Injection:** Mitigated by Drizzle ORM's parameterized queries, but no explicit validation on `req.params.id` beyond `parseInt()`

---

## 10. Performance Considerations

1. **Model Loading Time:** 5 ConvNeXt folds take 15-30 seconds to load on cold start. The Python server starts asynchronously so the Node.js server is ready while models load
2. **Memory Usage:** ~945MB for all 5 model folds. This is significant for resource-constrained environments
3. **Streaming Responses:** SSE streaming provides perceived performance — users see text appear word-by-word rather than waiting for the full response
4. **Database Connection Pooling:** `pg.Pool` reuses connections, avoiding the overhead of per-request connection setup
5. **React Query `staleTime: Infinity`:** Prevents unnecessary refetches but means data can become stale in multi-device scenarios
6. **Sequential Session Deletion:** `clearAllSessions` deletes sessions one at a time. Could be optimized with a batch DELETE endpoint

---

## 11. Potential Improvements

1. **Vector Embeddings for RAG:** Replace keyword matching with proper vector similarity search for more accurate context retrieval
2. **Image Storage:** Currently images are passed via route params (base64 in URL). A proper storage solution would reduce URL length and enable image persistence
3. **Authentication:** Add user authentication to scope sessions per user
4. **Batch Delete Endpoint:** Single endpoint to delete all sessions for a user
5. **Offline Support:** Cache knowledge base data on device for offline chat
6. **Model Quantization:** INT8 quantization could reduce model memory by ~4x with minimal accuracy loss
7. **WebSocket Chat:** Replace SSE with WebSocket for bidirectional real-time communication
8. **Confidence Calibration:** The 96% threshold could be dynamically adjusted based on validation data
