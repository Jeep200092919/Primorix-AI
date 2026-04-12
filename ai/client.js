const Groq = require('groq-sdk');

const API_KEY = process.env.GROQ_API_KEY || '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';
const MODEL_ID = 'llama-3.3-70b-versatile';

const groq = new Groq({ apiKey: API_KEY });

let initialized = false;

async function discoverModel() {
  try {
    // Quick probe to verify API key and model work
    const response = await groq.chat.completions.create({
      model: MODEL_ID,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 10,
    });
    if (response.choices?.[0]?.message?.content) {
      initialized = true;
      console.log(`[Primorix AI] Using model: ${MODEL_ID}`);
      return MODEL_ID;
    }
  } catch (err) {
    throw new Error(`Model ${MODEL_ID} not available: ${err.message}`);
  }
  throw new Error('No compatible AI model found. Please check your API key.');
}

function getResolvedModelId() {
  return MODEL_ID;
}

function buildSystemPrompt(user, memoryFacts, memorySummary) {
  const isGuest = user.is_guest;

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
  if (!initialized) {
    throw new Error('AI model not initialized. Call discoverModel() first.');
  }

  const systemPrompt = buildSystemPrompt(user, memoryFacts, memorySummary);

  // Build messages array: system prompt + conversation history + new user message
  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.map(msg => ({
      role: msg.role === 'model' ? 'assistant' : 'user',
      content: msg.content,
    })),
    { role: 'user', content: userMessage },
  ];

  const response = await groq.chat.completions.create({
    model: MODEL_ID,
    messages,
    temperature: 0.9,
    max_tokens: 8192,
    top_p: 0.95,
  });

  return response.choices[0].message.content;
}

async function generateConversationTitle(firstUserMessage, firstAiResponse) {
  try {
    const response = await groq.chat.completions.create({
      model: MODEL_ID,
      messages: [
        {
          role: 'user',
          content: `Based on this conversation exchange, generate a short, descriptive title (max 6 words, no quotes, no punctuation at the end):

User: ${firstUserMessage.slice(0, 200)}
AI: ${firstAiResponse.slice(0, 200)}

Title:`,
        },
      ],
      max_tokens: 20,
      temperature: 0.5,
    });
    const title = response.choices[0].message.content.trim().replace(/^["']|["']$/g, '');
    return title.slice(0, 60) || 'New Conversation';
  } catch {
    return firstUserMessage.slice(0, 40) || 'New Conversation';
  }
}

async function extractMemoryFacts(user, recentMessages) {
  if (recentMessages.length < 4) return [];

  const conversation = recentMessages
    .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`)
    .join('\n');

  try {
    const response = await groq.chat.completions.create({
      model: MODEL_ID,
      messages: [
        {
          role: 'user',
          content: `Analyze this conversation and extract important facts about the user that should be remembered for future conversations. Only extract genuinely meaningful personal information (name, occupation, location, preferences, important life events, ongoing projects, etc.).

Conversation:
${conversation.slice(0, 3000)}

Return ONLY a JSON array of objects with "key" and "value" fields. Example:
[{"key": "name", "value": "Alex"}, {"key": "occupation", "value": "software engineer"}]

If no meaningful facts found, return an empty array: []`,
        },
      ],
      max_tokens: 500,
      temperature: 0.3,
    });
    const text = response.choices[0].message.content.trim();
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
  getResolvedModelId,
  sendMessage,
  generateConversationTitle,
  extractMemoryFacts,
};
