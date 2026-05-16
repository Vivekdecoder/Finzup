// Worker API + Durable Object
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // --- API रूट ---
    if (url.pathname === '/api/register') {
      const { accessKey } = await request.json();
      await env.KV.put(accessKey, JSON.stringify({ name: 'अनाम' }));
      return new Response('OK', { status: 200 });
    }

    if (url.pathname === '/api/user') {
      const key = url.searchParams.get('key');
      const data = await env.KV.get(key, 'json');
      return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/api/chats') {
      const myKey = url.searchParams.get('myKey');
      // अपने सारे चैट पार्टनर लिस्ट करें (मान लिया KV में 'chats_<myKey>' key है)
      const chatList = await env.KV.get(`chats_${myKey}`, 'json') || [];
      return new Response(JSON.stringify(chatList), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/api/start-chat') {
      const { myKey, peerKey } = await request.json();
      // दोनों के लिए चैट लिस्ट अपडेट करें
      let myChats = await env.KV.get(`chats_${myKey}`, 'json') || [];
      if (!myChats.includes(peerKey)) {
        myChats.push(peerKey);
        await env.KV.put(`chats_${myKey}`, JSON.stringify(myChats));
      }
      let peerChats = await env.KV.get(`chats_${peerKey}`, 'json') || [];
      if (!peerChats.includes(myKey)) {
        peerChats.push(myKey);
        await env.KV.put(`chats_${peerKey}`, JSON.stringify(peerChats));
      }
      return new Response('OK', { status: 200 });
    }

    // --- WebSocket / Durable Object ---
    if (url.pathname === '/ws') {
      const room = url.searchParams.get('room');
      if (!room) return new Response('Missing room', { status: 400 });
      const id = env.CHAT_ROOM.idFromName(room);
      const stub = env.CHAT_ROOM.get(id);
      return stub.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  }
};

// Durable Object क्लास
export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.sessions = [];
  }

  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.handleSession(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  handleSession(webSocket) {
    webSocket.accept();
    this.sessions.push(webSocket);

    webSocket.addEventListener('message', (event) => {
      // सभी जुड़े क्लाइंट को डेटा भेजें
      this.sessions.forEach(s => {
        if (s !== webSocket) s.send(event.data);
      });
    });

    webSocket.addEventListener('close', () => {
      this.sessions = this.sessions.filter(s => s !== webSocket);
    });
  }
}