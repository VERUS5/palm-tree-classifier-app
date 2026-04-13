import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { GoogleGenAI } from "@google/genai";
import { db, ensureTables } from "./db";
import { documents, chunks, chatSessions, chatMessages } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { seedKnowledgeBase, backfillEmbeddings } from "./seed";
import { retrieveWithQueryExpansion, getAllKnowledgeBase } from "./rag-engine";
import * as fs from "node:fs";
import * as path from "node:path";

const MODELS_DIR = path.join(process.cwd(), "backend", "models");
const INFERENCE_URL = `http://127.0.0.1:${process.env.INFERENCE_PORT || 5001}`;

const geminiApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const geminiBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;

const aiConfig: ConstructorParameters<typeof GoogleGenAI>[0] = {
  apiKey: geminiApiKey,
};
if (geminiBaseUrl) {
  aiConfig.httpOptions = { apiVersion: "", baseUrl: geminiBaseUrl };
}
const ai = new GoogleGenAI(aiConfig);

export async function registerRoutes(app: Express): Promise<Server> {
  await ensureTables();
  await seedKnowledgeBase();
  backfillEmbeddings().catch(err =>
    console.warn("Background embedding backfill error:", (err as Error).message)
  );

  app.post("/api/classify", async (req: Request, res: Response) => {
    try {
      const { base64, mimeType: clientMimeType, lang } = req.body;
      if (!base64) {
        return res.status(400).json({ error: "No image provided" });
      }

      const base64Image = base64.includes(",") ? base64.split(",")[1] : base64;
      const mimeType = clientMimeType || "image/jpeg";

      interface ModelPrediction { class: string; confidence: number; probabilities?: Record<string, number>; folds_used?: number }
      let modelResult: ModelPrediction | null = null;

      try {
        const inferenceRes = await fetch(`${INFERENCE_URL}/predict`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base64: base64Image }),
        });
        if (inferenceRes.ok) {
          modelResult = await inferenceRes.json() as ModelPrediction;
          console.log("PyTorch model prediction:", modelResult);
        } else {
          console.warn("Inference server returned error, falling back to Gemini");
        }
      } catch (err) {
        console.warn("Inference server unavailable, falling back to Gemini:", (err as Error).message);
      }

      if (modelResult) {
        if (modelResult.confidence >= 0.96) {
          let description = "";
          try {
            const descResponse = await ai.models.generateContent({
              model: "gemini-2.5-flash",
              contents: [
                {
                  role: "user",
                  parts: [
                    {
                      inlineData: { data: base64Image, mimeType },
                    },
                    {
                      text: `This image has been classified by a ConvNeXt deep learning model as "${modelResult.class}" date palm variety with ${(modelResult.confidence * 100).toFixed(1)}% confidence.

Write a brief expert description (2-3 sentences) about what you see in the image and the characteristics of the "${modelResult.class}" variety. Include distinguishing features visible in the image.
${lang === "ar" ? "Write entirely in Arabic." : "Write entirely in English."}`,
                    },
                  ],
                },
              ],
            });
            description = descResponse.text || "";
          } catch {
            const descriptions: Record<string, Record<string, string>> = {
              Khalas: {
                en: "Khalas dates are golden-amber colored with a rich caramel flavor. They are one of the most prized varieties in the Gulf region.",
                ar: "تمور الخلاص ذات لون ذهبي كهرماني بنكهة كراميل غنية. وهي من أكثر الأصناف المرغوبة في منطقة الخليج.",
              },
              Razeez: {
                en: "Razeez dates are dark brown and elongated with a sweet, mild flavor. They are commonly grown in Saudi Arabia.",
                ar: "تمور الرزيز بنية داكنة ومستطيلة ذات نكهة حلوة معتدلة. تُزرع بشكل شائع في المملكة العربية السعودية.",
              },
              Shishi: {
                en: "Shishi dates are small to medium-sized with a dark color and sweet taste. They are popular in the Eastern Province of Saudi Arabia.",
                ar: "تمور الشيشي صغيرة إلى متوسطة الحجم ذات لون داكن وطعم حلو. تحظى بشعبية في المنطقة الشرقية بالمملكة العربية السعودية.",
              },
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
            description,
          });
        } else {
          const lowConfDesc = lang === "ar"
            ? `نوع غير معروف. يرجى التقاط صورة أوضح أو تجربة زاوية مختلفة للحصول على نتيجة أدق.`
            : `Unknown type. Try taking a clearer photo or a different angle for a more accurate result.`;

          return res.json({
            isPalm: false,
            class: "Unknown",
            confidence: modelResult.confidence,
            probabilities: modelResult.probabilities,
            folds_used: modelResult.folds_used,
            source: "convnext_ensemble",
            description: lowConfDesc,
          });
        }
      }

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: { data: base64Image, mimeType },
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
${lang === "ar" ? "Write the description in Arabic." : "Write the description in English."}`,
              },
            ],
          },
        ],
      });

      const text = response.text || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
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

  app.get("/api/sessions", async (_req: Request, res: Response) => {
    try {
      const sessions = await db.select().from(chatSessions).orderBy(desc(chatSessions.createdAt));
      res.json(sessions);
    } catch (error) {
      console.error("Error fetching sessions:", error);
      res.status(500).json({ error: "Failed to fetch sessions" });
    }
  });

  app.post("/api/sessions", async (req: Request, res: Response) => {
    try {
      const { treeClass, imageData, title } = req.body;
      const [session] = await db.insert(chatSessions).values({
        treeClass: treeClass || null,
        imageData: imageData || null,
        title: title || `${treeClass || "Palm"} Analysis`,
      }).returning();
      res.status(201).json(session);
    } catch (error) {
      console.error("Error creating session:", error);
      res.status(500).json({ error: "Failed to create session" });
    }
  });

  app.delete("/api/sessions/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(chatMessages).where(eq(chatMessages.sessionId, id));
      await db.delete(chatSessions).where(eq(chatSessions.id, id));
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting session:", error);
      res.status(500).json({ error: "Failed to delete session" });
    }
  });

  app.get("/api/sessions/:id/messages", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const msgs = await db.select().from(chatMessages).where(eq(chatMessages.sessionId, id)).orderBy(chatMessages.createdAt);
      res.json(msgs);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  app.post("/api/sessions/:id/messages", async (req: Request, res: Response) => {
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

  app.post("/api/sessions/:id/chat", async (req: Request, res: Response) => {
    try {
      const sessionId = parseInt(req.params.id);
      const { content, lang } = req.body;
      const isArabic = lang === "ar";

      const [session] = await db.select().from(chatSessions).where(eq(chatSessions.id, sessionId));
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      await db.insert(chatMessages).values({ sessionId, role: "user", content });

      const category = session.treeClass && session.treeClass !== "Unknown" ? session.treeClass : null;
      const ragResult = await retrieveWithQueryExpansion(content, category, lang || "en", 5);
      const ragContext = ragResult.context;

      console.log("[RAG] Query:", content.substring(0, 80));
      console.log("[RAG] Retrieved:", ragResult.sources.length, "chunks, top score:", ragResult.sources[0]?.score?.toFixed(2) || "N/A");

      const history = await db.select().from(chatMessages).where(eq(chatMessages.sessionId, sessionId)).orderBy(chatMessages.createdAt);

      const chatHistory = history.map(m => ({
        role: m.role === "assistant" ? "model" as const : "user" as const,
        parts: [{ text: m.content }],
      }));

      const treeInfo = session.treeClass && session.treeClass !== "Unknown"
        ? isArabic
          ? `المستخدم تعرّف على نخلة من نوع ${session.treeClass} من الصورة.`
          : `The user has identified a ${session.treeClass} palm tree from their image.`
        : isArabic
          ? "المستخدم يسأل عن النخيل بشكل عام."
          : "The user is asking about palm trees in general.";

      const ragSourceInfo = ragResult.sources.length > 0
        ? ragResult.sources.map(s => `${s.category}/${s.topic} (score: ${s.score.toFixed(1)})`).join(", ")
        : "no specific matches";

      const systemPrompt = isArabic
        ? `أنت مستشار زراعي خبير متخصص حصرياً في نخيل التمر في شبه الجزيرة العربية. تقدم نصائح عملية وقابلة للتطبيق للمزارعين والمهتمين.

${treeInfo}

${ragContext ? `سياق قاعدة المعرفة (مصادر: ${ragSourceInfo}):
${ragContext}

تعليمات استخدام السياق:
- اعتمد بشكل أساسي على المعلومات من قاعدة المعرفة أعلاه
- ادمج المعلومات من مصادر متعددة إذا كانت ذات صلة
- اذكر أرقامًا ونسبًا محددة من السياق عند الإمكان
- إذا كان السياق لا يغطي الإجابة بالكامل، أكمل من خبرتك مع الإشارة إلى ذلك` : "لا يوجد سياق محدد من قاعدة المعرفة. قدم نصيحة خبير عامة عن نخيل التمر."}

الإرشادات:
- أجب دائماً باللغة العربية
- كن ودوداً ومهنياً ومختصراً
- قدم نصائح عملية وتوصيات قابلة للتطبيق
- اذكر أرقامًا ومقاييس محددة عند الإمكان

قاعدة صارمة - نطاق المحادثة:
- أنت متخصص فقط في نخيل التمر والزراعة والتربة والري والآفات والحصاد والتسميد والمناخ المتعلق بالنخيل
- إذا سأل المستخدم عن أي موضوع خارج نطاق النخيل والزراعة (مثل: البرمجة، الطبخ، الرياضة، السياسة، التاريخ غير الزراعي، الرياضيات، الأخبار، أو أي موضوع آخر)، أجب فقط بـ: "عذراً، أنا متخصص فقط في نخيل التمر والزراعة. يمكنني مساعدتك في أي سؤال يتعلق بزراعة النخيل ورعايتها."
- لا تحاول الإجابة على أي سؤال خارج النطاق حتى لو كنت تعرف الإجابة`
        : `You are an expert agricultural advisor specializing EXCLUSIVELY in Date Palm trees in the Arabian Peninsula. You provide practical, actionable advice to farmers and enthusiasts.

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

      const stream = await ai.models.generateContentStream({
        model: "gemini-2.5-flash",
        contents: chatHistory,
        config: {
          systemInstruction: systemPrompt,
          maxOutputTokens: 8192,
          temperature: 0.7,
        },
      });

      let fullResponse = "";
      for await (const chunk of stream) {
        const text = chunk.text || "";
        if (text) {
          fullResponse += text;
          res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
        }
      }

      await db.insert(chatMessages).values({ sessionId, role: "assistant", content: fullResponse });

      res.write(`data: [DONE]\n\n`);
      res.end();
    } catch (error) {
      console.error("Chat error:", error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: "Failed to generate response" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Failed to process chat" });
      }
    }
  });

  app.post("/api/rag/search", async (req: Request, res: Response) => {
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
        sources: result.sources.map(s => ({
          id: s.id,
          category: s.category,
          topic: s.topic,
          score: parseFloat(s.score.toFixed(3)),
          contentPreview: (lang === "ar" && s.contentAr ? s.contentAr : s.content).substring(0, 200) + "...",
        })),
        context: result.context,
        debug: result.debugInfo,
      });
    } catch (error) {
      console.error("RAG search error:", error);
      res.status(500).json({ error: "RAG search failed" });
    }
  });

  app.get("/api/rag/stats", async (_req: Request, res: Response) => {
    try {
      const allDocs = await db.select().from(documents);
      const allChunks = await db.select().from(chunks);
      const topicCounts: Record<string, number> = {};
      const categoryCounts: Record<string, number> = {};
      for (const chunk of allChunks) {
        topicCounts[chunk.topic] = (topicCounts[chunk.topic] || 0) + 1;
      }
      for (const doc of allDocs) {
        categoryCounts[doc.category] = (categoryCounts[doc.category] || 0) + 1;
      }

      const hasArabic = allChunks.filter(c => c.contentAr).length;
      const hasKeywords = allChunks.filter(c => c.keywords && c.keywords.length > 0).length;

      res.json({
        documents: allDocs.length,
        chunks: allChunks.length,
        bilingualChunks: hasArabic,
        chunksWithKeywords: hasKeywords,
        topicDistribution: topicCounts,
        categoryDistribution: categoryCounts,
        ragVersion: 3,
        features: ["bm25_scoring", "cosine_similarity", "hybrid_55bm25_45cosine", "topic_boost", "keyword_matching", "query_expansion", "bilingual_ar_en", "gemini_embedding_001_3072dim"],
      });
    } catch (error) {
      console.error("RAG stats error:", error);
      res.status(500).json({ error: "Failed to get RAG stats" });
    }
  });

  app.get("/api/models", async (_req: Request, res: Response) => {
    try {
      if (!fs.existsSync(MODELS_DIR)) {
        fs.mkdirSync(MODELS_DIR, { recursive: true });
      }
      const files = fs.readdirSync(MODELS_DIR).filter(f => f.endsWith(".pth") || f.endsWith(".pt"));
      const models = files.map(f => {
        const stats = fs.statSync(path.join(MODELS_DIR, f));
        return {
          name: f,
          size: stats.size,
          sizeFormatted: `${(stats.size / (1024 * 1024)).toFixed(1)} MB`,
          modified: stats.mtime.toISOString(),
        };
      });
      res.json({ directory: MODELS_DIR, models });
    } catch (error) {
      console.error("Error listing models:", error);
      res.status(500).json({ error: "Failed to list models" });
    }
  });

  app.get("/api/knowledge-base", async (_req: Request, res: Response) => {
    try {
      const result = await getAllKnowledgeBase();
      res.json(result);
    } catch (error) {
      console.error("Error fetching knowledge base:", error);
      res.status(500).json({ error: "Failed to fetch knowledge base" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
