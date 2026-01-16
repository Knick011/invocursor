const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const ExcelJS = require('exceljs');

const app = express();
const PORT = process.env.PORT || 3050;

// OpenAI Configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'YOUR_API_KEY_HERE';
const OPENAI_MODEL = 'gpt-4o-mini';  // Cheapest smart model

// Supabase Configuration (for chat history storage)
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// Pending analytics requests (for password verification flow)
const pendingAnalyticsRequests = new Map();

// Data directories
const DATA_DIR = path.join(__dirname, '../data');
const CONFIGS_DIR = path.join(__dirname, '../configs');
const API_KEYS_FILE = path.join(DATA_DIR, 'api-keys.json');
const LOGS_FILE = path.join(DATA_DIR, 'request-logs.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ============================================
// TIER DEFINITIONS (Weekly Limits)
// ============================================

const TIERS = {
  free: {
    name: 'Free',
    weeklyLimit: 50,
    description: 'Free tier - 50 requests/week'
  },
  starter: {
    name: 'Starter',
    weeklyLimit: 1500,
    description: 'Starter tier - 1,500 requests/week'
  },
  growth: {
    name: 'Growth',
    weeklyLimit: 6500,
    description: 'Growth tier - 6,500 requests/week'
  }
};

// Helper to get the start of the current week (Monday)
function getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  const monday = new Date(now.setDate(diff));
  return monday.toISOString().split('T')[0];
}

// Initialize files if they don't exist
if (!fs.existsSync(API_KEYS_FILE)) {
  fs.writeFileSync(API_KEYS_FILE, JSON.stringify({
    keys: {
      "inv_demo_12345": {
        name: "Demo Account",
        tier: "starter",
        configs: ["pheedloop"],
        requestsThisWeek: 0,
        weekStart: getWeekStart(),
        created: new Date().toISOString()
      },
      "inv_free_trial": {
        name: "Free Trial",
        tier: "free",
        configs: ["*"],
        requestsThisWeek: 0,
        weekStart: getWeekStart(),
        created: new Date().toISOString()
      }
    }
  }, null, 2));
}

if (!fs.existsSync(LOGS_FILE)) {
  fs.writeFileSync(LOGS_FILE, JSON.stringify({ logs: [] }, null, 2));
}

// Rate limiting store
const rateLimits = new Map();

app.use(cors());
app.use(express.json());

// Serve widget files
app.use('/widget', express.static(path.join(__dirname, '../widget')));

// Serve assets (logo, images)
app.use('/assets', express.static(path.join(__dirname, '../assets')));

// ============================================
// API KEY MANAGEMENT
// ============================================

function loadApiKeys() {
  return JSON.parse(fs.readFileSync(API_KEYS_FILE, 'utf8'));
}

function saveApiKeys(data) {
  fs.writeFileSync(API_KEYS_FILE, JSON.stringify(data, null, 2));
}

