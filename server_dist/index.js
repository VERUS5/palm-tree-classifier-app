// backend/index.ts
import express from "express";

// backend/routes.ts
import { createServer } from "node:http";
import { GoogleGenAI as GoogleGenAI2 } from "@google/genai";

// backend/db.ts
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}
var pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});
var db = drizzle(pool);
async function ensureTables() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        content_type TEXT NOT NULL DEFAULT 'text',
        metadata JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id SERIAL PRIMARY KEY,
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        topic TEXT NOT NULL,
        content TEXT NOT NULL,
        content_ar TEXT,
        keywords TEXT[],
        keywords_ar TEXT[],
        embedding real[],
        chunk_index INTEGER DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS chat_sessions (
        id SERIAL PRIMARY KEY,
        tree_class TEXT,
        image_data TEXT,
        title TEXT NOT NULL DEFAULT 'New Session',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      ALTER TABLE chunks ADD COLUMN IF NOT EXISTS embedding real[];
    `);
    console.log("Database tables verified/created successfully");
  } finally {
    client.release();
  }
}

// shared/schema.ts
import { sql } from "drizzle-orm";
import { pgTable, serial, text, varchar, integer, timestamp, jsonb, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
var users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull()
});
var insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true
});
var documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  contentType: text("content_type").notNull().default("text"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull()
});
var chunks = pgTable("chunks", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  topic: text("topic").notNull(),
  content: text("content").notNull(),
  contentAr: text("content_ar"),
  keywords: text("keywords").array(),
  keywordsAr: text("keywords_ar").array(),
  embedding: real("embedding").array(),
  chunkIndex: integer("chunk_index").default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull()
});
var chatSessions = pgTable("chat_sessions", {
  id: serial("id").primaryKey(),
  treeClass: text("tree_class"),
  imageData: text("image_data"),
  title: text("title").notNull().default("New Session"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull()
});
var chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => chatSessions.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull()
});
var insertDocumentSchema = createInsertSchema(documents).omit({ id: true, createdAt: true });
var insertChunkSchema = createInsertSchema(chunks).omit({ id: true, createdAt: true });
var insertChatSessionSchema = createInsertSchema(chatSessions).omit({ id: true, createdAt: true });
var insertChatMessageSchema = createInsertSchema(chatMessages).omit({ id: true, createdAt: true });

// backend/routes.ts
import { eq as eq3, desc } from "drizzle-orm";

// backend/seed.ts
import { eq as eq2, isNull } from "drizzle-orm";

// backend/rag-engine.ts
import { eq } from "drizzle-orm";
import { GoogleGenAI } from "@google/genai";
var geminiApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
var geminiBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
var aiConfig = {
  apiKey: geminiApiKey
};
if (geminiBaseUrl) {
  aiConfig.httpOptions = { apiVersion: "", baseUrl: geminiBaseUrl };
}
var ai = new GoogleGenAI(aiConfig);
async function generateEmbedding(text2) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set \u2014 embeddings require a direct Google API key");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`;
  const body = {
    content: { parts: [{ text: text2 }] }
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText);
  }
  const data = await res.json();
  const values = data.embedding?.values;
  if (!values || values.length === 0) {
    throw new Error("Empty embedding returned from Gemini");
  }
  return values;
}
function cosineSimilarity(a, b) {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
var STOPWORDS = /* @__PURE__ */ new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "shall",
  "can",
  "need",
  "dare",
  "ought",
  "used",
  "to",
  "of",
  "in",
  "for",
  "on",
  "with",
  "at",
  "by",
  "from",
  "as",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "between",
  "out",
  "off",
  "over",
  "under",
  "again",
  "further",
  "then",
  "once",
  "here",
  "there",
  "when",
  "where",
  "why",
  "how",
  "all",
  "each",
  "every",
  "both",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "nor",
  "not",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  "just",
  "because",
  "but",
  "and",
  "or",
  "if",
  "while",
  "about",
  "what",
  "which",
  "who",
  "whom",
  "this",
  "that",
  "these",
  "those",
  "am",
  "it",
  "its",
  "my",
  "your",
  "his",
  "her",
  "our",
  "their",
  "i",
  "me",
  "we",
  "you",
  "he",
  "she",
  "they",
  "them",
  "up",
  "down"
]);
var ARABIC_STOPWORDS = /* @__PURE__ */ new Set([
  "\u0641\u064A",
  "\u0645\u0646",
  "\u0639\u0644\u0649",
  "\u0625\u0644\u0649",
  "\u0639\u0646",
  "\u0645\u0639",
  "\u0647\u0630\u0627",
  "\u0647\u0630\u0647",
  "\u0630\u0644\u0643",
  "\u062A\u0644\u0643",
  "\u0627\u0644\u062A\u064A",
  "\u0627\u0644\u0630\u064A",
  "\u0647\u0648",
  "\u0647\u064A",
  "\u0647\u0645",
  "\u0647\u0646",
  "\u0623\u0646\u0627",
  "\u0646\u062D\u0646",
  "\u0623\u0646\u062A",
  "\u0623\u0646\u062A\u0645",
  "\u0643\u0627\u0646",
  "\u0643\u0627\u0646\u062A",
  "\u064A\u0643\u0648\u0646",
  "\u062A\u0643\u0648\u0646",
  "\u0647\u0644",
  "\u0645\u0627",
  "\u0645\u0627\u0630\u0627",
  "\u0643\u064A\u0641",
  "\u0623\u064A\u0646",
  "\u0645\u062A\u0649",
  "\u0644\u0645\u0627\u0630\u0627",
  "\u0623\u0648",
  "\u0648",
  "\u062B\u0645",
  "\u0644\u0643\u0646",
  "\u0628\u0644",
  "\u062D\u062A\u0649",
  "\u0625\u0630\u0627",
  "\u0644\u0648",
  "\u0642\u062F",
  "\u0644\u0627",
  "\u0644\u0646",
  "\u0644\u0645",
  "\u0644\u064A\u0633",
  "\u0643\u0644",
  "\u0628\u0639\u0636",
  "\u0623\u064A",
  "\u063A\u064A\u0631",
  "\u0628\u064A\u0646",
  "\u0641\u0648\u0642",
  "\u062A\u062D\u062A",
  "\u0623\u0645\u0627\u0645",
  "\u062E\u0644\u0641",
  "\u0639\u0646\u062F",
  "\u0645\u0646\u0630",
  "\u062D\u0648\u0644",
  "\u0636\u062F",
  "\u0646\u062D\u0648",
  "\u0625\u0646",
  "\u0623\u0646"
]);
function tokenize(text2) {
  return text2.toLowerCase().replace(/[^\w\s\u0600-\u06FF]/g, " ").split(/\s+/).filter((t) => t.length > 1 && !STOPWORDS.has(t) && !ARABIC_STOPWORDS.has(t));
}
function stemSimple(word) {
  if (/[\u0600-\u06FF]/.test(word)) {
    return word.replace(/^(ال|و|ب|ك|ل|ف)/, "").replace(/(ة|ات|ون|ين|ان|ها|هم|هن|ي|نا)$/, "");
  }
  return word.replace(/ing$/, "").replace(/tion$/, "t").replace(/sion$/, "s").replace(/ness$/, "").replace(/ment$/, "").replace(/ful$/, "").replace(/ous$/, "").replace(/ive$/, "").replace(/able$/, "").replace(/ible$/, "").replace(/ly$/, "").replace(/er$/, "").replace(/est$/, "").replace(/ed$/, "").replace(/s$/, "");
}
function getTokens(text2) {
  return tokenize(text2).map(stemSimple);
}
var TOPIC_SYNONYMS = {
  irrigation: ["water", "irrigat", "drip", "flood", "moisture", "dry", "wet", "rain", "\u0631\u064A", "\u0645\u0627\u0621", "\u0633\u0642\u064A", "\u0631\u0637\u0648\u0628\u0629", "\u062C\u0641\u0627\u0641", "\u0645\u0637\u0631", "\u062A\u0646\u0642\u064A\u0637"],
  harvest: ["harvest", "pick", "ripe", "ripen", "collect", "yield", "fruit", "date", "rutab", "tamr", "bisar", "\u062D\u0635\u0627\u062F", "\u0642\u0637\u0641", "\u0646\u0636\u062C", "\u062B\u0645\u0631", "\u062A\u0645\u0631", "\u0631\u0637\u0628", "\u0628\u0633\u0631"],
  pests: ["pest", "bug", "insect", "disease", "fungus", "weevil", "moth", "mite", "worm", "beetle", "infect", "\u0622\u0641\u0629", "\u062D\u0634\u0631\u0629", "\u0645\u0631\u0636", "\u0641\u0637\u0631", "\u0633\u0648\u0633\u0629", "\u062F\u0648\u062F\u0629", "\u062E\u0646\u0641\u0633\u0627\u0621"],
  soil: ["soil", "ground", "earth", "clay", "sand", "loam", "drain", "ph", "salin", "compost", "mulch", "\u062A\u0631\u0628\u0629", "\u0623\u0631\u0636", "\u0631\u0645\u0644", "\u0637\u064A\u0646", "\u062A\u0635\u0631\u064A\u0641", "\u0645\u0644\u0648\u062D\u0629", "\u0633\u0645\u0627\u062F"],
  nutrition: ["fertil", "nutri", "npk", "nitrogen", "phosphor", "potassium", "feed", "mineral", "organic", "compost", "manure", "\u062A\u0633\u0645\u064A\u062F", "\u062A\u063A\u0630\u064A\u0629", "\u0646\u064A\u062A\u0631\u0648\u062C\u064A\u0646", "\u0641\u0648\u0633\u0641\u0648\u0631", "\u0628\u0648\u062A\u0627\u0633\u064A\u0648\u0645", "\u0639\u0636\u0648\u064A"],
  general: ["general", "info", "about", "what", "descri", "overview", "history", "origin", "type", "variet", "character", "\u0639\u0627\u0645", "\u0645\u0639\u0644\u0648\u0645\u0627\u062A", "\u0648\u0635\u0641", "\u0646\u0648\u0639", "\u0635\u0646\u0641", "\u062A\u0627\u0631\u064A\u062E"],
  climate: ["climat", "weather", "temperatur", "heat", "cold", "humid", "season", "summer", "winter", "frost", "\u0645\u0646\u0627\u062E", "\u062D\u0631\u0627\u0631\u0629", "\u0628\u0631\u062F", "\u0631\u0637\u0648\u0628\u0629", "\u0645\u0648\u0633\u0645", "\u0635\u064A\u0641", "\u0634\u062A\u0627\u0621"],
  propagation: ["propag", "plant", "seed", "offshoot", "sucker", "tissue", "cultur", "grow", "nursery", "\u0625\u0643\u062B\u0627\u0631", "\u0632\u0631\u0627\u0639\u0629", "\u0628\u0630\u0631\u0629", "\u0641\u0633\u064A\u0644\u0629", "\u0634\u062A\u0644\u0629", "\u0645\u0634\u062A\u0644"],
  pruning: ["prun", "trim", "cut", "frond", "leaf", "remov", "clean", "\u062A\u0642\u0644\u064A\u0645", "\u0642\u0635", "\u0633\u0639\u0641", "\u0648\u0631\u0642", "\u0625\u0632\u0627\u0644\u0629"],
  storage: ["stor", "preserv", "keep", "shelf", "freez", "dry", "pack", "process", "\u062A\u062E\u0632\u064A\u0646", "\u062D\u0641\u0638", "\u062A\u062C\u0641\u064A\u0641", "\u062A\u0639\u0628\u0626\u0629", "\u062A\u0635\u0646\u064A\u0639"],
  pollination: ["pollinat", "flower", "male", "female", "spathe", "bunch", "\u062A\u0644\u0642\u064A\u062D", "\u0632\u0647\u0631\u0629", "\u0637\u0644\u0639", "\u0639\u0630\u0642", "\u0634\u0645\u0631\u0627\u062E"],
  economics: ["price", "market", "sell", "export", "trade", "cost", "profit", "income", "\u0633\u0639\u0631", "\u0633\u0648\u0642", "\u0628\u064A\u0639", "\u062A\u0635\u062F\u064A\u0631", "\u062A\u062C\u0627\u0631\u0629", "\u0631\u0628\u062D"]
};
function computeBM25Score(queryTokens, docTokens, avgDocLen, totalDocs, docFreqs) {
  const k1 = 1.5;
  const b = 0.75;
  const docLen = docTokens.length;
  let score = 0;
  const termFreqs = /* @__PURE__ */ new Map();
  for (const token of docTokens) {
    termFreqs.set(token, (termFreqs.get(token) || 0) + 1);
  }
  for (const queryToken of queryTokens) {
    const tf = termFreqs.get(queryToken) || 0;
    if (tf === 0) continue;
    const df = docFreqs.get(queryToken) || 0;
    const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);
    const tfNorm = tf * (k1 + 1) / (tf + k1 * (1 - b + b * (docLen / avgDocLen)));
    score += idf * tfNorm;
  }
  return score;
}
function computeTopicBoost(queryTokens, topic) {
  const synonyms = TOPIC_SYNONYMS[topic.toLowerCase()] || [];
  let matchCount = 0;
  for (const token of queryTokens) {
    for (const syn of synonyms) {
      if (token.includes(syn) || syn.includes(token)) {
        matchCount++;
        break;
      }
    }
  }
  return matchCount > 0 ? 1.5 + matchCount * 0.3 : 0;
}
function computeKeywordBoost(queryTokens, keywords) {
  if (!keywords || keywords.length === 0) return 0;
  let matchCount = 0;
  for (const token of queryTokens) {
    for (const kw of keywords) {
      const kwStemmed = stemSimple(kw.toLowerCase());
      if (token === kwStemmed || token.includes(kwStemmed) || kwStemmed.includes(token)) {
        matchCount++;
        break;
      }
    }
  }
  return matchCount * 0.5;
}
async function retrieveRAGContext(query, category, lang = "en", topK = 5) {
  const allChunks = category ? await db.select({
    id: chunks.id,
    documentId: chunks.documentId,
    topic: chunks.topic,
    content: chunks.content,
    contentAr: chunks.contentAr,
    keywords: chunks.keywords,
    keywordsAr: chunks.keywordsAr,
    embedding: chunks.embedding,
    chunkIndex: chunks.chunkIndex,
    category: documents.category
  }).from(chunks).innerJoin(documents, eq(chunks.documentId, documents.id)).where(eq(documents.category, category)) : await db.select({
    id: chunks.id,
    documentId: chunks.documentId,
    topic: chunks.topic,
    content: chunks.content,
    contentAr: chunks.contentAr,
    keywords: chunks.keywords,
    keywordsAr: chunks.keywordsAr,
    embedding: chunks.embedding,
    chunkIndex: chunks.chunkIndex,
    category: documents.category
  }).from(chunks).innerJoin(documents, eq(chunks.documentId, documents.id));
  if (allChunks.length === 0) {
    return { context: "", sources: [], debugInfo: { totalChunks: 0, query } };
  }
  const queryTokens = getTokens(query);
  const allDocTokens = allChunks.map((chunk) => {
    const text2 = lang === "ar" && chunk.contentAr ? chunk.contentAr : chunk.content;
    return getTokens(text2);
  });
  const avgDocLen = allDocTokens.reduce((sum, t) => sum + t.length, 0) / allDocTokens.length;
  const docFreqs = /* @__PURE__ */ new Map();
  for (const docTokens of allDocTokens) {
    const uniqueTokens = new Set(docTokens);
    for (const token of uniqueTokens) {
      docFreqs.set(token, (docFreqs.get(token) || 0) + 1);
    }
  }
  const bm25Scores = allChunks.map((chunk, i) => {
    const bm25 = computeBM25Score(queryTokens, allDocTokens[i], avgDocLen, allChunks.length, docFreqs);
    const topicBoost = computeTopicBoost(queryTokens, chunk.topic);
    const kwSet = lang === "ar" ? chunk.keywordsAr : chunk.keywords;
    const keywordBoost = computeKeywordBoost(queryTokens, kwSet);
    return bm25 + topicBoost + keywordBoost;
  });
  const maxBM25 = Math.max(...bm25Scores, 1);
  let queryEmbedding = null;
  const hasEmbeddings = allChunks.some((c) => c.embedding && c.embedding.length > 0);
  if (hasEmbeddings) {
    try {
      queryEmbedding = await generateEmbedding(query);
    } catch (err) {
      console.warn("Failed to generate query embedding, using BM25 only:", err.message);
    }
  }
  const scored = allChunks.map((chunk, i) => {
    const bm25Norm = bm25Scores[i] / maxBM25;
    const kwSet = lang === "ar" ? chunk.keywordsAr : chunk.keywords;
    let hybridScore;
    if (queryEmbedding && chunk.embedding && chunk.embedding.length > 0) {
      const cosine = cosineSimilarity(queryEmbedding, chunk.embedding);
      hybridScore = 0.55 * bm25Norm + 0.45 * cosine;
    } else {
      hybridScore = bm25Norm;
    }
    return {
      id: chunk.id,
      documentId: chunk.documentId,
      topic: chunk.topic,
      content: chunk.content,
      contentAr: chunk.contentAr,
      keywords: kwSet,
      score: hybridScore,
      category: chunk.category
    };
  });
  scored.sort((a, b) => b.score - a.score);
  let topChunks = scored.slice(0, topK).filter((c) => c.score > 0);
  if (topChunks.length === 0) {
    topChunks = scored.filter((c) => c.topic === "general").slice(0, 2);
    if (topChunks.length === 0) {
      topChunks = scored.slice(0, 2);
    }
  }
  const contextParts = topChunks.map((c) => {
    const text2 = lang === "ar" && c.contentAr ? c.contentAr : c.content;
    return `[${c.category} - ${c.topic.toUpperCase()}] (relevance: ${c.score.toFixed(3)}):
${text2}`;
  });
  return {
    context: contextParts.join("\n\n---\n\n"),
    sources: topChunks,
    debugInfo: {
      totalChunks: allChunks.length,
      queryTokens,
      embeddingUsed: queryEmbedding !== null,
      topScores: topChunks.map((c) => ({ topic: c.topic, category: c.category, score: c.score.toFixed(3) })),
      category
    }
  };
}
async function retrieveWithQueryExpansion(query, category, lang = "en", topK = 5) {
  const directResult = await retrieveRAGContext(query, category, lang, topK);
  if (directResult.sources.length > 0 && directResult.sources[0].score > 3) {
    return directResult;
  }
  try {
    const expansionPrompt = `Given this question about date palm trees: "${query}"
Extract 5-8 key agricultural search terms (single words, in English) that would help find relevant information. Include related agricultural concepts.
Return ONLY a comma-separated list of words, nothing else.`;
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: expansionPrompt }] }],
      config: { maxOutputTokens: 100, temperature: 0.1 }
    });
    const expandedTerms = (response.text || "").split(",").map((t) => t.trim().toLowerCase()).filter((t) => t.length > 2);
    const expandedQuery = `${query} ${expandedTerms.join(" ")}`;
    const expandedResult = await retrieveRAGContext(expandedQuery, category, lang, topK);
    if (expandedResult.sources.length > 0 && expandedResult.sources[0].score > directResult.sources[0]?.score) {
      return {
        ...expandedResult,
        debugInfo: {
          ...expandedResult.debugInfo,
          queryExpansion: expandedTerms,
          originalScore: directResult.sources[0]?.score,
          expandedScore: expandedResult.sources[0].score
        }
      };
    }
  } catch (err) {
    console.warn("Query expansion failed, using direct retrieval:", err.message);
  }
  return directResult;
}
async function getAllKnowledgeBase() {
  const docs = await db.select().from(documents).orderBy(documents.category);
  const result = [];
  for (const doc of docs) {
    const docChunks = await db.select().from(chunks).where(eq(chunks.documentId, doc.id));
    result.push({ ...doc, chunks: docChunks });
  }
  return result;
}

