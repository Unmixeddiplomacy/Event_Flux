import { WebSocket, WebSocketServer } from "ws";
import { wsArcjet } from "../arcjet.js";

const matchSubscribers = new Map();

function subscribe(matchId, socket) {
    const key = Number(matchId);
    if (!matchSubscribers.has(key)) {
        matchSubscribers.set(key, new Set());
    }

    matchSubscribers.get(key).add(socket);
}

function unsubscribe(matchId, socket) {
    const key = Number(matchId);
    const subscribers = matchSubscribers.get(key);

    if (!subscribers) return;

    subscribers.delete(socket);

    if (subscribers.size === 0) {
        matchSubscribers.delete(key);
    }
}

function cleanupSubscription(socket) {
    for (const matchId of socket.subscriptions) {
        unsubscribe(matchId, socket);
    }
    socket.subscriptions.clear();
}

function broadcastToMatch(matchId, payload) {
    const key = Number(matchId);
    const subscribers = matchSubscribers.get(key);
    if (!subscribers || subscribers.size === 0) return;

    const message = JSON.stringify(payload);

    for (const client of subscribers) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }
}

function sendJson(socket, payload) {
    if (socket.readyState !== WebSocket.OPEN) return;

    socket.send(JSON.stringify(payload));
}

function broadcastToAll(wss, payload) {
    for (const client of wss.clients) {
        if (client.readyState !== WebSocket.OPEN) continue;

        client.send(JSON.stringify(payload));
    }
}

function handleMessage(socket, data) {
    let message;

    try {
        message = JSON.parse(data.toString());
    } catch {
        sendJson(socket, { type: 'error', message: 'Invalid JSON' });
    }

    if (message?.type === "subscribe" && Number.isInteger(message.matchId)) {
        subscribe(message.matchId, socket);
        socket.subscriptions.add(message.matchId);
        sendJson(socket, { type: 'subscribed', matchId: message.matchId });
        return;
    }

    if (message?.type === "unsubscribe" && Number.isInteger(message.matchId)) {
        unsubscribe(message.matchId, socket);
        socket.subscriptions.delete(message.matchId);
        sendJson(socket, { type: 'unsubscribed', matchId: message.matchId });
    }
}


export function attachWebsocketServer(server) {
    const wss = new WebSocketServer({
        noServer: true,
        maxPayload: 1024 * 1024,
    });

    server.on('upgrade', async (req, rawSocket, head) => {
        if (req.url !== '/ws') {
            rawSocket.destroy();
            return;
        }

        if (wsArcjet) {
            try {
                const decision = await wsArcjet.protect(req);

                if (decision.isDenied()) {
                    const isRateLimit = decision.reason.isRateLimit();
                    const status = isRateLimit ? '429 Too Many Requests' : '403 Forbidden';
                    const body = isRateLimit ? 'Rate limit exceeded' : 'Access denied';

                    rawSocket.write(
                        `HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`
                    );
                    rawSocket.destroy();
                    return;
                }
            } catch (e) {
                console.error('WS upgrade security error', e);
                const body = 'Internal server error';
                rawSocket.write(
                    `HTTP/1.1 500 Internal Server Error\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`
                );
                rawSocket.destroy();
                return;
            }
        }

        wss.handleUpgrade(req, rawSocket, head, (ws) => {
            wss.emit('connection', ws, req);
        });
    });

    wss.on('connection', (socket) => {
        socket.isAlive = true;
        socket.on('pong', () => { socket.isAlive = true; });

        socket.subscriptions = new Set();

        sendJson(socket, { type: 'welcome' });

        socket.on('message', (data) => {
            handleMessage(socket, data);
        })
        socket.on('error', () => {
            socket.terminate();
        });

        socket.on('close', () => {
            cleanupSubscription(socket);
        });
    });

    const interval = setInterval(() => {
        wss.clients.forEach((socket) => {
            if (socket.isAlive === false) return socket.terminate();

            socket.isAlive = false;
            socket.ping();
        });
    }, 30000);

    wss.on('close', () => clearInterval(interval));

    function broadcastMatchCreated(match) {
        broadcastToAll(wss, { type: 'match_created', data: match });
    }
    function broadcastCommentary(matchId, comment) {
        broadcastToMatch(matchId, { type: 'commentary', data: comment });
    }
    function broadcastScoreUpdate(matchId, scoreData) {
        broadcastToAll(wss, { type: 'score_update', matchId, data: scoreData });
    }
    return { broadcastMatchCreated, broadcastCommentary, broadcastScoreUpdate }
}