function generateApiKey() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'inv_';
  for (let i = 0; i < 24; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

function validateApiKey(apiKey) {
  if (!apiKey) return { valid: false, error: 'API key required' };

  if (apiKey === 'local' || apiKey === 'dev') {
    return { valid: true, keyData: { name: 'Local Dev', configs: ['*'], tier: 'growth' } };
  }

  const data = loadApiKeys();
  const keyData = data.keys[apiKey];

  if (!keyData) {
    return { valid: false, error: 'Invalid API key' };
  }

  return { valid: true, keyData };
}

// ============================================
// RATE LIMITING (Weekly)
// ============================================

function checkRateLimit(apiKey, keyData) {
  const currentWeekStart = getWeekStart();

  // Get the tier limit (default to starter if not specified)
  const tier = keyData.tier || 'starter';
  const tierConfig = TIERS[tier] || TIERS.starter;
  const weeklyLimit = tierConfig.weeklyLimit;

  // Check if we need to reset (new week)
  if (!rateLimits.has(apiKey) || rateLimits.get(apiKey).weekStart !== currentWeekStart) {
    rateLimits.set(apiKey, { weekStart: currentWeekStart, count: 0 });
  }

  const limit = rateLimits.get(apiKey);

  if (limit.count >= weeklyLimit) {
    return {
      allowed: false,
      remaining: 0,
      tier: tier,
      weeklyLimit: weeklyLimit,
      resetAt: 'next Monday'
    };
  }

  limit.count++;
  return {
    allowed: true,
    remaining: weeklyLimit - limit.count,
    tier: tier,
    weeklyLimit: weeklyLimit
  };
}

// ============================================
// REQUEST LOGGING
// ============================================

function logRequest(apiKey, goal, configName, success, responseTime) {
  try {
    const data = JSON.parse(fs.readFileSync(LOGS_FILE, 'utf8'));

    data.logs.push({
      timestamp: new Date().toISOString(),
      apiKey: apiKey ? apiKey.substring(0, 10) + '...' : 'none',
      config: configName,
      goal: goal,
      success: success,
      responseTime: responseTime
    });

    if (data.logs.length > 1000) {
      data.logs = data.logs.slice(-1000);
    }

    fs.writeFileSync(LOGS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Log error:', e.message);
  }
}

// ============================================
// CHAT HISTORY LOGGING (Supabase)
// ============================================

async function logChatToSupabase(apiKey, userMessage, aiResponse, responseType, mode, currentPage, configName) {
  if (!supabase) {
    console.log('Supabase not configured - chat not logged');
    return;
  }

  try {
    const { error } = await supabase.from('chat_logs').insert({
      api_key: apiKey,
      user_message: userMessage,
      ai_response: aiResponse,
      response_type: responseType,
      mode: mode,
      current_page: currentPage,
      config_name: configName,
      created_at: new Date().toISOString()
    });

    if (error) {
      console.error('Supabase log error:', error.message);
    }
  } catch (e) {
    console.error('Chat logging error:', e.message);
  }
}

// ============================================
// ANALYTICS TRIGGER DETECTION
// ============================================

const ANALYTICS_TRIGGERS = [
  'show analytics',
  'display analytics',
  'show history',
  'display history',
  'download analytics',
  'download history',
  'export data',
  'export analytics',
  'get my data',
  'get analytics',
  'get my analytics',
  'show my data',
  'analytics report',
  'chat history',
  'show chat history',
  'download chat history'
];

function isAnalyticsTrigger(message) {
  const lowerMessage = message.toLowerCase().trim();
  return ANALYTICS_TRIGGERS.some(trigger => lowerMessage.includes(trigger));
}

// ============================================
// EXCEL GENERATION
// ============================================

async function generateAnalyticsExcel(apiKey, keyData) {
  if (!supabase) {
    throw new Error('Analytics not available - database not configured');
  }

  // Fetch all chat logs for this API key
  const { data: chatLogs, error } = await supabase
    .from('chat_logs')
    .select('*')
    .eq('api_key', apiKey)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error('Failed to fetch chat history: ' + error.message);
  }

  // Create workbook
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Invocursor';
  workbook.created = new Date();

  // ===== SHEET 1: Chat History =====
  const historySheet = workbook.addWorksheet('Chat History');
  historySheet.columns = [
    { header: 'Date & Time', key: 'timestamp', width: 20 },
    { header: 'User Message', key: 'user_message', width: 50 },
    { header: 'AI Response', key: 'ai_response', width: 50 },
    { header: 'Response Type', key: 'response_type', width: 15 },
    { header: 'Mode', key: 'mode', width: 12 },
    { header: 'Page', key: 'current_page', width: 15 }
  ];

  // Style header row
  historySheet.getRow(1).font = { bold: true };
  historySheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E3A8A' }
  };
  historySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  // Add data
  chatLogs.forEach(log => {
    historySheet.addRow({
      timestamp: new Date(log.created_at).toLocaleString(),
      user_message: log.user_message,
      ai_response: log.ai_response,
      response_type: log.response_type,
      mode: log.mode === 'fast' ? 'Do it for me' : 'Teach me',
      current_page: log.current_page
    });
  });

  // ===== SHEET 2: Summary Statistics =====
  const summarySheet = workbook.addWorksheet('Summary');

  // Calculate stats
  const totalConversations = chatLogs.length;
  const fastModeCount = chatLogs.filter(l => l.mode === 'fast').length;
  const guidedModeCount = chatLogs.filter(l => l.mode === 'guided').length;
  const actionCount = chatLogs.filter(l => l.response_type === 'action').length;
  const questionCount = chatLogs.filter(l => l.response_type === 'question').length;

  // Group by date for daily stats
  const dailyStats = {};
  chatLogs.forEach(log => {
    const date = new Date(log.created_at).toISOString().split('T')[0];
    dailyStats[date] = (dailyStats[date] || 0) + 1;
  });

  // Group by hour for peak hours
  const hourlyStats = {};
  chatLogs.forEach(log => {
    const hour = new Date(log.created_at).getHours();
    hourlyStats[hour] = (hourlyStats[hour] || 0) + 1;
  });
  const peakHour = Object.entries(hourlyStats).sort((a, b) => b[1] - a[1])[0];

  // Add summary data
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 30 },
    { header: 'Value', key: 'value', width: 25 }
  ];
  summarySheet.getRow(1).font = { bold: true };
  summarySheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E3A8A' }
  };
  summarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  summarySheet.addRow({ metric: 'Account Name', value: keyData.name });
  summarySheet.addRow({ metric: 'Tier', value: keyData.tier });
  summarySheet.addRow({ metric: 'Report Generated', value: new Date().toLocaleString() });
  summarySheet.addRow({ metric: '', value: '' });
  summarySheet.addRow({ metric: 'Total Conversations', value: totalConversations });
  summarySheet.addRow({ metric: 'Do it for me Mode', value: fastModeCount });
  summarySheet.addRow({ metric: 'Teach me Mode', value: guidedModeCount });
  summarySheet.addRow({ metric: '', value: '' });
  summarySheet.addRow({ metric: 'Actions Executed', value: actionCount });
  summarySheet.addRow({ metric: 'Questions Asked', value: questionCount });
  summarySheet.addRow({ metric: '', value: '' });
  summarySheet.addRow({ metric: 'Peak Usage Hour', value: peakHour ? `${peakHour[0]}:00 (${peakHour[1]} chats)` : 'N/A' });
  summarySheet.addRow({ metric: 'Days with Activity', value: Object.keys(dailyStats).length });

  // ===== SHEET 3: Daily Usage =====
  const dailySheet = workbook.addWorksheet('Daily Usage');
  dailySheet.columns = [
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Conversations', key: 'count', width: 15 }
  ];
  dailySheet.getRow(1).font = { bold: true };
  dailySheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E3A8A' }
  };
  dailySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  Object.entries(dailyStats)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .forEach(([date, count]) => {
      dailySheet.addRow({ date, count });
    });

  // ===== SHEET 4: Common Questions =====
  const questionsSheet = workbook.addWorksheet('Common Questions');

  // Count message frequency
  const messageCounts = {};
  chatLogs.forEach(log => {
    const msg = log.user_message.toLowerCase().trim();
    messageCounts[msg] = (messageCounts[msg] || 0) + 1;
  });

  const topQuestions = Object.entries(messageCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50);

  questionsSheet.columns = [
    { header: 'Question/Request', key: 'question', width: 60 },
    { header: 'Times Asked', key: 'count', width: 15 }
  ];
  questionsSheet.getRow(1).font = { bold: true };
  questionsSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E3A8A' }
  };
  questionsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  topQuestions.forEach(([question, count]) => {
    questionsSheet.addRow({ question, count });
  });

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