// backend/seed.ts
var knowledgeBase = [
  {
    title: "Khalas Palm",
    category: "Khalas",
    chunks: [
      {
        topic: "general",
        content: "Khalas is one of the most popular premium date varieties in Saudi Arabia and the UAE, known for its golden color and caramel-like taste. The tree can grow up to 20 meters tall and live for over 100 years. It begins producing fruit 4-8 years after planting and reaches full production at 15 years. Khalas dates are medium-sized with a soft, moist texture when fresh. The variety is particularly prized in Al-Ahsa region of Saudi Arabia, which produces some of the finest Khalas dates in the world.",
        contentAr: "\u0627\u0644\u062E\u0644\u0627\u0635 \u0645\u0646 \u0623\u0634\u0647\u0631 \u0623\u0635\u0646\u0627\u0641 \u0627\u0644\u062A\u0645\u0648\u0631 \u0627\u0644\u0641\u0627\u062E\u0631\u0629 \u0641\u064A \u0627\u0644\u0633\u0639\u0648\u062F\u064A\u0629 \u0648\u0627\u0644\u0625\u0645\u0627\u0631\u0627\u062A\u060C \u0645\u0639\u0631\u0648\u0641 \u0628\u0644\u0648\u0646\u0647 \u0627\u0644\u0630\u0647\u0628\u064A \u0648\u0637\u0639\u0645\u0647 \u0627\u0644\u0634\u0628\u064A\u0647 \u0628\u0627\u0644\u0643\u0631\u0627\u0645\u064A\u0644. \u064A\u0645\u0643\u0646 \u0623\u0646 \u064A\u0635\u0644 \u0627\u0631\u062A\u0641\u0627\u0639 \u0627\u0644\u0646\u062E\u0644\u0629 \u0625\u0644\u0649 20 \u0645\u062A\u0631\u064B\u0627 \u0648\u062A\u0639\u064A\u0634 \u0623\u0643\u062B\u0631 \u0645\u0646 100 \u0639\u0627\u0645. \u062A\u0628\u062F\u0623 \u0628\u0627\u0644\u0625\u0646\u062A\u0627\u062C \u0628\u0639\u062F 4-8 \u0633\u0646\u0648\u0627\u062A \u0645\u0646 \u0627\u0644\u0632\u0631\u0627\u0639\u0629 \u0648\u062A\u0635\u0644 \u0644\u0623\u0642\u0635\u0649 \u0625\u0646\u062A\u0627\u062C \u0639\u0646\u062F 15 \u0633\u0646\u0629. \u062A\u0645\u0648\u0631 \u0627\u0644\u062E\u0644\u0627\u0635 \u0645\u062A\u0648\u0633\u0637\u0629 \u0627\u0644\u062D\u062C\u0645 \u0630\u0627\u062A \u0642\u0648\u0627\u0645 \u0637\u0631\u064A \u0648\u0631\u0637\u0628. \u064A\u062A\u0645\u064A\u0632 \u0635\u0646\u0641 \u0627\u0644\u062E\u0644\u0627\u0635 \u0628\u0634\u0643\u0644 \u062E\u0627\u0635 \u0641\u064A \u0645\u0646\u0637\u0642\u0629 \u0627\u0644\u0623\u062D\u0633\u0627\u0621 \u0628\u0627\u0644\u0645\u0645\u0644\u0643\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u0627\u0644\u0633\u0639\u0648\u062F\u064A\u0629 \u0627\u0644\u062A\u064A \u062A\u0646\u062A\u062C \u0623\u062C\u0648\u062F \u062A\u0645\u0648\u0631 \u0627\u0644\u062E\u0644\u0627\u0635 \u0641\u064A \u0627\u0644\u0639\u0627\u0644\u0645.",
        keywords: ["khalas", "premium", "golden", "caramel", "al-ahsa", "variety", "description", "overview"],
        keywordsAr: ["\u062E\u0644\u0627\u0635", "\u0641\u0627\u062E\u0631", "\u0630\u0647\u0628\u064A", "\u0643\u0631\u0627\u0645\u064A\u0644", "\u0627\u0644\u0623\u062D\u0633\u0627\u0621", "\u0635\u0646\u0641", "\u0648\u0635\u0641"]
      },
      {
        topic: "general",
        content: "Khalas dates undergo several ripening stages: Hababouk (immature green), Kimri (green and hard), Khalal (yellow/red and crunchy), Bisr (partially ripe), Rutab (soft and moist), and Tamr (fully dried). Each stage has distinct characteristics and culinary uses. The Khalal stage Khalas dates are particularly popular eaten fresh. At the Rutab stage, they develop their signature caramel flavor. Khalas trees are monoecious and require manual or assisted pollination for fruit production.",
        contentAr: "\u062A\u0645\u0631 \u062A\u0645\u0648\u0631 \u0627\u0644\u062E\u0644\u0627\u0635 \u0628\u0639\u062F\u0629 \u0645\u0631\u0627\u062D\u0644 \u0646\u0636\u062C: \u0627\u0644\u062D\u0628\u0627\u0628\u0648\u0643 (\u0623\u062E\u0636\u0631 \u063A\u064A\u0631 \u0646\u0627\u0636\u062C)\u060C \u0627\u0644\u0643\u0645\u0631\u064A (\u0623\u062E\u0636\u0631 \u0648\u0635\u0644\u0628)\u060C \u0627\u0644\u062E\u0644\u0627\u0644 (\u0623\u0635\u0641\u0631/\u0623\u062D\u0645\u0631 \u0648\u0645\u0642\u0631\u0645\u0634)\u060C \u0627\u0644\u0628\u0633\u0631 (\u0646\u0627\u0636\u062C \u062C\u0632\u0626\u064A\u064B\u0627)\u060C \u0627\u0644\u0631\u0637\u0628 (\u0637\u0631\u064A \u0648\u0631\u0637\u0628)\u060C \u0648\u0627\u0644\u062A\u0645\u0631 (\u0645\u062C\u0641\u0641 \u0628\u0627\u0644\u0643\u0627\u0645\u0644). \u0644\u0643\u0644 \u0645\u0631\u062D\u0644\u0629 \u062E\u0635\u0627\u0626\u0635 \u0648\u0627\u0633\u062A\u062E\u062F\u0627\u0645\u0627\u062A \u0637\u0647\u064A \u0645\u0645\u064A\u0632\u0629. \u062A\u0645\u0648\u0631 \u0627\u0644\u062E\u0644\u0627\u0635 \u0641\u064A \u0645\u0631\u062D\u0644\u0629 \u0627\u0644\u062E\u0644\u0627\u0644 \u062A\u0624\u0643\u0644 \u0637\u0627\u0632\u062C\u0629 \u0628\u0634\u0643\u0644 \u062E\u0627\u0635. \u0641\u064A \u0645\u0631\u062D\u0644\u0629 \u0627\u0644\u0631\u0637\u0628 \u062A\u0643\u062A\u0633\u0628 \u0646\u0643\u0647\u0629 \u0627\u0644\u0643\u0631\u0627\u0645\u064A\u0644 \u0627\u0644\u0645\u0645\u064A\u0632\u0629. \u0646\u062E\u064A\u0644 \u0627\u0644\u062E\u0644\u0627\u0635 \u0623\u062D\u0627\u062F\u064A \u0627\u0644\u0645\u0633\u0643\u0646 \u0648\u064A\u062A\u0637\u0644\u0628 \u062A\u0644\u0642\u064A\u062D\u064B\u0627 \u064A\u062F\u0648\u064A\u064B\u0627 \u0623\u0648 \u0645\u0633\u0627\u0639\u062F\u064B\u0627 \u0644\u0625\u0646\u062A\u0627\u062C \u0627\u0644\u062B\u0645\u0627\u0631.",
        keywords: ["ripening", "stages", "hababouk", "kimri", "khalal", "rutab", "tamr", "bisr", "pollination"],
        keywordsAr: ["\u0646\u0636\u062C", "\u0645\u0631\u0627\u062D\u0644", "\u062D\u0628\u0627\u0628\u0648\u0643", "\u0643\u0645\u0631\u064A", "\u062E\u0644\u0627\u0644", "\u0631\u0637\u0628", "\u062A\u0645\u0631", "\u0628\u0633\u0631", "\u062A\u0644\u0642\u064A\u062D"]
      },
      {
        topic: "irrigation",
        content: "Khalas palms require moderate irrigation. In summer, water 3-4 times a week with 150-200 liters per tree per session. In winter, once a week is sufficient with 80-100 liters. Avoid waterlogging as it can lead to root rot (Fusarium oxysporum). Drip irrigation systems work best for Khalas palms, delivering water directly to the root zone at 4-6 emitters per tree. Subsurface drip irrigation at 30-50cm depth is most efficient, reducing evaporation by 30-40%. Monitor soil moisture at 30cm and 60cm depths - irrigate when moisture drops below 50% field capacity.",
        contentAr: "\u062A\u062D\u062A\u0627\u062C \u0646\u062E\u064A\u0644 \u0627\u0644\u062E\u0644\u0627\u0635 \u0625\u0644\u0649 \u0631\u064A \u0645\u0639\u062A\u062F\u0644. \u0641\u064A \u0627\u0644\u0635\u064A\u0641\u060C \u0627\u0644\u0631\u064A 3-4 \u0645\u0631\u0627\u062A \u0623\u0633\u0628\u0648\u0639\u064A\u064B\u0627 \u0628\u0645\u0639\u062F\u0644 150-200 \u0644\u062A\u0631 \u0644\u0643\u0644 \u0646\u062E\u0644\u0629 \u0641\u064A \u0643\u0644 \u0631\u064A. \u0641\u064A \u0627\u0644\u0634\u062A\u0627\u0621 \u0645\u0631\u0629 \u0648\u0627\u062D\u062F\u0629 \u0623\u0633\u0628\u0648\u0639\u064A\u064B\u0627 \u0628\u0645\u0639\u062F\u0644 80-100 \u0644\u062A\u0631. \u062A\u062C\u0646\u0628 \u0627\u0644\u062A\u0634\u0628\u0639 \u0628\u0627\u0644\u0645\u0627\u0621 \u0644\u0623\u0646\u0647 \u064A\u0624\u062F\u064A \u0625\u0644\u0649 \u062A\u0639\u0641\u0646 \u0627\u0644\u062C\u0630\u0648\u0631 (\u0641\u064A\u0648\u0632\u0627\u0631\u064A\u0648\u0645). \u0646\u0638\u0627\u0645 \u0627\u0644\u0631\u064A \u0628\u0627\u0644\u062A\u0646\u0642\u064A\u0637 \u0647\u0648 \u0627\u0644\u0623\u0641\u0636\u0644 \u0644\u0646\u062E\u064A\u0644 \u0627\u0644\u062E\u0644\u0627\u0635\u060C \u062D\u064A\u062B \u064A\u0648\u0635\u0644 \u0627\u0644\u0645\u0627\u0621 \u0645\u0628\u0627\u0634\u0631\u0629 \u0644\u0645\u0646\u0637\u0642\u0629 \u0627\u0644\u062C\u0630\u0648\u0631 \u0639\u0628\u0631 4-6 \u0646\u0642\u0627\u0637\u0627\u062A \u0644\u0643\u0644 \u0646\u062E\u0644\u0629. \u0627\u0644\u0631\u064A \u0628\u0627\u0644\u062A\u0646\u0642\u064A\u0637 \u062A\u062D\u062A \u0627\u0644\u0633\u0637\u062D\u064A \u0639\u0644\u0649 \u0639\u0645\u0642 30-50 \u0633\u0645 \u0647\u0648 \u0627\u0644\u0623\u0643\u062B\u0631 \u0643\u0641\u0627\u0621\u0629 \u0648\u064A\u0642\u0644\u0644 \u0627\u0644\u062A\u0628\u062E\u0631 \u0628\u0646\u0633\u0628\u0629 30-40%. \u0631\u0627\u0642\u0628 \u0631\u0637\u0648\u0628\u0629 \u0627\u0644\u062A\u0631\u0628\u0629 \u0639\u0644\u0649 \u0639\u0645\u0642 30 \u0633\u0645 \u064860 \u0633\u0645 \u0648\u0623\u0631\u0648\u0650 \u0639\u0646\u062F\u0645\u0627 \u062A\u0646\u062E\u0641\u0636 \u0627\u0644\u0631\u0637\u0648\u0628\u0629 \u0639\u0646 50% \u0645\u0646 \u0627\u0644\u0633\u0639\u0629 \u0627\u0644\u062D\u0642\u0644\u064A\u0629.",
        keywords: ["irrigation", "water", "drip", "summer", "winter", "moisture", "emitter", "subsurface", "root", "waterlogging"],
        keywordsAr: ["\u0631\u064A", "\u0645\u0627\u0621", "\u062A\u0646\u0642\u064A\u0637", "\u0635\u064A\u0641", "\u0634\u062A\u0627\u0621", "\u0631\u0637\u0648\u0628\u0629", "\u062C\u0630\u0648\u0631", "\u062A\u0634\u0628\u0639"]
      },
      {
        topic: "harvest",
        content: "Harvest Khalas dates when they reach the 'Rutab' stage (half-ripe) for best texture, typically in late summer (August-September). The fruits should have a golden-amber color and soft, caramel-like consistency. Use sharp pruning shears to cut the entire bunch. Handle carefully to avoid bruising. Average yield is 70-120 kg per mature tree per season. For commercial harvesting, use hydraulic lifts for tall trees. Post-harvest, sort dates by size and quality - Grade A (>25mm diameter, uniform color), Grade B (20-25mm), Grade C (<20mm). Cool dates to 5\xB0C within 4 hours of harvest to preserve quality.",
        contentAr: "\u0627\u062D\u0635\u062F \u062A\u0645\u0648\u0631 \u0627\u0644\u062E\u0644\u0627\u0635 \u0639\u0646\u062F \u0648\u0635\u0648\u0644\u0647\u0627 \u0644\u0645\u0631\u062D\u0644\u0629 \u0627\u0644\u0631\u0637\u0628 (\u0646\u0635\u0641 \u0646\u0627\u0636\u062C) \u0644\u0644\u062D\u0635\u0648\u0644 \u0639\u0644\u0649 \u0623\u0641\u0636\u0644 \u0642\u0648\u0627\u0645\u060C \u0639\u0627\u062F\u0629 \u0641\u064A \u0623\u0648\u0627\u062E\u0631 \u0627\u0644\u0635\u064A\u0641 (\u0623\u063A\u0633\u0637\u0633-\u0633\u0628\u062A\u0645\u0628\u0631). \u064A\u062C\u0628 \u0623\u0646 \u064A\u0643\u0648\u0646 \u0644\u0648\u0646 \u0627\u0644\u062B\u0645\u0627\u0631 \u0630\u0647\u0628\u064A\u064B\u0627 \u0643\u0647\u0631\u0645\u0627\u0646\u064A\u064B\u0627 \u0645\u0639 \u0642\u0648\u0627\u0645 \u0637\u0631\u064A \u064A\u0634\u0628\u0647 \u0627\u0644\u0643\u0631\u0627\u0645\u064A\u0644. \u0627\u0633\u062A\u062E\u062F\u0645 \u0645\u0642\u0635 \u062A\u0642\u0644\u064A\u0645 \u062D\u0627\u062F \u0644\u0642\u0637\u0639 \u0627\u0644\u0639\u0630\u0642 \u0643\u0627\u0645\u0644\u0627\u064B. \u062A\u0639\u0627\u0645\u0644 \u0628\u062D\u0630\u0631 \u0644\u062A\u062C\u0646\u0628 \u0627\u0644\u0643\u062F\u0645\u0627\u062A. \u0645\u062A\u0648\u0633\u0637 \u0627\u0644\u0625\u0646\u062A\u0627\u062C 70-120 \u0643\u062C\u0645 \u0644\u0644\u0646\u062E\u0644\u0629 \u0627\u0644\u0646\u0627\u0636\u062C\u0629 \u0641\u064A \u0627\u0644\u0645\u0648\u0633\u0645. \u0644\u0644\u062D\u0635\u0627\u062F \u0627\u0644\u062A\u062C\u0627\u0631\u064A\u060C \u0627\u0633\u062A\u062E\u062F\u0645 \u0627\u0644\u0631\u0627\u0641\u0639\u0627\u062A \u0627\u0644\u0647\u064A\u062F\u0631\u0648\u0644\u064A\u0643\u064A\u0629 \u0644\u0644\u0646\u062E\u064A\u0644 \u0627\u0644\u0637\u0648\u064A\u0644. \u0628\u0639\u062F \u0627\u0644\u062D\u0635\u0627\u062F\u060C \u0635\u0646\u0641 \u0627\u0644\u062A\u0645\u0648\u0631 \u062D\u0633\u0628 \u0627\u0644\u062D\u062C\u0645 \u0648\u0627\u0644\u062C\u0648\u062F\u0629 - \u062F\u0631\u062C\u0629 \u0623 (\u0642\u0637\u0631 \u0623\u0643\u0628\u0631 \u0645\u0646 25 \u0645\u0645\u060C \u0644\u0648\u0646 \u0645\u0648\u062D\u062F)\u060C \u062F\u0631\u062C\u0629 \u0628 (20-25 \u0645\u0645)\u060C \u062F\u0631\u062C\u0629 \u062C (\u0623\u0642\u0644 \u0645\u0646 20 \u0645\u0645). \u0628\u0631\u0651\u062F \u0627\u0644\u062A\u0645\u0648\u0631 \u0625\u0644\u0649 5 \u062F\u0631\u062C\u0627\u062A \u0645\u0626\u0648\u064A\u0629 \u062E\u0644\u0627\u0644 4 \u0633\u0627\u0639\u0627\u062A \u0645\u0646 \u0627\u0644\u062D\u0635\u0627\u062F \u0644\u0644\u062D\u0641\u0627\u0638 \u0639\u0644\u0649 \u0627\u0644\u062C\u0648\u062F\u0629.",
        keywords: ["harvest", "rutab", "yield", "pruning", "grading", "quality", "cooling", "bunch", "production"],
        keywordsAr: ["\u062D\u0635\u0627\u062F", "\u0631\u0637\u0628", "\u0625\u0646\u062A\u0627\u062C", "\u062A\u0642\u0644\u064A\u0645", "\u062A\u0635\u0646\u064A\u0641", "\u062C\u0648\u062F\u0629", "\u062A\u0628\u0631\u064A\u062F", "\u0639\u0630\u0642"]
      },
      {
        topic: "pests",
        content: "Khalas palms are susceptible to Red Palm Weevil (Rhynchophorus ferrugineus), the most destructive palm pest globally. Regular monitoring is essential - look for entry holes, oozing sap, and wilting fronds. Use pheromone traps for early detection, placed every 500m in plantations. Inject infested trees with Imidacloprid at 0.5ml/L water through trunk holes. Other common pests: Dubas bug (Ommatissus lybicus) causes honeydew and sooty mold - treat with Spirotetramat; Lesser date moth (Batrachedra amydraula) attacks developing fruits - use mesh bunch covers. Integrated pest management combining biological controls (Beauveria bassiana fungus), cultural practices (sanitation, removal of infested material), and targeted pesticides is recommended.",
        contentAr: "\u0646\u062E\u064A\u0644 \u0627\u0644\u062E\u0644\u0627\u0635 \u0639\u0631\u0636\u0629 \u0644\u0633\u0648\u0633\u0629 \u0627\u0644\u0646\u062E\u064A\u0644 \u0627\u0644\u062D\u0645\u0631\u0627\u0621 (Rhynchophorus ferrugineus)\u060C \u0623\u062E\u0637\u0631 \u0622\u0641\u0627\u062A \u0627\u0644\u0646\u062E\u064A\u0644 \u0639\u0627\u0644\u0645\u064A\u064B\u0627. \u0627\u0644\u0645\u0631\u0627\u0642\u0628\u0629 \u0627\u0644\u0645\u0646\u062A\u0638\u0645\u0629 \u0636\u0631\u0648\u0631\u064A\u0629 - \u0627\u0628\u062D\u062B \u0639\u0646 \u062B\u0642\u0648\u0628 \u0627\u0644\u062F\u062E\u0648\u0644 \u0648\u0646\u0636\u062D \u0627\u0644\u0639\u0635\u0627\u0631\u0629 \u0648\u0630\u0628\u0648\u0644 \u0627\u0644\u0633\u0639\u0641. \u0627\u0633\u062A\u062E\u062F\u0645 \u0645\u0635\u0627\u0626\u062F \u0627\u0644\u0641\u064A\u0631\u0648\u0645\u0648\u0646\u0627\u062A \u0644\u0644\u0643\u0634\u0641 \u0627\u0644\u0645\u0628\u0643\u0631 \u0643\u0644 500\u0645 \u0641\u064A \u0627\u0644\u0645\u0632\u0627\u0631\u0639. \u062D\u0642\u0646 \u0627\u0644\u0623\u0634\u062C\u0627\u0631 \u0627\u0644\u0645\u0635\u0627\u0628\u0629 \u0628\u0627\u0644\u0625\u064A\u0645\u064A\u062F\u0627\u0643\u0644\u0648\u0628\u0631\u064A\u062F \u0628\u062A\u0631\u0643\u064A\u0632 0.5 \u0645\u0644/\u0644\u062A\u0631 \u0645\u0627\u0621 \u0639\u0628\u0631 \u062B\u0642\u0648\u0628 \u0627\u0644\u062C\u0630\u0639. \u0622\u0641\u0627\u062A \u0623\u062E\u0631\u0649 \u0634\u0627\u0626\u0639\u0629: \u062D\u0634\u0631\u0629 \u0627\u0644\u062F\u0648\u0628\u0627\u0633 (Ommatissus lybicus) \u062A\u0633\u0628\u0628 \u0627\u0644\u0646\u062F\u0648\u0629 \u0627\u0644\u0639\u0633\u0644\u064A\u0629 \u0648\u0627\u0644\u0639\u0641\u0646 \u0627\u0644\u0623\u0633\u0648\u062F - \u0639\u0627\u0644\u062C \u0628\u0627\u0644\u0633\u0628\u064A\u0631\u0648\u062A\u064A\u062A\u0631\u0627\u0645\u064A\u062A\u061B \u062F\u0648\u062F\u0629 \u0627\u0644\u062A\u0645\u0631 \u0627\u0644\u0635\u063A\u0631\u0649 (Batrachedra amydraula) \u062A\u0647\u0627\u062C\u0645 \u0627\u0644\u062B\u0645\u0627\u0631 \u0627\u0644\u0646\u0627\u0645\u064A\u0629 - \u0627\u0633\u062A\u062E\u062F\u0645 \u0623\u0643\u064A\u0627\u0633 \u0634\u0628\u0643\u064A\u0629 \u0644\u0644\u0639\u0630\u0648\u0642. \u064A\u064F\u0646\u0635\u062D \u0628\u0627\u0644\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u062A\u0643\u0627\u0645\u0644\u0629 \u0644\u0644\u0622\u0641\u0627\u062A \u0627\u0644\u062A\u064A \u062A\u062C\u0645\u0639 \u0628\u064A\u0646 \u0627\u0644\u0645\u0643\u0627\u0641\u062D\u0629 \u0627\u0644\u0628\u064A\u0648\u0644\u0648\u062C\u064A\u0629 (\u0641\u0637\u0631 \u0628\u0648\u0641\u064A\u0631\u064A\u0627 \u0628\u0627\u0633\u064A\u0627\u0646\u0627) \u0648\u0627\u0644\u0645\u0645\u0627\u0631\u0633\u0627\u062A \u0627\u0644\u0632\u0631\u0627\u0639\u064A\u0629 (\u0627\u0644\u0646\u0638\u0627\u0641\u0629 \u0648\u0625\u0632\u0627\u0644\u0629 \u0627\u0644\u0645\u0648\u0627\u062F \u0627\u0644\u0645\u0635\u0627\u0628\u0629) \u0648\u0627\u0644\u0645\u0628\u064A\u062F\u0627\u062A \u0627\u0644\u0645\u0648\u062C\u0647\u0629.",
        keywords: ["pest", "weevil", "dubas", "moth", "pheromone", "trap", "insecticide", "biological", "ipm", "integrated"],
        keywordsAr: ["\u0622\u0641\u0629", "\u0633\u0648\u0633\u0629", "\u062F\u0648\u0628\u0627\u0633", "\u062F\u0648\u062F\u0629", "\u0641\u064A\u0631\u0648\u0645\u0648\u0646", "\u0645\u0635\u064A\u062F\u0629", "\u0645\u0628\u064A\u062F", "\u0645\u0643\u0627\u0641\u062D\u0629", "\u0645\u062A\u0643\u0627\u0645\u0644\u0629"]
      },
      {
        topic: "soil",
        content: "Khalas palms thrive in well-drained sandy loam soils with a pH between 7.0-8.0. They are moderately salt-tolerant (up to 4 dS/m ECe). Adding organic compost (20-30 kg per tree annually) improves soil structure and nutrient availability. Mulching around the base (10cm thick, 1m radius) with palm frond pieces helps retain moisture and suppress weeds. Ideal soil composition: 60-70% sand, 15-25% silt, 10-15% clay. Perform soil analysis every 2 years to monitor nutrient levels and salinity. If soil EC exceeds 6 dS/m, apply gypsum at 2-4 tons/hectare to remediate. Planting depth should be 80-100cm with a basin diameter of 2m.",
        contentAr: "\u062A\u0632\u062F\u0647\u0631 \u0646\u062E\u064A\u0644 \u0627\u0644\u062E\u0644\u0627\u0635 \u0641\u064A \u0627\u0644\u062A\u0631\u0628\u0629 \u0627\u0644\u0631\u0645\u0644\u064A\u0629 \u0627\u0644\u0637\u0645\u064A\u064A\u0629 \u062C\u064A\u062F\u0629 \u0627\u0644\u062A\u0635\u0631\u064A\u0641 \u0645\u0639 \u062D\u0645\u0648\u0636\u0629 \u0628\u064A\u0646 7.0-8.0. \u062A\u062A\u062D\u0645\u0644 \u0627\u0644\u0645\u0644\u0648\u062D\u0629 \u0628\u0634\u0643\u0644 \u0645\u0639\u062A\u062F\u0644 (\u062D\u062A\u0649 4 \u062F\u064A\u0633\u064A\u0633\u0645\u0646\u0632/\u0645). \u0625\u0636\u0627\u0641\u0629 \u0633\u0645\u0627\u062F \u0639\u0636\u0648\u064A (20-30 \u0643\u062C\u0645 \u0644\u0643\u0644 \u0646\u062E\u0644\u0629 \u0633\u0646\u0648\u064A\u064B\u0627) \u064A\u062D\u0633\u0646 \u0628\u0646\u064A\u0629 \u0627\u0644\u062A\u0631\u0628\u0629 \u0648\u062A\u0648\u0641\u0631 \u0627\u0644\u0645\u063A\u0630\u064A\u0627\u062A. \u062A\u063A\u0637\u064A\u0629 \u0627\u0644\u062A\u0631\u0628\u0629 \u062D\u0648\u0644 \u0627\u0644\u0642\u0627\u0639\u062F\u0629 (\u0628\u0633\u0645\u0643 10 \u0633\u0645 \u0648\u0646\u0635\u0641 \u0642\u0637\u0631 1\u0645) \u0628\u0642\u0637\u0639 \u0633\u0639\u0641 \u0627\u0644\u0646\u062E\u064A\u0644 \u062A\u0633\u0627\u0639\u062F \u0641\u064A \u062D\u0641\u0638 \u0627\u0644\u0631\u0637\u0648\u0628\u0629 \u0648\u0645\u0646\u0639 \u0627\u0644\u0623\u0639\u0634\u0627\u0628. \u0627\u0644\u062A\u0631\u0643\u064A\u0628 \u0627\u0644\u0645\u062B\u0627\u0644\u064A \u0644\u0644\u062A\u0631\u0628\u0629: 60-70% \u0631\u0645\u0644\u060C 15-25% \u0637\u0645\u064A\u060C 10-15% \u0637\u064A\u0646. \u0623\u062C\u0631\u0650 \u062A\u062D\u0644\u064A\u0644 \u062A\u0631\u0628\u0629 \u0643\u0644 \u0633\u0646\u062A\u064A\u0646 \u0644\u0645\u0631\u0627\u0642\u0628\u0629 \u0645\u0633\u062A\u0648\u064A\u0627\u062A \u0627\u0644\u0645\u063A\u0630\u064A\u0627\u062A \u0648\u0627\u0644\u0645\u0644\u0648\u062D\u0629. \u0625\u0630\u0627 \u062A\u062C\u0627\u0648\u0632\u062A \u0627\u0644\u0645\u0648\u0635\u0644\u064A\u0629 \u0627\u0644\u0643\u0647\u0631\u0628\u0627\u0626\u064A\u0629 6 \u062F\u064A\u0633\u064A\u0633\u0645\u0646\u0632/\u0645\u060C \u0623\u0636\u0641 \u0627\u0644\u062C\u0628\u0633 \u0628\u0645\u0639\u062F\u0644 2-4 \u0637\u0646/\u0647\u0643\u062A\u0627\u0631. \u0639\u0645\u0642 \u0627\u0644\u0632\u0631\u0627\u0639\u0629 \u064A\u062C\u0628 \u0623\u0646 \u064A\u0643\u0648\u0646 80-100 \u0633\u0645 \u0645\u0639 \u0642\u0637\u0631 \u062D\u0648\u0636 2 \u0645\u062A\u0631.",
        keywords: ["soil", "sandy", "loam", "ph", "salinity", "compost", "mulch", "drainage", "gypsum", "planting"],
        keywordsAr: ["\u062A\u0631\u0628\u0629", "\u0631\u0645\u0644", "\u0637\u0645\u064A", "\u062D\u0645\u0648\u0636\u0629", "\u0645\u0644\u0648\u062D\u0629", "\u0633\u0645\u0627\u062F", "\u062A\u063A\u0637\u064A\u0629", "\u062A\u0635\u0631\u064A\u0641", "\u062C\u0628\u0633", "\u0632\u0631\u0627\u0639\u0629"]
      },
      {
        topic: "nutrition",
        content: "Apply NPK fertilizer (15-15-15) three times per year: early spring (March), mid-summer (June), and fall (October). Per mature tree per application: 2-3 kg NPK. Supplement with micronutrients including iron chelate (Fe-EDDHA, 50g/tree twice yearly), zinc sulfate (100g/tree), and manganese sulfate (75g/tree). Organic fertilizers: apply 30-50 kg composted manure per tree in December-January. For fruiting trees, increase potassium during fruit set (May-June) with potassium sulfate at 1-2 kg/tree. Foliar spray with boron (Borax 0.5g/L) during flowering improves fruit set. Avoid excessive nitrogen after fruit set as it delays ripening and reduces sugar content.",
        contentAr: "\u0623\u0636\u0641 \u0633\u0645\u0627\u062F NPK (15-15-15) \u062B\u0644\u0627\u062B \u0645\u0631\u0627\u062A \u0633\u0646\u0648\u064A\u064B\u0627: \u0623\u0648\u0627\u0626\u0644 \u0627\u0644\u0631\u0628\u064A\u0639 (\u0645\u0627\u0631\u0633)\u060C \u0645\u0646\u062A\u0635\u0641 \u0627\u0644\u0635\u064A\u0641 (\u064A\u0648\u0646\u064A\u0648)\u060C \u0648\u0627\u0644\u062E\u0631\u064A\u0641 (\u0623\u0643\u062A\u0648\u0628\u0631). \u0644\u0643\u0644 \u0646\u062E\u0644\u0629 \u0646\u0627\u0636\u062C\u0629: 2-3 \u0643\u062C\u0645 NPK \u0641\u064A \u0643\u0644 \u0645\u0631\u0629. \u0623\u0636\u0641 \u0627\u0644\u0639\u0646\u0627\u0635\u0631 \u0627\u0644\u0635\u063A\u0631\u0649 \u0628\u0645\u0627 \u0641\u064A\u0647\u0627 \u0643\u064A\u0644\u0627\u062A \u0627\u0644\u062D\u062F\u064A\u062F (Fe-EDDHA\u060C 50 \u062C\u0645/\u0646\u062E\u0644\u0629 \u0645\u0631\u062A\u064A\u0646 \u0633\u0646\u0648\u064A\u064B\u0627)\u060C \u0643\u0628\u0631\u064A\u062A\u0627\u062A \u0627\u0644\u0632\u0646\u0643 (100 \u062C\u0645/\u0646\u062E\u0644\u0629)\u060C \u0648\u0643\u0628\u0631\u064A\u062A\u0627\u062A \u0627\u0644\u0645\u0646\u063A\u0646\u064A\u0632 (75 \u062C\u0645/\u0646\u062E\u0644\u0629). \u0627\u0644\u0623\u0633\u0645\u062F\u0629 \u0627\u0644\u0639\u0636\u0648\u064A\u0629: \u0623\u0636\u0641 30-50 \u0643\u062C\u0645 \u0633\u0645\u0627\u062F \u0628\u0644\u062F\u064A \u0645\u062A\u062D\u0644\u0644 \u0644\u0643\u0644 \u0646\u062E\u0644\u0629 \u0641\u064A \u062F\u064A\u0633\u0645\u0628\u0631-\u064A\u0646\u0627\u064A\u0631. \u0644\u0644\u0646\u062E\u064A\u0644 \u0627\u0644\u0645\u062B\u0645\u0631\u060C \u0632\u062F \u0627\u0644\u0628\u0648\u062A\u0627\u0633\u064A\u0648\u0645 \u062E\u0644\u0627\u0644 \u0639\u0642\u062F \u0627\u0644\u062B\u0645\u0627\u0631 (\u0645\u0627\u064A\u0648-\u064A\u0648\u0646\u064A\u0648) \u0628\u0643\u0628\u0631\u064A\u062A\u0627\u062A \u0627\u0644\u0628\u0648\u062A\u0627\u0633\u064A\u0648\u0645 \u0628\u0645\u0639\u062F\u0644 1-2 \u0643\u062C\u0645/\u0646\u062E\u0644\u0629. \u0631\u0634 \u0648\u0631\u0642\u064A \u0628\u0627\u0644\u0628\u0648\u0631\u0648\u0646 (\u0628\u0648\u0631\u0627\u0643\u0633 0.5 \u062C\u0645/\u0644\u062A\u0631) \u0623\u062B\u0646\u0627\u0621 \u0627\u0644\u062A\u0632\u0647\u064A\u0631 \u064A\u062D\u0633\u0646 \u0639\u0642\u062F \u0627\u0644\u062B\u0645\u0627\u0631. \u062A\u062C\u0646\u0628 \u0627\u0644\u0625\u0641\u0631\u0627\u0637 \u0641\u064A \u0627\u0644\u0646\u064A\u062A\u0631\u0648\u062C\u064A\u0646 \u0628\u0639\u062F \u0639\u0642\u062F \u0627\u0644\u062B\u0645\u0627\u0631 \u0644\u0623\u0646\u0647 \u064A\u0624\u062E\u0631 \u0627\u0644\u0646\u0636\u062C \u0648\u064A\u0642\u0644\u0644 \u0646\u0633\u0628\u0629 \u0627\u0644\u0633\u0643\u0631.",
        keywords: ["fertilizer", "npk", "nitrogen", "phosphorus", "potassium", "iron", "zinc", "manganese", "boron", "organic", "compost", "foliar"],
        keywordsAr: ["\u0633\u0645\u0627\u062F", "\u0646\u064A\u062A\u0631\u0648\u062C\u064A\u0646", "\u0641\u0648\u0633\u0641\u0648\u0631", "\u0628\u0648\u062A\u0627\u0633\u064A\u0648\u0645", "\u062D\u062F\u064A\u062F", "\u0632\u0646\u0643", "\u0645\u0646\u063A\u0646\u064A\u0632", "\u0628\u0648\u0631\u0648\u0646", "\u0639\u0636\u0648\u064A", "\u0648\u0631\u0642\u064A"]
      },
      {
        topic: "climate",
        content: "Khalas palms thrive in hot, arid climates with summer temperatures of 35-50\xB0C and mild winters (10-20\xB0C). They require at least 3,000 heat units (base 18\xB0C) for proper fruit development. Optimal humidity during Rutab stage: 30-50%. High humidity above 70% during ripening causes fruit spoilage and fungal infections. Khalas can tolerate brief freezes down to -5\xB0C but sustained cold below 0\xB0C damages fronds and reduces yield. Wind protection is important - windbreaks of Prosopis or Casuarina at 20m spacing reduce sandblast damage to developing fruits. Annual rainfall below 100mm is ideal; excessive rain during harvest causes fruit cracking and fermentation.",
        contentAr: "\u062A\u0632\u062F\u0647\u0631 \u0646\u062E\u064A\u0644 \u0627\u0644\u062E\u0644\u0627\u0635 \u0641\u064A \u0627\u0644\u0645\u0646\u0627\u062E \u0627\u0644\u062D\u0627\u0631 \u0627\u0644\u062C\u0627\u0641 \u0645\u0639 \u062F\u0631\u062C\u0627\u062A \u062D\u0631\u0627\u0631\u0629 \u0635\u064A\u0641\u064A\u0629 35-50 \u062F\u0631\u062C\u0629 \u0648\u0634\u062A\u0627\u0621 \u0645\u0639\u062A\u062F\u0644 (10-20 \u062F\u0631\u062C\u0629). \u062A\u062D\u062A\u0627\u062C 3000 \u0648\u062D\u062F\u0629 \u062D\u0631\u0627\u0631\u064A\u0629 \u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644 (\u0623\u0633\u0627\u0633 18 \u062F\u0631\u062C\u0629) \u0644\u0646\u0645\u0648 \u0627\u0644\u062B\u0645\u0627\u0631 \u0627\u0644\u0633\u0644\u064A\u0645. \u0627\u0644\u0631\u0637\u0648\u0628\u0629 \u0627\u0644\u0645\u062B\u0644\u0649 \u0623\u062B\u0646\u0627\u0621 \u0645\u0631\u062D\u0644\u0629 \u0627\u0644\u0631\u0637\u0628: 30-50%. \u0627\u0644\u0631\u0637\u0648\u0628\u0629 \u0627\u0644\u0639\u0627\u0644\u064A\u0629 \u0641\u0648\u0642 70% \u0623\u062B\u0646\u0627\u0621 \u0627\u0644\u0646\u0636\u062C \u062A\u0633\u0628\u0628 \u062A\u0644\u0641 \u0627\u0644\u062B\u0645\u0627\u0631 \u0648\u0627\u0644\u0625\u0635\u0627\u0628\u0627\u062A \u0627\u0644\u0641\u0637\u0631\u064A\u0629. \u064A\u062A\u062D\u0645\u0644 \u0627\u0644\u062E\u0644\u0627\u0635 \u0635\u0642\u064A\u0639\u064B\u0627 \u0642\u0635\u064A\u0631\u064B\u0627 \u062D\u062A\u0649 -5 \u062F\u0631\u062C\u0627\u062A \u0644\u0643\u0646 \u0627\u0644\u0628\u0631\u062F \u0627\u0644\u0645\u0633\u062A\u0645\u0631 \u062A\u062D\u062A \u0627\u0644\u0635\u0641\u0631 \u064A\u062A\u0644\u0641 \u0627\u0644\u0633\u0639\u0641 \u0648\u064A\u0642\u0644\u0644 \u0627\u0644\u0625\u0646\u062A\u0627\u062C. \u0627\u0644\u062D\u0645\u0627\u064A\u0629 \u0645\u0646 \u0627\u0644\u0631\u064A\u0627\u062D \u0645\u0647\u0645\u0629 - \u0645\u0635\u062F\u0627\u062A \u0627\u0644\u0631\u064A\u0627\u062D \u0645\u0646 \u0627\u0644\u063A\u0627\u0641 \u0623\u0648 \u0627\u0644\u0643\u0627\u0632\u0648\u0627\u0631\u064A\u0646\u0627 \u0643\u0644 20 \u0645\u062A\u0631\u064B\u0627 \u062A\u0642\u0644\u0644 \u0623\u0636\u0631\u0627\u0631 \u0627\u0644\u0631\u0645\u0627\u0644 \u0639\u0644\u0649 \u0627\u0644\u062B\u0645\u0627\u0631 \u0627\u0644\u0646\u0627\u0645\u064A\u0629. \u0647\u0637\u0648\u0644 \u0623\u0645\u0637\u0627\u0631 \u0633\u0646\u0648\u064A \u0623\u0642\u0644 \u0645\u0646 100 \u0645\u0645 \u0645\u062B\u0627\u0644\u064A\u061B \u0627\u0644\u0623\u0645\u0637\u0627\u0631 \u0627\u0644\u063A\u0632\u064A\u0631\u0629 \u0623\u062B\u0646\u0627\u0621 \u0627\u0644\u062D\u0635\u0627\u062F \u062A\u0633\u0628\u0628 \u062A\u0634\u0642\u0642 \u0627\u0644\u062B\u0645\u0627\u0631 \u0648\u062A\u062E\u0645\u0631\u0647\u0627.",
        keywords: ["climate", "temperature", "humidity", "heat", "frost", "wind", "rainfall", "arid", "season"],
        keywordsAr: ["\u0645\u0646\u0627\u062E", "\u062D\u0631\u0627\u0631\u0629", "\u0631\u0637\u0648\u0628\u0629", "\u0635\u0642\u064A\u0639", "\u0631\u064A\u0627\u062D", "\u0623\u0645\u0637\u0627\u0631", "\u062C\u0627\u0641", "\u0645\u0648\u0633\u0645"]
      },
      {
        topic: "propagation",
        content: "Khalas palms are propagated primarily through offshoots (fasail). Select offshoots that are 3-5 years old, weighing 10-25 kg, with established root systems. Best planting time: March-April or September-October when temperatures are moderate. After separation from mother tree, treat the cut surface with fungicide (Captan or Carbendazim). Plant in a prepared hole 1m x 1m x 1m with a mix of sand, compost, and topsoil (2:1:1 ratio). Water immediately and provide shade for first 2-3 months. Survival rate of well-selected offshoots: 85-95%. Tissue culture propagation is available commercially but is more expensive - produces genetically identical, disease-free plantlets. Spacing: 8-10m between trees in commercial plantations.",
        contentAr: "\u064A\u064F\u0643\u062B\u0631 \u0646\u062E\u064A\u0644 \u0627\u0644\u062E\u0644\u0627\u0635 \u0628\u0634\u0643\u0644 \u0631\u0626\u064A\u0633\u064A \u0639\u0628\u0631 \u0627\u0644\u0641\u0633\u0627\u0626\u0644. \u0627\u062E\u062A\u0631 \u0641\u0633\u0627\u0626\u0644 \u0639\u0645\u0631\u0647\u0627 3-5 \u0633\u0646\u0648\u0627\u062A\u060C \u0648\u0632\u0646\u0647\u0627 10-25 \u0643\u062C\u0645\u060C \u0645\u0639 \u0646\u0638\u0627\u0645 \u062C\u0630\u0631\u064A \u0645\u062A\u0637\u0648\u0631. \u0623\u0641\u0636\u0644 \u0648\u0642\u062A \u0644\u0644\u0632\u0631\u0627\u0639\u0629: \u0645\u0627\u0631\u0633-\u0623\u0628\u0631\u064A\u0644 \u0623\u0648 \u0633\u0628\u062A\u0645\u0628\u0631-\u0623\u0643\u062A\u0648\u0628\u0631 \u0639\u0646\u062F\u0645\u0627 \u062A\u0643\u0648\u0646 \u0627\u0644\u062D\u0631\u0627\u0631\u0629 \u0645\u0639\u062A\u062F\u0644\u0629. \u0628\u0639\u062F \u0627\u0644\u0641\u0635\u0644 \u0639\u0646 \u0627\u0644\u0646\u062E\u0644\u0629 \u0627\u0644\u0623\u0645\u060C \u0639\u0627\u0644\u062C \u0633\u0637\u062D \u0627\u0644\u0642\u0637\u0639 \u0628\u0645\u0628\u064A\u062F \u0641\u0637\u0631\u064A (\u0643\u0627\u0628\u062A\u0627\u0646 \u0623\u0648 \u0643\u0627\u0631\u0628\u0646\u062F\u0627\u0632\u064A\u0645). \u0627\u0632\u0631\u0639 \u0641\u064A \u062D\u0641\u0631\u0629 \u0645\u062D\u0636\u0631\u0629 1\u0645 \xD7 1\u0645 \xD7 1\u0645 \u0628\u062E\u0644\u064A\u0637 \u0645\u0646 \u0627\u0644\u0631\u0645\u0644 \u0648\u0627\u0644\u0633\u0645\u0627\u062F \u0648\u0627\u0644\u062A\u0631\u0628\u0629 \u0627\u0644\u0633\u0637\u062D\u064A\u0629 (\u0646\u0633\u0628\u0629 2:1:1). \u0623\u0631\u0648\u0650 \u0641\u0648\u0631\u064B\u0627 \u0648\u0648\u0641\u0631 \u0638\u0644\u0627\u064B \u0644\u0623\u0648\u0644 2-3 \u0623\u0634\u0647\u0631. \u0645\u0639\u062F\u0644 \u0646\u062C\u0627\u062D \u0627\u0644\u0641\u0633\u0627\u0626\u0644 \u0627\u0644\u0645\u062E\u062A\u0627\u0631\u0629 \u062C\u064A\u062F\u064B\u0627: 85-95%. \u0627\u0644\u0625\u0643\u062B\u0627\u0631 \u0628\u0632\u0631\u0627\u0639\u0629 \u0627\u0644\u0623\u0646\u0633\u062C\u0629 \u0645\u062A\u0627\u062D \u062A\u062C\u0627\u0631\u064A\u064B\u0627 \u0644\u0643\u0646\u0647 \u0623\u063A\u0644\u0649 - \u064A\u0646\u062A\u062C \u0634\u062A\u0644\u0627\u062A \u0645\u062A\u0637\u0627\u0628\u0642\u0629 \u0648\u0631\u0627\u062B\u064A\u064B\u0627 \u0648\u062E\u0627\u0644\u064A\u0629 \u0645\u0646 \u0627\u0644\u0623\u0645\u0631\u0627\u0636. \u0627\u0644\u0645\u0633\u0627\u0641\u0629: 8-10\u0645 \u0628\u064A\u0646 \u0627\u0644\u0646\u062E\u064A\u0644 \u0641\u064A \u0627\u0644\u0645\u0632\u0627\u0631\u0639 \u0627\u0644\u062A\u062C\u0627\u0631\u064A\u0629.",
        keywords: ["propagation", "offshoot", "planting", "tissue", "culture", "spacing", "nursery", "root", "fasail"],
        keywordsAr: ["\u0625\u0643\u062B\u0627\u0631", "\u0641\u0633\u064A\u0644\u0629", "\u0632\u0631\u0627\u0639\u0629", "\u0623\u0646\u0633\u062C\u0629", "\u0645\u0633\u0627\u0641\u0629", "\u0645\u0634\u062A\u0644", "\u062C\u0630\u0648\u0631", "\u0641\u0633\u0627\u0626\u0644"]
      },
      {
        topic: "pollination",
        content: "Khalas palms require manual pollination for commercial fruit production. Male pollen is collected from male palms during February-March. Each female Khalas tree produces 10-15 bunches (spadices). Optimal pollination timing: 2-3 days after spathe opening, early morning (6-9 AM). Methods: (1) Traditional: Insert 2-3 male strands into each female bunch; (2) Mechanical: Pollen mixed with talc (1:10 ratio) applied with a duster; (3) Liquid: Pollen suspension (10g pollen + 1L water + 10g sugar) sprayed on bunches. Pollen viability decreases rapidly - use within 24 hours fresh, or store dried pollen at -20\xB0C for up to 2 years. One male tree produces enough pollen for 25-50 female trees. Fruit set rate with proper pollination: 70-85%.",
        contentAr: "\u064A\u062A\u0637\u0644\u0628 \u0646\u062E\u064A\u0644 \u0627\u0644\u062E\u0644\u0627\u0635 \u062A\u0644\u0642\u064A\u062D\u064B\u0627 \u064A\u062F\u0648\u064A\u064B\u0627 \u0644\u0644\u0625\u0646\u062A\u0627\u062C \u0627\u0644\u062A\u062C\u0627\u0631\u064A. \u064A\u064F\u062C\u0645\u0639 \u062D\u0628\u0648\u0628 \u0627\u0644\u0644\u0642\u0627\u062D \u0645\u0646 \u0627\u0644\u0646\u062E\u064A\u0644 \u0627\u0644\u0630\u0643\u0631\u064A \u062E\u0644\u0627\u0644 \u0641\u0628\u0631\u0627\u064A\u0631-\u0645\u0627\u0631\u0633. \u0643\u0644 \u0646\u062E\u0644\u0629 \u062E\u0644\u0627\u0635 \u0623\u0646\u062B\u0649 \u062A\u0646\u062A\u062C 10-15 \u0639\u0630\u0642\u064B\u0627 (\u0634\u0645\u0631\u0627\u062E). \u0627\u0644\u062A\u0648\u0642\u064A\u062A \u0627\u0644\u0623\u0645\u062B\u0644 \u0644\u0644\u062A\u0644\u0642\u064A\u062D: 2-3 \u0623\u064A\u0627\u0645 \u0628\u0639\u062F \u062A\u0641\u062A\u062D \u0627\u0644\u0637\u0644\u0639\u0629\u060C \u0627\u0644\u0635\u0628\u0627\u062D \u0627\u0644\u0628\u0627\u0643\u0631 (6-9 \u0635\u0628\u0627\u062D\u064B\u0627). \u0627\u0644\u0637\u0631\u0642: (1) \u062A\u0642\u0644\u064A\u062F\u064A: \u0625\u062F\u062E\u0627\u0644 2-3 \u062E\u0635\u0644\u0627\u062A \u0630\u0643\u0631\u064A\u0629 \u0641\u064A \u0643\u0644 \u0639\u0630\u0642 \u0623\u0646\u062B\u0648\u064A\u061B (2) \u0645\u064A\u0643\u0627\u0646\u064A\u0643\u064A: \u0644\u0642\u0627\u062D \u0645\u062E\u0644\u0648\u0637 \u0628\u0627\u0644\u062A\u0644\u0643 (\u0646\u0633\u0628\u0629 1:10) \u064A\u064F\u0637\u0628\u0642 \u0628\u0627\u0644\u0645\u0646\u0641\u0627\u062E\u061B (3) \u0633\u0627\u0626\u0644: \u0645\u0639\u0644\u0642 \u0644\u0642\u0627\u062D (10 \u062C\u0645 \u0644\u0642\u0627\u062D + 1 \u0644\u062A\u0631 \u0645\u0627\u0621 + 10 \u062C\u0645 \u0633\u0643\u0631) \u064A\u064F\u0631\u0634 \u0639\u0644\u0649 \u0627\u0644\u0639\u0630\u0648\u0642. \u0642\u0627\u0628\u0644\u064A\u0629 \u0627\u0644\u0644\u0642\u0627\u062D \u062A\u062A\u0646\u0627\u0642\u0635 \u0628\u0633\u0631\u0639\u0629 - \u0627\u0633\u062A\u062E\u062F\u0645\u0647 \u062E\u0644\u0627\u0644 24 \u0633\u0627\u0639\u0629 \u0637\u0627\u0632\u062C\u064B\u0627\u060C \u0623\u0648 \u062E\u0632\u0651\u0646 \u0627\u0644\u0644\u0642\u0627\u062D \u0627\u0644\u0645\u062C\u0641\u0641 \u0639\u0644\u0649 -20 \u062F\u0631\u062C\u0629 \u0644\u0645\u062F\u0629 \u062A\u0635\u0644 \u0644\u0633\u0646\u062A\u064A\u0646. \u0646\u062E\u0644\u0629 \u0630\u0643\u0631 \u0648\u0627\u062D\u062F\u0629 \u062A\u0643\u0641\u064A 25-50 \u0646\u062E\u0644\u0629 \u0623\u0646\u062B\u0649. \u0645\u0639\u062F\u0644 \u0639\u0642\u062F \u0627\u0644\u062B\u0645\u0627\u0631 \u0628\u0627\u0644\u062A\u0644\u0642\u064A\u062D \u0627\u0644\u0633\u0644\u064A\u0645: 70-85%.",
        keywords: ["pollination", "pollen", "male", "female", "spathe", "bunch", "fruit", "set", "manual", "mechanical"],
        keywordsAr: ["\u062A\u0644\u0642\u064A\u062D", "\u0644\u0642\u0627\u062D", "\u0630\u0643\u0631", "\u0623\u0646\u062B\u0649", "\u0637\u0644\u0639\u0629", "\u0639\u0630\u0642", "\u062B\u0645\u0627\u0631", "\u0639\u0642\u062F", "\u064A\u062F\u0648\u064A"]
      },
      {
        topic: "storage",
        content: "Khalas dates can be stored at different stages for varying durations. Rutab stage: refrigerate at 0-5\xB0C for 3-6 months in sealed containers, maintaining 65-70% relative humidity. Tamr stage: store at room temperature (20-25\xB0C) for up to 12 months in airtight containers. For long-term preservation: freeze at -18\xB0C for up to 2 years without significant quality loss. Commercial processing: wash dates in chlorinated water (100ppm), sort by size and quality, fumigate with methyl bromide alternative (phosphine at 1.5g/m\xB3 for 72 hours) for stored product insects. Moisture content for safe storage: Rutab 30-35%, Tamr 15-20%. Vacuum packaging extends shelf life by 40-60%. Date syrup (Dibs) production: cook dates at 80\xB0C, extract, filter, concentrate to 70 Brix.",
        contentAr: "\u064A\u0645\u0643\u0646 \u062A\u062E\u0632\u064A\u0646 \u062A\u0645\u0648\u0631 \u0627\u0644\u062E\u0644\u0627\u0635 \u0641\u064A \u0645\u0631\u0627\u062D\u0644 \u0645\u062E\u062A\u0644\u0641\u0629 \u0644\u0641\u062A\u0631\u0627\u062A \u0645\u062A\u0641\u0627\u0648\u062A\u0629. \u0645\u0631\u062D\u0644\u0629 \u0627\u0644\u0631\u0637\u0628: \u062A\u0628\u0631\u064A\u062F \u0639\u0644\u0649 0-5 \u062F\u0631\u062C\u0627\u062A \u0644\u0645\u062F\u0629 3-6 \u0623\u0634\u0647\u0631 \u0641\u064A \u062D\u0627\u0648\u064A\u0627\u062A \u0645\u062D\u0643\u0645\u0629 \u0645\u0639 \u0631\u0637\u0648\u0628\u0629 \u0646\u0633\u0628\u064A\u0629 65-70%. \u0645\u0631\u062D\u0644\u0629 \u0627\u0644\u062A\u0645\u0631: \u062A\u062E\u0632\u064A\u0646 \u0628\u062F\u0631\u062C\u0629 \u062D\u0631\u0627\u0631\u0629 \u0627\u0644\u063A\u0631\u0641\u0629 (20-25 \u062F\u0631\u062C\u0629) \u062D\u062A\u0649 12 \u0634\u0647\u0631\u064B\u0627 \u0641\u064A \u062D\u0627\u0648\u064A\u0627\u062A \u0645\u062D\u0643\u0645\u0629. \u0644\u0644\u062D\u0641\u0638 \u0637\u0648\u064A\u0644 \u0627\u0644\u0645\u062F\u0649: \u062A\u062C\u0645\u064A\u062F \u0639\u0644\u0649 -18 \u062F\u0631\u062C\u0629 \u0644\u0645\u062F\u0629 \u062A\u0635\u0644 \u0644\u0633\u0646\u062A\u064A\u0646 \u062F\u0648\u0646 \u0641\u0642\u062F\u0627\u0646 \u0643\u0628\u064A\u0631 \u0641\u064A \u0627\u0644\u062C\u0648\u062F\u0629. \u0627\u0644\u0645\u0639\u0627\u0644\u062C\u0629 \u0627\u0644\u062A\u062C\u0627\u0631\u064A\u0629: \u063A\u0633\u0644 \u0627\u0644\u062A\u0645\u0648\u0631 \u0628\u0645\u0627\u0621 \u0645\u0643\u0644\u0648\u0631 (100 \u062C\u0632\u0621 \u0628\u0627\u0644\u0645\u0644\u064A\u0648\u0646)\u060C \u0641\u0631\u0632 \u062D\u0633\u0628 \u0627\u0644\u062D\u062C\u0645 \u0648\u0627\u0644\u062C\u0648\u062F\u0629\u060C \u062A\u0628\u062E\u064A\u0631 \u0628\u0627\u0644\u0641\u0648\u0633\u0641\u064A\u0646 (1.5 \u062C\u0645/\u0645\xB3 \u0644\u0645\u062F\u0629 72 \u0633\u0627\u0639\u0629) \u0644\u062D\u0634\u0631\u0627\u062A \u0627\u0644\u0645\u062E\u0632\u0648\u0646. \u0646\u0633\u0628\u0629 \u0627\u0644\u0631\u0637\u0648\u0628\u0629 \u0644\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0622\u0645\u0646: \u0631\u0637\u0628 30-35%\u060C \u062A\u0645\u0631 15-20%. \u0627\u0644\u062A\u063A\u0644\u064A\u0641 \u0627\u0644\u0645\u0641\u0631\u063A \u064A\u0645\u062F\u062F \u0645\u062F\u0629 \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0629 \u0628\u0646\u0633\u0628\u0629 40-60%. \u0625\u0646\u062A\u0627\u062C \u062F\u0628\u0633 \u0627\u0644\u062A\u0645\u0631: \u0637\u0628\u062E \u0627\u0644\u062A\u0645\u0648\u0631 \u0639\u0644\u0649 80 \u062F\u0631\u062C\u0629\u060C \u0627\u0633\u062A\u062E\u0644\u0627\u0635\u060C \u062A\u0635\u0641\u064A\u0629\u060C \u062A\u0631\u0643\u064A\u0632 \u0625\u0644\u0649 70 \u0628\u0631\u0643\u0633.",
        keywords: ["storage", "refrigerate", "freeze", "shelf", "life", "packaging", "processing", "syrup", "dibs", "moisture"],
        keywordsAr: ["\u062A\u062E\u0632\u064A\u0646", "\u062A\u0628\u0631\u064A\u062F", "\u062A\u062C\u0645\u064A\u062F", "\u0635\u0644\u0627\u062D\u064A\u0629", "\u062A\u063A\u0644\u064A\u0641", "\u062A\u0635\u0646\u064A\u0639", "\u062F\u0628\u0633", "\u0631\u0637\u0648\u0628\u0629"]
      },
      {
        topic: "pruning",
        content: "Prune Khalas palms annually, ideally in December-January (dormant season). Remove dried, damaged, and pest-infested fronds. Maintain 80-100 green fronds on mature trees (7-8 leaf whorls). Leave a 45-degree angle between remaining fronds and trunk. Remove old fruit stalks and any offshoots not intended for propagation. Sterilize pruning tools with 10% bleach solution between trees to prevent disease spread. Heavy pruning (removing more than 30% of green fronds) reduces yield the following season by 15-25%. For young trees (under 5 years), only remove dead fronds - do not prune green fronds as they are needed for establishment.",
        contentAr: "\u0642\u0644\u0651\u0645 \u0646\u062E\u064A\u0644 \u0627\u0644\u062E\u0644\u0627\u0635 \u0633\u0646\u0648\u064A\u064B\u0627\u060C \u064A\u0641\u0636\u0644 \u0641\u064A \u062F\u064A\u0633\u0645\u0628\u0631-\u064A\u0646\u0627\u064A\u0631 (\u0645\u0648\u0633\u0645 \u0627\u0644\u0633\u0643\u0648\u0646). \u0623\u0632\u0644 \u0627\u0644\u0633\u0639\u0641 \u0627\u0644\u062C\u0627\u0641 \u0648\u0627\u0644\u062A\u0627\u0644\u0641 \u0648\u0627\u0644\u0645\u0635\u0627\u0628 \u0628\u0627\u0644\u0622\u0641\u0627\u062A. \u062D\u0627\u0641\u0638 \u0639\u0644\u0649 80-100 \u0633\u0639\u0641\u0629 \u062E\u0636\u0631\u0627\u0621 \u0639\u0644\u0649 \u0627\u0644\u0646\u062E\u064A\u0644 \u0627\u0644\u0646\u0627\u0636\u062C (7-8 \u062D\u0644\u0642\u0627\u062A \u0648\u0631\u0642\u064A\u0629). \u0627\u062A\u0631\u0643 \u0632\u0627\u0648\u064A\u0629 45 \u062F\u0631\u062C\u0629 \u0628\u064A\u0646 \u0627\u0644\u0633\u0639\u0641 \u0627\u0644\u0645\u062A\u0628\u0642\u064A \u0648\u0627\u0644\u062C\u0630\u0639. \u0623\u0632\u0644 \u0639\u0631\u0627\u062C\u064A\u0646 \u0627\u0644\u062B\u0645\u0627\u0631 \u0627\u0644\u0642\u062F\u064A\u0645\u0629 \u0648\u0623\u064A \u0641\u0633\u0627\u0626\u0644 \u063A\u064A\u0631 \u0645\u062E\u0635\u0635\u0629 \u0644\u0644\u0625\u0643\u062B\u0627\u0631. \u0639\u0642\u0651\u0645 \u0623\u062F\u0648\u0627\u062A \u0627\u0644\u062A\u0642\u0644\u064A\u0645 \u0628\u0645\u062D\u0644\u0648\u0644 \u0643\u0644\u0648\u0631 10% \u0628\u064A\u0646 \u0627\u0644\u0623\u0634\u062C\u0627\u0631 \u0644\u0645\u0646\u0639 \u0627\u0646\u062A\u0634\u0627\u0631 \u0627\u0644\u0623\u0645\u0631\u0627\u0636. \u0627\u0644\u062A\u0642\u0644\u064A\u0645 \u0627\u0644\u0634\u062F\u064A\u062F (\u0625\u0632\u0627\u0644\u0629 \u0623\u0643\u062B\u0631 \u0645\u0646 30% \u0645\u0646 \u0627\u0644\u0633\u0639\u0641 \u0627\u0644\u0623\u062E\u0636\u0631) \u064A\u0642\u0644\u0644 \u0627\u0644\u0625\u0646\u062A\u0627\u062C \u0641\u064A \u0627\u0644\u0645\u0648\u0633\u0645 \u0627\u0644\u062A\u0627\u0644\u064A \u0628\u0646\u0633\u0628\u0629 15-25%. \u0644\u0644\u0646\u062E\u064A\u0644 \u0627\u0644\u0635\u063A\u064A\u0631 (\u0623\u0642\u0644 \u0645\u0646 5 \u0633\u0646\u0648\u0627\u062A)\u060C \u0623\u0632\u0644 \u0627\u0644\u0633\u0639\u0641 \u0627\u0644\u0645\u064A\u062A \u0641\u0642\u0637 \u0648\u0644\u0627 \u062A\u0642\u0644\u0645 \u0627\u0644\u0633\u0639\u0641 \u0627\u0644\u0623\u062E\u0636\u0631 \u0644\u0623\u0646\u0647 \u0636\u0631\u0648\u0631\u064A \u0644\u0644\u0646\u0645\u0648.",
        keywords: ["pruning", "frond", "trimming", "cutting", "sterilize", "maintenance", "canopy"],
        keywordsAr: ["\u062A\u0642\u0644\u064A\u0645", "\u0633\u0639\u0641", "\u0642\u0635", "\u062A\u0639\u0642\u064A\u0645", "\u0635\u064A\u0627\u0646\u0629", "\u062A\u0627\u062C"]
      },
      {
        topic: "economics",
        content: "Khalas is among the highest-valued date varieties commercially. Farm-gate prices range from 15-35 SAR/kg ($4-9 USD/kg) depending on grade and season. Premium Al-Ahsa Khalas can fetch 50-80 SAR/kg in specialty markets. A mature Khalas plantation (200 trees/hectare) generates annual revenue of 200,000-500,000 SAR/hectare. Establishment cost: approximately 80,000-120,000 SAR/hectare (including land preparation, seedlings, irrigation, fencing). Break-even typically reached in year 7-9. Major export markets: UAE, Kuwait, Bahrain, Europe, and Southeast Asia. Khalas dates contribute significantly to Saudi Arabia's Vision 2030 agricultural diversification goals.",
        contentAr: "\u0627\u0644\u062E\u0644\u0627\u0635 \u0645\u0646 \u0623\u0639\u0644\u0649 \u0623\u0635\u0646\u0627\u0641 \u0627\u0644\u062A\u0645\u0648\u0631 \u0642\u064A\u0645\u0629 \u062A\u062C\u0627\u0631\u064A\u064B\u0627. \u0623\u0633\u0639\u0627\u0631 \u0627\u0644\u0628\u0648\u0627\u0628\u0629 \u062A\u062A\u0631\u0627\u0648\u062D \u0628\u064A\u0646 15-35 \u0631\u064A\u0627\u0644/\u0643\u062C\u0645 \u062D\u0633\u0628 \u0627\u0644\u062F\u0631\u062C\u0629 \u0648\u0627\u0644\u0645\u0648\u0633\u0645. \u062E\u0644\u0627\u0635 \u0627\u0644\u0623\u062D\u0633\u0627\u0621 \u0627\u0644\u0641\u0627\u062E\u0631 \u064A\u0635\u0644 \u0625\u0644\u0649 50-80 \u0631\u064A\u0627\u0644/\u0643\u062C\u0645 \u0641\u064A \u0627\u0644\u0623\u0633\u0648\u0627\u0642 \u0627\u0644\u0645\u062A\u062E\u0635\u0635\u0629. \u0645\u0632\u0631\u0639\u0629 \u062E\u0644\u0627\u0635 \u0646\u0627\u0636\u062C\u0629 (200 \u0646\u062E\u0644\u0629/\u0647\u0643\u062A\u0627\u0631) \u062A\u0648\u0644\u062F \u0625\u064A\u0631\u0627\u062F\u0627\u062A \u0633\u0646\u0648\u064A\u0629 200,000-500,000 \u0631\u064A\u0627\u0644/\u0647\u0643\u062A\u0627\u0631. \u062A\u0643\u0644\u0641\u0629 \u0627\u0644\u062A\u0623\u0633\u064A\u0633: \u062D\u0648\u0627\u0644\u064A 80,000-120,000 \u0631\u064A\u0627\u0644/\u0647\u0643\u062A\u0627\u0631 (\u0634\u0627\u0645\u0644\u0629 \u0625\u0639\u062F\u0627\u062F \u0627\u0644\u0623\u0631\u0636 \u0648\u0627\u0644\u0634\u062A\u0644\u0627\u062A \u0648\u0627\u0644\u0631\u064A \u0648\u0627\u0644\u062A\u0633\u064A\u064A\u062C). \u0646\u0642\u0637\u0629 \u0627\u0644\u062A\u0639\u0627\u062F\u0644 \u0641\u064A \u0627\u0644\u0633\u0646\u0629 7-9. \u0623\u0633\u0648\u0627\u0642 \u0627\u0644\u062A\u0635\u062F\u064A\u0631 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629: \u0627\u0644\u0625\u0645\u0627\u0631\u0627\u062A\u060C \u0627\u0644\u0643\u0648\u064A\u062A\u060C \u0627\u0644\u0628\u062D\u0631\u064A\u0646\u060C \u0623\u0648\u0631\u0648\u0628\u0627\u060C \u0648\u062C\u0646\u0648\u0628 \u0634\u0631\u0642 \u0622\u0633\u064A\u0627. \u062A\u0645\u0648\u0631 \u0627\u0644\u062E\u0644\u0627\u0635 \u062A\u0633\u0627\u0647\u0645 \u0628\u0634\u0643\u0644 \u0643\u0628\u064A\u0631 \u0641\u064A \u0623\u0647\u062F\u0627\u0641 \u0627\u0644\u062A\u0646\u0648\u064A\u0639 \u0627\u0644\u0632\u0631\u0627\u0639\u064A \u0644\u0631\u0624\u064A\u0629 \u0627\u0644\u0645\u0645\u0644\u0643\u0629 2030.",
        keywords: ["price", "market", "export", "revenue", "cost", "profit", "commercial", "value", "economy"],
        keywordsAr: ["\u0633\u0639\u0631", "\u0633\u0648\u0642", "\u062A\u0635\u062F\u064A\u0631", "\u0625\u064A\u0631\u0627\u062F\u0627\u062A", "\u062A\u0643\u0644\u0641\u0629", "\u0631\u0628\u062D", "\u062A\u062C\u0627\u0631\u064A", "\u0642\u064A\u0645\u0629", "\u0627\u0642\u062A\u0635\u0627\u062F"]
      }
    ]
  },
  {
    title: "Razeez Palm",
    category: "Razeez",
    chunks: [
      {
        topic: "general",
        content: "Razeez dates are famous for their soft texture and rich, deep flavor profile. They are often used for making date syrup (Dibs/Molasses) and date paste. The variety is particularly valued in the Al-Qassim region of Saudi Arabia. Trees are vigorous growers and relatively low-maintenance compared to other premium varieties. Razeez dates are dark brown to nearly black when fully ripe, with a wrinkled skin and moist flesh. They are medium to large in size (3-5cm length) and contain a single elongated pit. The variety is well-adapted to the central Arabian Peninsula climate.",
        contentAr: "\u062A\u0645\u0648\u0631 \u0627\u0644\u0631\u0632\u064A\u0632 \u0645\u0634\u0647\u0648\u0631\u0629 \u0628\u0642\u0648\u0627\u0645\u0647\u0627 \u0627\u0644\u0637\u0631\u064A \u0648\u0646\u0643\u0647\u062A\u0647\u0627 \u0627\u0644\u063A\u0646\u064A\u0629 \u0627\u0644\u0639\u0645\u064A\u0642\u0629. \u062A\u064F\u0633\u062A\u062E\u062F\u0645 \u063A\u0627\u0644\u0628\u064B\u0627 \u0644\u0635\u0646\u0639 \u062F\u0628\u0633 \u0627\u0644\u062A\u0645\u0631 \u0648\u0627\u0644\u0639\u062C\u0648\u0629. \u064A\u064F\u0642\u062F\u0651\u0631 \u0627\u0644\u0635\u0646\u0641 \u0628\u0634\u0643\u0644 \u062E\u0627\u0635 \u0641\u064A \u0645\u0646\u0637\u0642\u0629 \u0627\u0644\u0642\u0635\u064A\u0645 \u0628\u0627\u0644\u0645\u0645\u0644\u0643\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u0627\u0644\u0633\u0639\u0648\u062F\u064A\u0629. \u0627\u0644\u0623\u0634\u062C\u0627\u0631 \u0646\u0627\u0645\u064A\u0629 \u0628\u0642\u0648\u0629 \u0648\u062A\u062D\u062A\u0627\u062C \u0635\u064A\u0627\u0646\u0629 \u0623\u0642\u0644 \u0645\u0642\u0627\u0631\u0646\u0629 \u0628\u0627\u0644\u0623\u0635\u0646\u0627\u0641 \u0627\u0644\u0641\u0627\u062E\u0631\u0629 \u0627\u0644\u0623\u062E\u0631\u0649. \u062A\u0645\u0648\u0631 \u0627\u0644\u0631\u0632\u064A\u0632 \u0628\u0646\u064A\u0629 \u062F\u0627\u0643\u0646\u0629 \u0625\u0644\u0649 \u0633\u0648\u062F\u0627\u0621 \u062A\u0642\u0631\u064A\u0628\u064B\u0627 \u0639\u0646\u062F \u0627\u0644\u0646\u0636\u062C \u0627\u0644\u0643\u0627\u0645\u0644\u060C \u0645\u0639 \u0642\u0634\u0631\u0629 \u0645\u062C\u0639\u062F\u0629 \u0648\u0644\u062D\u0645 \u0631\u0637\u0628. \u062D\u062C\u0645\u0647\u0627 \u0645\u062A\u0648\u0633\u0637 \u0625\u0644\u0649 \u0643\u0628\u064A\u0631 (3-5 \u0633\u0645 \u0637\u0648\u0644\u0627\u064B) \u0648\u062A\u062D\u062A\u0648\u064A \u0639\u0644\u0649 \u0646\u0648\u0627\u0629 \u0648\u0627\u062D\u062F\u0629 \u0645\u0633\u062A\u0637\u064A\u0644\u0629. \u0627\u0644\u0635\u0646\u0641 \u0645\u062A\u0623\u0642\u0644\u0645 \u062C\u064A\u062F\u064B\u0627 \u0645\u0639 \u0645\u0646\u0627\u062E \u0648\u0633\u0637 \u0634\u0628\u0647 \u0627\u0644\u062C\u0632\u064A\u0631\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629.",
        keywords: ["razeez", "variety", "description", "soft", "dark", "al-qassim", "overview", "flavor", "syrup"],
        keywordsAr: ["\u0631\u0632\u064A\u0632", "\u0635\u0646\u0641", "\u0648\u0635\u0641", "\u0637\u0631\u064A", "\u062F\u0627\u0643\u0646", "\u0627\u0644\u0642\u0635\u064A\u0645", "\u0646\u0643\u0647\u0629", "\u062F\u0628\u0633"]
      },
      {
        topic: "irrigation",
        content: "Razeez is highly drought-tolerant but produces best with consistent moisture. Deep watering twice a week in summer with 120-180 liters per tree is recommended. Reduce to once every 10 days in winter with 60-80 liters. The key is deep, infrequent watering rather than shallow, frequent irrigation. This encourages deep root development. Basin irrigation works well for Razeez in small orchards. For large plantations, bubbler irrigation (30-40 liters/hour per emitter, 4 emitters/tree) is most efficient. Reduce irrigation during the Tamr stage to increase sugar concentration. Water quality: Razeez tolerates moderately saline water up to 5,000 ppm TDS, better than most varieties.",
        contentAr: "\u0627\u0644\u0631\u0632\u064A\u0632 \u0634\u062F\u064A\u062F \u0627\u0644\u062A\u062D\u0645\u0644 \u0644\u0644\u062C\u0641\u0627\u0641 \u0644\u0643\u0646\u0647 \u064A\u0646\u062A\u062C \u0623\u0641\u0636\u0644 \u0645\u0639 \u0631\u0637\u0648\u0628\u0629 \u0645\u0646\u062A\u0638\u0645\u0629. \u0627\u0644\u0631\u064A \u0627\u0644\u0639\u0645\u064A\u0642 \u0645\u0631\u062A\u064A\u0646 \u0623\u0633\u0628\u0648\u0639\u064A\u064B\u0627 \u0641\u064A \u0627\u0644\u0635\u064A\u0641 \u0628\u0645\u0639\u062F\u0644 120-180 \u0644\u062A\u0631 \u0644\u0643\u0644 \u0646\u062E\u0644\u0629. \u0642\u0644\u0651\u0644 \u0625\u0644\u0649 \u0645\u0631\u0629 \u0643\u0644 10 \u0623\u064A\u0627\u0645 \u0641\u064A \u0627\u0644\u0634\u062A\u0627\u0621 \u0628\u0645\u0639\u062F\u0644 60-80 \u0644\u062A\u0631. \u0627\u0644\u0645\u0641\u062A\u0627\u062D \u0647\u0648 \u0627\u0644\u0631\u064A \u0627\u0644\u0639\u0645\u064A\u0642 \u063A\u064A\u0631 \u0627\u0644\u0645\u062A\u0643\u0631\u0631 \u0628\u062F\u0644\u0627\u064B \u0645\u0646 \u0627\u0644\u0631\u064A \u0627\u0644\u0633\u0637\u062D\u064A \u0627\u0644\u0645\u062A\u0643\u0631\u0631. \u0647\u0630\u0627 \u064A\u0634\u062C\u0639 \u0646\u0645\u0648 \u0627\u0644\u062C\u0630\u0648\u0631 \u0627\u0644\u0639\u0645\u064A\u0642\u0629. \u0631\u064A \u0627\u0644\u0623\u062D\u0648\u0627\u0636 \u064A\u0646\u0627\u0633\u0628 \u0627\u0644\u0631\u0632\u064A\u0632 \u0641\u064A \u0627\u0644\u0628\u0633\u0627\u062A\u064A\u0646 \u0627\u0644\u0635\u063A\u064A\u0631\u0629. \u0644\u0644\u0645\u0632\u0627\u0631\u0639 \u0627\u0644\u0643\u0628\u064A\u0631\u0629\u060C \u0631\u064A \u0627\u0644\u0641\u0642\u0627\u0639\u0627\u062A (30-40 \u0644\u062A\u0631/\u0633\u0627\u0639\u0629 \u0644\u0643\u0644 \u0646\u0642\u0627\u0637\u0629\u060C 4 \u0646\u0642\u0627\u0637\u0627\u062A/\u0646\u062E\u0644\u0629) \u0647\u0648 \u0627\u0644\u0623\u0643\u0641\u0623. \u0642\u0644\u0651\u0644 \u0627\u0644\u0631\u064A \u062E\u0644\u0627\u0644 \u0645\u0631\u062D\u0644\u0629 \u0627\u0644\u062A\u0645\u0631 \u0644\u0632\u064A\u0627\u062F\u0629 \u062A\u0631\u0643\u064A\u0632 \u0627\u0644\u0633\u0643\u0631. \u062C\u0648\u062F\u0629 \u0627\u0644\u0645\u0627\u0621: \u0627\u0644\u0631\u0632\u064A\u0632 \u064A\u062A\u062D\u0645\u0644 \u0627\u0644\u0645\u064A\u0627\u0647 \u0627\u0644\u0645\u0627\u0644\u062D\u0629 \u0627\u0644\u0645\u0639\u062A\u062F\u0644\u0629 \u062D\u062A\u0649 5000 \u062C\u0632\u0621 \u0628\u0627\u0644\u0645\u0644\u064A\u0648\u0646\u060C \u0623\u0641\u0636\u0644 \u0645\u0646 \u0645\u0639\u0638\u0645 \u0627\u0644\u0623\u0635\u0646\u0627\u0641.",
        keywords: ["irrigation", "drought", "water", "deep", "bubbler", "basin", "saline", "tolerance", "summer", "winter"],
        keywordsAr: ["\u0631\u064A", "\u062C\u0641\u0627\u0641", "\u0645\u0627\u0621", "\u0639\u0645\u064A\u0642", "\u0641\u0642\u0627\u0639\u0627\u062A", "\u062D\u0648\u0636", "\u0645\u0644\u0648\u062D\u0629", "\u062A\u062D\u0645\u0644", "\u0635\u064A\u0641", "\u0634\u062A\u0627\u0621"]
      },
      {
        topic: "harvest",
        content: "Razeez dates are often harvested at the 'Tamr' stage (fully dried) as they have excellent storage capabilities. Harvest typically occurs in September-October, about 2-3 weeks later than Khalas. The dates should be dark brown to black in color with moisture content of 18-22%. They can be left on the tree longer than other varieties without quality loss, making harvest timing more flexible. Average yield: 80-130 kg per mature tree. Bunch weight ranges from 8-15 kg. For commercial harvesting, use nylon nets under bunches to catch naturally falling fruits. Sort into three grades: Super (uniform dark color, >3.5cm), Choice (>3cm), and Standard (remainder). Razeez dates are excellent for pressing into date paste (Ajwa-style preparation).",
        contentAr: "\u062A\u064F\u062D\u0635\u062F \u062A\u0645\u0648\u0631 \u0627\u0644\u0631\u0632\u064A\u0632 \u063A\u0627\u0644\u0628\u064B\u0627 \u0641\u064A \u0645\u0631\u062D\u0644\u0629 \u0627\u0644\u062A\u0645\u0631 (\u0645\u062C\u0641\u0641\u0629 \u0628\u0627\u0644\u0643\u0627\u0645\u0644) \u0644\u0623\u0646\u0647\u0627 \u0645\u0645\u062A\u0627\u0632\u0629 \u0641\u064A \u0627\u0644\u062A\u062E\u0632\u064A\u0646. \u0627\u0644\u062D\u0635\u0627\u062F \u0639\u0627\u062F\u0629 \u0641\u064A \u0633\u0628\u062A\u0645\u0628\u0631-\u0623\u0643\u062A\u0648\u0628\u0631\u060C \u0628\u0639\u062F \u0627\u0644\u062E\u0644\u0627\u0635 \u0628\u062D\u0648\u0627\u0644\u064A 2-3 \u0623\u0633\u0627\u0628\u064A\u0639. \u064A\u062C\u0628 \u0623\u0646 \u064A\u0643\u0648\u0646 \u0644\u0648\u0646\u0647\u0627 \u0628\u0646\u064A\u064B\u0627 \u062F\u0627\u0643\u0646\u064B\u0627 \u0625\u0644\u0649 \u0623\u0633\u0648\u062F \u0628\u0646\u0633\u0628\u0629 \u0631\u0637\u0648\u0628\u0629 18-22%. \u064A\u0645\u0643\u0646 \u062A\u0631\u0643\u0647\u0627 \u0639\u0644\u0649 \u0627\u0644\u0646\u062E\u0644\u0629 \u0623\u0637\u0648\u0644 \u0645\u0646 \u0627\u0644\u0623\u0635\u0646\u0627\u0641 \u0627\u0644\u0623\u062E\u0631\u0649 \u062F\u0648\u0646 \u0641\u0642\u062F\u0627\u0646 \u0627\u0644\u062C\u0648\u062F\u0629\u060C \u0645\u0645\u0627 \u064A\u062C\u0639\u0644 \u062A\u0648\u0642\u064A\u062A \u0627\u0644\u062D\u0635\u0627\u062F \u0623\u0643\u062B\u0631 \u0645\u0631\u0648\u0646\u0629. \u0645\u062A\u0648\u0633\u0637 \u0627\u0644\u0625\u0646\u062A\u0627\u062C: 80-130 \u0643\u062C\u0645 \u0644\u0644\u0646\u062E\u0644\u0629 \u0627\u0644\u0646\u0627\u0636\u062C\u0629. \u0648\u0632\u0646 \u0627\u0644\u0639\u0630\u0642 \u064A\u062A\u0631\u0627\u0648\u062D \u0628\u064A\u0646 8-15 \u0643\u062C\u0645. \u0644\u0644\u062D\u0635\u0627\u062F \u0627\u0644\u062A\u062C\u0627\u0631\u064A\u060C \u0627\u0633\u062A\u062E\u062F\u0645 \u0634\u0628\u0627\u0643 \u0646\u0627\u064A\u0644\u0648\u0646 \u062A\u062D\u062A \u0627\u0644\u0639\u0630\u0648\u0642 \u0644\u0627\u0644\u062A\u0642\u0627\u0637 \u0627\u0644\u062B\u0645\u0627\u0631 \u0627\u0644\u0645\u062A\u0633\u0627\u0642\u0637\u0629 \u0637\u0628\u064A\u0639\u064A\u064B\u0627. \u0635\u0646\u0641 \u0625\u0644\u0649 \u062B\u0644\u0627\u062B \u062F\u0631\u062C\u0627\u062A: \u0633\u0648\u0628\u0631 (\u0644\u0648\u0646 \u062F\u0627\u0643\u0646 \u0645\u0648\u062D\u062F\u060C \u0623\u0643\u0628\u0631 \u0645\u0646 3.5 \u0633\u0645)\u060C \u0645\u0645\u062A\u0627\u0632 (\u0623\u0643\u0628\u0631 \u0645\u0646 3 \u0633\u0645)\u060C \u0648\u0639\u0627\u062F\u064A (\u0627\u0644\u0628\u0627\u0642\u064A). \u062A\u0645\u0648\u0631 \u0627\u0644\u0631\u0632\u064A\u0632 \u0645\u0645\u062A\u0627\u0632\u0629 \u0644\u0635\u0646\u0639 \u0627\u0644\u0639\u062C\u0648\u0629.",
        keywords: ["harvest", "tamr", "dried", "yield", "bunch", "grading", "storage", "flexible", "paste", "ajwa"],
        keywordsAr: ["\u062D\u0635\u0627\u062F", "\u062A\u0645\u0631", "\u0645\u062C\u0641\u0641", "\u0625\u0646\u062A\u0627\u062C", "\u0639\u0630\u0642", "\u062A\u0635\u0646\u064A\u0641", "\u062A\u062E\u0632\u064A\u0646", "\u0639\u062C\u0648\u0629"]
      },
      {
        topic: "pests",
        content: "Razeez is generally more resistant to pests than other varieties, but still requires vigilance. Main threats: Lesser Date Moth (Batrachedra amydraula) - attacks developing fruits from June onwards. Use pheromone traps for monitoring and mesh bunch covers (2mm mesh) for protection. Rhinoceros beetle (Oryctes rhinoceros) - bores into the crown area. Apply entomopathogenic nematodes (Steinernema carpocapsae) to compost heaps where larvae develop. Scale insects (Parlatoria blanchardi) - cause yellowing of fronds. Treat with white oil (2%) in early spring. Maintain clean ground cover, remove fallen fronds and fruits promptly to reduce infestation risks. Regular trunk inspection monthly helps catch Red Palm Weevil early before significant damage occurs.",
        contentAr: "\u0627\u0644\u0631\u0632\u064A\u0632 \u0639\u0645\u0648\u0645\u064B\u0627 \u0623\u0643\u062B\u0631 \u0645\u0642\u0627\u0648\u0645\u0629 \u0644\u0644\u0622\u0641\u0627\u062A \u0645\u0646 \u0627\u0644\u0623\u0635\u0646\u0627\u0641 \u0627\u0644\u0623\u062E\u0631\u0649 \u0644\u0643\u0646\u0647 \u064A\u062A\u0637\u0644\u0628 \u0627\u0644\u064A\u0642\u0638\u0629. \u0627\u0644\u062A\u0647\u062F\u064A\u062F\u0627\u062A \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629: \u062F\u0648\u062F\u0629 \u0627\u0644\u062A\u0645\u0631 \u0627\u0644\u0635\u063A\u0631\u0649 (Batrachedra amydraula) - \u062A\u0647\u0627\u062C\u0645 \u0627\u0644\u062B\u0645\u0627\u0631 \u0627\u0644\u0646\u0627\u0645\u064A\u0629 \u0645\u0646 \u064A\u0648\u0646\u064A\u0648. \u0627\u0633\u062A\u062E\u062F\u0645 \u0645\u0635\u0627\u0626\u062F \u0641\u064A\u0631\u0648\u0645\u0648\u0646\u0627\u062A \u0644\u0644\u0645\u0631\u0627\u0642\u0628\u0629 \u0648\u0623\u0643\u064A\u0627\u0633 \u0634\u0628\u0643\u064A\u0629 (2 \u0645\u0645) \u0644\u0644\u062D\u0645\u0627\u064A\u0629. \u062E\u0646\u0641\u0633\u0627\u0621 \u0648\u062D\u064A\u062F \u0627\u0644\u0642\u0631\u0646 (Oryctes rhinoceros) - \u062A\u062D\u0641\u0631 \u0641\u064A \u0645\u0646\u0637\u0642\u0629 \u0627\u0644\u062A\u0627\u062C. \u0637\u0628\u0651\u0642 \u0627\u0644\u0646\u064A\u0645\u0627\u062A\u0648\u062F\u0627 \u0627\u0644\u0645\u0645\u0631\u0636\u0629 \u0644\u0644\u062D\u0634\u0631\u0627\u062A (Steinernema carpocapsae) \u0639\u0644\u0649 \u0623\u0643\u0648\u0627\u0645 \u0627\u0644\u0633\u0645\u0627\u062F \u062D\u064A\u062B \u062A\u062A\u0637\u0648\u0631 \u0627\u0644\u064A\u0631\u0642\u0627\u062A. \u0627\u0644\u062D\u0634\u0631\u0627\u062A \u0627\u0644\u0642\u0634\u0631\u064A\u0629 (Parlatoria blanchardi) - \u062A\u0633\u0628\u0628 \u0627\u0635\u0641\u0631\u0627\u0631 \u0627\u0644\u0633\u0639\u0641. \u0639\u0627\u0644\u062C \u0628\u0627\u0644\u0632\u064A\u062A \u0627\u0644\u0623\u0628\u064A\u0636 (2%) \u0641\u064A \u0623\u0648\u0627\u0626\u0644 \u0627\u0644\u0631\u0628\u064A\u0639. \u062D\u0627\u0641\u0638 \u0639\u0644\u0649 \u0646\u0638\u0627\u0641\u0629 \u0627\u0644\u0623\u0631\u0636\u060C \u0623\u0632\u0644 \u0627\u0644\u0633\u0639\u0641 \u0648\u0627\u0644\u062B\u0645\u0627\u0631 \u0627\u0644\u0645\u062A\u0633\u0627\u0642\u0637\u0629 \u0641\u0648\u0631\u064B\u0627 \u0644\u062A\u0642\u0644\u064A\u0644 \u0645\u062E\u0627\u0637\u0631 \u0627\u0644\u0625\u0635\u0627\u0628\u0629.",
        keywords: ["pest", "moth", "beetle", "scale", "resistant", "trap", "nematode", "weevil", "protection"],
        keywordsAr: ["\u0622\u0641\u0629", "\u062F\u0648\u062F\u0629", "\u062E\u0646\u0641\u0633\u0627\u0621", "\u0642\u0634\u0631\u064A\u0629", "\u0645\u0642\u0627\u0648\u0645", "\u0645\u0635\u064A\u062F\u0629", "\u0646\u064A\u0645\u0627\u062A\u0648\u062F\u0627", "\u0633\u0648\u0633\u0629", "\u062D\u0645\u0627\u064A\u0629"]
      },
      {
        topic: "soil",
        content: "Razeez palms prefer deep sandy soils with good drainage. They can tolerate slightly alkaline conditions up to pH 8.5, broader than most date varieties. Remarkably adaptable to poor soil conditions including low-fertility desert soils. However, optimal performance is achieved in sandy loam with 2-3% organic matter content. Razeez shows superior salt tolerance - can grow in soils with ECe up to 8 dS/m (moderate salinity). For new plantations in degraded soils, amend with 50-70 kg compost per planting hole, mix with native sand at 1:2 ratio. Minimum soil depth for Razeez: 1.5m of unrestricted root zone. Avoid hardpan layers within 2m of surface.",
        contentAr: "\u062A\u0641\u0636\u0644 \u0646\u062E\u064A\u0644 \u0627\u0644\u0631\u0632\u064A\u0632 \u0627\u0644\u062A\u0631\u0628\u0629 \u0627\u0644\u0631\u0645\u0644\u064A\u0629 \u0627\u0644\u0639\u0645\u064A\u0642\u0629 \u062C\u064A\u062F\u0629 \u0627\u0644\u062A\u0635\u0631\u064A\u0641. \u062A\u062A\u062D\u0645\u0644 \u0638\u0631\u0648\u0641 \u0642\u0644\u0648\u064A\u0629 \u0637\u0641\u064A\u0641\u0629 \u062D\u062A\u0649 pH 8.5\u060C \u0623\u0648\u0633\u0639 \u0645\u0646 \u0645\u0639\u0638\u0645 \u0623\u0635\u0646\u0627\u0641 \u0627\u0644\u062A\u0645\u0648\u0631. \u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u062A\u0643\u064A\u0641 \u0628\u0634\u0643\u0644 \u0645\u0644\u062D\u0648\u0638 \u0645\u0639 \u0638\u0631\u0648\u0641 \u0627\u0644\u062A\u0631\u0628\u0629 \u0627\u0644\u0641\u0642\u064A\u0631\u0629 \u0628\u0645\u0627 \u0641\u064A\u0647\u0627 \u062A\u0631\u0628\u0629 \u0627\u0644\u0635\u062D\u0631\u0627\u0621 \u0645\u0646\u062E\u0641\u0636\u0629 \u0627\u0644\u062E\u0635\u0648\u0628\u0629. \u0644\u0643\u0646 \u0627\u0644\u0623\u062F\u0627\u0621 \u0627\u0644\u0623\u0645\u062B\u0644 \u064A\u062A\u062D\u0642\u0642 \u0641\u064A \u0627\u0644\u062A\u0631\u0628\u0629 \u0627\u0644\u0631\u0645\u0644\u064A\u0629 \u0627\u0644\u0637\u0645\u064A\u064A\u0629 \u0628\u0646\u0633\u0628\u0629 \u0645\u0627\u062F\u0629 \u0639\u0636\u0648\u064A\u0629 2-3%. \u0627\u0644\u0631\u0632\u064A\u0632 \u064A\u0638\u0647\u0631 \u062A\u062D\u0645\u0644 \u0645\u0644\u0648\u062D\u0629 \u0645\u062A\u0641\u0648\u0642 - \u064A\u0645\u0643\u0646 \u0623\u0646 \u064A\u0646\u0645\u0648 \u0641\u064A \u062A\u0631\u0628\u0629 \u0628\u0645\u0648\u0635\u0644\u064A\u0629 \u0643\u0647\u0631\u0628\u0627\u0626\u064A\u0629 \u062D\u062A\u0649 8 \u062F\u064A\u0633\u064A\u0633\u0645\u0646\u0632/\u0645 (\u0645\u0644\u0648\u062D\u0629 \u0645\u0639\u062A\u062F\u0644\u0629). \u0644\u0644\u0645\u0632\u0627\u0631\u0639 \u0627\u0644\u062C\u062F\u064A\u062F\u0629 \u0641\u064A \u0627\u0644\u062A\u0631\u0628\u0629 \u0627\u0644\u0645\u062A\u062F\u0647\u0648\u0631\u0629\u060C \u0623\u0636\u0641 50-70 \u0643\u062C\u0645 \u0633\u0645\u0627\u062F \u0644\u0643\u0644 \u062D\u0641\u0631\u0629 \u0632\u0631\u0627\u0639\u0629 \u0645\u0639 \u062E\u0644\u0637 \u0628\u0627\u0644\u0631\u0645\u0644 \u0627\u0644\u0645\u062D\u0644\u064A \u0628\u0646\u0633\u0628\u0629 1:2.",
        keywords: ["soil", "sandy", "alkaline", "salt", "tolerant", "drainage", "poor", "compost", "organic"],
        keywordsAr: ["\u062A\u0631\u0628\u0629", "\u0631\u0645\u0644", "\u0642\u0644\u0648\u064A", "\u0645\u0644\u0648\u062D\u0629", "\u062A\u062D\u0645\u0644", "\u062A\u0635\u0631\u064A\u0641", "\u0641\u0642\u064A\u0631\u0629", "\u0633\u0645\u0627\u062F", "\u0639\u0636\u0648\u064A"]
      },
      {
        topic: "nutrition",
        content: "Razeez requires less fertilization than Khalas due to its adaptable nature. Apply a balanced fertilizer (15-15-15 NPK) twice yearly in spring (March) and late summer (August) at 1.5-2.5 kg per mature tree per application. Potassium supplementation during fruit development (May-July) improves date quality and sweetness - apply potassium sulfate at 1 kg/tree. Razeez responds well to organic fertilization: 20-40 kg well-composted manure per tree annually applied in winter (December). Micronutrient needs are lower than Khalas, but iron supplementation is still recommended in alkaline soils (iron chelate 30g/tree). Avoid over-fertilization - excessive nitrogen leads to vegetative growth at the expense of fruit production and increases pest susceptibility.",
        contentAr: "\u064A\u062A\u0637\u0644\u0628 \u0627\u0644\u0631\u0632\u064A\u0632 \u062A\u0633\u0645\u064A\u062F\u064B\u0627 \u0623\u0642\u0644 \u0645\u0646 \u0627\u0644\u062E\u0644\u0627\u0635 \u0628\u0633\u0628\u0628 \u0637\u0628\u064A\u0639\u062A\u0647 \u0627\u0644\u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u062A\u0643\u064A\u0641. \u0623\u0636\u0641 \u0633\u0645\u0627\u062F \u0645\u062A\u0648\u0627\u0632\u0646 (NPK 15-15-15) \u0645\u0631\u062A\u064A\u0646 \u0633\u0646\u0648\u064A\u064B\u0627 \u0641\u064A \u0627\u0644\u0631\u0628\u064A\u0639 (\u0645\u0627\u0631\u0633) \u0648\u0623\u0648\u0627\u062E\u0631 \u0627\u0644\u0635\u064A\u0641 (\u0623\u063A\u0633\u0637\u0633) \u0628\u0645\u0639\u062F\u0644 1.5-2.5 \u0643\u062C\u0645 \u0644\u0643\u0644 \u0646\u062E\u0644\u0629 \u0646\u0627\u0636\u062C\u0629. \u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0628\u0648\u062A\u0627\u0633\u064A\u0648\u0645 \u062E\u0644\u0627\u0644 \u0646\u0645\u0648 \u0627\u0644\u062B\u0645\u0627\u0631 (\u0645\u0627\u064A\u0648-\u064A\u0648\u0644\u064A\u0648) \u064A\u062D\u0633\u0646 \u062C\u0648\u062F\u0629 \u0627\u0644\u062A\u0645\u0648\u0631 \u0648\u062D\u0644\u0627\u0648\u062A\u0647\u0627 - \u0623\u0636\u0641 \u0643\u0628\u0631\u064A\u062A\u0627\u062A \u0627\u0644\u0628\u0648\u062A\u0627\u0633\u064A\u0648\u0645 \u0628\u0645\u0639\u062F\u0644 1 \u0643\u062C\u0645/\u0646\u062E\u0644\u0629. \u0627\u0644\u0631\u0632\u064A\u0632 \u064A\u0633\u062A\u062C\u064A\u0628 \u062C\u064A\u062F\u064B\u0627 \u0644\u0644\u062A\u0633\u0645\u064A\u062F \u0627\u0644\u0639\u0636\u0648\u064A: 20-40 \u0643\u062C\u0645 \u0633\u0645\u0627\u062F \u0628\u0644\u062F\u064A \u0645\u062A\u062D\u0644\u0644 \u0644\u0643\u0644 \u0646\u062E\u0644\u0629 \u0633\u0646\u0648\u064A\u064B\u0627 \u0641\u064A \u0627\u0644\u0634\u062A\u0627\u0621 (\u062F\u064A\u0633\u0645\u0628\u0631). \u0627\u062D\u062A\u064A\u0627\u062C\u0627\u062A \u0627\u0644\u0639\u0646\u0627\u0635\u0631 \u0627\u0644\u0635\u063A\u0631\u0649 \u0623\u0642\u0644 \u0645\u0646 \u0627\u0644\u062E\u0644\u0627\u0635\u060C \u0644\u0643\u0646 \u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u062D\u062F\u064A\u062F \u0644\u0627 \u062A\u0632\u0627\u0644 \u0645\u0637\u0644\u0648\u0628\u0629 \u0641\u064A \u0627\u0644\u062A\u0631\u0628\u0629 \u0627\u0644\u0642\u0644\u0648\u064A\u0629 (\u0643\u064A\u0644\u0627\u062A \u0627\u0644\u062D\u062F\u064A\u062F 30 \u062C\u0645/\u0646\u062E\u0644\u0629).",
        keywords: ["fertilizer", "npk", "potassium", "organic", "compost", "manure", "iron", "nutrition", "moderate"],
        keywordsAr: ["\u0633\u0645\u0627\u062F", "\u0628\u0648\u062A\u0627\u0633\u064A\u0648\u0645", "\u0639\u0636\u0648\u064A", "\u0633\u0645\u0627\u062F \u0628\u0644\u062F\u064A", "\u062D\u062F\u064A\u062F", "\u062A\u063A\u0630\u064A\u0629", "\u0645\u0639\u062A\u062F\u0644"]
      },
      {
        topic: "climate",
        content: "Razeez thrives in the hot, continental climate of central Saudi Arabia (Najd region). Summer temperatures of 40-50\xB0C are well-tolerated. Winter temperatures of 5-15\xB0C are optimal for dormancy. Razeez has better cold tolerance than many Gulf varieties - can survive brief exposure to -3\xB0C without significant damage. The variety requires 2,800-3,200 heat units for proper fruit maturation. Low humidity (20-40%) during the Tamr stage is ideal for natural drying on the tree. Razeez is relatively wind-resistant due to its robust trunk and flexible fronds, making it suitable for exposed locations. Dust storms can affect pollination if they occur during March-April flowering period.",
        contentAr: "\u064A\u0632\u062F\u0647\u0631 \u0627\u0644\u0631\u0632\u064A\u0632 \u0641\u064A \u0627\u0644\u0645\u0646\u0627\u062E \u0627\u0644\u062D\u0627\u0631 \u0627\u0644\u0642\u0627\u0631\u064A \u0644\u0648\u0633\u0637 \u0627\u0644\u0633\u0639\u0648\u062F\u064A\u0629 (\u0645\u0646\u0637\u0642\u0629 \u0646\u062C\u062F). \u062D\u0631\u0627\u0631\u0629 \u0627\u0644\u0635\u064A\u0641 40-50 \u062F\u0631\u062C\u0629 \u062A\u064F\u062A\u062D\u0645\u0644 \u062C\u064A\u062F\u064B\u0627. \u062D\u0631\u0627\u0631\u0629 \u0627\u0644\u0634\u062A\u0627\u0621 5-15 \u062F\u0631\u062C\u0629 \u0645\u062B\u0627\u0644\u064A\u0629 \u0644\u0644\u0633\u0643\u0648\u0646. \u0627\u0644\u0631\u0632\u064A\u0632 \u0644\u062F\u064A\u0647 \u062A\u062D\u0645\u0644 \u0628\u0631\u062F \u0623\u0641\u0636\u0644 \u0645\u0646 \u0623\u0635\u0646\u0627\u0641 \u0627\u0644\u062E\u0644\u064A\u062C - \u064A\u062A\u062D\u0645\u0644 \u062A\u0639\u0631\u0636\u064B\u0627 \u0642\u0635\u064A\u0631\u064B\u0627 \u062D\u062A\u0649 -3 \u062F\u0631\u062C\u0627\u062A. \u064A\u062A\u0637\u0644\u0628 \u0627\u0644\u0635\u0646\u0641 2,800-3,200 \u0648\u062D\u062F\u0629 \u062D\u0631\u0627\u0631\u064A\u0629 \u0644\u0646\u0636\u062C \u0627\u0644\u062B\u0645\u0627\u0631. \u0627\u0644\u0631\u0637\u0648\u0628\u0629 \u0627\u0644\u0645\u0646\u062E\u0641\u0636\u0629 (20-40%) \u062E\u0644\u0627\u0644 \u0645\u0631\u062D\u0644\u0629 \u0627\u0644\u062A\u0645\u0631 \u0645\u062B\u0627\u0644\u064A\u0629 \u0644\u0644\u062A\u062C\u0641\u064A\u0641 \u0627\u0644\u0637\u0628\u064A\u0639\u064A. \u0627\u0644\u0631\u0632\u064A\u0632 \u0645\u0642\u0627\u0648\u0645 \u0646\u0633\u0628\u064A\u064B\u0627 \u0644\u0644\u0631\u064A\u0627\u062D \u0628\u0633\u0628\u0628 \u062C\u0630\u0639\u0647 \u0627\u0644\u0642\u0648\u064A \u0648\u0633\u0639\u0641\u0647 \u0627\u0644\u0645\u0631\u0646.",
        keywords: ["climate", "heat", "cold", "continental", "najd", "temperature", "humidity", "wind", "dust"],
        keywordsAr: ["\u0645\u0646\u0627\u062E", "\u062D\u0631\u0627\u0631\u0629", "\u0628\u0631\u062F", "\u0642\u0627\u0631\u064A", "\u0646\u062C\u062F", "\u0631\u0637\u0648\u0628\u0629", "\u0631\u064A\u0627\u062D", "\u063A\u0628\u0627\u0631"]
      },
      {
        topic: "propagation",
        content: "Razeez produces abundant offshoots (8-15 per tree over its lifetime), making propagation straightforward. Select offshoots of 3-4 years old, weighing 8-20 kg. Razeez offshoots have a higher survival rate (90-97%) than most varieties when properly handled. Best planting season in Al-Qassim: September-November or February-March. After separation, leave offshoots to callus for 24-48 hours in shade before planting. Razeez is also popular for inter-planting with Sukkari or Safawi varieties in mixed orchards. Spacing: 7-9m between trees. Young Razeez trees grow faster than Khalas, often producing first commercial crop in year 5-6.",
        contentAr: "\u0627\u0644\u0631\u0632\u064A\u0632 \u064A\u0646\u062A\u062C \u0641\u0633\u0627\u0626\u0644 \u0648\u0641\u064A\u0631\u0629 (8-15 \u0641\u0633\u064A\u0644\u0629 \u0644\u0644\u0646\u062E\u0644\u0629 \u0637\u0648\u0627\u0644 \u062D\u064A\u0627\u062A\u0647\u0627)\u060C \u0645\u0645\u0627 \u064A\u062C\u0639\u0644 \u0627\u0644\u0625\u0643\u062B\u0627\u0631 \u0633\u0647\u0644\u0627\u064B. \u0627\u062E\u062A\u0631 \u0641\u0633\u0627\u0626\u0644 \u0639\u0645\u0631\u0647\u0627 3-4 \u0633\u0646\u0648\u0627\u062A \u0628\u0648\u0632\u0646 8-20 \u0643\u062C\u0645. \u0641\u0633\u0627\u0626\u0644 \u0627\u0644\u0631\u0632\u064A\u0632 \u0644\u062F\u064A\u0647\u0627 \u0645\u0639\u062F\u0644 \u0646\u062C\u0627\u062D \u0623\u0639\u0644\u0649 (90-97%) \u0645\u0646 \u0645\u0639\u0638\u0645 \u0627\u0644\u0623\u0635\u0646\u0627\u0641 \u0639\u0646\u062F \u0627\u0644\u0645\u0639\u0627\u0645\u0644\u0629 \u0627\u0644\u0635\u062D\u064A\u062D\u0629. \u0623\u0641\u0636\u0644 \u0645\u0648\u0633\u0645 \u0644\u0644\u0632\u0631\u0627\u0639\u0629 \u0641\u064A \u0627\u0644\u0642\u0635\u064A\u0645: \u0633\u0628\u062A\u0645\u0628\u0631-\u0646\u0648\u0641\u0645\u0628\u0631 \u0623\u0648 \u0641\u0628\u0631\u0627\u064A\u0631-\u0645\u0627\u0631\u0633. \u0628\u0639\u062F \u0627\u0644\u0641\u0635\u0644\u060C \u0627\u062A\u0631\u0643 \u0627\u0644\u0641\u0633\u0627\u0626\u0644 \u0644\u062A\u062A\u0635\u0644\u0628 24-48 \u0633\u0627\u0639\u0629 \u0641\u064A \u0627\u0644\u0638\u0644 \u0642\u0628\u0644 \u0627\u0644\u0632\u0631\u0627\u0639\u0629. \u0627\u0644\u0631\u0632\u064A\u0632 \u0634\u0627\u0626\u0639 \u0623\u064A\u0636\u064B\u0627 \u0644\u0644\u0632\u0631\u0627\u0639\u0629 \u0627\u0644\u0645\u062E\u062A\u0644\u0637\u0629 \u0645\u0639 \u0627\u0644\u0633\u0643\u0631\u064A \u0623\u0648 \u0627\u0644\u0635\u0641\u0627\u0648\u064A. \u0627\u0644\u0645\u0633\u0627\u0641\u0629: 7-9\u0645 \u0628\u064A\u0646 \u0627\u0644\u0646\u062E\u064A\u0644.",
        keywords: ["propagation", "offshoot", "planting", "survival", "spacing", "nursery", "growth", "fast"],
        keywordsAr: ["\u0625\u0643\u062B\u0627\u0631", "\u0641\u0633\u064A\u0644\u0629", "\u0632\u0631\u0627\u0639\u0629", "\u0646\u062C\u0627\u062D", "\u0645\u0633\u0627\u0641\u0629", "\u0645\u0634\u062A\u0644", "\u0646\u0645\u0648", "\u0633\u0631\u064A\u0639"]
      },
      {
        topic: "storage",
        content: "Razeez dates have superior natural storage capabilities due to their lower moisture content at the Tamr stage (15-18%). At room temperature in airtight containers, Tamr-stage Razeez keeps for 12-18 months. Refrigerated at 5\xB0C: up to 24 months. Frozen at -18\xB0C: up to 3 years with minimal quality degradation. Razeez is the preferred variety for date paste (Ajwa) production: pit, grind, press into molds at 60\xB0C. Date syrup (Dibs): soak in warm water, extract, boil to 72 Brix, yields 40-50% of original weight. Razeez dates are also excellent for stuffed date confections. Dehydrated Razeez date powder (ground to <1mm, 5% moisture) is used as a natural sweetener and has a shelf life of 2+ years.",
        contentAr: "\u062A\u0645\u0648\u0631 \u0627\u0644\u0631\u0632\u064A\u0632 \u0644\u062F\u064A\u0647\u0627 \u0642\u062F\u0631\u0629 \u062A\u062E\u0632\u064A\u0646 \u0637\u0628\u064A\u0639\u064A\u0629 \u0645\u0645\u062A\u0627\u0632\u0629 \u0628\u0633\u0628\u0628 \u0627\u0646\u062E\u0641\u0627\u0636 \u0646\u0633\u0628\u0629 \u0627\u0644\u0631\u0637\u0648\u0628\u0629 \u0641\u064A \u0645\u0631\u062D\u0644\u0629 \u0627\u0644\u062A\u0645\u0631 (15-18%). \u0641\u064A \u062F\u0631\u062C\u0629 \u062D\u0631\u0627\u0631\u0629 \u0627\u0644\u063A\u0631\u0641\u0629 \u0628\u062D\u0627\u0648\u064A\u0627\u062A \u0645\u062D\u0643\u0645\u0629\u060C \u062A\u064F\u062D\u0641\u0638 \u062A\u0645\u0648\u0631 \u0627\u0644\u0631\u0632\u064A\u0632 \u0644\u0645\u062F\u0629 12-18 \u0634\u0647\u0631\u064B\u0627. \u0645\u0628\u0631\u062F\u0629 \u0639\u0644\u0649 5 \u062F\u0631\u062C\u0627\u062A: \u062D\u062A\u0649 24 \u0634\u0647\u0631\u064B\u0627. \u0645\u062C\u0645\u062F\u0629 \u0639\u0644\u0649 -18 \u062F\u0631\u062C\u0629: \u062D\u062A\u0649 3 \u0633\u0646\u0648\u0627\u062A. \u0627\u0644\u0631\u0632\u064A\u0632 \u0627\u0644\u0635\u0646\u0641 \u0627\u0644\u0645\u0641\u0636\u0644 \u0644\u0625\u0646\u062A\u0627\u062C \u0627\u0644\u0639\u062C\u0648\u0629: \u0625\u0632\u0627\u0644\u0629 \u0627\u0644\u0646\u0648\u0649\u060C \u0637\u062D\u0646\u060C \u0643\u0628\u0633 \u0641\u064A \u0642\u0648\u0627\u0644\u0628 \u0639\u0644\u0649 60 \u062F\u0631\u062C\u0629. \u062F\u0628\u0633 \u0627\u0644\u062A\u0645\u0631: \u0646\u0642\u0639 \u0641\u064A \u0645\u0627\u0621 \u062F\u0627\u0641\u0626\u060C \u0627\u0633\u062A\u062E\u0644\u0627\u0635\u060C \u063A\u0644\u064A \u062D\u062A\u0649 72 \u0628\u0631\u0643\u0633. \u0645\u0633\u062D\u0648\u0642 \u062A\u0645\u0631 \u0627\u0644\u0631\u0632\u064A\u0632 \u0627\u0644\u0645\u062C\u0641\u0641 (\u0645\u0637\u062D\u0648\u0646 \u0625\u0644\u0649 \u0623\u0642\u0644 \u0645\u0646 1 \u0645\u0645\u060C \u0631\u0637\u0648\u0628\u0629 5%) \u064A\u064F\u0633\u062A\u062E\u062F\u0645 \u0643\u0645\u064F\u062D\u0644\u064D\u0651 \u0637\u0628\u064A\u0639\u064A \u0648\u0645\u062F\u0629 \u0635\u0644\u0627\u062D\u064A\u062A\u0647 \u0623\u0643\u062B\u0631 \u0645\u0646 \u0633\u0646\u062A\u064A\u0646.",
        keywords: ["storage", "shelf", "life", "paste", "ajwa", "syrup", "dibs", "powder", "sweetener", "freeze"],
        keywordsAr: ["\u062A\u062E\u0632\u064A\u0646", "\u0635\u0644\u0627\u062D\u064A\u0629", "\u0639\u062C\u0648\u0629", "\u062F\u0628\u0633", "\u0645\u0633\u062D\u0648\u0642", "\u0645\u062D\u0644\u064A", "\u062A\u062C\u0645\u064A\u062F"]
      }
    ]
  },
  {
    title: "Shishi Palm",
    category: "Shishi",
    chunks: [
      {
        topic: "general",
        content: "Shishi is a widely cultivated variety in central and eastern Saudi Arabia, easily identified by its slightly varying color at the 'Bisar' stage where fruits show a distinctive two-tone appearance. The dates are medium-sized (2.5-4cm length) with a pleasant mild sweetness and firm texture. Popular in traditional Arabian cuisine and often served with Arabic coffee (Gahwa). The trees are well-suited to the hot, dry climate of central Saudi Arabia and are considered reliable producers. Shishi dates are reddish-brown when ripe with a slightly chewy consistency. The variety is commercially important for its consistent yields and adaptability.",
        contentAr: "\u0627\u0644\u0634\u064A\u0634\u064A \u0635\u0646\u0641 \u0645\u0632\u0631\u0648\u0639 \u0639\u0644\u0649 \u0646\u0637\u0627\u0642 \u0648\u0627\u0633\u0639 \u0641\u064A \u0648\u0633\u0637 \u0648\u0634\u0631\u0642 \u0627\u0644\u0633\u0639\u0648\u062F\u064A\u0629\u060C \u064A\u064F\u062A\u0639\u0631\u0641 \u0639\u0644\u064A\u0647 \u0628\u0633\u0647\u0648\u0644\u0629 \u0645\u0646 \u0644\u0648\u0646\u0647 \u0627\u0644\u0645\u062A\u063A\u064A\u0631 \u0641\u064A \u0645\u0631\u062D\u0644\u0629 \u0627\u0644\u0628\u0633\u0631 \u062D\u064A\u062B \u062A\u0638\u0647\u0631 \u0627\u0644\u062B\u0645\u0627\u0631 \u0628\u0645\u0638\u0647\u0631 \u062B\u0646\u0627\u0626\u064A \u0627\u0644\u0644\u0648\u0646 \u0645\u0645\u064A\u0632. \u0627\u0644\u062A\u0645\u0648\u0631 \u0645\u062A\u0648\u0633\u0637\u0629 \u0627\u0644\u062D\u062C\u0645 (2.5-4 \u0633\u0645) \u0630\u0627\u062A \u062D\u0644\u0627\u0648\u0629 \u0645\u0639\u062A\u062F\u0644\u0629 \u0644\u0637\u064A\u0641\u0629 \u0648\u0642\u0648\u0627\u0645 \u0645\u062A\u0645\u0627\u0633\u0643. \u0634\u0627\u0626\u0639\u0629 \u0641\u064A \u0627\u0644\u0645\u0637\u0628\u062E \u0627\u0644\u0639\u0631\u0628\u064A \u0627\u0644\u062A\u0642\u0644\u064A\u062F\u064A \u0648\u062A\u064F\u0642\u062F\u0645 \u063A\u0627\u0644\u0628\u064B\u0627 \u0645\u0639 \u0627\u0644\u0642\u0647\u0648\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629. \u0627\u0644\u0623\u0634\u062C\u0627\u0631 \u0645\u0644\u0627\u0626\u0645\u0629 \u0644\u0644\u0645\u0646\u0627\u062E \u0627\u0644\u062D\u0627\u0631 \u0627\u0644\u062C\u0627\u0641 \u0644\u0648\u0633\u0637 \u0627\u0644\u0633\u0639\u0648\u062F\u064A\u0629 \u0648\u0645\u0646\u062A\u062C\u0629 \u0628\u0634\u0643\u0644 \u0645\u0648\u062B\u0648\u0642. \u062A\u0645\u0648\u0631 \u0627\u0644\u0634\u064A\u0634\u064A \u0628\u0646\u064A\u0629 \u0645\u062D\u0645\u0631\u0629 \u0639\u0646\u062F \u0627\u0644\u0646\u0636\u062C \u0628\u0642\u0648\u0627\u0645 \u0645\u0637\u0627\u0637\u064A \u0642\u0644\u064A\u0644\u0627\u064B.",
        keywords: ["shishi", "variety", "description", "two-tone", "medium", "coffee", "overview", "bisar"],
        keywordsAr: ["\u0634\u064A\u0634\u064A", "\u0635\u0646\u0641", "\u0648\u0635\u0641", "\u062B\u0646\u0627\u0626\u064A", "\u0645\u062A\u0648\u0633\u0637", "\u0642\u0647\u0648\u0629", "\u0628\u0633\u0631"]
      },
      {
        topic: "irrigation",
        content: "Shishi palms prefer sandy soil with good drainage. Water frequently but lightly during the flowering season (March-May) - daily irrigation with 40-60 liters to support pollination and fruit set. In summer (June-August), irrigate 3 times weekly with 100-150 liters per tree. Reduce watering during the Tamr stage (September) to concentrate sugars in the fruit - once weekly with 50-80 liters. Shishi is moderately drought-tolerant but responds significantly to consistent irrigation with 20-30% higher yields. Surface irrigation in shallow basins (2m diameter, 15cm deep) works well. For drip systems, use 4 emitters at 8 liters/hour each. Critical irrigation period: May-July during fruit development - water stress here reduces fruit size by 15-25%.",
        contentAr: "\u062A\u0641\u0636\u0644 \u0646\u062E\u064A\u0644 \u0627\u0644\u0634\u064A\u0634\u064A \u0627\u0644\u062A\u0631\u0628\u0629 \u0627\u0644\u0631\u0645\u0644\u064A\u0629 \u062C\u064A\u062F\u0629 \u0627\u0644\u062A\u0635\u0631\u064A\u0641. \u0623\u0631\u0648\u0650 \u0628\u0634\u0643\u0644 \u0645\u062A\u0643\u0631\u0631 \u0648\u062E\u0641\u064A\u0641 \u0623\u062B\u0646\u0627\u0621 \u0645\u0648\u0633\u0645 \u0627\u0644\u062A\u0632\u0647\u064A\u0631 (\u0645\u0627\u0631\u0633-\u0645\u0627\u064A\u0648) - \u0631\u064A \u064A\u0648\u0645\u064A \u0628\u0645\u0639\u062F\u0644 40-60 \u0644\u062A\u0631 \u0644\u062F\u0639\u0645 \u0627\u0644\u062A\u0644\u0642\u064A\u062D \u0648\u0639\u0642\u062F \u0627\u0644\u062B\u0645\u0627\u0631. \u0641\u064A \u0627\u0644\u0635\u064A\u0641 (\u064A\u0648\u0646\u064A\u0648-\u0623\u063A\u0633\u0637\u0633)\u060C \u0623\u0631\u0648\u0650 3 \u0645\u0631\u0627\u062A \u0623\u0633\u0628\u0648\u0639\u064A\u064B\u0627 \u0628\u0645\u0639\u062F\u0644 100-150 \u0644\u062A\u0631. \u0642\u0644\u0651\u0644 \u0627\u0644\u0631\u064A \u0623\u062B\u0646\u0627\u0621 \u0645\u0631\u062D\u0644\u0629 \u0627\u0644\u062A\u0645\u0631 (\u0633\u0628\u062A\u0645\u0628\u0631) \u0644\u062A\u0631\u0643\u064A\u0632 \u0627\u0644\u0633\u0643\u0631 - \u0645\u0631\u0629 \u0623\u0633\u0628\u0648\u0639\u064A\u064B\u0627 \u0628\u0645\u0639\u062F\u0644 50-80 \u0644\u062A\u0631. \u0627\u0644\u0634\u064A\u0634\u064A \u0645\u062A\u062D\u0645\u0644 \u0644\u0644\u062C\u0641\u0627\u0641 \u0628\u0634\u0643\u0644 \u0645\u0639\u062A\u062F\u0644 \u0644\u0643\u0646\u0647 \u064A\u0633\u062A\u062C\u064A\u0628 \u0628\u0634\u0643\u0644 \u0643\u0628\u064A\u0631 \u0644\u0644\u0631\u064A \u0627\u0644\u0645\u0646\u062A\u0638\u0645 \u0645\u0639 \u0625\u0646\u062A\u0627\u062C \u0623\u0639\u0644\u0649 \u0628\u0646\u0633\u0628\u0629 20-30%. \u0627\u0644\u0631\u064A \u0627\u0644\u0633\u0637\u062D\u064A \u0641\u064A \u0623\u062D\u0648\u0627\u0636 \u0636\u062D\u0644\u0629 (\u0642\u0637\u0631 2\u0645\u060C \u0639\u0645\u0642 15 \u0633\u0645) \u064A\u0639\u0645\u0644 \u062C\u064A\u062F\u064B\u0627.",
        keywords: ["irrigation", "water", "flowering", "drainage", "summer", "drip", "basin", "drought", "fruit"],
        keywordsAr: ["\u0631\u064A", "\u0645\u0627\u0621", "\u062A\u0632\u0647\u064A\u0631", "\u062A\u0635\u0631\u064A\u0641", "\u0635\u064A\u0641", "\u062A\u0646\u0642\u064A\u0637", "\u062D\u0648\u0636", "\u062C\u0641\u0627\u0641", "\u062B\u0645\u0627\u0631"]
      },
      {
        topic: "harvest",
        content: "Shishi harvest season starts mid-season, typically July-August for Khalal/Bisr stages and extends to September for Tamr stage. The fruits have a distinct two-tone color before fully ripening, transitioning from yellow-green to a uniform reddish-brown amber. Harvest when 60-70% of the bunch has ripened for optimal flavor. Average yield: 60-100 kg per mature tree. Shishi dates are versatile - they can be eaten at Khalal stage (crunchy, mildly sweet), Rutab stage (soft, rich), or Tamr stage (dried, concentrated sweetness). For fresh market: harvest at Rutab, pack in 500g or 1kg trays. For processing: harvest at Tamr for date bars, stuffed dates, and confections. Handle gently - Shishi dates bruise more easily than Khalas at the Rutab stage.",
        contentAr: "\u0645\u0648\u0633\u0645 \u062D\u0635\u0627\u062F \u0627\u0644\u0634\u064A\u0634\u064A \u064A\u0628\u062F\u0623 \u0641\u064A \u0645\u0646\u062A\u0635\u0641 \u0627\u0644\u0645\u0648\u0633\u0645\u060C \u0639\u0627\u062F\u0629 \u064A\u0648\u0644\u064A\u0648-\u0623\u063A\u0633\u0637\u0633 \u0644\u0645\u0631\u0627\u062D\u0644 \u0627\u0644\u062E\u0644\u0627\u0644/\u0627\u0644\u0628\u0633\u0631 \u0648\u064A\u0645\u062A\u062F \u062D\u062A\u0649 \u0633\u0628\u062A\u0645\u0628\u0631 \u0644\u0645\u0631\u062D\u0644\u0629 \u0627\u0644\u062A\u0645\u0631. \u0627\u0644\u062B\u0645\u0627\u0631 \u0644\u0647\u0627 \u0644\u0648\u0646 \u062B\u0646\u0627\u0626\u064A \u0645\u0645\u064A\u0632 \u0642\u0628\u0644 \u0627\u0644\u0646\u0636\u062C \u0627\u0644\u0643\u0627\u0645\u0644\u060C \u062A\u062A\u062D\u0648\u0644 \u0645\u0646 \u0623\u0635\u0641\u0631-\u0623\u062E\u0636\u0631 \u0625\u0644\u0649 \u0628\u0646\u064A \u0645\u062D\u0645\u0631 \u0643\u0647\u0631\u0645\u0627\u0646\u064A \u0645\u0648\u062D\u062F. \u0627\u062D\u0635\u062F \u0639\u0646\u062F\u0645\u0627 \u064A\u0646\u0636\u062C 60-70% \u0645\u0646 \u0627\u0644\u0639\u0630\u0642 \u0644\u0644\u0646\u0643\u0647\u0629 \u0627\u0644\u0645\u062B\u0644\u0649. \u0645\u062A\u0648\u0633\u0637 \u0627\u0644\u0625\u0646\u062A\u0627\u062C: 60-100 \u0643\u062C\u0645 \u0644\u0644\u0646\u062E\u0644\u0629 \u0627\u0644\u0646\u0627\u0636\u062C\u0629. \u062A\u0645\u0648\u0631 \u0627\u0644\u0634\u064A\u0634\u064A \u0645\u062A\u0639\u062F\u062F\u0629 \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645 - \u062A\u0624\u0643\u0644 \u0641\u064A \u0645\u0631\u062D\u0644\u0629 \u0627\u0644\u062E\u0644\u0627\u0644 (\u0645\u0642\u0631\u0645\u0634\u0629\u060C \u062D\u0644\u0648\u0629 \u0642\u0644\u064A\u0644\u0627\u064B)\u060C \u0627\u0644\u0631\u0637\u0628 (\u0637\u0631\u064A\u0629\u060C \u063A\u0646\u064A\u0629)\u060C \u0623\u0648 \u0627\u0644\u062A\u0645\u0631 (\u0645\u062C\u0641\u0641\u0629\u060C \u062D\u0644\u0627\u0648\u0629 \u0645\u0631\u0643\u0632\u0629). \u0644\u0644\u0633\u0648\u0642 \u0627\u0644\u0637\u0627\u0632\u062C: \u0627\u062D\u0635\u062F \u0641\u064A \u0645\u0631\u062D\u0644\u0629 \u0627\u0644\u0631\u0637\u0628. \u0644\u0644\u062A\u0635\u0646\u064A\u0639: \u0627\u062D\u0635\u062F \u0641\u064A \u0645\u0631\u062D\u0644\u0629 \u0627\u0644\u062A\u0645\u0631.",
        keywords: ["harvest", "bisar", "two-tone", "yield", "khalal", "rutab", "tamr", "versatile", "fresh", "processing"],
        keywordsAr: ["\u062D\u0635\u0627\u062F", "\u0628\u0633\u0631", "\u062B\u0646\u0627\u0626\u064A", "\u0625\u0646\u062A\u0627\u062C", "\u062E\u0644\u0627\u0644", "\u0631\u0637\u0628", "\u062A\u0645\u0631", "\u0637\u0627\u0632\u062C", "\u062A\u0635\u0646\u064A\u0639"]
      },
      {
        topic: "pests",
        content: "Shishi palms are prone to dust mites (Oligonychus afrasiaticus), especially in dry, hot conditions during June-August. Washing bunches with pressurized water spray (weekly) can reduce mite populations by 70-80%. For severe infestations, apply Abamectin (0.5ml/L) or sulfur dust (30g/bunch). Also susceptible to the Rhinoceros beetle (Oryctes rhinoceros) which attacks the growing point. Install light traps at 3m height to attract and capture adult beetles. Regular pruning of old fronds reduces pest harboring sites. Bird damage can be significant on Shishi - use reflective tape or nylon net covers on bunches during Rutab stage. Monitor for Red Palm Weevil using acoustic detection devices placed against the trunk monthly.",
        contentAr: "\u0646\u062E\u064A\u0644 \u0627\u0644\u0634\u064A\u0634\u064A \u0639\u0631\u0636\u0629 \u0644\u0639\u0646\u0627\u0643\u0628 \u0627\u0644\u063A\u0628\u0627\u0631 (Oligonychus afrasiaticus)\u060C \u062E\u0627\u0635\u0629 \u0641\u064A \u0627\u0644\u0638\u0631\u0648\u0641 \u0627\u0644\u062C\u0627\u0641\u0629 \u0627\u0644\u062D\u0627\u0631\u0629 \u062E\u0644\u0627\u0644 \u064A\u0648\u0646\u064A\u0648-\u0623\u063A\u0633\u0637\u0633. \u063A\u0633\u0644 \u0627\u0644\u0639\u0630\u0648\u0642 \u0628\u0645\u0627\u0621 \u0645\u0636\u063A\u0648\u0637 (\u0623\u0633\u0628\u0648\u0639\u064A\u064B\u0627) \u064A\u0642\u0644\u0644 \u0623\u0639\u062F\u0627\u062F \u0627\u0644\u0639\u0646\u0627\u0643\u0628 \u0628\u0646\u0633\u0628\u0629 70-80%. \u0644\u0644\u0625\u0635\u0627\u0628\u0627\u062A \u0627\u0644\u0634\u062F\u064A\u062F\u0629\u060C \u0637\u0628\u0651\u0642 \u0623\u0628\u0627\u0645\u0643\u062A\u064A\u0646 (0.5 \u0645\u0644/\u0644\u062A\u0631) \u0623\u0648 \u0645\u0633\u062D\u0648\u0642 \u0643\u0628\u0631\u064A\u062A (30 \u062C\u0645/\u0639\u0630\u0642). \u0639\u0631\u0636\u0629 \u0623\u064A\u0636\u064B\u0627 \u0644\u062E\u0646\u0641\u0633\u0627\u0621 \u0648\u062D\u064A\u062F \u0627\u0644\u0642\u0631\u0646 \u0627\u0644\u062A\u064A \u062A\u0647\u0627\u062C\u0645 \u0646\u0642\u0637\u0629 \u0627\u0644\u0646\u0645\u0648. \u062B\u0628\u0651\u062A \u0645\u0635\u0627\u0626\u062F \u0636\u0648\u0626\u064A\u0629 \u0639\u0644\u0649 \u0627\u0631\u062A\u0641\u0627\u0639 3\u0645. \u0627\u0644\u062A\u0642\u0644\u064A\u0645 \u0627\u0644\u0645\u0646\u062A\u0638\u0645 \u0644\u0644\u0633\u0639\u0641 \u0627\u0644\u0642\u062F\u064A\u0645 \u064A\u0642\u0644\u0644 \u0645\u0648\u0627\u0642\u0639 \u0625\u064A\u0648\u0627\u0621 \u0627\u0644\u0622\u0641\u0627\u062A. \u0623\u0636\u0631\u0627\u0631 \u0627\u0644\u0637\u064A\u0648\u0631 \u0642\u062F \u062A\u0643\u0648\u0646 \u0643\u0628\u064A\u0631\u0629 - \u0627\u0633\u062A\u062E\u062F\u0645 \u0634\u0631\u064A\u0637\u064B\u0627 \u0639\u0627\u0643\u0633\u064B\u0627 \u0623\u0648 \u0634\u0628\u0627\u0643\u064B\u0627 \u0639\u0644\u0649 \u0627\u0644\u0639\u0630\u0648\u0642.",
        keywords: ["pest", "mite", "dust", "beetle", "rhinoceros", "bird", "trap", "spray", "sulfur", "weevil"],
        keywordsAr: ["\u0622\u0641\u0629", "\u0639\u0646\u0643\u0628\u0648\u062A", "\u063A\u0628\u0627\u0631", "\u062E\u0646\u0641\u0633\u0627\u0621", "\u0637\u064A\u0648\u0631", "\u0645\u0635\u064A\u062F\u0629", "\u0631\u0634", "\u0643\u0628\u0631\u064A\u062A", "\u0633\u0648\u0633\u0629"]
      },
      {
        topic: "soil",
        content: "Shishi palms do best in light sandy soils with moderate fertility. Good drainage is essential as they are more sensitive to waterlogging than Khalas or Razeez. Add sand to heavy clay soils before planting (at least 40% sand content in planting area). Optimal soil pH: 7.0-7.5, narrower range than other varieties. Shishi has moderate salt tolerance (ECe up to 5 dS/m). Apply organic mulch (palm frond pieces, composted bark) in a 1.5m radius ring around the trunk base. Soil preparation for new planting: excavate 1.2m x 1.2m x 1m hole, fill with amended mix of native soil (50%), sand (30%), and composted manure (20%). Install drainage tiles in areas with water tables higher than 2m below surface.",
        contentAr: "\u062A\u0646\u0645\u0648 \u0646\u062E\u064A\u0644 \u0627\u0644\u0634\u064A\u0634\u064A \u0623\u0641\u0636\u0644 \u0641\u064A \u0627\u0644\u062A\u0631\u0628\u0629 \u0627\u0644\u0631\u0645\u0644\u064A\u0629 \u0627\u0644\u062E\u0641\u064A\u0641\u0629 \u0630\u0627\u062A \u0627\u0644\u062E\u0635\u0648\u0628\u0629 \u0627\u0644\u0645\u0639\u062A\u062F\u0644\u0629. \u0627\u0644\u062A\u0635\u0631\u064A\u0641 \u0627\u0644\u062C\u064A\u062F \u0636\u0631\u0648\u0631\u064A \u0644\u0623\u0646\u0647\u0627 \u0623\u0643\u062B\u0631 \u062D\u0633\u0627\u0633\u064A\u0629 \u0644\u0644\u062A\u0634\u0628\u0639 \u0628\u0627\u0644\u0645\u0627\u0621 \u0645\u0646 \u0627\u0644\u062E\u0644\u0627\u0635 \u0623\u0648 \u0627\u0644\u0631\u0632\u064A\u0632. \u0623\u0636\u0641 \u0631\u0645\u0644\u0627\u064B \u0644\u0644\u062A\u0631\u0628\u0629 \u0627\u0644\u0637\u064A\u0646\u064A\u0629 \u0627\u0644\u062B\u0642\u064A\u0644\u0629 \u0642\u0628\u0644 \u0627\u0644\u0632\u0631\u0627\u0639\u0629 (40% \u0631\u0645\u0644 \u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644). \u062D\u0645\u0648\u0636\u0629 \u0627\u0644\u062A\u0631\u0628\u0629 \u0627\u0644\u0645\u062B\u0644\u0649: 7.0-7.5. \u0627\u0644\u0634\u064A\u0634\u064A \u0644\u062F\u064A\u0647 \u062A\u062D\u0645\u0644 \u0645\u0644\u0648\u062D\u0629 \u0645\u0639\u062A\u062F\u0644 (\u062D\u062A\u0649 5 \u062F\u064A\u0633\u064A\u0633\u0645\u0646\u0632/\u0645). \u0636\u0639 \u0646\u0634\u0627\u0631\u0629 \u0639\u0636\u0648\u064A\u0629 \u0628\u0646\u0635\u0641 \u0642\u0637\u0631 1.5\u0645 \u062D\u0648\u0644 \u0642\u0627\u0639\u062F\u0629 \u0627\u0644\u062C\u0630\u0639. \u062A\u062D\u0636\u064A\u0631 \u0627\u0644\u062A\u0631\u0628\u0629 \u0644\u0644\u0632\u0631\u0627\u0639\u0629 \u0627\u0644\u062C\u062F\u064A\u062F\u0629: \u062D\u0641\u0631 1.2\u0645 \xD7 1.2\u0645 \xD7 1\u0645\u060C \u0645\u0644\u0621 \u0628\u062E\u0644\u064A\u0637 \u0645\u0646 \u0627\u0644\u062A\u0631\u0628\u0629 \u0627\u0644\u0645\u062D\u0644\u064A\u0629 (50%)\u060C \u0631\u0645\u0644 (30%)\u060C \u0648\u0633\u0645\u0627\u062F \u0645\u062A\u062D\u0644\u0644 (20%).",
        keywords: ["soil", "sandy", "drainage", "clay", "ph", "salt", "mulch", "waterlogging", "preparation"],
        keywordsAr: ["\u062A\u0631\u0628\u0629", "\u0631\u0645\u0644", "\u062A\u0635\u0631\u064A\u0641", "\u0637\u064A\u0646", "\u062D\u0645\u0648\u0636\u0629", "\u0645\u0644\u0648\u062D\u0629", "\u0646\u0634\u0627\u0631\u0629", "\u062A\u0634\u0628\u0639", "\u062A\u062D\u0636\u064A\u0631"]
      },
      {
        topic: "nutrition",
        content: "Apply a complete fertilizer with emphasis on potassium during fruit set (May-June). Standard program: NPK 12-12-17 (high potassium formula) at 2 kg/tree, three times yearly (March, June, September). Foliar feeding with micronutrients during the growing season improves fruit quality: spray zinc sulfate (3g/L), manganese sulfate (2g/L), and boric acid (1g/L) monthly from April to July. Organic matter application: 25-35 kg composted manure per tree in December. Avoid excessive nitrogen which promotes vegetative growth at the expense of fruit production. Shishi responds particularly well to potassium - applying extra K\u2082O (1.5 kg/tree of potassium sulfate in May) increases fruit sweetness by 8-12% Brix and improves color development.",
        contentAr: "\u0623\u0636\u0641 \u0633\u0645\u0627\u062F\u064B\u0627 \u0643\u0627\u0645\u0644\u0627\u064B \u0645\u0639 \u0627\u0644\u062A\u0631\u0643\u064A\u0632 \u0639\u0644\u0649 \u0627\u0644\u0628\u0648\u062A\u0627\u0633\u064A\u0648\u0645 \u0623\u062B\u0646\u0627\u0621 \u0639\u0642\u062F \u0627\u0644\u062B\u0645\u0627\u0631 (\u0645\u0627\u064A\u0648-\u064A\u0648\u0646\u064A\u0648). \u0627\u0644\u0628\u0631\u0646\u0627\u0645\u062C \u0627\u0644\u0642\u064A\u0627\u0633\u064A: NPK 12-12-17 (\u062A\u0631\u0643\u064A\u0628\u0629 \u0639\u0627\u0644\u064A\u0629 \u0627\u0644\u0628\u0648\u062A\u0627\u0633\u064A\u0648\u0645) \u0628\u0645\u0639\u062F\u0644 2 \u0643\u062C\u0645/\u0646\u062E\u0644\u0629\u060C \u062B\u0644\u0627\u062B \u0645\u0631\u0627\u062A \u0633\u0646\u0648\u064A\u064B\u0627 (\u0645\u0627\u0631\u0633\u060C \u064A\u0648\u0646\u064A\u0648\u060C \u0633\u0628\u062A\u0645\u0628\u0631). \u0627\u0644\u062A\u063A\u0630\u064A\u0629 \u0627\u0644\u0648\u0631\u0642\u064A\u0629 \u0628\u0627\u0644\u0639\u0646\u0627\u0635\u0631 \u0627\u0644\u0635\u063A\u0631\u0649: \u0631\u0634 \u0643\u0628\u0631\u064A\u062A\u0627\u062A \u0627\u0644\u0632\u0646\u0643 (3 \u062C\u0645/\u0644\u062A\u0631)\u060C \u0643\u0628\u0631\u064A\u062A\u0627\u062A \u0627\u0644\u0645\u0646\u063A\u0646\u064A\u0632 (2 \u062C\u0645/\u0644\u062A\u0631)\u060C \u0648\u062D\u0645\u0636 \u0627\u0644\u0628\u0648\u0631\u064A\u0643 (1 \u062C\u0645/\u0644\u062A\u0631) \u0634\u0647\u0631\u064A\u064B\u0627 \u0645\u0646 \u0623\u0628\u0631\u064A\u0644 \u0625\u0644\u0649 \u064A\u0648\u0644\u064A\u0648. \u0627\u0644\u0645\u0627\u062F\u0629 \u0627\u0644\u0639\u0636\u0648\u064A\u0629: 25-35 \u0643\u062C\u0645 \u0633\u0645\u0627\u062F \u0645\u062A\u062D\u0644\u0644 \u0644\u0643\u0644 \u0646\u062E\u0644\u0629 \u0641\u064A \u062F\u064A\u0633\u0645\u0628\u0631. \u062A\u062C\u0646\u0628 \u0627\u0644\u0625\u0641\u0631\u0627\u0637 \u0641\u064A \u0627\u0644\u0646\u064A\u062A\u0631\u0648\u062C\u064A\u0646. \u0627\u0644\u0634\u064A\u0634\u064A \u064A\u0633\u062A\u062C\u064A\u0628 \u0628\u0634\u0643\u0644 \u062E\u0627\u0635 \u0644\u0644\u0628\u0648\u062A\u0627\u0633\u064A\u0648\u0645 - \u0625\u0636\u0627\u0641\u0629 \u0643\u0628\u0631\u064A\u062A\u0627\u062A \u0627\u0644\u0628\u0648\u062A\u0627\u0633\u064A\u0648\u0645 (1.5 \u0643\u062C\u0645/\u0646\u062E\u0644\u0629 \u0641\u064A \u0645\u0627\u064A\u0648) \u062A\u0632\u064A\u062F \u062D\u0644\u0627\u0648\u0629 \u0627\u0644\u062B\u0645\u0627\u0631 \u0628\u0646\u0633\u0628\u0629 8-12% \u0628\u0631\u0643\u0633.",
        keywords: ["fertilizer", "potassium", "foliar", "zinc", "manganese", "boron", "organic", "npk", "sweetness"],
        keywordsAr: ["\u0633\u0645\u0627\u062F", "\u0628\u0648\u062A\u0627\u0633\u064A\u0648\u0645", "\u0648\u0631\u0642\u064A", "\u0632\u0646\u0643", "\u0645\u0646\u063A\u0646\u064A\u0632", "\u0628\u0648\u0631\u0648\u0646", "\u0639\u0636\u0648\u064A", "\u062D\u0644\u0627\u0648\u0629"]
      },
      {
        topic: "climate",
        content: "Shishi is well-suited to the hot, dry climate of central Saudi Arabia (Riyadh and surrounding areas). Temperature tolerance: 42-48\xB0C in summer, 5-18\xB0C in winter. The variety needs distinct seasonal temperature variation for optimal fruit quality - the difference between summer and winter temperatures influences sugar accumulation. Heat units required: 2,600-3,000 (base 18\xB0C). Shishi is moderately frost-sensitive - temperatures below -2\xB0C cause frond damage and may kill young trees. Optimal humidity for fruit development: 25-45%. Shishi dates can suffer from sunscald on exposed bunches during extreme heat (>48\xB0C) - cover bunches with breathable cloth during July-August heatwaves.",
        contentAr: "\u0627\u0644\u0634\u064A\u0634\u064A \u0645\u0644\u0627\u0626\u0645 \u0644\u0644\u0645\u0646\u0627\u062E \u0627\u0644\u062D\u0627\u0631 \u0627\u0644\u062C\u0627\u0641 \u0644\u0648\u0633\u0637 \u0627\u0644\u0633\u0639\u0648\u062F\u064A\u0629 (\u0627\u0644\u0631\u064A\u0627\u0636 \u0648\u0627\u0644\u0645\u0646\u0627\u0637\u0642 \u0627\u0644\u0645\u062D\u064A\u0637\u0629). \u062A\u062D\u0645\u0644 \u0627\u0644\u062D\u0631\u0627\u0631\u0629: 42-48 \u062F\u0631\u062C\u0629 \u0641\u064A \u0627\u0644\u0635\u064A\u0641\u060C 5-18 \u062F\u0631\u062C\u0629 \u0641\u064A \u0627\u0644\u0634\u062A\u0627\u0621. \u064A\u062D\u062A\u0627\u062C \u0627\u0644\u0635\u0646\u0641 \u062A\u0628\u0627\u064A\u0646 \u062D\u0631\u0627\u0631\u064A \u0645\u0648\u0633\u0645\u064A \u0648\u0627\u0636\u062D \u0644\u062C\u0648\u062F\u0629 \u0627\u0644\u062B\u0645\u0627\u0631 \u0627\u0644\u0645\u062B\u0644\u0649. \u0627\u0644\u0648\u062D\u062F\u0627\u062A \u0627\u0644\u062D\u0631\u0627\u0631\u064A\u0629 \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629: 2,600-3,000. \u0627\u0644\u0634\u064A\u0634\u064A \u062D\u0633\u0627\u0633 \u0645\u0639\u062A\u062F\u0644\u064B\u0627 \u0644\u0644\u0635\u0642\u064A\u0639 - \u062F\u0631\u062C\u0627\u062A \u062D\u0631\u0627\u0631\u0629 \u0623\u0642\u0644 \u0645\u0646 -2 \u062A\u062A\u0644\u0641 \u0627\u0644\u0633\u0639\u0641 \u0648\u0642\u062F \u062A\u0642\u062A\u0644 \u0627\u0644\u0623\u0634\u062C\u0627\u0631 \u0627\u0644\u0635\u063A\u064A\u0631\u0629. \u0627\u0644\u0631\u0637\u0648\u0628\u0629 \u0627\u0644\u0645\u062B\u0644\u0649 \u0644\u0646\u0645\u0648 \u0627\u0644\u062B\u0645\u0627\u0631: 25-45%. \u0642\u062F \u062A\u0639\u0627\u0646\u064A \u0645\u0646 \u062D\u0631\u0648\u0642 \u0627\u0644\u0634\u0645\u0633 \u0639\u0644\u0649 \u0627\u0644\u0639\u0630\u0648\u0642 \u0627\u0644\u0645\u0643\u0634\u0648\u0641\u0629 \u0641\u064A \u0627\u0644\u062D\u0631 \u0627\u0644\u0634\u062F\u064A\u062F (\u0623\u0639\u0644\u0649 \u0645\u0646 48 \u062F\u0631\u062C\u0629).",
        keywords: ["climate", "heat", "temperature", "frost", "humidity", "season", "sunscald", "riyadh"],
        keywordsAr: ["\u0645\u0646\u0627\u062E", "\u062D\u0631\u0627\u0631\u0629", "\u0635\u0642\u064A\u0639", "\u0631\u0637\u0648\u0628\u0629", "\u0645\u0648\u0633\u0645", "\u062D\u0631\u0648\u0642", "\u0627\u0644\u0631\u064A\u0627\u0636"]
      },
      {
        topic: "pollination",
        content: "Shishi palms flower from late February to early April, slightly earlier than Khalas. Each tree produces 8-12 female bunches. Manual pollination should be done within 3 days of spathe opening for best results. Shishi is somewhat less receptive to pollination than Khalas, so using fresh, high-quality pollen is important. Recommended pollen sources: use male palms known for compatibility with Shishi (Ghanami males are preferred). Apply more pollen strands per bunch (3-5 strands compared to 2-3 for Khalas). For Shishi, mechanical pollination using a pollen-talc mixture (1:8 ratio) blown into opened spathes works well. Expected fruit set: 60-75% with proper technique. Thin bunches to 8-10 per tree for optimal fruit size and quality.",
        contentAr: "\u062A\u0632\u0647\u0631 \u0646\u062E\u064A\u0644 \u0627\u0644\u0634\u064A\u0634\u064A \u0645\u0646 \u0623\u0648\u0627\u062E\u0631 \u0641\u0628\u0631\u0627\u064A\u0631 \u0625\u0644\u0649 \u0623\u0648\u0627\u0626\u0644 \u0623\u0628\u0631\u064A\u0644\u060C \u0623\u0628\u0643\u0631 \u0642\u0644\u064A\u0644\u0627\u064B \u0645\u0646 \u0627\u0644\u062E\u0644\u0627\u0635. \u0643\u0644 \u0646\u062E\u0644\u0629 \u062A\u0646\u062A\u062C 8-12 \u0639\u0630\u0642\u064B\u0627 \u0623\u0646\u062B\u0648\u064A\u064B\u0627. \u0627\u0644\u062A\u0644\u0642\u064A\u062D \u0627\u0644\u064A\u062F\u0648\u064A \u064A\u062C\u0628 \u0623\u0646 \u064A\u062A\u0645 \u062E\u0644\u0627\u0644 3 \u0623\u064A\u0627\u0645 \u0645\u0646 \u0641\u062A\u062D \u0627\u0644\u0637\u0644\u0639\u0629. \u0627\u0644\u0634\u064A\u0634\u064A \u0623\u0642\u0644 \u0627\u0633\u062A\u0642\u0628\u0627\u0644\u0627\u064B \u0644\u0644\u062A\u0644\u0642\u064A\u062D \u0645\u0646 \u0627\u0644\u062E\u0644\u0627\u0635\u060C \u0644\u0630\u0627 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0644\u0642\u0627\u062D \u0637\u0627\u0632\u062C \u0639\u0627\u0644\u064A \u0627\u0644\u062C\u0648\u062F\u0629 \u0645\u0647\u0645. \u0645\u0635\u0627\u062F\u0631 \u0627\u0644\u0644\u0642\u0627\u062D \u0627\u0644\u0645\u0641\u0636\u0644\u0629: \u0641\u062D\u0648\u0644 \u063A\u0646\u0627\u0645\u064A. \u0636\u0639 \u062E\u0635\u0644\u0627\u062A \u0644\u0642\u0627\u062D \u0623\u0643\u062B\u0631 \u0644\u0643\u0644 \u0639\u0630\u0642 (3-5 \u0645\u0642\u0627\u0631\u0646\u0629 \u0628\u0640 2-3 \u0644\u0644\u062E\u0644\u0627\u0635). \u0627\u0644\u062A\u0644\u0642\u064A\u062D \u0627\u0644\u0645\u064A\u0643\u0627\u0646\u064A\u0643\u064A \u0628\u062E\u0644\u064A\u0637 \u0644\u0642\u0627\u062D \u0648\u062A\u0644\u0643 (1:8) \u064A\u0639\u0645\u0644 \u062C\u064A\u062F\u064B\u0627. \u0639\u0642\u062F \u0627\u0644\u062B\u0645\u0627\u0631 \u0627\u0644\u0645\u062A\u0648\u0642\u0639: 60-75%. \u062E\u0641\u0651\u0641 \u0627\u0644\u0639\u0630\u0648\u0642 \u0625\u0644\u0649 8-10 \u0644\u0643\u0644 \u0646\u062E\u0644\u0629 \u0644\u0644\u062D\u062C\u0645 \u0648\u0627\u0644\u062C\u0648\u062F\u0629 \u0627\u0644\u0645\u062B\u0644\u0649.",
        keywords: ["pollination", "pollen", "spathe", "flower", "male", "bunch", "thinning", "fruit", "set"],
        keywordsAr: ["\u062A\u0644\u0642\u064A\u062D", "\u0644\u0642\u0627\u062D", "\u0637\u0644\u0639\u0629", "\u0632\u0647\u0631\u0629", "\u0630\u0643\u0631", "\u0639\u0630\u0642", "\u062E\u0641", "\u062B\u0645\u0627\u0631", "\u0639\u0642\u062F"]
      }
    ]
  }
];
async function generateEmbeddingWithRetry(text2, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await generateEmbedding(text2);
    } catch (err) {
      const msg = err.message;
      if (msg.includes("GEMINI_API_KEY not set")) {
        return null;
      }
      if (attempt < maxRetries) {
        await new Promise((res) => setTimeout(res, 1e3 * attempt));
      } else {
        console.warn(`Failed to generate embedding after ${maxRetries} attempts:`, msg);
        return null;
      }
    }
  }
  return null;
}
async function seedKnowledgeBase() {
  const existingDocs = await db.select().from(documents);
  if (existingDocs.length > 0) {
    const existingChunks = await db.select().from(chunks).where(eq2(chunks.documentId, existingDocs[0].id));
    if (existingChunks.length > 0 && existingChunks[0].contentAr) {
      console.log("Knowledge base already seeded with full RAG data, skipping...");
      return;
    }
    console.log("Upgrading knowledge base to full RAG system...");
    for (const doc of existingDocs) {
      await db.delete(chunks).where(eq2(chunks.documentId, doc.id));
    }
    await db.delete(documents).where(eq2(documents.id, documents.id));
  }
  console.log("Seeding comprehensive RAG knowledge base...");
  for (const entry of knowledgeBase) {
    const [doc] = await db.insert(documents).values({
      title: entry.title,
      category: entry.category,
      contentType: "text",
      metadata: { source: "rag_v2", version: 2, chunksCount: entry.chunks.length }
    }).returning();
    for (let i = 0; i < entry.chunks.length; i++) {
      const chunk = entry.chunks[i];
      const embeddingText = `${chunk.topic}: ${chunk.content}`;
      const embedding = await generateEmbeddingWithRetry(embeddingText);
      await db.insert(chunks).values({
        documentId: doc.id,
        topic: chunk.topic,
        content: chunk.content,
        contentAr: chunk.contentAr,
        keywords: chunk.keywords,
        keywordsAr: chunk.keywordsAr,
        embedding: embedding ?? void 0,
        chunkIndex: i
      });
    }
  }
  const totalChunks = knowledgeBase.reduce((sum, e) => sum + e.chunks.length, 0);
  console.log(`RAG knowledge base seeded: ${knowledgeBase.length} documents, ${totalChunks} chunks (bilingual with keywords + embeddings)`);
}
async function backfillEmbeddings() {
  if (!process.env.GEMINI_API_KEY) {
    console.log("GEMINI_API_KEY not set \u2014 skipping embedding backfill (add key to enable semantic search)");
    return;
  }
  const chunksWithoutEmbedding = await db.select({
    id: chunks.id,
    topic: chunks.topic,
    content: chunks.content
  }).from(chunks).where(isNull(chunks.embedding));
  if (chunksWithoutEmbedding.length === 0) {
    console.log("All chunks already have embeddings.");
    return;
  }
  console.log(`Backfilling embeddings for ${chunksWithoutEmbedding.length} chunks...`);
  let succeeded = 0;
  let failed = 0;
  for (const chunk of chunksWithoutEmbedding) {
    const embeddingText = `${chunk.topic}: ${chunk.content}`;
    const embedding = await generateEmbeddingWithRetry(embeddingText);
    if (embedding) {
      await db.update(chunks).set({ embedding }).where(eq2(chunks.id, chunk.id));
      succeeded++;
    } else {
      failed++;
    }
    await new Promise((res) => setTimeout(res, 200));
  }
  console.log(`Embedding backfill complete: ${succeeded} succeeded, ${failed} failed`);
}

