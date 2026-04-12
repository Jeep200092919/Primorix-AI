const Groq = require('groq-sdk');

// ── Chat mode: llama-3.3-70b-versatile ──────────────────────────────────────
const CHAT_API_KEY = process.env.GROQ_API_KEY || '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';
const CHAT_MODEL   = 'llama-3.3-70b-versatile';

// ── Code mode: qwen/qwen3-32b ────────────────────────────────────────────────
const CODE_API_KEY = process.env.GROQ_CODE_API_KEY || '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';
const CODE_MODEL   = 'qwen/qwen3-32b';

const chatGroq = new Groq({ apiKey: CHAT_API_KEY });
const codeGroq = new Groq({ apiKey: CODE_API_KEY });

let chatInitialized = false;
let codeInitialized = false;

async function discoverModel() {
  // Probe chat model
  try {
    const r = await chatGroq.chat.completions.create({
      model: CHAT_MODEL,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 10,
    });
    if (r.choices?.[0]?.message?.content) {
      chatInitialized = true;
      console.log(`[Primorix AI] Chat model ready: ${CHAT_MODEL}`);
    }
  } catch (err) {
    console.warn(`[Primorix AI] Chat model unavailable: ${err.message}`);
  }

  // Probe code model
  try {
    const r = await codeGroq.chat.completions.create({
      model: CODE_MODEL,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 10,
    });
    if (r.choices?.[0]?.message?.content) {
      codeInitialized = true;
      console.log(`[Primorix AI] Code model ready: ${CODE_MODEL}`);
    }
  } catch (err) {
    console.warn(`[Primorix AI] Code model unavailable: ${err.message}`);
  }

  if (!chatInitialized && !codeInitialized) {
    throw new Error('No AI models available. Please check your API keys.');
  }

  return { chat: CHAT_MODEL, code: CODE_MODEL };
}

function getResolvedModelId(mode = 'chat') {
  return mode === 'code' ? CODE_MODEL : CHAT_MODEL;
}

// ── System prompts ────────────────────────────────────────────────────────────

function buildChatSystemPrompt(user, memoryFacts, memorySummary) {
  const isGuest = user.is_guest;
  let memorySection = '';
  if (!isGuest && memoryFacts?.length > 0) {
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
- For guest users: encourage them to create an account so you can truly remember them across sessions
- Be concise unless depth is requested
- Format code blocks with triple backticks and the language name
- If asked to remember something specific, confirm that you've noted it

Your personality: Curious, helpful, slightly witty, never condescending. You genuinely care about giving good answers.`;
}

function buildCodeSystemPrompt(user) {
  const name = user.is_guest ? 'the user' : user.username;
  return `You are Primorix AI in Code Mode — an expert software engineer and coding assistant helping ${name}.

YOUR CAPABILITIES:
- Write clean, efficient, production-ready code in any language
- Debug and fix errors with clear explanations of the root cause
- Review code for bugs, security issues, and performance improvements
- Explain complex programming concepts clearly
- Suggest best practices, design patterns, and architecture

CODE GUIDELINES:
- Always use fenced code blocks with the correct language tag (e.g. \`\`\`python)
- Write complete, working code — never truncate or use placeholders like "// rest of code here"
- Add brief inline comments only where the logic isn't obvious
- Prefer modern syntax and idiomatic patterns for each language
- Point out potential edge cases, security issues, or performance concerns
- If the user has an error, diagnose the root cause before providing the fix

Keep explanations focused and technical. You are talking to someone who wants working code, not filler.`;
}

// ── Core functions ────────────────────────────────────────────────────────────

async function sendMessage({ user, memoryFacts, memorySummary, conversationHistory, userMessage, mode = 'chat' }) {
  const isCodeMode = mode === 'code';
  const client     = isCodeMode ? codeGroq : chatGroq;
  const model      = isCodeMode ? CODE_MODEL : CHAT_MODEL;
  const ready      = isCodeMode ? codeInitialized : chatInitialized;

  if (!ready) {
    throw new Error('AI model not initialized. Call discoverModel() first.');
  }

  const systemPrompt = isCodeMode
    ? buildCodeSystemPrompt(user)
    : buildChatSystemPrompt(user, memoryFacts, memorySummary);

  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.map(msg => ({
      role: msg.role === 'model' ? 'assistant' : 'user',
      content: msg.content,
    })),
    { role: 'user', content: userMessage },
  ];

  const response = await client.chat.completions.create({
    model,
    messages,
    temperature: isCodeMode ? 0.3 : 0.9,
    max_tokens: isCodeMode ? 4096 : 8192,
    top_p: 0.95,
  });

  let content = response.choices[0].message.content;

  // Strip <think>...</think> blocks that Qwen3 emits in code mode
  if (isCodeMode) {
    content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }

  return content;
}

async function generateConversationTitle(firstUserMessage, firstAiResponse) {
  if (!chatInitialized) return firstUserMessage.slice(0, 40) || 'New Conversation';
  try {
    const response = await chatGroq.chat.completions.create({
      model: CHAT_MODEL,
      messages: [{
        role: 'user',
        content: `Generate a short title (max 6 words, no quotes) for this conversation:\nUser: ${firstUserMessage.slice(0, 200)}\nAI: ${firstAiResponse.slice(0, 200)}\nTitle:`,
      }],
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
  if (recentMessages.length < 4 || !chatInitialized) return [];
  const conversation = recentMessages
    .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`)
    .join('\n');
  try {
    const response = await chatGroq.chat.completions.create({
      model: CHAT_MODEL,
      messages: [{
        role: 'user',
        content: `Extract important personal facts about the user from this conversation. Return ONLY a JSON array like [{"key":"name","value":"Alex"}]. Return [] if nothing meaningful.\n\nConversation:\n${conversation.slice(0, 3000)}`,
      }],
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
    // Non-critical
  }
  return [];
}

module.exports = {
  discoverModel,
  getResolvedModelId,
  sendMessage,
  generateConversationTitle,
  extractMemoryFacts,
  CHAT_MODEL,
  CODE_MODEL,
};
