"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOllamaInstructModel = getOllamaInstructModel;
exports.extractMemoriesFromTranscript = extractMemoriesFromTranscript;
async function getOllamaInstructModel() {
    try {
        const res = await fetch('http://localhost:11434/api/tags', {
            signal: AbortSignal.timeout(2000)
        });
        if (!res.ok)
            return null;
        const data = await res.json();
        const models = data.models.map(m => m.name);
        if (!models.length)
            return null;
        const embeddingPatterns = ['embed', 'minilm', 'e5-', 'bge-'];
        const candidates = models.filter(m => !embeddingPatterns.some(p => m.toLowerCase().includes(p)));
        if (!candidates.length)
            return null;
        const rank = (name) => {
            const n = name.toLowerCase();
            let s = 0;
            if (n.includes('instruct') || n.includes('chat') || n.includes(':it'))
                s += 100;
            if (n.includes('70b'))
                s += 70;
            else if (n.includes('32b'))
                s += 32;
            else if (n.includes('13b') || n.includes('14b'))
                s += 14;
            else if (n.includes('8b') || n.includes('9b'))
                s += 8;
            else if (n.includes('7b'))
                s += 7;
            else if (n.includes('3b'))
                s += 3;
            else if (n.includes('1b') || n.includes('1.5b'))
                s += 1;
            if (n.includes('llama3'))
                s += 10;
            else if (n.includes('mistral') || n.includes('mixtral'))
                s += 9;
            else if (n.includes('deepseek'))
                s += 8;
            else if (n.includes('llama'))
                s += 8;
            else if (n.includes('qwen'))
                s += 7;
            else if (n.includes('gemma'))
                s += 6;
            else if (n.includes('phi'))
                s += 5;
            return s;
        };
        candidates.sort((a, b) => rank(b) - rank(a));
        return candidates[0];
    }
    catch {
        return null;
    }
}
const SYSTEM_PROMPT = `Extract durable facts about the user from this conversation transcript.
Return ONLY a JSON array with no markdown, no explanation, no surrounding text.
Format: [{"content": "user prefers X", "type": "preference"}]
Valid types: preference, fact, project, decision, skill, episodic
Rules:
- Only extract facts that are reusable across future conversations
- Phrase each fact as a third-person statement about the user
- Skip questions, assistant responses, filler, greetings
- Skip anything temporary or session-specific
- Deduplicate: if the same fact appears multiple times, include it once`;
async function extractMemoriesFromTranscript(transcript, openaiApiKey) {
    if (openaiApiKey) {
        try {
            const res = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + openaiApiKey,
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        { role: 'user', content: transcript.slice(0, 12000) }
                    ],
                    temperature: 0,
                }),
            });
            if (res.ok) {
                const data = await res.json();
                const clean = data.choices[0].message.content.replace(/```json|```/g, '').trim();
                const match = clean.match(/\[[\s\S]*\]/);
                if (match)
                    return JSON.parse(match[0]);
            }
        }
        catch { }
    }
    const model = await getOllamaInstructModel();
    if (!model)
        return [];
    try {
        const res = await fetch('http://localhost:11434/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                stream: false,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: transcript.slice(0, 6000) }
                ],
            }),
        });
        if (!res.ok)
            return [];
        const data = await res.json();
        const clean = data.message.content.replace(/```json|```/g, '').trim();
        const match = clean.match(/\[[\s\S]*\]/);
        if (!match)
            return [];
        return JSON.parse(match[0]);
    }
    catch {
        return [];
    }
}
