"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.embedText = embedText;
exports.cosineSimilarity = cosineSimilarity;
exports.scoreMemory = scoreMemory;
const openai_1 = __importDefault(require("openai"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const CONFIG_PATH = path_1.default.join(os_1.default.homedir(), '.mnemix', 'config.json');
function getApiKey() {
    if (!fs_1.default.existsSync(CONFIG_PATH))
        return null;
    const config = JSON.parse(fs_1.default.readFileSync(CONFIG_PATH, 'utf-8'));
    return config.openai_api_key || null;
}
async function embedText(text) {
    const apiKey = getApiKey();
    if (!apiKey) {
        // fallback: simple hash-based pseudo-embedding for local testing
        // replace with real embeddings once API key is set
        return pseudoEmbed(text);
    }
    const openai = new openai_1.default({ apiKey });
    const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
    });
    return response.data[0].embedding;
}
function cosineSimilarity(a, b) {
    if (a.length === 0 || b.length === 0)
        return 0;
    const dot = a.reduce((sum, ai, i) => sum + ai * (b[i] || 0), 0);
    const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
    const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
    if (magA === 0 || magB === 0)
        return 0;
    return dot / (magA * magB);
}
function scoreMemory(embeddingSimilarity, createdAt, accessCount, importanceScore) {
    const daysSince = (Date.now() - new Date(createdAt).getTime()) / 86400000;
    const recency = Math.exp(-daysSince / 30);
    const frequency = Math.log1p(accessCount) / 10;
    return (embeddingSimilarity * 0.50 +
        recency * 0.20 +
        frequency * 0.15 +
        importanceScore * 0.15);
}
// Deterministic pseudo-embedding for offline use
// Not semantically meaningful — just for dev/testing
function pseudoEmbed(text) {
    const dim = 128;
    const vec = new Array(dim).fill(0);
    for (let i = 0; i < text.length; i++) {
        vec[i % dim] += text.charCodeAt(i) / 1000;
    }
    const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map(v => v / mag);
}
