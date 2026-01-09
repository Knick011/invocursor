/**
 * Invocursor Widget v3.1
 * AI Learning & Support Assistant with Mode Toggle
 * Features: "Do it for me" (fast) vs "Teach me" (guided) modes
 */
(function() {
  const SCRIPT = document.currentScript;
  const API_URL = SCRIPT?.dataset?.api || window.location.origin;
  const CONFIG_NAME = SCRIPT?.dataset?.config || 'pheedloop';
  const API_KEY = SCRIPT?.dataset?.apiKey || 'local';
  const STORAGE_KEY = 'invocursor_history_' + CONFIG_NAME;
  const MODE_KEY = 'invocursor_mode';

  // Animation settings
  const CURSOR_SPEED = 800;
  const CLICK_DELAY = 300;
  const TYPE_SPEED = 50;
  const STEP_PAUSE_FAST = 400;
  const STEP_PAUSE_GUIDED = 1500;

  // State
  let chatHistory = [];
  let currentMode = localStorage.getItem(MODE_KEY) || 'fast'; // 'fast' or 'guided'
  let waitingForContinue = false;
  let pendingSteps = [];
  let currentStepIndex = 0;

  // Load/save history
  function loadHistory() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        chatHistory = JSON.parse(saved);
        if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
      }
    } catch (e) { chatHistory = []; }
  }

  function saveHistory() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chatHistory.slice(-20)));
    } catch (e) {}
  }

  function addToHistory(role, content) {
    chatHistory.push({ role, content, timestamp: Date.now() });
    saveHistory();
  }

  function clearHistory() {
    chatHistory = [];
    localStorage.removeItem(STORAGE_KEY);
  }

  function setMode(mode) {
    currentMode = mode;
    localStorage.setItem(MODE_KEY, mode);
    updateModeUI();
  }

  // Styles
  const style = document.createElement('style');
  style.textContent = `
    #cp-widget {
      position: fixed;
      bottom: 16px;
      right: 8px;
      width: 400px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      z-index: 99999;
    }

    #cp-toggle {
      width: 52px;
      height: 52px;
      border-radius: 12px;
      background: transparent;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(245, 158, 11, 0.35);
      transition: transform 0.2s, box-shadow 0.2s;
      padding: 0;
      overflow: hidden;
    }

    #cp-toggle:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 25px rgba(245, 158, 11, 0.5);
    }

    #cp-toggle img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 12px;
    }

    #cp-panel {
      display: none;
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.15);
      overflow: hidden;
      margin-bottom: 12px;
    }

    #cp-header {
      background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%);
      color: #fff;
      padding: 12px 16px;
    }

    #cp-header-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }

    #cp-header h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
    }

    #cp-header-btns {
      display: flex;
      gap: 8px;
    }

    #cp-clear, #cp-close {
      background: rgba(255,255,255,0.2);
      border: none;
      color: #fff;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    #cp-clear:hover, #cp-close:hover {
      background: rgba(255,255,255,0.3);
    }

    /* Mode Toggle */
    #cp-mode-toggle {
      display: flex;
      background: rgba(0,0,0,0.2);
      border-radius: 8px;
      padding: 3px;
      gap: 3px;
    }

    .cp-mode-btn {
      flex: 1;
      padding: 6px 10px;
      border: none;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      background: transparent;
      color: rgba(255,255,255,0.7);
    }

    .cp-mode-btn.active {
      background: #fff;
      color: #ea580c;
    }

    .cp-mode-btn:not(.active):hover {
      background: rgba(255,255,255,0.1);
      color: #fff;
    }

    #cp-log {
      height: 300px;
      overflow-y: auto;
      padding: 12px;
      background: #f8fafc;
    }

    #cp-input-wrap {
      padding: 12px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      gap: 8px;
    }

    #cp-input {
      flex: 1;
      padding: 12px;
      border: 2px solid #e2e8f0;
      border-radius: 10px;
      font-size: 14px;
      transition: border-color 0.2s;
    }

    #cp-input:focus {
      outline: none;
      border-color: #f59e0b;
    }

    #cp-input:disabled {
      background: #f1f5f9;
    }

    #cp-send {
      padding: 12px 20px;
      background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%);
      color: #fff;
      border: none;
      border-radius: 10px;
      cursor: pointer;
      font-weight: 600;
      transition: opacity 0.2s;
    }

    #cp-send:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Messages */
    .cp-msg {
      margin: 8px 0;
      padding: 10px 12px;
      border-radius: 10px;
      font-size: 13px;
      line-height: 1.5;
    }

    .cp-user {
      background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%);
      color: #fff;
      margin-left: 40px;
    }

    .cp-assistant {
      background: #fff;
      border: 1px solid #e2e8f0;
      margin-right: 40px;
    }

    .cp-question {
      background: #fef3c7;
      border: 1px solid #fbbf24;
      margin-right: 40px;
    }

    .cp-explanation {
      background: #eff6ff;
      border: 1px solid #93c5fd;
      margin-right: 40px;
    }

    .cp-status {
      background: #f0fdf4;
      border: 1px solid #86efac;
      margin-right: 40px;
    }

    .cp-plan {
      background: #f0f9ff;
      border: 1px solid #bae6fd;
    }

    .cp-step {
      background: #fefce8;
      border-left: 3px solid #eab308;
      margin: 4px 0;
    }

    .cp-step.done {
      background: #dcfce7;
      border-left-color: #22c55e;
    }

    .cp-step.fail {
      background: #fee2e2;
      border-left-color: #ef4444;
    }

    .cp-step.waiting {
      background: #fef3c7;
      border-left-color: #f59e0b;
    }

    .cp-done {
      background: #dcfce7;
      border: 1px solid #86efac;
      color: #166534;
      font-weight: 600;
    }

    .cp-error {
      background: #fee2e2;
      border: 1px solid #fca5a5;
      color: #991b1b;
    }

    .cp-thinking {
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      color: #64748b;
      font-style: italic;
    }

    .cp-tip {
      background: #fdf4ff;
      border: 1px solid #e879f9;
      margin-right: 40px;
      font-size: 12px;
    }

    .cp-tip::before {
      content: "💡 ";
    }

    /* Continue Button */
    #cp-continue-wrap {
      padding: 8px 12px;
      border-top: 1px solid #e2e8f0;
      display: none;
      gap: 8px;
    }

    #cp-continue-wrap.visible {
      display: flex;
    }

    #cp-continue {
      flex: 1;
      padding: 10px 16px;
      background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
      color: #fff;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 13px;
    }

    #cp-continue:hover {
      opacity: 0.9;
    }

    #cp-skip-all {
      padding: 10px 16px;
      background: #f1f5f9;
      color: #64748b;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 500;
      font-size: 13px;
    }

    /* Cursor styles */
    #cp-cursor {
      position: fixed;
      width: 24px;
      height: 24px;
      pointer-events: none;
      z-index: 999999;
      opacity: 0;
      filter: drop-shadow(0 2px 8px rgba(245, 158, 11, 0.6));
      transition: opacity 0.3s;
    }

    #cp-cursor.visible {
      opacity: 1;
    }

    #cp-click-ripple {
      position: fixed;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: rgba(245, 158, 11, 0.4);
      pointer-events: none;
      z-index: 999998;
      transform: scale(0);
      opacity: 0;
    }

    #cp-click-ripple.animate {
      animation: cp-ripple 0.4s ease-out forwards;
    }

    @keyframes cp-ripple {
      0% { transform: scale(0); opacity: 1; }
      100% { transform: scale(2); opacity: 0; }
    }

    .cp-highlight {
      outline: 3px solid #f59e0b !important;
      outline-offset: 2px;
      transition: outline 0.2s;
    }
  `;
  document.head.appendChild(style);

  // Widget HTML
  const widget = document.createElement('div');
  widget.id = 'cp-widget';
  widget.innerHTML = `
    <div id="cp-panel">
      <div id="cp-header">
        <div id="cp-header-top">
          <h3>Invocursor</h3>
          <div id="cp-header-btns">
            <button id="cp-clear" title="Clear chat">🗑</button>
            <button id="cp-close">×</button>
          </div>
        </div>
        <div id="cp-mode-toggle">
          <button class="cp-mode-btn" data-mode="fast">⚡ Do it for me</button>
          <button class="cp-mode-btn" data-mode="guided">📚 Teach me</button>
        </div>
      </div>
      <div id="cp-log"></div>
      <div id="cp-continue-wrap">
        <button id="cp-continue">Continue to next step →</button>
        <button id="cp-skip-all">Do the rest</button>
      </div>
      <div id="cp-input-wrap">
        <input id="cp-input" placeholder="What would you like to do?" />
        <button id="cp-send">Go</button>
      </div>
    </div>
    <button id="cp-toggle">
      <img src="${API_URL}/assets/logo.png" alt="Invocursor">
    </button>
  `;
  document.body.appendChild(widget);

  // Cursor element
  const cursor = document.createElement('div');
  cursor.id = 'cp-cursor';
  cursor.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24">
    <path d="M4 4l7 17 2-7 7-2L4 4z" fill="#f59e0b" stroke="#fff" stroke-width="1.5"/>
  </svg>`;
  document.body.appendChild(cursor);

  // Click ripple
  const ripple = document.createElement('div');
  ripple.id = 'cp-click-ripple';
  document.body.appendChild(ripple);

  // Cursor position
  let cursorX = window.innerWidth - 100;
  let cursorY = window.innerHeight - 100;
  cursor.style.left = cursorX + 'px';
  cursor.style.top = cursorY + 'px';

  // Elements
  const panel = document.getElementById('cp-panel');
  const toggle = document.getElementById('cp-toggle');
  const logEl = document.getElementById('cp-log');
  const input = document.getElementById('cp-input');
  const sendBtn = document.getElementById('cp-send');
  const continueWrap = document.getElementById('cp-continue-wrap');
  const continueBtn = document.getElementById('cp-continue');
  const skipAllBtn = document.getElementById('cp-skip-all');

  // Initialize
  loadHistory();
  updateModeUI();

  function updateModeUI() {
    document.querySelectorAll('.cp-mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === currentMode);
    });
  }

  // Event handlers
  toggle.onclick = () => {
    panel.style.display = 'block';
    toggle.style.display = 'none';
    input.focus();
  };

  document.getElementById('cp-close').onclick = () => {
    panel.style.display = 'none';
    toggle.style.display = 'block';
  };

  document.getElementById('cp-clear').onclick = () => {
    clearHistory();
    logEl.innerHTML = '';
    log('Chat cleared. How can I help you?', 'cp-assistant');
  };

  document.querySelectorAll('.cp-mode-btn').forEach(btn => {
    btn.onclick = () => setMode(btn.dataset.mode);
  });

  continueBtn.onclick = () => continueGuidedExecution();
  skipAllBtn.onclick = () => skipToEnd();

  // Helpers
  function log(html, cls) {
    const div = document.createElement('div');
    div.className = 'cp-msg ' + cls;
    div.innerHTML = html;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
    return div;
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function getCurrentPage() {
    const activeTab = document.querySelector('.nav-tab.active, [data-active="true"], .tab.active');
    if (activeTab?.dataset?.page) return activeTab.dataset.page;
    const path = window.location.pathname.split('/').pop();
    return path || 'home';
  }

  function getCurrentState() {
    const state = {};
    document.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach(el => {
      const id = el.id || el.name;
      if (id) {
        const label = el.closest('label')?.textContent?.trim() ||
                     document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() ||
                     el.dataset?.label || id;
        state[label] = el.checked ? 'ON' : 'OFF';
      }
    });
    document.querySelectorAll('select').forEach(el => {
      const id = el.id || el.name;
      if (id) {
        const label = document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() || id;
        const selectedOption = el.options[el.selectedIndex];
        state[label] = selectedOption?.text || el.value;
      }
    });
    document.querySelectorAll('input[type="text"], input[type="email"], input[type="number"], textarea').forEach(el => {
      const id = el.id || el.name;
      if (id && el.value) {
        const label = document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() || id;
        state[label] = el.value;
      }
    });
    return state;
  }

  // Cursor animation
  function animateCursor(targetX, targetY, duration) {
    return new Promise(resolve => {
      const startX = cursorX;
      const startY = cursorY;
      const startTime = performance.now();

      function animate(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);

        cursorX = startX + (targetX - startX) * eased;
        cursorY = startY + (targetY - startY) * eased;

        cursor.style.left = cursorX + 'px';
        cursor.style.top = cursorY + 'px';

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          resolve();
        }
      }
      requestAnimationFrame(animate);
    });
  }

  async function showClick(x, y) {
    ripple.style.left = (x - 20) + 'px';
    ripple.style.top = (y - 20) + 'px';
    ripple.classList.remove('animate');
    void ripple.offsetWidth;
    ripple.classList.add('animate');
    await sleep(CLICK_DELAY);
  }

  async function moveCursor(el) {
    const rect = el.getBoundingClientRect();
    const targetX = rect.left + rect.width / 2 - 12;
    const targetY = rect.top + rect.height / 2 - 12;

    cursor.classList.add('visible');
    await animateCursor(targetX, targetY, CURSOR_SPEED);
    el.classList.add('cp-highlight');
    await sleep(200);
  }

  function hideCursor() {
    cursor.classList.remove('visible');
    document.querySelectorAll('.cp-highlight').forEach(el => {
      el.classList.remove('cp-highlight');
    });
  }

  async function typeText(el, text) {
    el.focus();
    el.value = '';
    for (let i = 0; i < text.length; i++) {
      el.value += text[i];
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(TYPE_SPEED);
    }
  }

  // Execute single step
  async function executeStep(step) {
    if (step.type === 'navigate') {
      const tab = document.querySelector(`[data-page="${step.target}"]`);
      if (!tab) return { success: false, reason: 'Page not found' };

      await moveCursor(tab);
      await showClick(cursorX + 12, cursorY + 12);
      tab.click();
      await sleep(currentMode === 'fast' ? STEP_PAUSE_FAST : STEP_PAUSE_GUIDED);
      hideCursor();
      return { success: true };
    }

    const el = document.querySelector(step.target);
    if (!el) return { success: false, reason: 'Element not found' };

    await moveCursor(el);

    if (step.type === 'toggle') {
      const want = step.value === true || step.value === 'true';
      await showClick(cursorX + 12, cursorY + 12);
      if (el.checked !== want) el.click();
      await sleep(currentMode === 'fast' ? STEP_PAUSE_FAST : STEP_PAUSE_GUIDED);
      hideCursor();
      return { success: el.checked === want };
    }

    if (step.type === 'type') {
      await showClick(cursorX + 12, cursorY + 12);
      await typeText(el, step.value || '');
      await sleep(currentMode === 'fast' ? STEP_PAUSE_FAST : STEP_PAUSE_GUIDED);
      hideCursor();
      return { success: true };
    }

    if (step.type === 'click') {
      await showClick(cursorX + 12, cursorY + 12);
      el.click();
      await sleep(currentMode === 'fast' ? STEP_PAUSE_FAST : STEP_PAUSE_GUIDED);
      hideCursor();
      return { success: true };
    }

    if (step.type === 'select') {
      await showClick(cursorX + 12, cursorY + 12);
      el.value = step.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(currentMode === 'fast' ? STEP_PAUSE_FAST : STEP_PAUSE_GUIDED);
      hideCursor();
      return { success: true };
    }

    return { success: false, reason: 'Unknown action' };
  }

  function describeStep(step) {
    if (step.type === 'navigate') return `Go to <b>${step.target}</b>`;
    if (step.type === 'toggle') return `${step.value ? 'Enable' : 'Disable'} <b>${step.target}</b>`;
    if (step.type === 'type') return `Type "${step.value}" in <b>${step.target}</b>`;
    if (step.type === 'click') return `Click <b>${step.target}</b>`;
    if (step.type === 'select') return `Select "${step.value}" in <b>${step.target}</b>`;
    return JSON.stringify(step);
  }

  // Execute plan - handles both modes
  async function executePlan(plan, explanations = []) {
    // Show plan overview
    let planHtml = '<b>Plan:</b><br>';
    plan.forEach((step, i) => {
      planHtml += `${i+1}. ${describeStep(step)}<br>`;
    });
    log(planHtml, 'cp-plan');

    await sleep(600);

    if (currentMode === 'fast') {
      // Fast mode: execute all steps quickly
      for (let i = 0; i < plan.length; i++) {
        const step = plan[i];
        const stepDiv = log(`▶ Step ${i+1}: ${describeStep(step)}`, 'cp-step');

        await sleep(200);
        const result = await executeStep(step);

        if (result.success) {
          stepDiv.className = 'cp-msg cp-step done';
          stepDiv.innerHTML = `✓ Step ${i+1}: ${describeStep(step)}`;
        } else {
          stepDiv.className = 'cp-msg cp-step fail';
          stepDiv.innerHTML = `✗ Step ${i+1}: ${describeStep(step)} (${result.reason || 'failed'})`;
        }

        await sleep(300);
      }
      log('Done!', 'cp-done');
    } else {
      // Guided mode: step by step with explanations
      pendingSteps = plan.map((step, i) => ({
        step,
        explanation: explanations[i] || null
      }));
      currentStepIndex = 0;
      await executeGuidedStep();
    }
  }

  async function executeGuidedStep() {
    if (currentStepIndex >= pendingSteps.length) {
      continueWrap.classList.remove('visible');
      input.disabled = false;
      sendBtn.disabled = false;
      log('All done! You\'ve completed all the steps.', 'cp-done');
      log('Pro tip: Try doing this yourself next time - you\'ve got this!', 'cp-tip');
      return;
    }

    const { step, explanation } = pendingSteps[currentStepIndex];

    // Show explanation if in guided mode
    if (explanation) {
      log(explanation, 'cp-explanation');
      await sleep(500);
    }

    const stepDiv = log(`▶ Step ${currentStepIndex + 1}: ${describeStep(step)}`, 'cp-step waiting');

    await sleep(300);
    const result = await executeStep(step);

    if (result.success) {
      stepDiv.className = 'cp-msg cp-step done';
      stepDiv.innerHTML = `✓ Step ${currentStepIndex + 1}: ${describeStep(step)}`;
    } else {
      stepDiv.className = 'cp-msg cp-step fail';
      stepDiv.innerHTML = `✗ Step ${currentStepIndex + 1}: ${describeStep(step)} (${result.reason || 'failed'})`;
    }

    currentStepIndex++;

    if (currentStepIndex < pendingSteps.length) {
      // Show continue button
      continueWrap.classList.add('visible');
      waitingForContinue = true;
    } else {
      continueWrap.classList.remove('visible');
      input.disabled = false;
      sendBtn.disabled = false;
      log('All done! Great job following along.', 'cp-done');
      log('Pro tip: Try doing this yourself next time - you\'ve got this!', 'cp-tip');
    }
  }

  function continueGuidedExecution() {
    waitingForContinue = false;
    continueWrap.classList.remove('visible');
    executeGuidedStep();
  }

  function skipToEnd() {
    // Switch to fast mode for remaining steps
    waitingForContinue = false;
    continueWrap.classList.remove('visible');

    // Execute remaining steps quickly
    (async () => {
      for (let i = currentStepIndex; i < pendingSteps.length; i++) {
        const { step } = pendingSteps[i];
        const stepDiv = log(`▶ Step ${i + 1}: ${describeStep(step)}`, 'cp-step');

        await sleep(200);
        const result = await executeStep(step);

        if (result.success) {
          stepDiv.className = 'cp-msg cp-step done';
          stepDiv.innerHTML = `✓ Step ${i + 1}: ${describeStep(step)}`;
        } else {
          stepDiv.className = 'cp-msg cp-step fail';
          stepDiv.innerHTML = `✗ Step ${i + 1}: ${describeStep(step)} (${result.reason || 'failed'})`;
        }

        await sleep(300);
      }

      input.disabled = false;
      sendBtn.disabled = false;
      log('Done!', 'cp-done');
    })();
  }

  // Main chat function
  async function chat(message) {
    log(message, 'cp-user');
    addToHistory('user', message);

    const thinkingDiv = log('Thinking...', 'cp-thinking');

    const currentPage = getCurrentPage();
    const currentState = getCurrentState();

    try {
      const resp = await fetch(API_URL + '/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY
        },
        body: JSON.stringify({
          message,
          currentPage,
          currentState,
          history: chatHistory.slice(-6),
          configName: CONFIG_NAME,
          mode: currentMode
        })
      });

      const data = await resp.json();
      thinkingDiv.remove();

      if (data.error) {
        log('Error: ' + data.error, 'cp-error');
        return;
      }

      const responseType = data.type || 'explanation';
      const responseMessage = data.message || 'I understood your request.';

      addToHistory('assistant', responseMessage);

      switch (responseType) {
        case 'question':
          log('🤔 ' + responseMessage, 'cp-question');
          break;

        case 'explanation':
          log(responseMessage, 'cp-explanation');
          break;

        case 'status':
          log('📊 ' + responseMessage, 'cp-status');
          break;

        case 'action':
          log(responseMessage, 'cp-assistant');
          if (data.plan && data.plan.length > 0) {
            await executePlan(data.plan, data.explanations || []);
          }
          break;

        case 'error':
          log(responseMessage, 'cp-error');
          break;

        default:
          log(responseMessage, 'cp-assistant');
      }

    } catch (e) {
      thinkingDiv.remove();
      log('Connection error. Please try again.', 'cp-error');
    }
  }

  // Send handler
  async function send() {
    const message = input.value.trim();
    if (!message || waitingForContinue) return;

    input.value = '';
    input.disabled = true;
    sendBtn.disabled = true;

    await chat(message);

    if (!waitingForContinue) {
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  sendBtn.onclick = send;
  input.onkeydown = e => { if (e.key === 'Enter') send(); };

  // Welcome message
  const modeDesc = currentMode === 'fast'
    ? 'I\'ll complete tasks quickly for you.'
    : 'I\'ll guide you step-by-step so you learn.';
  log(`Hi! I'm here to help. ${modeDesc} Use the toggle above to switch modes anytime.`, 'cp-assistant');
})();