// ============================================
// CONFIG MANAGEMENT
// ============================================

function loadConfig(configName) {
  const configPath = path.join(CONFIGS_DIR, configName + '.json');
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
  return null;
}

function listConfigs() {
  if (!fs.existsSync(CONFIGS_DIR)) return [];
  return fs.readdirSync(CONFIGS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}

// ============================================
// OPENAI API
// ============================================

async function callOpenAI(systemPrompt, userMessage, jsonMode = false) {
  const body = {
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    temperature: 0.1,
    max_tokens: jsonMode ? 2000 : 500
  };

  // Enable JSON mode for config generation
  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'OpenAI API error');
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// ============================================
// PROMPT BUILDING
// ============================================

function buildSystemPrompt(config) {
  let pagesSummary = '';
  for (const [pageName, pageData] of Object.entries(config.pages)) {
    const elements = Object.keys(pageData.elements).join(', ');
    pagesSummary += `- "${pageName}": ${pageData.description}. Elements: ${elements}\n`;
  }

  let elementsDetail = '';
  for (const [pageName, pageData] of Object.entries(config.pages)) {
    for (const [elementId, elementData] of Object.entries(pageData.elements)) {
      let line = `${elementId} (${elementData.type}): "${elementData.label}"`;
      if (elementData.synonyms) {
        line += ` - also called: ${elementData.synonyms.join(', ')}`;
      }
      line += ` [on ${pageName} page]`;
      elementsDetail += line + '\n';
    }
  }

  return `You are an AI assistant for ${config.app.name}.
${config.app.description}

PAGES:
${pagesSummary}
ALL ELEMENTS:
${elementsDetail}

You create action plans as JSON arrays. Output ONLY valid JSON, no explanation.

Step types:
- Navigate: {"type":"navigate","target":"page-name"}
- Toggle ON: {"type":"toggle","target":"#element-id","value":true}
- Toggle OFF: {"type":"toggle","target":"#element-id","value":false}
- Type text: {"type":"type","target":"#element-id","value":"the text"}
- Click: {"type":"click","target":"#element-id"}

Rules:
- enable/turn on/activate = value: true
- disable/turn off/stop = value: false
- Navigate to correct page FIRST if not already there
- Only include necessary steps
- Output JSON array only, no markdown, no explanation`;
}

function buildUserMessage(goal, currentPage) {
  return `Current page: "${currentPage}"
User wants: "${goal}"

Output the JSON plan:`;
}

// Smart conversation system prompt - Mode-aware (fast vs guided)
function buildSmartSystemPrompt(config, mode = 'fast') {
  let pagesSummary = '';
  for (const [pageName, pageData] of Object.entries(config.pages)) {
    const elements = Object.keys(pageData.elements).join(', ');
    pagesSummary += `- "${pageName}": ${pageData.description}. Elements: ${elements}\n`;
  }

  let elementsDetail = '';
  for (const [pageName, pageData] of Object.entries(config.pages)) {
    for (const [elementId, elementData] of Object.entries(pageData.elements)) {
      let line = `${elementId} (${elementData.type}): "${elementData.label}"`;
      if (elementData.synonyms) {
        line += ` - also called: ${elementData.synonyms.join(', ')}`;
      }
      line += ` [on ${pageName} page]`;
      elementsDetail += line + '\n';
    }
  }

  const baseInfo = `You are a friendly assistant for ${config.app.name}.
${config.app.description}

PAGES:
${pagesSummary}
ALL ELEMENTS:
${elementsDetail}`;

  if (mode === 'guided') {
    // TEACH ME MODE - Detailed explanations, step-by-step learning
    return `${baseInfo}

MODE: TEACH ME (Guided Learning)
The user wants to LEARN, not just get things done. Your job is to teach them.

ALWAYS respond with valid JSON in this format:
{
  "type": "response_type",
  "message": "Your message to the user",
  "plan": [...],
  "explanations": ["Explanation for step 1", "Explanation for step 2", ...]
}

CRITICAL FOR GUIDED MODE:
- When type is "action", you MUST include an "explanations" array
- Each step in "plan" should have a corresponding explanation in "explanations"
- Explanations should teach WHY this step matters, not just WHAT it does
- Use simple, encouraging language

Response types:
- "question": Ask clarifying questions to understand their goal
- "explanation": Teach about a feature (no action needed)
- "action": Perform steps WITH detailed explanations for each step
- "status": Report current state
- "error": Can't help

For actions, include BOTH plan and explanations:
{
  "type": "action",
  "message": "Great! Let me show you how to do this step by step.",
  "plan": [
    {"type":"navigate","target":"settings"},
    {"type":"toggle","target":"#dark-mode","value":true}
  ],
  "explanations": [
    "First, we need to go to the Settings page. This is where you'll find all the customization options for your account.",
    "Now we'll enable Dark Mode. This changes the color scheme to darker colors, which is easier on your eyes, especially at night. You can always toggle this back if you prefer the light theme."
  ]
}

TEACHING STYLE:
- Celebrate their questions: "Great question!"
- Explain the WHY: "This helps because..."
- Give context: "You'll find this useful when..."
- Encourage independence: "Next time, you can find this in..."
- Offer tips: "Pro tip: You can also..."

Always navigate to the correct page FIRST before other actions.`;

  } else {
    // DO IT FOR ME MODE - Quick, efficient execution
    return `${baseInfo}

MODE: DO IT FOR ME (Fast Execution)
The user wants you to complete tasks quickly. Be efficient.

ALWAYS respond with valid JSON in this format:
{
  "type": "response_type",
  "message": "Brief message",
  "plan": [...]
}

Response types:
- "question": Only if absolutely necessary for clarification
- "explanation": Brief explanation if they ask about something
- "action": Perform the task (include "plan" array)
- "status": Quick status report
- "error": Can't help

For actions:
{
  "type": "action",
  "message": "Done! I've enabled dark mode for you.",
  "plan": [
    {"type":"navigate","target":"settings"},
    {"type":"toggle","target":"#dark-mode","value":true}
  ]
}

FAST MODE STYLE:
- Be concise - users want speed
- Skip lengthy explanations unless asked
- Just get it done
- Brief confirmation when complete

Plan step types:
- {"type":"navigate","target":"page-name"}
- {"type":"toggle","target":"#element-id","value":true/false}
- {"type":"type","target":"#element-id","value":"text"}
- {"type":"click","target":"#element-id"}

Always navigate to the correct page FIRST before other actions.`;
  }
}

// ============================================
// AUTH MIDDLEWARE
// ============================================

function authMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey || 'local';

  const validation = validateApiKey(apiKey);
  if (!validation.valid) {
    return res.status(401).json({ error: validation.error });
  }

  const rateCheck = checkRateLimit(apiKey, validation.keyData);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: 'Weekly rate limit exceeded',
      tier: rateCheck.tier,
      weeklyLimit: rateCheck.weeklyLimit,
      resetAt: rateCheck.resetAt,
      upgradeInfo: 'Contact us to upgrade your tier for more requests'
    });
  }

  req.apiKey = apiKey;
  req.keyData = validation.keyData;
  req.rateRemaining = rateCheck.remaining;
  req.tier = rateCheck.tier;
  req.weeklyLimit = rateCheck.weeklyLimit;

  res.set('X-RateLimit-Remaining', rateCheck.remaining);
  res.set('X-RateLimit-Limit', rateCheck.weeklyLimit);
  res.set('X-RateLimit-Tier', rateCheck.tier);

  next();
}

