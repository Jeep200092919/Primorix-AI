/* ============================================================
   Primorix AI — API Client
   ============================================================ */

const API = {
  _token: null,

  setToken(token) {
    this._token = token;
  },

  _headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this._token) h['Authorization'] = `Bearer ${this._token}`;
    return h;
  },

  async _request(method, path, body) {
    const opts = { method, headers: this._headers() };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },

  // Auth
  register(username, email, password) {
    return this._request('POST', '/api/auth/register', { username, email, password });
  },
  login(username, password) {
    return this._request('POST', '/api/auth/login', { username, password });
  },
  guest(sessionId) {
    return this._request('POST', '/api/auth/guest', { sessionId });
  },
  me() {
    return this._request('GET', '/api/auth/me');
  },

  // Conversations
  getConversations() {
    return this._request('GET', '/api/conversations');
  },
  getConversation(id) {
    return this._request('GET', `/api/conversations/${id}`);
  },
  deleteConversation(id) {
    return this._request('DELETE', `/api/conversations/${id}`);
  },

  // Chat
  sendMessage(message, conversationId, mode = 'chat', file = null) {
    if (file) {
      const form = new FormData();
      form.append('message', message || '');
      if (conversationId) form.append('conversationId', String(conversationId));
      form.append('mode', mode);
      form.append('file', file);
      const headers = {};
      if (this._token) headers['Authorization'] = `Bearer ${this._token}`;
      return fetch('/api/chat/send', { method: 'POST', headers, body: form })
        .then(res => res.json().then(d => { if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`); return d; }));
    }
    return this._request('POST', '/api/chat/send', { message, conversationId, mode });
  },
  getMemory() {
    return this._request('GET', '/api/chat/memory');
  },
  deleteMemory(key) {
    return this._request('DELETE', `/api/chat/memory/${encodeURIComponent(key)}`);
  },
  getModels() {
    return this._request('GET', '/api/chat/models');
  },
};
