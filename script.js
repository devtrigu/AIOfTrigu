// =========================================================
// TriguAI — Chat client for Gemini API
// Semua data (API key & percakapan) disimpan di localStorage.
// =========================================================

const STORAGE_KEYS = {
  apiKey: 'triguai_api_key',
  conversations: 'triguai_conversations',
  activeId: 'triguai_active_id',
  model: 'triguai_model',
};

const MODEL_LABELS = {
  'gemini-3.5-flash': 'Gemini 3.5 Flash',
  'gemini-3.1-pro': 'Gemini 3.1 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-2.5-flash-lite': 'Gemini 2.5 Lite',
};

// ---------------------------------------------------------
// State
// ---------------------------------------------------------
let conversations = [];   // [{ id, title, model, messages:[{role, text}], updatedAt }]
let activeId = null;
let currentModel = 'gemini-3.1-pro';
let isSending = false;

// ---------------------------------------------------------
// DOM refs
// ---------------------------------------------------------
const $ = (id) => document.getElementById(id);

const appEl = $('app');
const sidebarOpenBtn = $('sidebarOpenBtn');
const collapseBtn = $('collapseBtn');
const newChatBtn = $('newChatBtn');
const searchInput = $('searchInput');
const convListEl = $('convList');
const convTitleEl = $('convTitle');

const modelSelect = $('modelSelect');
const modelSelectBtn = $('modelSelectBtn');
const modelSelectLabel = $('modelSelectLabel');
const modelDropdown = $('modelDropdown');

const chatScroll = $('chatScroll');
const chatInner = $('chatInner');
const emptyState = $('emptyState');

const composerForm = $('composerForm');
const promptInput = $('promptInput');
const sendBtn = $('sendBtn');

const apiModalOverlay = $('apiModalOverlay');
const apiKeyInput = $('apiKeyInput');
const apiKeyError = $('apiKeyError');
const apiKeySaveBtn = $('apiKeySaveBtn');

const settingsBtn = $('settingsBtn');
const settingsModalOverlay = $('settingsModalOverlay');
const settingsCloseBtn = $('settingsCloseBtn');
const settingsApiKeyInput = $('settingsApiKeyInput');
const settingsApiKeyError = $('settingsApiKeyError');
const settingsSaveBtn = $('settingsSaveBtn');
const clearAllBtn = $('clearAllBtn');

// ---------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------
function getApiKey(){
  return localStorage.getItem(STORAGE_KEYS.apiKey) || '';
}
function setApiKey(key){
  localStorage.setItem(STORAGE_KEYS.apiKey, key);
}
function loadConversations(){
  try{
    const raw = localStorage.getItem(STORAGE_KEYS.conversations);
    conversations = raw ? JSON.parse(raw) : [];
  }catch(e){
    conversations = [];
  }
}
function saveConversations(){
  localStorage.setItem(STORAGE_KEYS.conversations, JSON.stringify(conversations));
}
function loadActiveId(){
  activeId = localStorage.getItem(STORAGE_KEYS.activeId) || null;
}
function setActiveId(id){
  activeId = id;
  if(id){ localStorage.setItem(STORAGE_KEYS.activeId, id); }
  else{ localStorage.removeItem(STORAGE_KEYS.activeId); }
}
function loadModel(){
  currentModel = localStorage.getItem(STORAGE_KEYS.model) || 'gemini-3.1-pro';
}
function setModel(model){
  currentModel = model;
  localStorage.setItem(STORAGE_KEYS.model, model);
}

