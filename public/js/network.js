let ws = null;
let messageHandler = null;
let reconnectTimeout = null;
let serverUrl = null;

export function connect(url) {
  serverUrl = url;
  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log('Connected to server');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (messageHandler) {
        messageHandler(msg);
      }
    } catch (e) {
      console.error('Failed to parse message:', e);
    }
  };

  ws.onclose = () => {
    console.log('Disconnected from server');
    // Auto-reconnect after 2 seconds
    reconnectTimeout = setTimeout(() => {
      console.log('Reconnecting...');
      connect(serverUrl);
    }, 2000);
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

export function sendMessage(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function onMessage(handler) {
  messageHandler = handler;
}

export function disconnect() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }
  if (ws) {
    ws.close();
  }
}
