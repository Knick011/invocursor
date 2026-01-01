const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3050;

// OpenAI Configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'YOUR_API_KEY_HERE';
const OPENAI_MODEL = 'gpt-4o-mini';  // Cheapest smart model

// Data directories
const DATA_DIR = path.join(__dirname, '../data');
const CONFIGS_DIR = path.join(__dirname, '../configs');
const API_KEYS_FILE = path.join(DATA_DIR, 'api-keys.json');
const LOGS_FILE = path.join(DATA_DIR, 'request-logs.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize files if they don't exist
if (!fs.existsSync(API_KEYS_FILE)) {
  fs.writeFileSync(API_KEYS_FILE, JSON.stringify({
    keys: {
      "inv_demo_12345": {
        name: "Demo Account",
        configs: ["pheedloop"],
        rateLimit: 100,
        requestsToday: 0,
        lastReset: new Date().toISOString().split('T')[0],
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
    return { valid: true, keyData: { name: 'Local Dev', configs: ['*'], rateLimit: 1000 } };
  }

  const data = loadApiKeys();
  const keyData = data.keys[apiKey];

  if (!keyData) {
    return { valid: false, error: 'Invalid API key' };
  }

  return { valid: true, keyData };
}

// ============================================
// RATE LIMITING
// ============================================

function checkRateLimit(apiKey, keyData) {
  const today = new Date().toISOString().split('T')[0];

  if (!rateLimits.has(apiKey) || rateLimits.get(apiKey).date !== today) {
    rateLimits.set(apiKey, { date: today, count: 0 });
  }

  const limit = rateLimits.get(apiKey);

  if (limit.count >= keyData.rateLimit) {
    return { allowed: false, remaining: 0 };
  }

  limit.count++;
  return { allowed: true, remaining: keyData.rateLimit - limit.count };
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
      error: 'Rate limit exceeded',
      resetAt: 'midnight UTC'
    });
  }

  req.apiKey = apiKey;
  req.keyData = validation.keyData;
  req.rateRemaining = rateCheck.remaining;

  res.set('X-RateLimit-Remaining', rateCheck.remaining);

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
    const today = new Date().toISOString().split('T')[0];
    const todayLogs = myLogs.filter(l => l.timestamp.startsWith(today));

    res.json({
      totalRequests: myLogs.length,
      todayRequests: todayLogs.length,
      successRate: myLogs.length > 0
        ? Math.round(myLogs.filter(l => l.success).length / myLogs.length * 100)
        : 0,
      rateRemaining: req.rateRemaining
    });
  } catch (e) {
    res.json({ error: e.message });
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
  const { name, configs = [], rateLimit = 100, adminSecret } = req.body;

  if (adminSecret !== 'invocursor-admin-2024') {
    return res.status(401).json({ error: 'Invalid admin secret' });
  }

  const newKey = generateApiKey();
  const data = loadApiKeys();

  data.keys[newKey] = {
    name: name || 'New Account',
    configs: configs,
    rateLimit: rateLimit,
    requestsToday: 0,
    lastReset: new Date().toISOString().split('T')[0],
    created: new Date().toISOString()
  };

  saveApiKeys(data);

  res.json({
    apiKey: newKey,
    message: 'API key created successfully'
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
    masked[key.substring(0, 10) + '...'] = {
      name: value.name,
      configs: value.configs,
      rateLimit: value.rateLimit,
      created: value.created
    };
  }

  res.json({ keys: masked });
});

// ============================================
// STATIC FILES
// ============================================

app.get('/', (req, res) => {
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