// ============================================
// API ROUTES
// ============================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    model: OPENAI_MODEL,
    apiKeySet: OPENAI_API_KEY !== 'YOUR_API_KEY_HERE'
  });
});

app.post('/api/plan', authMiddleware, async (req, res) => {
  const startTime = Date.now();
  const { goal, currentPage, configName = 'pheedloop' } = req.body;

  console.log('\n=== PLAN REQUEST ===');
  console.log('API Key:', req.apiKey.substring(0, 10) + '...');
  console.log('Config:', configName);
  console.log('Goal:', goal);
  console.log('Current page:', currentPage);

  if (req.keyData.configs[0] !== '*' && !req.keyData.configs.includes(configName)) {
    logRequest(req.apiKey, goal, configName, false, Date.now() - startTime);
    return res.status(403).json({ error: 'No access to this config' });
  }

  const config = loadConfig(configName);
  if (!config) {
    logRequest(req.apiKey, goal, configName, false, Date.now() - startTime);
    return res.json({ error: 'Config not found: ' + configName });
  }

  try {
    const systemPrompt = buildSystemPrompt(config);
    const userMessage = buildUserMessage(goal, currentPage);

    console.log('Calling OpenAI...');
    const response = await callOpenAI(systemPrompt, userMessage);
    console.log('Response:', response.substring(0, 200));

    // Extract JSON array
    const match = response.match(/\[[\s\S]*?\]/);
    if (match) {
      const plan = JSON.parse(match[0]);
      console.log('Plan:', JSON.stringify(plan));

      logRequest(req.apiKey, goal, configName, true, Date.now() - startTime);
      res.json({ plan });
    } else {
      throw new Error('No valid plan in response');
    }
  } catch (e) {
    console.error('Error:', e.message);
    logRequest(req.apiKey, goal, configName, false, Date.now() - startTime);
    res.json({ error: e.message });
  }
});

