import { db } from "./db";
import { documents, chunks } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { GoogleGenAI } from "@google/genai";

const geminiApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const geminiBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;

const aiConfig: ConstructorParameters<typeof GoogleGenAI>[0] = {
  apiKey: geminiApiKey,
};
if (geminiBaseUrl) {
  aiConfig.httpOptions = { apiVersion: "", baseUrl: geminiBaseUrl };
}
const ai = new GoogleGenAI(aiConfig);

interface ScoredChunk {
  id: number;
  documentId: number;
  topic: string;
  content: string;
  contentAr: string | null;
  keywords: string[] | null;
  score: number;
  category: string;
}

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
  "as", "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "here", "there", "when", "where", "why", "how", "all", "each",
  "every", "both", "few", "more", "most", "other", "some", "such", "no",
  "nor", "not", "only", "own", "same", "so", "than", "too", "very",
  "just", "because", "but", "and", "or", "if", "while", "about", "what",
  "which", "who", "whom", "this", "that", "these", "those", "am", "it",
  "its", "my", "your", "his", "her", "our", "their", "i", "me", "we",
  "you", "he", "she", "they", "them", "up", "down",
]);

const ARABIC_STOPWORDS = new Set([
  "في", "من", "على", "إلى", "عن", "مع", "هذا", "هذه", "ذلك", "تلك",
  "التي", "الذي", "هو", "هي", "هم", "هن", "أنا", "نحن", "أنت", "أنتم",
  "كان", "كانت", "يكون", "تكون", "هل", "ما", "ماذا", "كيف", "أين", "متى",
  "لماذا", "أو", "و", "ثم", "لكن", "بل", "حتى", "إذا", "لو", "قد",
  "لا", "لن", "لم", "ليس", "كل", "بعض", "أي", "غير", "بين", "فوق",
  "تحت", "أمام", "خلف", "عند", "منذ", "حول", "ضد", "نحو", "إن", "أن",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s\u0600-\u06FF]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOPWORDS.has(t) && !ARABIC_STOPWORDS.has(t));
}

function stemSimple(word: string): string {
  if (/[\u0600-\u06FF]/.test(word)) {
    return word.replace(/^(ال|و|ب|ك|ل|ف)/, "").replace(/(ة|ات|ون|ين|ان|ها|هم|هن|ي|نا)$/, "");
  }
  return word
    .replace(/ing$/, "")
    .replace(/tion$/, "t")
    .replace(/sion$/, "s")
    .replace(/ness$/, "")
    .replace(/ment$/, "")
    .replace(/ful$/, "")
    .replace(/ous$/, "")
    .replace(/ive$/, "")
    .replace(/able$/, "")
    .replace(/ible$/, "")
    .replace(/ly$/, "")
    .replace(/er$/, "")
    .replace(/est$/, "")
    .replace(/ed$/, "")
    .replace(/s$/, "");
}

function getTokens(text: string): string[] {
  return tokenize(text).map(stemSimple);
}

