import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { GoogleGenAI } from "@google/genai";
import { db } from "./db";
import { documents, chunks, chatSessions, chatMessages } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { seedKnowledgeBase } from "./seed";
import * as fs from "node:fs";
import * as path from "node:path";

const MODELS_DIR = path.join(process.cwd(), "server", "models");
const INFERENCE_URL = `http://127.0.0.1:${process.env.INFERENCE_PORT || 5001}`;

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

function retrieveContext(allChunks: { topic: string; content: string }[], query: string): string {
  const queryLower = query.toLowerCase();
  const matched: string[] = [];

  for (const chunk of allChunks) {
    const topicLower = chunk.topic.toLowerCase();
    if (
      (queryLower.includes("water") || queryLower.includes("irrigat")) && topicLower === "irrigation" ||
      (queryLower.includes("harvest") || queryLower.includes("pick") || queryLower.includes("ripe")) && topicLower === "harvest" ||
      (queryLower.includes("pest") || queryLower.includes("bug") || queryLower.includes("disease") || queryLower.includes("insect")) && topicLower === "pests" ||
      (queryLower.includes("soil") || queryLower.includes("ground") || queryLower.includes("plant")) && topicLower === "soil" ||
      (queryLower.includes("fertil") || queryLower.includes("nutri") || queryLower.includes("feed")) && topicLower === "nutrition"
    ) {
      matched.push(`[${chunk.topic.toUpperCase()}]: ${chunk.content}`);
    }
  }

  if (matched.length === 0) {
    const general = allChunks.find(c => c.topic === "general");
    if (general) matched.push(`[GENERAL]: ${general.content}`);
    const irrigation = allChunks.find(c => c.topic === "irrigation");
    if (irrigation) matched.push(`[IRRIGATION]: ${irrigation.content}`);
  }

  return matched.join("\n\n");
}

export async function registerRoutes(app: Express): Promise<Server> {
  await seedKnowledgeBase();

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

      if (modelResult && modelResult.confidence > 0.3) {
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

      let ragContext = "";
      if (session.treeClass && session.treeClass !== "Unknown") {
        const docs = await db.select().from(documents).where(eq(documents.category, session.treeClass));
        if (docs.length > 0) {
          const docChunks = await db.select().from(chunks).where(eq(chunks.documentId, docs[0].id));
          ragContext = retrieveContext(docChunks, content);
        }
      }

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

      const systemPrompt = isArabic
        ? `أنت مستشار زراعي خبير متخصص في نخيل التمر في شبه الجزيرة العربية. تقدم نصائح عملية وقابلة للتطبيق للمزارعين والمهتمين.

${treeInfo}

${ragContext ? `سياق قاعدة المعرفة (استخدم هذه المعلومات لتقديم إجابات دقيقة):
${ragContext}` : ""}

الإرشادات:
- أجب دائماً باللغة العربية
- كن ودوداً ومهنياً ومختصراً
- استخدم سياق قاعدة المعرفة عند توفره
- إذا لم يغطي السياق السؤال، قدم نصيحة خبير عامة مع الإشارة إلى ذلك
- قدم نصائح عملية وتوصيات قابلة للتطبيق
- إذا سُئلت عن شيء غير متعلق بالزراعة/النخيل، أعد التوجيه بلطف`
        : `You are an expert agricultural advisor specializing in Date Palm trees in the Arabian Peninsula. You provide practical, actionable advice to farmers and enthusiasts.

${treeInfo}

${ragContext ? `KNOWLEDGE BASE CONTEXT (use this information to provide accurate answers):
${ragContext}` : ""}

Guidelines:
- Always respond in English
- Be friendly, professional, and concise
- Use the knowledge base context when available
- If the context doesn't cover the question, provide general expert advice but mention you're using general knowledge
- Include practical tips and actionable recommendations
- If asked about something unrelated to agriculture/palm trees, politely redirect`;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const stream = await ai.models.generateContentStream({
        model: "gemini-2.5-flash",
        contents: chatHistory,
        config: {
          systemInstruction: systemPrompt,
          maxOutputTokens: 2048,
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
      const docs = await db.select().from(documents).orderBy(documents.category);
      const result = [];
      for (const doc of docs) {
        const docChunks = await db.select().from(chunks).where(eq(chunks.documentId, doc.id));
        result.push({ ...doc, chunks: docChunks });
      }
      res.json(result);
    } catch (error) {
      console.error("Error fetching knowledge base:", error);
      res.status(500).json({ error: "Failed to fetch knowledge base" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
