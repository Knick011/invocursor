/**
 * Invocursor Widget v2.1
 * Drop-in AI assistant for any web application
 * Now with smooth cursor animations!
 */
(function() {
  // Configuration - can be overridden via data attributes
  const SCRIPT = document.currentScript;
  // Auto-detect API URL: use data-api if provided, otherwise use same origin
  const API_URL = SCRIPT?.dataset?.api || window.location.origin;
  const CONFIG_NAME = SCRIPT?.dataset?.config || 'pheedloop';
  const API_KEY = SCRIPT?.dataset?.apiKey || 'local';

  // Animation settings (adjustable)
  const CURSOR_SPEED = 800;      // ms to move cursor
  const CLICK_DELAY = 300;       // ms pause after click
  const TYPE_SPEED = 50;         // ms per character
  const STEP_PAUSE = 500;        // ms between steps

  // Inject styles
  const style = document.createElement('style');
  style.textContent = `
    #cp-widget {
      position: fixed;
      bottom: 16px;
      right: 16px;
      width: 380px;
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
      padding: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    #cp-header h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
    }

    #cp-close {
      background: rgba(255,255,255,0.2);
      border: none;
      color: #fff;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 16px;
    }

    #cp-log {
      height: 320px;
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

    .cp-msg {
      margin: 8px 0;
      padding: 10px 12px;
      border-radius: 10px;
      font-size: 13px;
      line-height: 1.4;
    }

    .cp-user {
      background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%);
      color: #fff;
      margin-left: 40px;
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

    /* Cursor styles - improved */
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

    /* Click ripple effect */
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

    /* Highlight effect for target element */
    .cp-highlight {
      outline: 3px solid #f59e0b !important;
      outline-offset: 2px;
      transition: outline 0.2s;
    }
  `;
  document.head.appendChild(style);

  // Create widget HTML
  const widget = document.createElement('div');
  widget.id = 'cp-widget';
  widget.innerHTML = `
    <div id="cp-panel">
      <div id="cp-header">
        <h3>✨ Invocursor</h3>
        <button id="cp-close">×</button>
      </div>
      <div id="cp-log"></div>
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

  // Create cursor with better design
  const cursor = document.createElement('div');
  cursor.id = 'cp-cursor';
  cursor.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24">
    <path d="M4 4l7 17 2-7 7-2L4 4z" fill="#f59e0b" stroke="#fff" stroke-width="1.5"/>
  </svg>`;
  document.body.appendChild(cursor);

  // Create click ripple element
  const ripple = document.createElement('div');
  ripple.id = 'cp-click-ripple';
  document.body.appendChild(ripple);

  // Current cursor position
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

  // Toggle panel
  toggle.onclick = () => {
    panel.style.display = 'block';
    toggle.style.display = 'none';
    input.focus();
  };

  document.getElementById('cp-close').onclick = () => {
    panel.style.display = 'none';
    toggle.style.display = 'block';
  };

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

  // Smooth cursor animation using requestAnimationFrame
  function animateCursor(targetX, targetY, duration) {
    return new Promise(resolve => {
      const startX = cursorX;
      const startY = cursorY;
      const startTime = performance.now();

      function animate(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Easing function (ease-out cubic)
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

  // Show click effect
  async function showClick(x, y) {
    ripple.style.left = (x - 20) + 'px';
    ripple.style.top = (y - 20) + 'px';
    ripple.classList.remove('animate');
    void ripple.offsetWidth; // Force reflow
    ripple.classList.add('animate');
    await sleep(CLICK_DELAY);
  }

  // Move cursor to element with smooth animation
  async function moveCursor(el) {
    const rect = el.getBoundingClientRect();
    const targetX = rect.left + rect.width / 2 - 12;
    const targetY = rect.top + rect.height / 2 - 12;

    // Show cursor
    cursor.classList.add('visible');

    // Animate to target
    await animateCursor(targetX, targetY, CURSOR_SPEED);

    // Highlight element
    el.classList.add('cp-highlight');
    await sleep(200);
  }

  function hideCursor() {
    cursor.classList.remove('visible');
    // Remove all highlights
    document.querySelectorAll('.cp-highlight').forEach(el => {
      el.classList.remove('cp-highlight');
    });
  }

  // Type text character by character
  async function typeText(el, text) {
    el.focus();
    el.value = '';

    for (let i = 0; i < text.length; i++) {
      el.value += text[i];
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(TYPE_SPEED);
    }
  }

  // Execute a single step
  async function executeStep(step) {
    // Navigate
    if (step.type === 'navigate') {
      const tab = document.querySelector(`[data-page="${step.target}"]`);
      if (!tab) return { success: false, reason: 'Page not found' };

      await moveCursor(tab);
      await showClick(cursorX + 12, cursorY + 12);
      tab.click();
      await sleep(STEP_PAUSE);
      hideCursor();
      return { success: true };
    }

    // Find element
    const el = document.querySelector(step.target);
    if (!el) return { success: false, reason: 'Element not found' };

    await moveCursor(el);

    // Toggle
    if (step.type === 'toggle') {
      const want = step.value === true || step.value === 'true';
      await showClick(cursorX + 12, cursorY + 12);
      if (el.checked !== want) el.click();
      await sleep(STEP_PAUSE);
      hideCursor();
      return { success: el.checked === want };
    }

    // Type
    if (step.type === 'type') {
      await showClick(cursorX + 12, cursorY + 12);
      await typeText(el, step.value || '');
      await sleep(STEP_PAUSE);
      hideCursor();
      return { success: true };
    }

    // Click
    if (step.type === 'click') {
      await showClick(cursorX + 12, cursorY + 12);
      el.click();
      await sleep(STEP_PAUSE);
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
    return JSON.stringify(step);
  }

  // Main function
  async function run(goal) {
    logEl.innerHTML = '';
    log(goal, 'cp-user');
    log('🧠 Creating plan...', 'cp-plan');

    // Get plan from API
    let plan;
    try {
      const resp = await fetch(API_URL + '/api/plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY
        },
        body: JSON.stringify({
          goal,
          currentPage: getCurrentPage(),
          configName: CONFIG_NAME
        })
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      plan = data.plan;
    } catch (e) {
      log('Error: ' + e.message, 'cp-error');
      return;
    }

    if (!plan?.length) {
      log('Could not create a plan for this request', 'cp-error');
      return;
    }

    // Show plan
    let planHtml = '<b>Plan:</b><br>';
    plan.forEach((step, i) => {
      planHtml += `${i+1}. ${describeStep(step)}<br>`;
    });
    log(planHtml, 'cp-plan');

    await sleep(600);

    // Execute steps
    for (let i = 0; i < plan.length; i++) {
      const step = plan[i];
      const stepDiv = log(`▶ Step ${i+1}: ${describeStep(step)}`, 'cp-step');

      await sleep(300);
      const result = await executeStep(step);

      if (result.success) {
        stepDiv.className = 'cp-msg cp-step done';
        stepDiv.innerHTML = `✓ Step ${i+1}: ${describeStep(step)}`;
      } else {
        stepDiv.className = 'cp-msg cp-step fail';
        stepDiv.innerHTML = `✗ Step ${i+1}: ${describeStep(step)} (${result.reason || 'failed'})`;
      }

      await sleep(400);
    }

    log('✅ Done!', 'cp-done');
  }

  // Send handler
  async function send() {
    const goal = input.value.trim();
    if (!goal) return;

    input.value = '';
    input.disabled = true;
    sendBtn.disabled = true;

    await run(goal);

    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }

  sendBtn.onclick = send;
  input.onkeydown = e => { if (e.key === 'Enter') send(); };

  // Ready
  log('👋 Hi! Tell me what you\'d like to do.', 'cp-done');
})();