// backend/routes.ts
import * as fs from "node:fs";
import * as path from "node:path";
var MODELS_DIR = path.join(process.cwd(), "backend", "models");
var INFERENCE_URL = `http://127.0.0.1:${process.env.INFERENCE_PORT || 5001}`;
var geminiApiKey2 = process.env.AI_INTEGRATIONS_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
var geminiBaseUrl2 = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
var aiConfig2 = {
  apiKey: geminiApiKey2
};
if (geminiBaseUrl2) {
  aiConfig2.httpOptions = { apiVersion: "", baseUrl: geminiBaseUrl2 };
}
var ai2 = new GoogleGenAI2(aiConfig2);
async function registerRoutes(app2) {
  await ensureTables();
  await seedKnowledgeBase();
  backfillEmbeddings().catch(
    (err) => console.warn("Background embedding backfill error:", err.message)
  );
  app2.post("/api/classify", async (req, res) => {
    try {
      const { base64, mimeType: clientMimeType, lang } = req.body;
      if (!base64) {
        return res.status(400).json({ error: "No image provided" });
      }
      const base64Image = base64.includes(",") ? base64.split(",")[1] : base64;
      const mimeType = clientMimeType || "image/jpeg";
      let modelResult = null;
      try {
        const inferenceRes = await fetch(`${INFERENCE_URL}/predict`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base64: base64Image })
        });
        if (inferenceRes.ok) {
          modelResult = await inferenceRes.json();
          console.log("PyTorch model prediction:", modelResult);
        } else {
          console.warn("Inference server returned error, falling back to Gemini");
        }
      } catch (err) {
        console.warn("Inference server unavailable, falling back to Gemini:", err.message);
      }
      if (modelResult) {
        if (modelResult.confidence >= 0.96) {
          let description = "";
          try {
            const descResponse = await ai2.models.generateContent({
              model: "gemini-2.5-flash",
              contents: [
                {
                  role: "user",
                  parts: [
                    {
                      inlineData: { data: base64Image, mimeType }
                    },
                    {
                      text: `This image has been classified by a ConvNeXt deep learning model as "${modelResult.class}" date palm variety with ${(modelResult.confidence * 100).toFixed(1)}% confidence.

Write a brief expert description (2-3 sentences) about what you see in the image and the characteristics of the "${modelResult.class}" variety. Include distinguishing features visible in the image.
${lang === "ar" ? "Write entirely in Arabic." : "Write entirely in English."}`
                    }
                  ]
                }
              ]
            });
            description = descResponse.text || "";
          } catch {
            const descriptions = {
              Khalas: {
                en: "Khalas dates are golden-amber colored with a rich caramel flavor. They are one of the most prized varieties in the Gulf region.",
                ar: "\u062A\u0645\u0648\u0631 \u0627\u0644\u062E\u0644\u0627\u0635 \u0630\u0627\u062A \u0644\u0648\u0646 \u0630\u0647\u0628\u064A \u0643\u0647\u0631\u0645\u0627\u0646\u064A \u0628\u0646\u0643\u0647\u0629 \u0643\u0631\u0627\u0645\u064A\u0644 \u063A\u0646\u064A\u0629. \u0648\u0647\u064A \u0645\u0646 \u0623\u0643\u062B\u0631 \u0627\u0644\u0623\u0635\u0646\u0627\u0641 \u0627\u0644\u0645\u0631\u063A\u0648\u0628\u0629 \u0641\u064A \u0645\u0646\u0637\u0642\u0629 \u0627\u0644\u062E\u0644\u064A\u062C."
              },
              Razeez: {
                en: "Razeez dates are dark brown and elongated with a sweet, mild flavor. They are commonly grown in Saudi Arabia.",
                ar: "\u062A\u0645\u0648\u0631 \u0627\u0644\u0631\u0632\u064A\u0632 \u0628\u0646\u064A\u0629 \u062F\u0627\u0643\u0646\u0629 \u0648\u0645\u0633\u062A\u0637\u064A\u0644\u0629 \u0630\u0627\u062A \u0646\u0643\u0647\u0629 \u062D\u0644\u0648\u0629 \u0645\u0639\u062A\u062F\u0644\u0629. \u062A\u064F\u0632\u0631\u0639 \u0628\u0634\u0643\u0644 \u0634\u0627\u0626\u0639 \u0641\u064A \u0627\u0644\u0645\u0645\u0644\u0643\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u0627\u0644\u0633\u0639\u0648\u062F\u064A\u0629."
              },
              Shishi: {
                en: "Shishi dates are small to medium-sized with a dark color and sweet taste. They are popular in the Eastern Province of Saudi Arabia.",
                ar: "\u062A\u0645\u0648\u0631 \u0627\u0644\u0634\u064A\u0634\u064A \u0635\u063A\u064A\u0631\u0629 \u0625\u0644\u0649 \u0645\u062A\u0648\u0633\u0637\u0629 \u0627\u0644\u062D\u062C\u0645 \u0630\u0627\u062A \u0644\u0648\u0646 \u062F\u0627\u0643\u0646 \u0648\u0637\u0639\u0645 \u062D\u0644\u0648. \u062A\u062D\u0638\u0649 \u0628\u0634\u0639\u0628\u064A\u0629 \u0641\u064A \u0627\u0644\u0645\u0646\u0637\u0642\u0629 \u0627\u0644\u0634\u0631\u0642\u064A\u0629 \u0628\u0627\u0644\u0645\u0645\u0644\u0643\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u0627\u0644\u0633\u0639\u0648\u062F\u064A\u0629."
              }
            };
            const langKey = lang === "ar" ? "ar" : "en";
            description = descriptions[modelResult.class]?.[langKey] || "";
          }
          return res.json({
            isPalm: true,
            class: modelResult.class,
            confidence: modelResult.confidence,
            probabilities: modelResult.probabilities,
            folds_used: modelResult.folds_used,
            source: "convnext_ensemble",
            description
          });
        } else {
          const lowConfDesc = lang === "ar" ? `\u0646\u0648\u0639 \u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641. \u064A\u0631\u062C\u0649 \u0627\u0644\u062A\u0642\u0627\u0637 \u0635\u0648\u0631\u0629 \u0623\u0648\u0636\u062D \u0623\u0648 \u062A\u062C\u0631\u0628\u0629 \u0632\u0627\u0648\u064A\u0629 \u0645\u062E\u062A\u0644\u0641\u0629 \u0644\u0644\u062D\u0635\u0648\u0644 \u0639\u0644\u0649 \u0646\u062A\u064A\u062C\u0629 \u0623\u062F\u0642.` : `Unknown type. Try taking a clearer photo or a different angle for a more accurate result.`;
          return res.json({
            isPalm: false,
            class: "Unknown",
            confidence: modelResult.confidence,
            probabilities: modelResult.probabilities,
            folds_used: modelResult.folds_used,
            source: "convnext_ensemble",
            description: lowConfDesc
          });
        }
      }
      const response = await ai2.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: { data: base64Image, mimeType }
              },
              {
                text: `You are an expert agricultural botanist specializing in date palm identification. Analyze this image and determine if it shows a date palm tree or dates fruit.

If it IS a date palm or dates, classify it as one of these varieties: "Khalas", "Razeez", or "Shishi".

Respond ONLY with valid JSON in this exact format:
{
  "isPalm": true/false,
  "class": "Khalas" | "Razeez" | "Shishi" | "Unknown",
  "confidence": 0.0-1.0,
  "description": "Brief description of what you see and why you classified it this way"
}

If not a palm tree, set isPalm to false, class to "Unknown", and describe what you actually see.
${lang === "ar" ? "Write the description in Arabic." : "Write the description in English."}`
              }
            ]
          }
        ]
      });
      const text2 = response.text || "";
      const jsonMatch = text2.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        result.source = "gemini_vision";
        res.json(result);
      } else {
        res.json({ isPalm: false, class: "Unknown", confidence: 0, description: "Could not analyze the image", source: "gemini_vision" });
      }
    } catch (error) {
      console.error("Classification error:", error);
      res.status(500).json({ error: "Failed to classify image" });
    }
  });
  app2.get("/api/sessions", async (_req, res) => {
    try {
      const sessions = await db.select().from(chatSessions).orderBy(desc(chatSessions.createdAt));
      res.json(sessions);
    } catch (error) {
      console.error("Error fetching sessions:", error);
      res.status(500).json({ error: "Failed to fetch sessions" });
    }
  });
  app2.post("/api/sessions", async (req, res) => {
    try {
      const { treeClass, imageData, title } = req.body;
      const [session] = await db.insert(chatSessions).values({
        treeClass: treeClass || null,
        imageData: imageData || null,
        title: title || `${treeClass || "Palm"} Analysis`
      }).returning();
      res.status(201).json(session);
    } catch (error) {
      console.error("Error creating session:", error);
      res.status(500).json({ error: "Failed to create session" });
    }
  });
  app2.delete("/api/sessions/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(chatMessages).where(eq3(chatMessages.sessionId, id));
      await db.delete(chatSessions).where(eq3(chatSessions.id, id));
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting session:", error);
      res.status(500).json({ error: "Failed to delete session" });
    }
  });
  app2.get("/api/sessions/:id/messages", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const msgs = await db.select().from(chatMessages).where(eq3(chatMessages.sessionId, id)).orderBy(chatMessages.createdAt);
      res.json(msgs);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });
  app2.post("/api/sessions/:id/messages", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const { role, content } = req.body;
      const [msg] = await db.insert(chatMessages).values({ sessionId, role, content }).returning();
      res.status(201).json(msg);
    } catch (error) {
      console.error("Error saving message:", error);
      res.status(500).json({ error: "Failed to save message" });
    }
  });
  app2.post("/api/sessions/:id/chat", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const { content, lang } = req.body;
      const isArabic = lang === "ar";
      const [session] = await db.select().from(chatSessions).where(eq3(chatSessions.id, sessionId));
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      await db.insert(chatMessages).values({ sessionId, role: "user", content });
      const category = session.treeClass && session.treeClass !== "Unknown" ? session.treeClass : null;
      const ragResult = await retrieveWithQueryExpansion(content, category, lang || "en", 5);
      const ragContext = ragResult.context;
      console.log("[RAG] Query:", content.substring(0, 80));
      console.log("[RAG] Retrieved:", ragResult.sources.length, "chunks, top score:", ragResult.sources[0]?.score?.toFixed(2) || "N/A");
      const history = await db.select().from(chatMessages).where(eq3(chatMessages.sessionId, sessionId)).orderBy(chatMessages.createdAt);
      const chatHistory = history.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      }));
      const treeInfo = session.treeClass && session.treeClass !== "Unknown" ? isArabic ? `\u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u062A\u0639\u0631\u0651\u0641 \u0639\u0644\u0649 \u0646\u062E\u0644\u0629 \u0645\u0646 \u0646\u0648\u0639 ${session.treeClass} \u0645\u0646 \u0627\u0644\u0635\u0648\u0631\u0629.` : `The user has identified a ${session.treeClass} palm tree from their image.` : isArabic ? "\u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u064A\u0633\u0623\u0644 \u0639\u0646 \u0627\u0644\u0646\u062E\u064A\u0644 \u0628\u0634\u0643\u0644 \u0639\u0627\u0645." : "The user is asking about palm trees in general.";
      const ragSourceInfo = ragResult.sources.length > 0 ? ragResult.sources.map((s) => `${s.category}/${s.topic} (score: ${s.score.toFixed(1)})`).join(", ") : "no specific matches";
      const systemPrompt = isArabic ? `\u0623\u0646\u062A \u0645\u0633\u062A\u0634\u0627\u0631 \u0632\u0631\u0627\u0639\u064A \u062E\u0628\u064A\u0631 \u0645\u062A\u062E\u0635\u0635 \u062D\u0635\u0631\u064A\u0627\u064B \u0641\u064A \u0646\u062E\u064A\u0644 \u0627\u0644\u062A\u0645\u0631 \u0641\u064A \u0634\u0628\u0647 \u0627\u0644\u062C\u0632\u064A\u0631\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629. \u062A\u0642\u062F\u0645 \u0646\u0635\u0627\u0626\u062D \u0639\u0645\u0644\u064A\u0629 \u0648\u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u062A\u0637\u0628\u064A\u0642 \u0644\u0644\u0645\u0632\u0627\u0631\u0639\u064A\u0646 \u0648\u0627\u0644\u0645\u0647\u062A\u0645\u064A\u0646.

${treeInfo}

${ragContext ? `\u0633\u064A\u0627\u0642 \u0642\u0627\u0639\u062F\u0629 \u0627\u0644\u0645\u0639\u0631\u0641\u0629 (\u0645\u0635\u0627\u062F\u0631: ${ragSourceInfo}):
${ragContext}