const TOPIC_SYNONYMS: Record<string, string[]> = {
  irrigation: ["water", "irrigat", "drip", "flood", "moisture", "dry", "wet", "rain", "ري", "ماء", "سقي", "رطوبة", "جفاف", "مطر", "تنقيط"],
  harvest: ["harvest", "pick", "ripe", "ripen", "collect", "yield", "fruit", "date", "rutab", "tamr", "bisar", "حصاد", "قطف", "نضج", "ثمر", "تمر", "رطب", "بسر"],
  pests: ["pest", "bug", "insect", "disease", "fungus", "weevil", "moth", "mite", "worm", "beetle", "infect", "آفة", "حشرة", "مرض", "فطر", "سوسة", "دودة", "خنفساء"],
  soil: ["soil", "ground", "earth", "clay", "sand", "loam", "drain", "ph", "salin", "compost", "mulch", "تربة", "أرض", "رمل", "طين", "تصريف", "ملوحة", "سماد"],
  nutrition: ["fertil", "nutri", "npk", "nitrogen", "phosphor", "potassium", "feed", "mineral", "organic", "compost", "manure", "تسميد", "تغذية", "نيتروجين", "فوسفور", "بوتاسيوم", "عضوي"],
  general: ["general", "info", "about", "what", "descri", "overview", "history", "origin", "type", "variet", "character", "عام", "معلومات", "وصف", "نوع", "صنف", "تاريخ"],
  climate: ["climat", "weather", "temperatur", "heat", "cold", "humid", "season", "summer", "winter", "frost", "مناخ", "حرارة", "برد", "رطوبة", "موسم", "صيف", "شتاء"],
  propagation: ["propag", "plant", "seed", "offshoot", "sucker", "tissue", "cultur", "grow", "nursery", "إكثار", "زراعة", "بذرة", "فسيلة", "شتلة", "مشتل"],
  pruning: ["prun", "trim", "cut", "frond", "leaf", "remov", "clean", "تقليم", "قص", "سعف", "ورق", "إزالة"],
  storage: ["stor", "preserv", "keep", "shelf", "freez", "dry", "pack", "process", "تخزين", "حفظ", "تجفيف", "تعبئة", "تصنيع"],
  pollination: ["pollinat", "flower", "male", "female", "spathe", "bunch", "تلقيح", "زهرة", "طلع", "عذق", "شمراخ"],
  economics: ["price", "market", "sell", "export", "trade", "cost", "profit", "income", "سعر", "سوق", "بيع", "تصدير", "تجارة", "ربح"],
};

function computeBM25Score(queryTokens: string[], docTokens: string[], avgDocLen: number, totalDocs: number, docFreqs: Map<string, number>): number {
  const k1 = 1.5;
  const b = 0.75;
  const docLen = docTokens.length;
  let score = 0;

  const termFreqs = new Map<string, number>();
  for (const token of docTokens) {
    termFreqs.set(token, (termFreqs.get(token) || 0) + 1);
  }

  for (const queryToken of queryTokens) {
    const tf = termFreqs.get(queryToken) || 0;
    if (tf === 0) continue;

    const df = docFreqs.get(queryToken) || 0;
    const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);
    const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgDocLen)));
    score += idf * tfNorm;
  }

  return score;
}

function computeTopicBoost(queryTokens: string[], topic: string): number {
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
  return matchCount > 0 ? 1.5 + (matchCount * 0.3) : 0;
}