app.get('/api/config/:name', (req, res) => {
  const config = loadConfig(req.params.name);
  if (config) {
    res.json(config);
  } else {
    res.status(404).json({ error: 'Config not found' });
  }
});

app.get('/api/configs', (req, res) => {
  res.json({ configs: listConfigs() });
});

app.get('/api/stats', authMiddleware, (req, res) => {
  try {
    const logs = JSON.parse(fs.readFileSync(LOGS_FILE, 'utf8'));
    const keyPrefix = req.apiKey.substring(0, 10) + '...';

    const myLogs = logs.logs.filter(l => l.apiKey === keyPrefix);

    // Get current week's logs
    const weekStart = getWeekStart();
    const weekLogs = myLogs.filter(l => l.timestamp >= weekStart);

    res.json({
      totalRequests: myLogs.length,
      weekRequests: weekLogs.length,
      successRate: myLogs.length > 0
        ? Math.round(myLogs.filter(l => l.success).length / myLogs.length * 100)
        : 0,
      tier: req.tier,
      weeklyLimit: req.weeklyLimit,
      rateRemaining: req.rateRemaining
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// ============================================
// SMART CHAT ENDPOINT
// ============================================

app.post('/api/chat', authMiddleware, async (req, res) => {
  const startTime = Date.now();
  const { message, currentPage, currentState, history, configName = 'pheedloop', mode = 'fast' } = req.body;

  console.log('\n=== SMART CHAT ===');
  console.log('Mode:', mode);
  console.log('Message:', message);
  console.log('Page:', currentPage);
  console.log('State:', JSON.stringify(currentState || {}).substring(0, 200));

  // ============================================
  // ANALYTICS TRIGGER HANDLING (Before OpenAI)
  // ============================================

  // Check if there's a pending password verification for this API key
  const pendingRequest = pendingAnalyticsRequests.get(req.apiKey);
  if (pendingRequest && Date.now() - pendingRequest.timestamp < 300000) { // 5 min timeout
    // User is providing password
    const keyData = loadApiKeys().keys[req.apiKey];
    const correctPassword = keyData?.analyticsPassword;

    if (!correctPassword) {
      pendingAnalyticsRequests.delete(req.apiKey);
      return res.json({
        type: 'error',
        message: 'Analytics password not set up for this account. Please contact support to enable analytics.'
      });
    }

    if (message.trim() === correctPassword) {
      // Password correct - generate Excel
      pendingAnalyticsRequests.delete(req.apiKey);
      console.log('Password verified - generating analytics Excel...');

      try {
        const excelBuffer = await generateAnalyticsExcel(req.apiKey, keyData);

        // Convert to base64 for sending through JSON
        const base64Excel = excelBuffer.toString('base64');

        return res.json({
          type: 'analytics_download',
          message: 'Here is your analytics report! Click the button below to download your Excel file.',
          downloadData: {
            filename: `invocursor-analytics-${new Date().toISOString().split('T')[0]}.xlsx`,
            base64: base64Excel,
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          }
        });
      } catch (e) {
        console.error('Excel generation error:', e.message);
        return res.json({
          type: 'error',
          message: 'Failed to generate analytics: ' + e.message
        });
      }
    } else {
      // Wrong password
      return res.json({
        type: 'question',
        message: 'Incorrect password. Please try again or type "cancel" to go back to normal chat.'
      });
    }
  }

  // Check if user wants to cancel analytics
  if (pendingRequest && message.toLowerCase().trim() === 'cancel') {
    pendingAnalyticsRequests.delete(req.apiKey);
    return res.json({
      type: 'explanation',
      message: 'Analytics request cancelled. How else can I help you?'
    });
  }

  // Check if this is an analytics trigger
  if (isAnalyticsTrigger(message)) {
    // Check if user is on Growth tier
    const keyData = loadApiKeys().keys[req.apiKey];
    if (keyData?.tier !== 'growth') {
      return res.json({
        type: 'explanation',
        message: 'Analytics and chat history export is available on the Growth plan. You are currently on the ' + (keyData?.tier || 'free') + ' plan. Contact us to upgrade!'
      });
    }

    // Check if Supabase is configured
    if (!supabase) {
      return res.json({
        type: 'error',
        message: 'Analytics service is not available at the moment. Please try again later.'
      });
    }

    // Set pending request and ask for password
    pendingAnalyticsRequests.set(req.apiKey, { timestamp: Date.now() });

    return res.json({
      type: 'question',
      message: 'To access your analytics and chat history, please enter your analytics password. (Type "cancel" to go back)'
    });
  }

  // ============================================
  // NORMAL CHAT FLOW
  // ============================================

  const config = loadConfig(configName);
  if (!config) {
    return res.json({ error: 'Config not found' });
  }

  try {
    const systemPrompt = buildSmartSystemPrompt(config, mode);

    // Build context message with current state
    let userMessage = `Current page: "${currentPage}"\n`;

    if (currentState && Object.keys(currentState).length > 0) {
      userMessage += `\nCurrent state of settings:\n`;
      for (const [key, value] of Object.entries(currentState)) {
        userMessage += `- ${key}: ${value}\n`;
      }
    }

    // Add conversation history for context
    if (history && history.length > 0) {
      userMessage += `\nRecent conversation:\n`;
      history.slice(-4).forEach(h => {
        userMessage += `${h.role}: ${h.content}\n`;
      });
    }

    userMessage += `\nUser says: "${message}"\n\nRespond with JSON:`;

    const response = await callOpenAI(systemPrompt, userMessage, true);
    console.log('Response:', response.substring(0, 300));

    const parsed = JSON.parse(response);

    // Log to file
    logRequest(req.apiKey, message, configName, true, Date.now() - startTime);

    // Log to Supabase (async, don't wait)
    logChatToSupabase(
      req.apiKey,
      message,
      parsed.message || JSON.stringify(parsed),
      parsed.type,
      mode,
      currentPage,
      configName
    );

    res.json(parsed);

  } catch (e) {
    console.error('Error:', e.message);
    logRequest(req.apiKey, message, configName, false, Date.now() - startTime);
    res.json({
      type: 'error',
      message: 'Sorry, I had trouble understanding that. Could you try rephrasing?'
    });
  }
});

// ============================================
// AUTO-CONFIG GENERATOR
// ============================================

async function fetchPageHTML(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });
  if (!response.ok) throw new Error('Failed to fetch page');
  return await response.text();
}

function extractRelevantHTML(html) {
  // Remove scripts, styles, and comments to reduce token usage
  let clean = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Limit to 15000 chars to stay within token limits
  if (clean.length > 15000) {
    clean = clean.substring(0, 15000);
  }
  return clean;
}

async function generateConfigFromHTML(html, appName, appDescription) {
  const systemPrompt = `You are an expert at analyzing web application HTML and creating configuration files.

Analyze the HTML and identify:
1. Navigation elements (tabs, menu items, links that switch pages/views)
2. Form inputs (text fields, checkboxes, dropdowns, buttons)
3. Interactive elements (toggles, switches, clickable items)

Output a JSON config file in this EXACT format:
{
  "app": {
    "name": "App Name",
    "description": "What this app does"
  },
  "pages": {
    "page-name": {
      "description": "What this page is for",
      "elements": {
        "#element-id-or-selector": {
          "type": "checkbox|text|button|select",
          "label": "Human readable label",
          "synonyms": ["alternative", "names", "users might say"]
        }
      }
    }
  }
}

Rules:
- Use actual CSS selectors from the HTML (IDs preferred, then classes)
- Include synonyms users might say (e.g., "dark mode" = ["night mode", "dark theme"])
- Group elements by logical pages/sections
- Only include interactive elements (skip headers, paragraphs, images)
- Output ONLY valid JSON, no explanation`;

  const userMessage = `App Name: ${appName}
App Description: ${appDescription}

HTML to analyze:
${html}

Generate the config JSON:`;

  const response = await callOpenAI(systemPrompt, userMessage, true);  // JSON mode enabled

  // Extract JSON from response - try multiple approaches
  try {
    // First try: direct parse
    return JSON.parse(response);
  } catch (e) {
    // Second try: extract JSON object
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) {
        // Third try: clean up common issues
        let cleaned = match[0]
          .replace(/,\s*}/g, '}')  // Remove trailing commas
          .replace(/,\s*]/g, ']')  // Remove trailing commas in arrays
          .replace(/[\x00-\x1F\x7F]/g, ''); // Remove control characters
        return JSON.parse(cleaned);
      }
    }
  }
  throw new Error('Could not generate valid config');
}

