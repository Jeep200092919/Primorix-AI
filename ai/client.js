const { GoogleGenerativeAI } = require('@google/generative-ai');

const API_KEY = process.env.GOOGLE_AI_API_KEY || 'AIzaSyDSMgE_ZjAeA6VSwcbzvkhmvuXYYNM1in8';

const genAI = new GoogleGenerativeAI(API_KEY);

// Priority-ordered list: try newer/preferred models first, fall back as needed
const MODEL_PRIORITY = [
  'gemma-3-27b-it',
  'gemini-2.5-pro',
  'gemini-2.0-flash-thinking-exp',
  'gemini-2.0-flash',
  'gemini-1.5-pro-latest',
  'gemini-1.5-flash-latest',
];

// The model name exposed to the user
const USER_FACING_MODELS = {
  'primorix-1.0': null, // will be resolved on startup
};

let resolvedModel = null;
let resolvedModelId = null;

async function discoverModel() {
  for (const modelId of MODEL_PRIORITY) {
    try {
      const model = genAI.getGenerativeModel({ model: modelId });
      // Quick probe: start a chat and send a tiny message to verify model works
      const chat = model.startChat({ history: [] });
      const result = await chat.sendMessage('hi');
      const text = result.response.text();
      if (text) {
        console.log(`[Primorix AI] Using model: ${modelId}`);
        resolvedModel = model;
        resolvedModelId = modelId;
        USER_FACING_MODELS['primorix-1.0'] = modelId;
        return modelId;
      }
    } catch (err) {
      console.log(`[Primorix AI] Model ${modelId} not available: ${err.message}`);
    }
  }
  throw new Error('No compatible AI model found. Please check your API key and network access.');
}

function getModel() {
  if (!resolvedModel) {
    throw new Error('AI model not initialized. Call discoverModel() first.');
  }
  return resolvedModel;
}

function getResolvedModelId() {
  return resolvedModelId;
}

function buildSystemPrompt(user, memoryFacts, memorySummary) {
  const isGuest = user.is_guest;
  const userName = isGuest ? 'a guest user' : user.username;

  let memorySection = '';
  if (!isGuest && memoryFacts && memoryFacts.length > 0) {
    const factLines = memoryFacts.map(f => `  - ${f.memory_key}: ${f.memory_value}`).join('\n');
    memorySection = `\nWHAT YOU KNOW ABOUT THIS USER:\n${factLines}\n`;
  } else if (!isGuest && memorySummary) {
    memorySection = `\nUSER MEMORY:\n${memorySummary}\n`;
  }

  return `You are Primorix AI, a highly capable and personable AI assistant with genuine long-term memory. You remember users across conversations and build a real understanding of who they are, what they care about, and how best to help them.

You are currently talking to ${isGuest ? 'a guest user (not logged in)' : `${user.username} (a registered user)`}.
${memorySection}
CORE BEHAVIOR:
- Be warm, helpful, and genuinely intelligent
- Reference things you know about the user naturally when relevant — don't be robotic about it
- If the user tells you something personal or important, remember it (the system automatically stores key facts)
- If you learn the user's name, preferences, or important life details, weave them naturally into conversation
- For guest users: encourage them to create an account so you can truly remember them across sessions
- Be concise unless depth is requested
- Format code blocks with triple backticks and the language name
- You can reason through complex problems step by step
- If asked to remember something specific, confirm that you've noted it

Your personality: Curious, helpful, slightly witty, never condescending. You genuinely care about giving good answers.`;
}

async function sendMessage({ user, memoryFacts, memorySummary, conversationHistory, userMessage }) {
  const model = getModel();

  const systemInstruction = buildSystemPrompt(user, memoryFacts, memorySummary);

  // Build chat history for context (convert from DB format to Gemini format)
  const history = conversationHistory.map(msg => ({
    role: msg.role === 'model' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));

  const chat = model.startChat({
    systemInstruction,
    history,
    generationConfig: {
      temperature: 0.9,
      topP: 0.95,
      maxOutputTokens: 8192,
    },
  });

  const result = await chat.sendMessage(userMessage);
  return result.response.text();
}

async function generateConversationTitle(firstUserMessage, firstAiResponse) {
  const model = getModel();
  const prompt = `Based on this conversation exchange, generate a short, descriptive title (max 6 words, no quotes):

User: ${firstUserMessage.slice(0, 200)}
AI: ${firstAiResponse.slice(0, 200)}

Title:`;

  try {
    const result = await model.generateContent(prompt);
    const title = result.response.text().trim().replace(/^["']|["']$/g, '');
    return title.slice(0, 60) || 'New Conversation';
  } catch {
    return firstUserMessage.slice(0, 40) || 'New Conversation';
  }
}

async function extractMemoryFacts(user, recentMessages) {
  if (recentMessages.length < 4) return [];
  const model = getModel();

  const conversation = recentMessages
    .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`)
    .join('\n');

  const prompt = `Analyze this conversation and extract important facts about the user that should be remembered for future conversations. Only extract genuinely meaningful personal information (name, occupation, location, preferences, important life events, ongoing projects, etc.).

Conversation:
${conversation.slice(0, 3000)}

Return ONLY a JSON array of objects with "key" and "value" fields. Example:
[{"key": "name", "value": "Alex"}, {"key": "occupation", "value": "software engineer"}]

If no meaningful facts found, return an empty array: []`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const facts = JSON.parse(jsonMatch[0]);
      return Array.isArray(facts) ? facts.filter(f => f.key && f.value) : [];
    }
  } catch {
    // Silent fail — memory extraction is non-critical
  }
  return [];
}

module.exports = {
  discoverModel,
  getModel,
  getResolvedModelId,
  sendMessage,
  generateConversationTitle,
  extractMemoryFacts,
  USER_FACING_MODELS,
};
