/* ============================================================
   Primorix AI — Main Application
   ============================================================ */

const App = {
  user: null,
  currentConvId: null,
  conversations: [],
  isSending: false,

  // ── Storage ───────────────────────────────────────────────

  storage: {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
    remove(k) { localStorage.removeItem(k); },
  },

  // ── Init ──────────────────────────────────────────────────

  async init() {
    this.bindAuthUI();
    this.bindAppUI();
    this.setupMarked();

    // Try to restore session
    const saved = this.storage.get('primorix_session');
    if (saved?.token) {
      API.setToken(saved.token);
      try {
        const user = await API.me();
        this.onLogin({ ...user, token: saved.token });
        return;
      } catch {
        this.storage.remove('primorix_session');
      }
    }

    this.showAuth();
  },

  setupMarked() {
    if (typeof marked !== 'undefined') {
      marked.setOptions({
        breaks: true,
        gfm: true,
        highlight(code, lang) {
          if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value;
          }
          return typeof hljs !== 'undefined' ? hljs.highlightAuto(code).value : code;
        },
      });
    }
  },

  // ── Auth Screen ───────────────────────────────────────────

  showAuth() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app-screen').classList.add('hidden');
  },

  showApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');
  },

  bindAuthUI() {
    // Tabs
    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`${tab.dataset.tab}-form`).classList.add('active');
        document.getElementById('login-error').classList.remove('visible');
        document.getElementById('register-error').classList.remove('visible');
      });
    });

    // Password toggles
    document.querySelectorAll('.toggle-pwd').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        input.type = input.type === 'password' ? 'text' : 'password';
      });
    });

    // Login form
    document.getElementById('login-form').addEventListener('submit', async e => {
      e.preventDefault();
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      const errEl = document.getElementById('login-error');
      errEl.classList.remove('visible');

      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.textContent = 'Signing in...';

      try {
        const data = await API.login(username, password);
        API.setToken(data.token);
        this.storage.set('primorix_session', { token: data.token });
        this.onLogin({ ...data.user, token: data.token });
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.add('visible');
        btn.disabled = false;
        btn.textContent = 'Sign In';
      }
    });

    // Register form
    document.getElementById('register-form').addEventListener('submit', async e => {
      e.preventDefault();
      const username = document.getElementById('reg-username').value.trim();
      const email = document.getElementById('reg-email').value.trim();
      const password = document.getElementById('reg-password').value;
      const errEl = document.getElementById('register-error');
      errEl.classList.remove('visible');

      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.textContent = 'Creating account...';

      try {
        const data = await API.register(username, email, password);
        API.setToken(data.token);
        this.storage.set('primorix_session', { token: data.token });
        this.onLogin({ ...data.user, token: data.token });
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.add('visible');
        btn.disabled = false;
        btn.textContent = 'Create Account';
      }
    });

    // Guest mode
    document.getElementById('guest-btn').addEventListener('click', async () => {
      const btn = document.getElementById('guest-btn');
      btn.disabled = true;
      btn.textContent = 'Starting guest session...';

      let sessionId = this.storage.get('primorix_guest_id');
      if (!sessionId) {
        sessionId = crypto.randomUUID();
        this.storage.set('primorix_guest_id', sessionId);
      }

      try {
        const data = await API.guest(sessionId);
        API.setToken(data.token);
        this.storage.set('primorix_session', { token: data.token, isGuest: true });
        this.onLogin({ ...data.user, token: data.token });
      } catch (err) {
        alert('Could not start guest session: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Continue as Guest';
      }
    });
  },

  // ── After Login ───────────────────────────────────────────

  async onLogin(user) {
    this.user = user;
    this.updateUserUI(user);
    this.showApp();
    await this.loadConversations();
    this.showWelcome();
    this.updateMemoryIndicator();
  },

  updateUserUI(user) {
    const name = user.username || user.name || 'User';
    document.getElementById('user-name').textContent = name;
    document.getElementById('user-avatar').textContent = name.charAt(0).toUpperCase();
    document.getElementById('user-type').textContent = user.isGuest ? 'Guest session' : 'Account';
  },

  updateMemoryIndicator() {
    const indicator = document.getElementById('memory-indicator');
    if (this.user && !this.user.isGuest) {
      indicator.classList.remove('hidden');
    } else {
      indicator.classList.add('hidden');
    }
  },

  // ── App UI Bindings ───────────────────────────────────────

  bindAppUI() {
    // New chat
    document.getElementById('new-chat-btn').addEventListener('click', () => {
      this.currentConvId = null;
      this.showWelcome();
      this.highlightConv(null);
      this.closeSidebarMobile();
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', () => {
      this.logout();
    });

    // Sidebar toggle (open)
    document.getElementById('sidebar-toggle-open').addEventListener('click', () => {
      this.openSidebar();
    });

    // Sidebar toggle (close)
    document.getElementById('sidebar-toggle-close').addEventListener('click', () => {
      this.closeSidebarMobile();
    });

    // Overlay
    document.getElementById('sidebar-overlay').addEventListener('click', () => {
      this.closeSidebarMobile();
    });

    // Memory button
    document.getElementById('memory-btn').addEventListener('click', () => {
      this.openMemoryModal();
    });

    // Close memory modal
    document.getElementById('close-memory-modal').addEventListener('click', () => {
      document.getElementById('memory-modal').classList.add('hidden');
    });
    document.getElementById('memory-modal').addEventListener('click', e => {
      if (e.target === e.currentTarget) {
        e.currentTarget.classList.add('hidden');
      }
    });

    // Message input
    const input = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');

    input.addEventListener('input', () => {
      // Auto-resize
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 200) + 'px';
      sendBtn.disabled = !input.value.trim() || this.isSending;
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn.disabled) this.sendMessage();
      }
    });

    sendBtn.addEventListener('click', () => {
      if (!sendBtn.disabled) this.sendMessage();
    });

    // Suggestion chips
    document.addEventListener('click', e => {
      if (e.target.classList.contains('suggestion-chip')) {
        const prompt = e.target.dataset.prompt;
        if (prompt) {
          input.value = prompt;
          input.dispatchEvent(new Event('input'));
          this.sendMessage();
        }
      }
    });
  },

  openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.add('visible');
    document.getElementById('sidebar-overlay').classList.remove('hidden');
  },

  closeSidebarMobile() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('visible');
    document.getElementById('sidebar-overlay').classList.add('hidden');
  },

  logout() {
    this.storage.remove('primorix_session');
    // Keep guest id so guest sessions are persistent within the browser
    this.user = null;
    this.currentConvId = null;
    this.conversations = [];
    API.setToken(null);
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('reg-username').value = '';
    document.getElementById('reg-email').value = '';
    document.getElementById('reg-password').value = '';
    this.showAuth();
  },

  // ── Welcome Screen ────────────────────────────────────────

  showWelcome() {
    const welcome = document.getElementById('welcome-screen');
    const messages = document.getElementById('messages-container');
    welcome.classList.remove('hidden');
    messages.classList.add('hidden');
    messages.innerHTML = '';

    // Personalized welcome message
    if (this.user && !this.user.isGuest) {
      document.getElementById('welcome-message').textContent =
        `Welcome back, ${this.user.username}! How can I help you today?`;
    } else if (this.user?.isGuest) {
      document.getElementById('welcome-message').textContent =
        `Hello, Guest! How can I help you today?`;
    }
  },

  // ── Conversations ─────────────────────────────────────────

  async loadConversations() {
    try {
      this.conversations = await API.getConversations();
      this.renderConversationList();
    } catch {
      // Non-critical
    }
  },

  renderConversationList() {
    const list = document.getElementById('conversations-list');
    if (!this.conversations.length) {
      list.innerHTML = '<div class="conversations-empty">No conversations yet.<br/>Start a new chat!</div>';
      return;
    }

    list.innerHTML = this.conversations.map(c => `
      <div class="conv-item ${c.id === this.currentConvId ? 'active' : ''}" data-id="${c.id}">
        <div class="conv-item-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <div class="conv-item-text">
          <div class="conv-item-title">${this.escHtml(c.title)}</div>
          <div class="conv-item-date">${this.relativeTime(c.updated_at)}</div>
        </div>
        <button class="conv-item-del" data-conv-del="${c.id}" title="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>
    `).join('');

    // Bind click events
    list.querySelectorAll('.conv-item').forEach(item => {
      item.addEventListener('click', e => {
        if (e.target.closest('[data-conv-del]')) return;
        this.loadConversation(parseInt(item.dataset.id));
        this.closeSidebarMobile();
      });
    });

    list.querySelectorAll('[data-conv-del]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        this.deleteConversation(parseInt(btn.dataset.convDel));
      });
    });
  },

  highlightConv(id) {
    document.querySelectorAll('.conv-item').forEach(item => {
      item.classList.toggle('active', parseInt(item.dataset.id) === id);
    });
  },

  async loadConversation(id) {
    try {
      const conv = await API.getConversation(id);
      this.currentConvId = id;
      this.highlightConv(id);

      const welcome = document.getElementById('welcome-screen');
      const messages = document.getElementById('messages-container');
      welcome.classList.add('hidden');
      messages.classList.remove('hidden');
      messages.innerHTML = '';

      conv.messages.forEach(msg => {
        this.appendMessage(msg.role === 'user' ? 'user' : 'ai', msg.content, false);
      });

      this.scrollToBottom(false);
    } catch (err) {
      console.error('Failed to load conversation:', err);
    }
  },

  async deleteConversation(id) {
    try {
      await API.deleteConversation(id);
      this.conversations = this.conversations.filter(c => c.id !== id);
      if (this.currentConvId === id) {
        this.currentConvId = null;
        this.showWelcome();
      }
      this.renderConversationList();
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  },

  // ── Sending Messages ──────────────────────────────────────

  async sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text || this.isSending) return;

    // Show chat view
    document.getElementById('welcome-screen').classList.add('hidden');
    const messages = document.getElementById('messages-container');
    messages.classList.remove('hidden');

    // Clear input
    input.value = '';
    input.style.height = 'auto';
    document.getElementById('send-btn').disabled = true;

    // Add user message to UI
    this.appendMessage('user', text);

    // Add typing indicator
    const typingId = 'typing-' + Date.now();
    const typingEl = document.createElement('div');
    typingEl.id = typingId;
    typingEl.className = 'message ai';
    typingEl.innerHTML = `
      <div class="message-header">
        <div class="message-avatar">P</div>
        <span class="message-sender">Primorix AI</span>
      </div>
      <div class="message-content">
        <div class="typing-indicator">
          <span></span><span></span><span></span>
        </div>
      </div>
    `;
    messages.appendChild(typingEl);
    this.scrollToBottom();

    this.isSending = true;

    try {
      const data = await API.sendMessage(text, this.currentConvId);

      // Remove typing indicator
      typingEl.remove();

      // Update current conversation ID
      if (!this.currentConvId) {
        this.currentConvId = data.conversationId;
        // Reload conversation list to get the new one with title
        setTimeout(() => this.loadConversations(), 1500);
      } else if (data.isNewConversation) {
        setTimeout(() => this.loadConversations(), 1500);
      }

      // Add AI response
      this.appendMessage('ai', data.message.content);
      this.highlightConv(this.currentConvId);

    } catch (err) {
      typingEl.remove();
      this.appendMessage('ai', `I'm sorry, I encountered an error: ${err.message}. Please try again.`);
      console.error('Send error:', err);
    } finally {
      this.isSending = false;
      document.getElementById('send-btn').disabled = !input.value.trim();
      input.focus();
    }
  },

  // ── Message Rendering ─────────────────────────────────────

  appendMessage(role, content, animate = true) {
    const messages = document.getElementById('messages-container');
    const el = document.createElement('div');
    el.className = `message ${role}`;
    if (!animate) el.style.animation = 'none';

    const userName = role === 'user'
      ? (this.user?.username || 'You')
      : 'Primorix AI';

    const avatarText = role === 'user'
      ? (this.user?.username?.charAt(0).toUpperCase() || 'U')
      : 'P';

    const renderedContent = role === 'ai'
      ? this.renderMarkdown(content)
      : `<p>${this.escHtml(content).replace(/\n/g, '<br/>')}</p>`;

    el.innerHTML = `
      <div class="message-header">
        <div class="message-avatar">${avatarText}</div>
        <span class="message-sender">${this.escHtml(userName)}</span>
      </div>
      <div class="message-content">${renderedContent}</div>
    `;

    // Add copy buttons to code blocks
    if (role === 'ai') {
      el.querySelectorAll('pre').forEach(pre => {
        const wrap = document.createElement('div');
        wrap.className = 'code-block-wrap';
        pre.parentNode.insertBefore(wrap, pre);
        wrap.appendChild(pre);

        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-code-btn';
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', () => {
          const code = pre.querySelector('code');
          navigator.clipboard.writeText(code?.textContent || pre.textContent).then(() => {
            copyBtn.textContent = 'Copied!';
            setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
          });
        });
        wrap.appendChild(copyBtn);
      });

      // Syntax highlight
      if (typeof hljs !== 'undefined') {
        el.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
      }
    }

    messages.appendChild(el);
    this.scrollToBottom();
  },

  renderMarkdown(text) {
    if (typeof marked !== 'undefined') {
      try {
        return marked.parse(text);
      } catch {}
    }
    // Fallback: escape and add line breaks
    return `<p>${this.escHtml(text).replace(/\n/g, '<br/>')}</p>`;
  },

  scrollToBottom(smooth = true) {
    const area = document.getElementById('chat-area');
    setTimeout(() => {
      area.scrollTo({ top: area.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
    }, 30);
  },

  // ── Memory Modal ──────────────────────────────────────────

  async openMemoryModal() {
    document.getElementById('memory-modal').classList.remove('hidden');
    const list = document.getElementById('memory-list');
    list.innerHTML = '<div class="memory-empty">Loading...</div>';

    try {
      const data = await API.getMemory();

      if (data.isGuest) {
        list.innerHTML = `
          <div class="guest-memory-banner">
            <p>Memory is only available for registered users. Create a free account to let Primorix AI truly remember you across all conversations.</p>
            <button onclick="document.getElementById('memory-modal').classList.add('hidden'); App.logout()">
              Create Account
            </button>
          </div>
        `;
        return;
      }

      if (!data.facts || data.facts.length === 0) {
        list.innerHTML = '<div class="memory-empty">No memories yet. Start chatting and I\'ll remember important things about you!</div>';
        return;
      }

      list.innerHTML = data.facts.map(f => `
        <div class="memory-item" data-key="${this.escHtml(f.memory_key)}">
          <div class="memory-item-content">
            <div class="memory-key">${this.escHtml(f.memory_key)}</div>
            <div class="memory-value">${this.escHtml(f.memory_value)}</div>
          </div>
          <button class="memory-del" data-key="${this.escHtml(f.memory_key)}" title="Forget this">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      `).join('');

      list.querySelectorAll('.memory-del').forEach(btn => {
        btn.addEventListener('click', async () => {
          const key = btn.dataset.key;
          try {
            await API.deleteMemory(key);
            btn.closest('.memory-item').remove();
            if (!list.querySelector('.memory-item')) {
              list.innerHTML = '<div class="memory-empty">No memories yet.</div>';
            }
          } catch {}
        });
      });

    } catch (err) {
      list.innerHTML = `<div class="memory-empty">Failed to load memory: ${err.message}</div>`;
    }
  },

  // ── Utilities ─────────────────────────────────────────────

  escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  relativeTime(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  },
};

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());