\u062A\u0639\u0644\u064A\u0645\u0627\u062A \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u0633\u064A\u0627\u0642:
- \u0627\u0639\u062A\u0645\u062F \u0628\u0634\u0643\u0644 \u0623\u0633\u0627\u0633\u064A \u0639\u0644\u0649 \u0627\u0644\u0645\u0639\u0644\u0648\u0645\u0627\u062A \u0645\u0646 \u0642\u0627\u0639\u062F\u0629 \u0627\u0644\u0645\u0639\u0631\u0641\u0629 \u0623\u0639\u0644\u0627\u0647
- \u0627\u062F\u0645\u062C \u0627\u0644\u0645\u0639\u0644\u0648\u0645\u0627\u062A \u0645\u0646 \u0645\u0635\u0627\u062F\u0631 \u0645\u062A\u0639\u062F\u062F\u0629 \u0625\u0630\u0627 \u0643\u0627\u0646\u062A \u0630\u0627\u062A \u0635\u0644\u0629
- \u0627\u0630\u0643\u0631 \u0623\u0631\u0642\u0627\u0645\u064B\u0627 \u0648\u0646\u0633\u0628\u064B\u0627 \u0645\u062D\u062F\u062F\u0629 \u0645\u0646 \u0627\u0644\u0633\u064A\u0627\u0642 \u0639\u0646\u062F \u0627\u0644\u0625\u0645\u0643\u0627\u0646
- \u0625\u0630\u0627 \u0643\u0627\u0646 \u0627\u0644\u0633\u064A\u0627\u0642 \u0644\u0627 \u064A\u063A\u0637\u064A \u0627\u0644\u0625\u062C\u0627\u0628\u0629 \u0628\u0627\u0644\u0643\u0627\u0645\u0644\u060C \u0623\u0643\u0645\u0644 \u0645\u0646 \u062E\u0628\u0631\u062A\u0643 \u0645\u0639 \u0627\u0644\u0625\u0634\u0627\u0631\u0629 \u0625\u0644\u0649 \u0630\u0644\u0643` : "\u0644\u0627 \u064A\u0648\u062C\u062F \u0633\u064A\u0627\u0642 \u0645\u062D\u062F\u062F \u0645\u0646 \u0642\u0627\u0639\u062F\u0629 \u0627\u0644\u0645\u0639\u0631\u0641\u0629. \u0642\u062F\u0645 \u0646\u0635\u064A\u062D\u0629 \u062E\u0628\u064A\u0631 \u0639\u0627\u0645\u0629 \u0639\u0646 \u0646\u062E\u064A\u0644 \u0627\u0644\u062A\u0645\u0631."}

\u0627\u0644\u0625\u0631\u0634\u0627\u062F\u0627\u062A:
- \u0623\u062C\u0628 \u062F\u0627\u0626\u0645\u0627\u064B \u0628\u0627\u0644\u0644\u063A\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629
- \u0643\u0646 \u0648\u062F\u0648\u062F\u0627\u064B \u0648\u0645\u0647\u0646\u064A\u0627\u064B \u0648\u0645\u062E\u062A\u0635\u0631\u0627\u064B
- \u0642\u062F\u0645 \u0646\u0635\u0627\u0626\u062D \u0639\u0645\u0644\u064A\u0629 \u0648\u062A\u0648\u0635\u064A\u0627\u062A \u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u062A\u0637\u0628\u064A\u0642
- \u0627\u0630\u0643\u0631 \u0623\u0631\u0642\u0627\u0645\u064B\u0627 \u0648\u0645\u0642\u0627\u064A\u064A\u0633 \u0645\u062D\u062F\u062F\u0629 \u0639\u0646\u062F \u0627\u0644\u0625\u0645\u0643\u0627\u0646

\u0642\u0627\u0639\u062F\u0629 \u0635\u0627\u0631\u0645\u0629 - \u0646\u0637\u0627\u0642 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629:
- \u0623\u0646\u062A \u0645\u062A\u062E\u0635\u0635 \u0641\u0642\u0637 \u0641\u064A \u0646\u062E\u064A\u0644 \u0627\u0644\u062A\u0645\u0631 \u0648\u0627\u0644\u0632\u0631\u0627\u0639\u0629 \u0648\u0627\u0644\u062A\u0631\u0628\u0629 \u0648\u0627\u0644\u0631\u064A \u0648\u0627\u0644\u0622\u0641\u0627\u062A \u0648\u0627\u0644\u062D\u0635\u0627\u062F \u0648\u0627\u0644\u062A\u0633\u0645\u064A\u062F \u0648\u0627\u0644\u0645\u0646\u0627\u062E \u0627\u0644\u0645\u062A\u0639\u0644\u0642 \u0628\u0627\u0644\u0646\u062E\u064A\u0644
- \u0625\u0630\u0627 \u0633\u0623\u0644 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u0639\u0646 \u0623\u064A \u0645\u0648\u0636\u0648\u0639 \u062E\u0627\u0631\u062C \u0646\u0637\u0627\u0642 \u0627\u0644\u0646\u062E\u064A\u0644 \u0648\u0627\u0644\u0632\u0631\u0627\u0639\u0629 (\u0645\u062B\u0644: \u0627\u0644\u0628\u0631\u0645\u062C\u0629\u060C \u0627\u0644\u0637\u0628\u062E\u060C \u0627\u0644\u0631\u064A\u0627\u0636\u0629\u060C \u0627\u0644\u0633\u064A\u0627\u0633\u0629\u060C \u0627\u0644\u062A\u0627\u0631\u064A\u062E \u063A\u064A\u0631 \u0627\u0644\u0632\u0631\u0627\u0639\u064A\u060C \u0627\u0644\u0631\u064A\u0627\u0636\u064A\u0627\u062A\u060C \u0627\u0644\u0623\u062E\u0628\u0627\u0631\u060C \u0623\u0648 \u0623\u064A \u0645\u0648\u0636\u0648\u0639 \u0622\u062E\u0631)\u060C \u0623\u062C\u0628 \u0641\u0642\u0637 \u0628\u0640: "\u0639\u0630\u0631\u0627\u064B\u060C \u0623\u0646\u0627 \u0645\u062A\u062E\u0635\u0635 \u0641\u0642\u0637 \u0641\u064A \u0646\u062E\u064A\u0644 \u0627\u0644\u062A\u0645\u0631 \u0648\u0627\u0644\u0632\u0631\u0627\u0639\u0629. \u064A\u0645\u0643\u0646\u0646\u064A \u0645\u0633\u0627\u0639\u062F\u062A\u0643 \u0641\u064A \u0623\u064A \u0633\u0624\u0627\u0644 \u064A\u062A\u0639\u0644\u0642 \u0628\u0632\u0631\u0627\u0639\u0629 \u0627\u0644\u0646\u062E\u064A\u0644 \u0648\u0631\u0639\u0627\u064A\u062A\u0647\u0627."
- \u0644\u0627 \u062A\u062D\u0627\u0648\u0644 \u0627\u0644\u0625\u062C\u0627\u0628\u0629 \u0639\u0644\u0649 \u0623\u064A \u0633\u0624\u0627\u0644 \u062E\u0627\u0631\u062C \u0627\u0644\u0646\u0637\u0627\u0642 \u062D\u062A\u0649 \u0644\u0648 \u0643\u0646\u062A \u062A\u0639\u0631\u0641 \u0627\u0644\u0625\u062C\u0627\u0628\u0629` : `You are an expert agricultural advisor specializing EXCLUSIVELY in Date Palm trees in the Arabian Peninsula. You provide practical, actionable advice to farmers and enthusiasts.

${treeInfo}

${ragContext ? `KNOWLEDGE BASE CONTEXT (sources: ${ragSourceInfo}):
${ragContext}

