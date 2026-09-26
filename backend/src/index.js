import express from 'express';
import cors from 'cors';
import { matchRouter } from './routes/matches.js';
import http from 'http';
import { attachWebsocketServer } from './ws/server.js';
import { securityMiddleware } from './arcjet.js';
import { commentaryRouter } from './routes/commentary.js';
import { FootballDataAdapter } from './ingestion/adapters/football-data.js';
import { MatchStateDiffTracker, resolveInternalMatchId } from './ingestion/match-mapper.js';
import { createLivePoller } from './ingestion/poller.js';
import * as ingestionService from './ingestion/service.js';

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
const server = http.createServer(app);

app.use(express.json());
const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://localhost:5173'];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (e.g. curl, Postman, server-to-server)
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.get('/', (req, res) => {
    res.json({ message: 'Welcome to the Express server!' });
});

app.use(securityMiddleware());

app.use('/matches', matchRouter);
app.use('/matches/:id/commentary', commentaryRouter);

const { broadcastMatchCreated, broadcastCommentary, broadcastScoreUpdate } = attachWebsocketServer(server);
app.locals.broadcastMatchCreated = broadcastMatchCreated;
app.locals.broadcastCommentary = broadcastCommentary;
app.locals.broadcastScoreUpdate = broadcastScoreUpdate;

let livePoller = null;

server.listen(PORT, HOST, () => {
    const baseUrl = (HOST === '0.0.0.0') ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;

    console.log(`Server is running on ${baseUrl}`);
    console.log(`WebSocket Server is running on ${baseUrl.replace('http', 'ws')}/ws`);

    // Ingestion Bootstrap: runs live poller when key is present or INGESTION_MODE=live
    const ingestionMode = (process.env.INGESTION_MODE || '').toLowerCase();
    const apiKey = (process.env.FOOTBALL_DATA_API_KEY || '').trim();

    // Football Ingestion Supervisor
    if (ingestionMode === 'live' || (ingestionMode !== 'seed' && apiKey)) {
        if (!apiKey) {
            console.warn('[Ingestion] INGESTION_MODE=live requested, but FOOTBALL_DATA_API_KEY is not set. Standing by.');
        } else {
            const adapter = new FootballDataAdapter({
                apiKey,
                baseUrl: process.env.FOOTBALL_DATA_BASE_URL,
            });
            const diffTracker = new MatchStateDiffTracker();
            const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS);

            livePoller = createLivePoller({
                adapter,
                mapper: { resolveInternalMatchId },
                diffTracker,
                service: ingestionService,
                broadcastCommentary,
                pollIntervalMs,
            });

            app.locals.livePoller = livePoller;
            livePoller.start();
            console.log(`[Ingestion] Live football poller activated (interval: ${pollIntervalMs / 1000}s).`);
        }
    } else {
        console.log('[Ingestion] Running in seed / standby mode (supply FOOTBALL_DATA_API_KEY to activate live API polling).');
    }
});

function handleShutdown(signal) {
    console.log(`\n[Server] Received ${signal}. Initiating graceful shutdown...`);
    if (livePoller) {
        livePoller.stop();
    }
    server.close(() => {
        console.log('[Server] HTTP and WebSocket listeners terminated.');
        process.exit(0);
    });
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