// ---------------------------------------------------------
// Utilities
// ---------------------------------------------------------
function uid(){
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function escapeHtml(str){
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Sangat ringan: render paragraf & blok kode ``` tanpa dependensi luar
function renderContent(text){
  const escaped = escapeHtml(text);
  const withCode = escaped.replace(/```([\s\S]*?)```/g, (_, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });
  const paragraphs = withCode.split(/\n{2,}/).map(p => {
    if(p.startsWith('<pre>')) return p;
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  });
  return paragraphs.join('');
}

function getConversation(id){
  return conversations.find(c => c.id === id) || null;
}

function sortedConversations(){
  return [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
}

// ---------------------------------------------------------
// Rendering: sidebar conversation list
// ---------------------------------------------------------
function renderConvList(filterText){
  const query = (filterText || '').trim().toLowerCase();
  const list = sortedConversations().filter(c =>
    !query || c.title.toLowerCase().includes(query)
  );

  convListEl.innerHTML = '';

  if(list.length === 0){
    const empty = document.createElement('div');
    empty.className = 'conv-empty';
    empty.textContent = query ? 'Tidak ada percakapan yang cocok.' : 'Belum ada percakapan.';
    convListEl.appendChild(empty);
    return;
  }

  for(const conv of list){
    const item = document.createElement('div');
    item.className = 'conv-item' + (conv.id === activeId ? ' active' : '');
    item.dataset.id = conv.id;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'conv-item-title';
    titleSpan.textContent = conv.title;

    const delBtn = document.createElement('button');
    delBtn.className = 'conv-item-del';
    delBtn.setAttribute('aria-label', 'Hapus percakapan');
    delBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2m2 0v13a2 2 0 01-2 2H8a2 2 0 01-2-2V7h12z"/></svg>`;
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteConversation(conv.id);
    });

    item.appendChild(titleSpan);
    item.appendChild(delBtn);
    item.addEventListener('click', () => selectConversation(conv.id));
    convListEl.appendChild(item);
  }
}

// ---------------------------------------------------------
// Rendering: chat messages
// ---------------------------------------------------------
function renderMessages(){
  const conv = getConversation(activeId);
  chatInner.querySelectorAll('.msg').forEach(el => el.remove());

  if(!conv || conv.messages.length === 0){
    emptyState.style.display = 'flex';
    return;
  }
  emptyState.style.display = 'none';

  for(const msg of conv.messages){
    chatInner.appendChild(buildMessageEl(msg));
  }
  scrollToBottom();
}

