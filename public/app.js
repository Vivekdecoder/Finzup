// ---------- कॉन्फ़िगरेशन ----------
const API_BASE = '/api'; // Worker URL (प्रॉडक्शन में पूरा URL)
const WS_BASE = 'wss://your-worker-subdomain.workers.dev'; // अपना वर्कर डोमेन
const CLOUDINARY_CLOUD_NAME = 'den3qwwjn'; // बदलें
const CLOUDINARY_UPLOAD_PRESET = 'messenger_preset'; // बदलें

// ---------- स्टेट ----------
let myKey = localStorage.getItem('accessKey');
let currentPeerKey = null;
let socket = null;

// ---------- रूटर ----------
const routes = {
  '#welcome': renderWelcome,
  '#chats': renderChatList,
  '#search': renderSearch,
  '#chat': renderChat
};

function navigate(hash) {
  location.hash = hash;
}
window.addEventListener('hashchange', () => {
  const hash = location.hash || '#welcome';
  const render = routes[hash] || renderWelcome;
  document.getElementById('app').innerHTML = render();
  if (hash === '#chat') loadChat();
  if (hash === '#chats') loadChatList();
});

// ---------- व्यू रेंडरर्स ----------
function renderWelcome() {
  return `
    <h2>स्वागत है</h2>
    <p>आपकी गुप्त पहचान तैयार हो रही है...</p>
    <p id="keyDisplay"></p>
    <button id="copyKeyBtn">की कॉपी करें</button>
    <button id="gotoChatsBtn">चैट शुरू करें →</button>
  `;
}

function renderChatList() {
  return `
    <h2>आपकी चैट</h2>
    <button id="searchBtn">➕ नई चैट (की खोजें)</button>
    <div id="chatListContainer"></div>
  `;
}

function renderSearch() {
  return `
    <h2>की द्वारा खोजें</h2>
    <input id="searchInput" placeholder="पूरी एक्सेस की डालें">
    <button id="doSearch">खोजें</button>
    <div id="searchResult"></div>
  `;
}

function renderChat() {
  const peerName = localStorage.getItem(`peerName_${currentPeerKey}`) || 'अनाम';
  return `
    <h2>${peerName} के साथ चैट</h2>
    <div id="messages" style="height: 60vh; overflow-y: auto;"></div>
    <input id="msgInput" placeholder="संदेश लिखें...">
    <button id="sendMsg">भेजें</button>
    <button id="uploadBtn">📎 मीडिया भेजें</button>
  `;
}

// ---------- इनिशियलाइज़ेशन ----------
async function init() {
  if (!myKey) {
    // नई एक्सेस की बनाएँ
    myKey = crypto.randomUUID() + '-' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('accessKey', myKey);
    await fetch(`${API_BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessKey: myKey })
    });
  }
  location.hash = location.hash || '#chats';
  window.dispatchEvent(new Event('hashchange'));
}

// ---------- विभिन्न व्यू की लॉजिक ----------
function attachWelcomeEvents() {
  document.getElementById('copyKeyBtn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(myKey);
    alert('की कॉपी हो गई! इसे दोस्त को भेजें।');
  });
  document.getElementById('gotoChatsBtn')?.addEventListener('click', () => navigate('#chats'));
}

function attachChatListEvents() {
  document.getElementById('searchBtn')?.addEventListener('click', () => navigate('#search'));
  loadChatList();
}

async function loadChatList() {
  const res = await fetch(`${API_BASE}/chats?myKey=${myKey}`);
  const peers = await res.json();
  const container = document.getElementById('chatListContainer');
  if (!container) return;
  container.innerHTML = peers.map(peerKey => {
    const name = localStorage.getItem(`peerName_${peerKey}`) || 'अनाम';
    return `<div class="chat-list-item" data-key="${peerKey}">${name}</div>`;
  }).join('');
  document.querySelectorAll('.chat-list-item').forEach(item => {
    item.addEventListener('click', () => {
      currentPeerKey = item.dataset.key;
      navigate('#chat');
    });
  });
}

function attachSearchEvents() {
  document.getElementById('doSearch')?.addEventListener('click', async () => {
    const key = document.getElementById('searchInput').value.trim();
    if (!key) return;
    const res = await fetch(`${API_BASE}/user?key=${encodeURIComponent(key)}`);
    if (res.ok) {
      const user = await res.json();
      document.getElementById('searchResult').innerHTML = `
        <p>नाम: ${user.name || 'अनाम'}</p>
        <button id="startChat" data-key="${key}">चैट शुरू करें</button>
      `;
      document.getElementById('startChat').addEventListener('click', async () => {
        // चैट सेशन बनाएँ (KV में जोड़ें)
        await fetch(`${API_BASE}/start-chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ myKey, peerKey: key })
        });
        currentPeerKey = key;
        localStorage.setItem(`peerName_${key}`, user.name || 'अनाम');
        navigate('#chat');
      });
    } else {
      document.getElementById('searchResult').innerHTML = '<p>की नहीं मिली</p>';
    }
  });
}

// ---------- चैट (WebSocket) ----------
function loadChat() {
  if (!currentPeerKey) return;
  // Durable Object चैटरूम ID (दोनों की को सॉर्ट करके)
  const roomId = [myKey, currentPeerKey].sort().join('_');
  // WebSocket कनेक्ट
  if (socket) socket.close();
  socket = new WebSocket(`${WS_BASE}/ws?room=${roomId}&user=${myKey}`);

  const messagesDiv = document.getElementById('messages');
  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    const el = document.createElement('div');
    el.className = 'message';
    if (msg.type === 'image') {
      el.innerHTML = `<img src="${msg.url}" style="max-width:100%">`;
    } else if (msg.type === 'video') {
      el.innerHTML = `<video src="${msg.url}" controls style="max-width:100%"></video>`;
    } else {
      el.textContent = msg.text;
    }
    messagesDiv.appendChild(el);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  };

  document.getElementById('sendMsg')?.addEventListener('click', () => {
    const input = document.getElementById('msgInput');
    if (!input.value.trim()) return;
    socket.send(JSON.stringify({ type: 'text', text: input.value }));
    input.value = '';
  });

  document.getElementById('uploadBtn')?.addEventListener('click', openUploadWidget);
}

// ---------- Cloudinary विजेट ----------
function openUploadWidget() {
  cloudinary.openUploadWidget({
    cloudName: CLOUDINARY_CLOUD_NAME,
    uploadPreset: CLOUDINARY_UPLOAD_PRESET,
    sources: ['local', 'url', 'camera']
  }, (error, result) => {
    if (!error && result.event === 'success') {
      const mediaUrl = result.info.secure_url;
      const isVideo = result.info.resource_type === 'video';
      socket.send(JSON.stringify({ type: isVideo ? 'video' : 'image', url: mediaUrl }));
    }
  });
}

// ---------- इवेंट अटैचमेंट (hashchange पर कॉल) ----------
const originalDispatch = window.dispatchEvent.bind(window);
window.addEventListener('hashchange', () => {
  const hash = location.hash;
  if (hash === '#welcome') setTimeout(attachWelcomeEvents, 0);
  else if (hash === '#chats') setTimeout(attachChatListEvents, 0);
  else if (hash === '#search') setTimeout(attachSearchEvents, 0);
  else if (hash === '#chat') loadChat();
});

// स्टार्ट
init();