CONTEXT USAGE INSTRUCTIONS:
- Base your answers primarily on the knowledge base information above
- Synthesize information from multiple sources when relevant
- Cite specific numbers, percentages, and measurements from the context when possible
- If the context doesn't fully cover the answer, supplement with your expertise but mention this` : "No specific knowledge base context available. Provide general expert advice about date palm trees."}

Guidelines:
- Always respond in English
- Be friendly, professional, and concise
- Provide practical tips with specific measurements and numbers when possible
- Include actionable recommendations

STRICT SCOPE RULE:
- You ONLY answer questions about date palm trees, agriculture, soil, irrigation, pests, harvesting, fertilization, and climate related to palm cultivation
- If the user asks about ANY topic outside of palm trees and agriculture (such as: programming, cooking, sports, politics, non-agricultural history, math, news, or any other unrelated topic), respond ONLY with: "I'm sorry, I specialize only in date palm trees and agriculture. I can help you with any questions about palm tree cultivation and care."
- Do NOT attempt to answer any out-of-scope question even if you know the answer`;
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      const stream = await ai2.models.generateContentStream({
        model: "gemini-2.5-flash",
        contents: chatHistory,
        config: {
          systemInstruction: systemPrompt,
          maxOutputTokens: 2048,
          temperature: 0.7
        }
      });
      let fullResponse = "";
      for await (const chunk of stream) {
        const text2 = chunk.text || "";
        if (text2) {
          fullResponse += text2;
          res.write(`data: ${JSON.stringify({ content: text2 })}