function buildMessageEl(msg){
  const wrap = document.createElement('div');
  wrap.className = `msg ${msg.role}${msg.error ? ' error' : ''}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.innerHTML = msg.role === 'user'
    ? `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`
    : `<svg viewBox="0 0 40 40" width="15" height="15" fill="none"><path d="M20 4 L20 36" stroke="#151022" stroke-width="2.6" stroke-linecap="round"/><path d="M20 9 C14 9 10.5 12.6 10.5 18 C10.5 12.6 14 9 20 9 C26 9 29.5 12.6 29.5 18 C29.5 12.6 26 9 20 9 Z" fill="#151022"/></svg>`;

  const body = document.createElement('div');
  body.className = 'msg-body';

  const role = document.createElement('div');
  role.className = 'msg-role';
  role.textContent = msg.role === 'user' ? 'Anda' : 'TriguAI';

  const content = document.createElement('div');
  content.className = 'msg-content';
  content.innerHTML = renderContent(msg.text);

  body.appendChild(role);
  body.appendChild(content);
  wrap.appendChild(avatar);
  wrap.appendChild(body);
  return wrap;
}

function scrollToBottom(){
  requestAnimationFrame(() => {
    chatScroll.scrollTop = chatScroll.scrollHeight;
  });
}

// ---------------------------------------------------------
// Conversation actions
// ---------------------------------------------------------
function createConversation(){
  const conv = {
    id: uid(),
    title: 'Percakapan baru',
    model: currentModel,
    messages: [],
    updatedAt: Date.now(),
  };
  conversations.push(conv);
  saveConversations();
  setActiveId(conv.id);
  renderConvList(searchInput.value);
  renderMessages();
  updateTopbar();
  closeSidebarOnMobile();
}

function selectConversation(id){
  setActiveId(id);
  const conv = getConversation(id);
  if(conv){ setModel(conv.model || currentModel); syncModelUI(); }
  renderConvList(searchInput.value);
  renderMessages();
  updateTopbar();
  closeSidebarOnMobile();
}

function deleteConversation(id){
  conversations = conversations.filter(c => c.id !== id);
  saveConversations();
  if(activeId === id){
    setActiveId(null);
  }
  renderConvList(searchInput.value);
  renderMessages();
  updateTopbar();
}

function updateTopbar(){
  const conv = getConversation(activeId);
  convTitleEl.textContent = conv ? conv.title : 'Percakapan baru';
}

function closeSidebarOnMobile(){
  if(window.innerWidth <= 860){
    appEl.classList.add('sidebar-collapsed');
  }
}

// ---------------------------------------------------------
// Model dropdown
// ---------------------------------------------------------
function syncModelUI(){
  modelSelectLabel.textContent = MODEL_LABELS[currentModel] || currentModel;
  modelDropdown.querySelectorAll('li').forEach(li => {
    li.setAttribute('aria-selected', li.dataset.model === currentModel ? 'true' : 'false');
  });
}

function openModelDropdown(){
  modelDropdown.hidden = false;
  modelSelect.classList.add('open');
  modelSelectBtn.setAttribute('aria-expanded', 'true');
}
function closeModelDropdown(){
  modelDropdown.hidden = true;
  modelSelect.classList.remove('open');
  modelSelectBtn.setAttribute('aria-expanded', 'false');
}

modelSelectBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if(modelDropdown.hidden){ openModelDropdown(); } else { closeModelDropdown(); }
});

modelDropdown.addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if(!li) return;
  const model = li.dataset.model;
  setModel(model);
  syncModelUI();
  const conv = getConversation(activeId);
  if(conv){ conv.model = model; saveConversations(); }
  closeModelDropdown();
});

document.addEventListener('click', (e) => {
  if(!modelSelect.contains(e.target)){ closeModelDropdown(); }
});

// ---------------------------------------------------------
// Sidebar toggle
// ---------------------------------------------------------
collapseBtn.addEventListener('click', () => appEl.classList.add('sidebar-collapsed'));
sidebarOpenBtn.addEventListener('click', () => appEl.classList.remove('sidebar-collapsed'));

// ---------------------------------------------------------
// Search
// ---------------------------------------------------------
searchInput.addEventListener('input', () => {
  renderConvList(searchInput.value);
});

// ---------------------------------------------------------
// New chat
// ---------------------------------------------------------
newChatBtn.addEventListener('click', createConversation);

// ---------------------------------------------------------
// Composer: auto-resize + enable/disable send button
// ---------------------------------------------------------
promptInput.addEventListener('input', () => {
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 180) + 'px';
  sendBtn.disabled = promptInput.value.trim().length === 0 || isSending;
});

promptInput.addEventListener('keydown', (e) => {
  if(e.key === 'Enter' && !e.shiftKey){
    e.preventDefault();
    composerForm.requestSubmit();
  }
});

composerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = promptInput.value.trim();
  if(!text || isSending) return;

  if(!getApiKey()){
    showApiModal();
    return;
  }

  let conv = getConversation(activeId);
  if(!conv){
    conv = {
      id: uid(),
      title: 'Percakapan baru',
      model: currentModel,
      messages: [],
      updatedAt: Date.now(),
    };
    conversations.push(conv);
    setActiveId(conv.id);
  }

  conv.messages.push({ role: 'user', text });
  if(conv.title === 'Percakapan baru'){
    conv.title = text.slice(0, 48) + (text.length > 48 ? '…' : '');
  }
  conv.updatedAt = Date.now();
  saveConversations();

  promptInput.value = '';
  promptInput.style.height = 'auto';
  sendBtn.disabled = true;
  isSending = true;

  renderConvList(searchInput.value);
  renderMessages();
  updateTopbar();
  showTypingIndicator();

  try{
    const reply = await callGemini(conv);
    hideTypingIndicator();
    conv.messages.push({ role: 'model', text: reply });
  }catch(err){
    hideTypingIndicator();
    conv.messages.push({ role: 'model', text: err.message || 'Terjadi kesalahan saat menghubungi Gemini API.', error: true });
  }

  conv.updatedAt = Date.now();
  saveConversations();
  renderConvList(searchInput.value);
  renderMessages();
  isSending = false;
  sendBtn.disabled = promptInput.value.trim().length === 0;
});

function showTypingIndicator(){
  const wrap = document.createElement('div');
  wrap.className = 'msg model';
  wrap.id = 'typingIndicator';
  wrap.innerHTML = `
    <div class="msg-avatar"><svg viewBox="0 0 40 40" width="15" height="15" fill="none"><path d="M20 4 L20 36" stroke="#151022" stroke-width="2.6" stroke-linecap="round"/><path d="M20 9 C14 9 10.5 12.6 10.5 18 C10.5 12.6 14 9 20 9 C26 9 29.5 12.6 29.5 18 C29.5 12.6 26 9 20 9 Z" fill="#151022"/></svg></div>
    <div class="msg-body">
      <div class="msg-role">TriguAI</div>
      <div class="typing"><span></span><span></span><span></span></div>
    </div>`;
  chatInner.appendChild(wrap);
  scrollToBottom();
}
function hideTypingIndicator(){
  const el = document.getElementById('typingIndicator');
  if(el) el.remove();
}

// ---------------------------------------------------------
// Gemini API call
// ---------------------------------------------------------
async function callGemini(conv){
  const apiKey = getApiKey();
  const model = conv.model || currentModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const contents = conv.messages
    .filter(m => !m.error)
    .map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.text }],
    }));

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents }),
  });

  if(!res.ok){
    let detail = '';
    try{
      const errJson = await res.json();
      detail = errJson?.error?.message || '';
    }catch(_){}
    if(res.status === 400 || res.status === 403){
      throw new Error('API Key tidak valid atau tidak memiliki akses. Periksa kembali di Pengaturan API. ' + detail);
    }
    if(res.status === 429){
      throw new Error('Batas permintaan tercapai. Coba lagi sebentar lagi.');
    }
    throw new Error(detail || `Permintaan gagal (status ${res.status}).`);
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p.text || '').join('').trim();
  return text || 'Model tidak mengembalikan jawaban. Coba ubah pertanyaan atau model.';
}

// ---------------------------------------------------------
// API key modal
// ---------------------------------------------------------
function showApiModal(){
  apiKeyInput.value = getApiKey();
  apiKeyError.hidden = true;
  apiModalOverlay.classList.add('visible');
  setTimeout(() => apiKeyInput.focus(), 260);
}
function hideApiModal(){
  apiModalOverlay.classList.remove('visible');
}

apiKeySaveBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if(!key){
    apiKeyError.hidden = false;
    apiKeyInput.focus();
    return;
  }
  setApiKey(key);
  hideApiModal();
});

apiKeyInput.addEventListener('keydown', (e) => {
  if(e.key === 'Enter'){ e.preventDefault(); apiKeySaveBtn.click(); }
});

// ---------------------------------------------------------
// Settings modal
// ---------------------------------------------------------
function showSettingsModal(){
  settingsApiKeyInput.value = getApiKey();
  settingsApiKeyError.hidden = true;
  settingsModalOverlay.classList.add('visible');
}
function hideSettingsModal(){
  settingsModalOverlay.classList.remove('visible');
}

settingsBtn.addEventListener('click', showSettingsModal);
settingsCloseBtn.addEventListener('click', hideSettingsModal);
settingsModalOverlay.addEventListener('click', (e) => {
  if(e.target === settingsModalOverlay) hideSettingsModal();
});

settingsSaveBtn.addEventListener('click', () => {
  const key = settingsApiKeyInput.value.trim();
  if(!key){
    settingsApiKeyError.hidden = false;
    settingsApiKeyInput.focus();
    return;
  }
  setApiKey(key);
  hideSettingsModal();
});

clearAllBtn.addEventListener('click', () => {
  if(!confirm('Hapus semua percakapan? Tindakan ini tidak bisa dibatalkan.')) return;
  conversations = [];
  saveConversations();
  setActiveId(null);
  renderConvList(searchInput.value);
  renderMessages();
  updateTopbar();
  hideSettingsModal();
});

// ---------------------------------------------------------
// Init
// ---------------------------------------------------------
function init(){
  loadConversations();
  loadActiveId();
  loadModel();

  if(!getConversation(activeId)){
    activeId = null;
  }

  syncModelUI();
  renderConvList('');
  renderMessages();
  updateTopbar();

  if(window.innerWidth <= 860){
    appEl.classList.add('sidebar-collapsed');
  }

  if(!getApiKey()){
    showApiModal();
  }
}

init();