function computeKeywordBoost(queryTokens: string[], keywords: string[] | null): number {
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

export async function retrieveRAGContext(
  query: string,
  category: string | null,
  lang: string = "en",
  topK: number = 5
): Promise<{ context: string; sources: ScoredChunk[]; debugInfo: object }> {
  const allChunks = category
    ? await db.select({
        id: chunks.id,
        documentId: chunks.documentId,
        topic: chunks.topic,
        content: chunks.content,
        contentAr: chunks.contentAr,
        keywords: chunks.keywords,
        keywordsAr: chunks.keywordsAr,
        chunkIndex: chunks.chunkIndex,
        category: documents.category,
      }).from(chunks).innerJoin(documents, eq(chunks.documentId, documents.id)).where(eq(documents.category, category))
    : await db.select({
        id: chunks.id,
        documentId: chunks.documentId,
        topic: chunks.topic,
        content: chunks.content,
        contentAr: chunks.contentAr,
        keywords: chunks.keywords,
        keywordsAr: chunks.keywordsAr,
        chunkIndex: chunks.chunkIndex,
        category: documents.category,
      }).from(chunks).innerJoin(documents, eq(chunks.documentId, documents.id));

  if (allChunks.length === 0) {
    return { context: "", sources: [], debugInfo: { totalChunks: 0, query } };
  }

  const queryTokens = getTokens(query);

  const allDocTokens: string[][] = allChunks.map(chunk => {
    const text = lang === "ar" && chunk.contentAr ? chunk.contentAr : chunk.content;
    return getTokens(text);
  });

  const avgDocLen = allDocTokens.reduce((sum, t) => sum + t.length, 0) / allDocTokens.length;

  const docFreqs = new Map<string, number>();
  for (const docTokens of allDocTokens) {
    const uniqueTokens = new Set(docTokens);
    for (const token of uniqueTokens) {
      docFreqs.set(token, (docFreqs.get(token) || 0) + 1);
    }
  }

  const scored: ScoredChunk[] = allChunks.map((chunk, i) => {
    const bm25 = computeBM25Score(queryTokens, allDocTokens[i], avgDocLen, allChunks.length, docFreqs);
    const topicBoost = computeTopicBoost(queryTokens, chunk.topic);
    const kwSet = lang === "ar" ? chunk.keywordsAr : chunk.keywords;
    const keywordBoost = computeKeywordBoost(queryTokens, kwSet);

    return {
      id: chunk.id,
      documentId: chunk.documentId,
      topic: chunk.topic,
      content: chunk.content,
      contentAr: chunk.contentAr,
      keywords: kwSet,
      score: bm25 + topicBoost + keywordBoost,
      category: chunk.category,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  let topChunks = scored.slice(0, topK).filter(c => c.score > 0);

  if (topChunks.length === 0) {
    topChunks = scored
      .filter(c => c.topic === "general")
      .slice(0, 2);
    
    if (topChunks.length === 0) {
      topChunks = scored.slice(0, 2);
    }
  }

  const contextParts = topChunks.map(c => {
    const text = lang === "ar" && c.contentAr ? c.contentAr : c.content;
    return `[${c.category} - ${c.topic.toUpperCase()}] (relevance: ${c.score.toFixed(2)}):\n${text}`;
  });

  return {
    context: contextParts.join("\n\n---\n\n"),
    sources: topChunks,
    debugInfo: {
      totalChunks: allChunks.length,
      queryTokens,
      topScores: topChunks.map(c => ({ topic: c.topic, category: c.category, score: c.score.toFixed(2) })),
      category,
    },
  };
}

export async function retrieveWithQueryExpansion(
  query: string,
  category: string | null,
  lang: string = "en",
  topK: number = 5
): Promise<{ context: string; sources: ScoredChunk[]; debugInfo: object }> {
  const directResult = await retrieveRAGContext(query, category, lang, topK);

  if (directResult.sources.length > 0 && directResult.sources[0].score > 3.0) {
    return directResult;
  }

  try {
    const expansionPrompt = `Given this question about date palm trees: "${query}"
Extract 5-8 key agricultural search terms (single words, in English) that would help find relevant information. Include related agricultural concepts.
Return ONLY a comma-separated list of words, nothing else.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: expansionPrompt }] }],
      config: { maxOutputTokens: 100, temperature: 0.1 },
    });

    const expandedTerms = (response.text || "").split(",").map(t => t.trim().toLowerCase()).filter(t => t.length > 2);
    const expandedQuery = `${query} ${expandedTerms.join(" ")}`;

    const expandedResult = await retrieveRAGContext(expandedQuery, category, lang, topK);

    if (expandedResult.sources.length > 0 && expandedResult.sources[0].score > directResult.sources[0]?.score) {
      return {
        ...expandedResult,
        debugInfo: {
          ...expandedResult.debugInfo as object,
          queryExpansion: expandedTerms,
          originalScore: directResult.sources[0]?.score,
          expandedScore: expandedResult.sources[0].score,
        },
      };
    }
  } catch (err) {
    console.warn("Query expansion failed, using direct retrieval:", (err as Error).message);
  }

  return directResult;
}

export async function getAllKnowledgeBase() {
  const docs = await db.select().from(documents).orderBy(documents.category);
  const result = [];
  for (const doc of docs) {
    const docChunks = await db.select().from(chunks).where(eq(chunks.documentId, doc.id));
    result.push({ ...doc, chunks: docChunks });
  }
  return result;
}
