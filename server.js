import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

app.post('/api/optimize-route', async (req, res) => {
    try {
        const { merchants } = req.body;
        const prompt = `As a Nigerian Credit Risk Specialist for Rill, optimize the collection route for today. 
    Here are the merchants: ${JSON.stringify(merchants)}.
    Provide a prioritized list of merchant IDs and a brief reasoning for this order (max 2 sentences).`;

        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        prioritizedIds: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING }
                        },
                        reasoning: { type: Type.STRING }
                    },
                    required: ["prioritizedIds", "reasoning"]
                }
            }
        });

        res.json(JSON.parse(response.text || '{}'));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to optimize route' });
    }
});

app.post('/api/rebuttal', async (req, res) => {
    try {
        const { merchantName, excuse } = req.body;
        const prompt = `A merchant named ${merchantName} says: "${excuse}". 
    As a Rill Collection Officer, provide a firm but professional rebuttal that emphasizes repayment discipline and habit formation. 
    Keep it under 3 sentences. Use a tone of "calm accountability".`;

        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
        });

        res.json({ text: response.text });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to generate rebuttal' });
    }
});

app.post('/api/risk-briefing', async (req, res) => {
    try {
        const { logs, merchants } = req.body;
        const prompt = `Summarize the day's field activity for the Head of Credit. 
    Field Logs: ${JSON.stringify(logs)}
    Merchant Status: ${JSON.stringify(merchants)}
    Provide a 3-sentence risk briefing highlighting any behavioral shifts or cluster-level trends.`;

        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
        });

        res.json({ text: response.text });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to generate risk briefing' });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Rill AI API Server running on port ${PORT}`);
});