// API: Generate config from URL
app.post('/api/generate-config', authMiddleware, async (req, res) => {
  const { url, appName, appDescription, saveName } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  console.log('\n=== CONFIG GENERATION ===');
  console.log('URL:', url);
  console.log('App:', appName);

  try {
    // Fetch the page
    console.log('Fetching page...');
    const html = await fetchPageHTML(url);

    // Clean HTML
    const cleanHTML = extractRelevantHTML(html);
    console.log('HTML length:', cleanHTML.length);

    // Generate config using AI
    console.log('Generating config with AI...');
    const config = await generateConfigFromHTML(
      cleanHTML,
      appName || 'My App',
      appDescription || 'A web application'
    );

    // Optionally save the config
    if (saveName) {
      const configPath = path.join(CONFIGS_DIR, saveName + '.json');
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log('Saved to:', configPath);
    }

    res.json({
      success: true,
      config,
      message: saveName ? `Config saved as ${saveName}.json` : 'Config generated (not saved)'
    });

  } catch (e) {
    console.error('Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// API: Generate config from raw HTML (for SPAs or when URL fetch doesn't work)
app.post('/api/generate-config-from-html', authMiddleware, async (req, res) => {
  const { html, appName, appDescription, saveName } = req.body;

  if (!html) {
    return res.status(400).json({ error: 'HTML is required' });
  }

  console.log('\n=== CONFIG GENERATION FROM HTML ===');
  console.log('App:', appName);

  try {
    const cleanHTML = extractRelevantHTML(html);
    console.log('HTML length:', cleanHTML.length);

    console.log('Generating config with AI...');
    const config = await generateConfigFromHTML(
      cleanHTML,
      appName || 'My App',
      appDescription || 'A web application'
    );

    if (saveName) {
      const configPath = path.join(CONFIGS_DIR, saveName + '.json');
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log('Saved to:', configPath);
    }

    res.json({
      success: true,
      config,
      message: saveName ? `Config saved as ${saveName}.json` : 'Config generated (not saved)'
    });

  } catch (e) {
    console.error('Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// ADMIN ROUTES
// ============================================

app.post('/admin/keys', (req, res) => {
  const { name, configs = [], tier = 'starter', adminSecret } = req.body;

  if (adminSecret !== 'invocursor-admin-2024') {
    return res.status(401).json({ error: 'Invalid admin secret' });
  }

  // Validate tier
  if (!TIERS[tier]) {
    return res.status(400).json({ error: `Invalid tier. Must be one of: ${Object.keys(TIERS).join(', ')}` });
  }

  const newKey = generateApiKey();
  const data = loadApiKeys();

  data.keys[newKey] = {
    name: name || 'New Account',
    tier: tier,
    configs: configs,
    requestsThisWeek: 0,
    weekStart: getWeekStart(),
    created: new Date().toISOString()
  };

  saveApiKeys(data);

  const tierConfig = TIERS[tier];
  res.json({
    apiKey: newKey,
    tier: tier,
    weeklyLimit: tierConfig.weeklyLimit,
    message: `API key created successfully with ${tierConfig.name} tier (${tierConfig.weeklyLimit} requests/week)`
  });
});

app.get('/admin/keys', (req, res) => {
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret !== 'invocursor-admin-2024') {
    return res.status(401).json({ error: 'Invalid admin secret' });
  }

  const data = loadApiKeys();
  const masked = {};

  for (const [key, value] of Object.entries(data.keys)) {
    const tier = value.tier || 'starter';
    const tierConfig = TIERS[tier] || TIERS.starter;
    masked[key.substring(0, 10) + '...'] = {
      name: value.name,
      tier: tier,
      weeklyLimit: tierConfig.weeklyLimit,
      configs: value.configs,
      created: value.created,
      hasAnalyticsPassword: !!value.analyticsPassword
    };
  }

  res.json({ keys: masked, tiers: TIERS });
});

// Set analytics password for a customer
app.post('/admin/set-analytics-password', (req, res) => {
  const { apiKey, password, adminSecret } = req.body;

  if (adminSecret !== 'invocursor-admin-2024') {
    return res.status(401).json({ error: 'Invalid admin secret' });
  }

  if (!apiKey || !password) {
    return res.status(400).json({ error: 'API key and password are required' });
  }

  const data = loadApiKeys();

  if (!data.keys[apiKey]) {
    return res.status(404).json({ error: 'API key not found' });
  }

  // Set the analytics password
  data.keys[apiKey].analyticsPassword = password;
  saveApiKeys(data);

  res.json({
    success: true,
    message: `Analytics password set for ${data.keys[apiKey].name}. They can now use "show analytics" in chat.`
  });
});

// ============================================
// STATIC FILES
// ============================================

// Landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../landing.html'));
});

// Onboarding / Setup page
app.get('/setup', (req, res) => {
  res.sendFile(path.join(__dirname, '../onboarding.html'));
});

app.get('/onboarding', (req, res) => {
  res.sendFile(path.join(__dirname, '../onboarding.html'));
});

// Demo page
app.get('/demo', (req, res) => {
  res.sendFile(path.join(__dirname, '../test.html'));
});

// Test page (for iframe embed)
app.get('/test.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../test.html'));
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║       INVOCURSOR SERVER v2.1             ║');
  console.log('║           (OpenAI Powered)               ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  URL:      http://localhost:${PORT}           ║`);
  console.log(`║  Model:    ${OPENAI_MODEL}                  ║`);
  console.log('║  Auth:     API Key required              ║');
  console.log('╚══════════════════════════════════════════╝');

  if (OPENAI_API_KEY === 'YOUR_API_KEY_HERE') {
    console.log('\n⚠️  WARNING: Set OPENAI_API_KEY environment variable!');
    console.log('   Run: OPENAI_API_KEY=sk-xxx node server/index.js\n');
  } else {
    console.log('\n✓ OpenAI API key configured\n');
  }
});