`);
        }
      }
      await db.insert(chatMessages).values({ sessionId, role: "assistant", content: fullResponse });
      res.write(`data: [DONE]

`);
      res.end();
    } catch (error) {
      console.error("Chat error:", error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: "Failed to generate response" })}

`);
        res.end();
      } else {
        res.status(500).json({ error: "Failed to process chat" });
      }
    }
  });
  app2.post("/api/rag/search", async (req, res) => {
    try {
      const { query, category, lang, topK } = req.body;
      if (!query) {
        return res.status(400).json({ error: "Query is required" });
      }
      const result = await retrieveWithQueryExpansion(query, category || null, lang || "en", topK || 5);
      res.json({
        query,
        category: category || "all",
        lang: lang || "en",
        resultsCount: result.sources.length,
        sources: result.sources.map((s) => ({
          id: s.id,
          category: s.category,
          topic: s.topic,
          score: parseFloat(s.score.toFixed(3)),
          contentPreview: (lang === "ar" && s.contentAr ? s.contentAr : s.content).substring(0, 200) + "..."
        })),
        context: result.context,
        debug: result.debugInfo
      });
    } catch (error) {
      console.error("RAG search error:", error);
      res.status(500).json({ error: "RAG search failed" });
    }
  });
  app2.get("/api/rag/stats", async (_req, res) => {
    try {
      const allDocs = await db.select().from(documents);
      const allChunks = await db.select().from(chunks);
      const topicCounts = {};
      const categoryCounts = {};
      for (const chunk of allChunks) {
        topicCounts[chunk.topic] = (topicCounts[chunk.topic] || 0) + 1;
      }
      for (const doc of allDocs) {
        categoryCounts[doc.category] = (categoryCounts[doc.category] || 0) + 1;
      }
      const hasArabic = allChunks.filter((c) => c.contentAr).length;
      const hasKeywords = allChunks.filter((c) => c.keywords && c.keywords.length > 0).length;
      res.json({
        documents: allDocs.length,
        chunks: allChunks.length,
        bilingualChunks: hasArabic,
        chunksWithKeywords: hasKeywords,
        topicDistribution: topicCounts,
        categoryDistribution: categoryCounts,
        ragVersion: 2,
        features: ["bm25_scoring", "topic_boost", "keyword_matching", "query_expansion", "bilingual_ar_en"]
      });
    } catch (error) {
      console.error("RAG stats error:", error);
      res.status(500).json({ error: "Failed to get RAG stats" });
    }
  });
  app2.get("/api/models", async (_req, res) => {
    try {
      if (!fs.existsSync(MODELS_DIR)) {
        fs.mkdirSync(MODELS_DIR, { recursive: true });
      }
      const files = fs.readdirSync(MODELS_DIR).filter((f) => f.endsWith(".pth") || f.endsWith(".pt"));
      const models = files.map((f) => {
        const stats = fs.statSync(path.join(MODELS_DIR, f));
        return {
          name: f,
          size: stats.size,
          sizeFormatted: `${(stats.size / (1024 * 1024)).toFixed(1)} MB`,
          modified: stats.mtime.toISOString()
        };
      });
      res.json({ directory: MODELS_DIR, models });
    } catch (error) {
      console.error("Error listing models:", error);
      res.status(500).json({ error: "Failed to list models" });
    }
  });
  app2.get("/api/knowledge-base", async (_req, res) => {
    try {
      const result = await getAllKnowledgeBase();
      res.json(result);
    } catch (error) {
      console.error("Error fetching knowledge base:", error);
      res.status(500).json({ error: "Failed to fetch knowledge base" });
    }
  });
  const httpServer = createServer(app2);
  return httpServer;
}

