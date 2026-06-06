import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize GoogleGenAI client (lazy checking inside route so we don't crash on startup if key is missing)
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    throw new Error("GEMINI_API_KEY environment variable is not configured.");
  }
  return new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// API endpoint to retrieve the Gemini API key for direct client-side requests
app.get("/api/key", (req, res) => {
  res.json({ apiKey: process.env.GEMINI_API_KEY || "" });
});

// API endpoint for color fixes using Gemini
app.post("/api/suggestions", async (req, res) => {
  try {
    const { fgHex, bgHex, ratio } = req.body;

    if (!fgHex || !bgHex) {
      return res.status(400).json({ error: "Missing foreground or background hex colors." });
    }

    const ai = getGeminiClient();

    const promptText = `You are a WCAG color accessibility expert.

The user has chosen:
- Foreground color: ${fgHex}
- Background color: ${bgHex}
- Current contrast ratio: ${ratio}:1 (Fails at least one WCAG compliance level: AA Large (3.0:1), AA Normal (4.5:1) or AAA Normal (7.0:1)).

Your task:
1. Suggest 3 foreground color alternatives. Keep the same hue (within ±15°), only adjust lightness and saturation. Each suggested color MUST be extremely accessible, achieving at least ≥7.0:1 contrast ratio against ${bgHex} so that it always passes all 3 WCAG standards (AA Large, AA Normal, and AAA Normal).
2. Suggest 3 background color alternatives. Keep the same hue (within ±15°), only adjust lightness and saturation. Each suggested color MUST be extremely accessible, achieving at least ≥7.0:1 contrast ratio against ${fgHex} so that it always passes all 3 WCAG standards (AA Large, AA Normal, and AAA Normal).

Rules:
- Return ONLY a valid JSON object matching the requested schema. No explanation, no markdown formatting, no backticks.
- Verify each hex mathematically produces ≥7.0:1 against its companion before including it.
- All hex values must be valid 6-character hex codes with # prefix.

Return exactly this structure:
{
  "foreground_fixes": ["#hex1", "#hex2", "#hex3"],
  "background_fixes": ["#hex1", "#hex2", "#hex3"]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: promptText,
      config: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            foreground_fixes: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Array of 3 valid hex codes that work with the original background",
            },
            background_fixes: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Array of 3 valid hex codes that work with the original foreground",
            },
          },
          required: ["foreground_fixes", "background_fixes"],
        },
      },
    });

    const textOutput = response.text;
    if (!textOutput) {
      throw new Error("Empty response from AI assistant.");
    }

    const data = JSON.parse(textOutput.trim());
    return res.json(data);
  } catch (error: any) {
    console.error("Gemini suggestion error:", error);
    return res.status(500).json({
      error: error.message || "An error occurred while generating color suggestions.",
    });
  }
});

// Setup Vite Dev Server / Static Middleware
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`ContrastAI server is running on http://localhost:${PORT}`);
  });
}

startServer();