// backend/index.ts
import * as fs2 from "fs";
import * as path2 from "path";
import { spawn } from "child_process";
var app = express();
var log = console.log;
function setupCors(app2) {
  app2.use((req, res, next) => {
    const origins = /* @__PURE__ */ new Set();
    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }
    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        origins.add(`https://${d.trim()}`);
      });
    }
    const origin = req.header("origin");
    const isLocalhost = origin?.startsWith("http://localhost:") || origin?.startsWith("http://127.0.0.1:");
    if (origin && (origins.has(origin) || isLocalhost)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
      );
      res.header("Access-Control-Allow-Headers", "Content-Type");
      res.header("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
}
function setupBodyParsing(app2) {
  app2.use(
    express.json({
      limit: "10mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app2.use(express.urlencoded({ extended: false, limit: "10mb" }));
}
function setupRequestLogging(app2) {
  app2.use((req, res, next) => {
    const start = Date.now();
    const path3 = req.path;
    let capturedJsonResponse = void 0;
    const originalResJson = res.json;
    res.json = function(bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };
    res.on("finish", () => {
      if (!path3.startsWith("/api")) return;
      const duration = Date.now() - start;
      let logLine = `${req.method} ${path3} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    });
    next();
  });
}
function getAppName() {
  try {
    const appJsonPath = path2.resolve(process.cwd(), "app.json");
    const appJsonContent = fs2.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}
function serveExpoManifest(platform, res) {
  const manifestPath = path2.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json"
  );
  if (!fs2.existsSync(manifestPath)) {
    return res.status(404).json({ error: `Manifest not found for platform: ${platform}` });
  }
  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");
  const manifest = fs2.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}
function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expoServerUrl = process.env.EXPO_SERVER_URL || `${host}`;
  log(`baseUrl`, baseUrl);
  log(`expoServerUrl`, expoServerUrl);
  const html = landingPageTemplate.replace(/BASE_URL_PLACEHOLDER/g, baseUrl).replace(/EXPS_URL_PLACEHOLDER/g, expoServerUrl).replace(/APP_NAME_PLACEHOLDER/g, appName);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}
function configureExpoAndLanding(app2) {
  const templatePath = path2.resolve(
    process.cwd(),
    "backend",
    "templates",
    "landing-page.html"
  );
  const landingPageTemplate = fs2.readFileSync(templatePath, "utf-8");
  const appName = getAppName();
  log("Serving static Expo files with dynamic manifest routing");
  app2.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    if (req.path !== "/" && req.path !== "/manifest") {
      return next();
    }
    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }
    if (req.path === "/") {
      return serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName
      });
    }
    next();
  });
  app2.use("/assets", express.static(path2.resolve(process.cwd(), "assets")));
  app2.use(express.static(path2.resolve(process.cwd(), "static-build")));
  log("Expo routing: Checking expo-platform header on / and /manifest");
}
function setupErrorHandler(app2) {
  app2.use((err, _req, res, next) => {
    const error = err;
    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    return res.status(status).json({ message });
  });
}
var inferenceProcess = null;
function startInferenceServer() {
  const inferenceScript = path2.resolve(process.cwd(), "backend", "inference_server.py");
  if (!fs2.existsSync(inferenceScript)) {
    log("Inference server script not found, skipping PyTorch model loading");
    return;
  }
  const modelsDir = path2.resolve(process.cwd(), "backend", "models");
  const modelFiles = fs2.readdirSync(modelsDir).filter((f) => f.endsWith(".pth"));
  if (modelFiles.length === 0) {
    log("No .pth model files found, skipping inference server");
    return;
  }
  log(`Starting Python inference server with ${modelFiles.length} model files...`);
  inferenceProcess = spawn("python3", [inferenceScript], {
    env: { ...process.env, INFERENCE_PORT: process.env.INFERENCE_PORT || "5001" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  inferenceProcess.stdout?.on("data", (data) => {
    const msg = data.toString().trim();
    if (msg) log(`[inference] ${msg}`);
  });
  inferenceProcess.stderr?.on("data", (data) => {
    const msg = data.toString().trim();
    if (msg) log(`[inference] ${msg}`);
  });
  inferenceProcess.on("exit", (code) => {
    log(`[inference] Process exited with code ${code}`);
    inferenceProcess = null;
  });
}
function stopInferenceServer() {
  if (inferenceProcess) {
    inferenceProcess.kill("SIGTERM");
    inferenceProcess = null;
  }
}
process.on("SIGTERM", () => {
  stopInferenceServer();
  process.exit(0);
});
process.on("SIGINT", () => {
  stopInferenceServer();
  process.exit(0);
});
(async () => {
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);
  configureExpoAndLanding(app);
  startInferenceServer();
  const server = await registerRoutes(app);
  setupErrorHandler(app);
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true
    },
    () => {
      log(`express server serving on port ${port}`);
    }
  );
})();
