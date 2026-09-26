import { useState, useEffect, useRef, useCallback } from 'react';
import { WS_BASE_URL, INITIAL_RECONNECT_DELAY, MAX_RECONNECT_DELAY } from '../constants';
import { ConnectionStatus, WSMessage } from '../types';

interface UseWebSocketReturn {
  status: ConnectionStatus;
  connectGlobal: () => void;
  subscribeMatch: (matchId: string | number) => void;
  unsubscribeMatch: (matchId: string | number) => void;
  disconnect: () => void;
}

const MAX_RECONNECT_ATTEMPTS = 8;

export const useWebSocket = (
  onMessage: (msg: WSMessage) => void
): UseWebSocketReturn => {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');

  const ws = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);
  const isIntentionalClose = useRef(false);
  const subscribedMatchIdsRef = useRef(new Set<string>());

  // Keep latest onMessage callback in a ref to keep initConnection stable
  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const normalizeId = (matchId: string | number) => String(matchId);

  const sendMessage = useCallback((message: WSMessage | Record<string, unknown>) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
    }
  }, []);

  // Core connect function - stable with zero external dependencies
  const initConnection = useCallback(() => {
    // If already open or actively connecting, do not re-create
    if (
      ws.current &&
      (ws.current.readyState === WebSocket.OPEN ||
        ws.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    // Clean up any existing socket before opening a new one
    if (ws.current) {
      const old = ws.current;
      old.onopen = null;
      old.onmessage = null;
      old.onerror = null;
      old.onclose = null;
      try {
        old.close();
      } catch {}
      ws.current = null;
    }

    isIntentionalClose.current = false;

    try {
      const socket = new WebSocket(WS_BASE_URL);
      ws.current = socket;

      socket.onopen = () => {
        if (socket !== ws.current) return;
        setStatus('connected');
        reconnectAttempts.current = 0;

        // Re-subscribe to all active matches post-reconnect
        if (subscribedMatchIdsRef.current.size > 0) {
          subscribedMatchIdsRef.current.forEach((matchId) => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: 'subscribe', matchId: Number(matchId) }));
            }
          });
        }
      };

      socket.onmessage = (event) => {
        if (socket !== ws.current) return;
        try {
          const data = JSON.parse(event.data);
          onMessageRef.current(data);
        } catch (e) {
          console.error('[WebSocket] Failed to parse message:', e);
        }
      };

      socket.onerror = () => {
        if (socket !== ws.current) return;
        // Keep status in 'reconnecting' rather than flickering to 'error'
        // unless we have exceeded maximum reconnect attempts
        if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
          setStatus('error');
        }
      };

      socket.onclose = () => {
        if (socket !== ws.current) return;
        if (!isIntentionalClose.current) {
          // Transition to 'reconnecting', NOT 'disconnected' (Offline)
          // to eliminate visual flicker on transient reconnections.
          if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
            setStatus('reconnecting');

            const delay = Math.min(
              INITIAL_RECONNECT_DELAY * (2 ** reconnectAttempts.current),
              MAX_RECONNECT_DELAY
            );

            reconnectTimeout.current = setTimeout(() => {
              reconnectAttempts.current += 1;
              initConnection();
            }, delay);
          } else {
            // Only show offline if all reconnect attempts are exhausted
            setStatus('disconnected');
          }
        } else {
          setStatus('disconnected');
        }
      };
    } catch (e) {
      console.error('[WebSocket] Socket creation failed:', e);
      setStatus('error');
    }
  }, []);

  const connectGlobal = useCallback(() => {
    initConnection();
  }, [initConnection]);

  const subscribeMatch = useCallback(
    (matchId: string | number) => {
      const normalized = normalizeId(matchId);
      subscribedMatchIdsRef.current.add(normalized);
      sendMessage({ type: 'subscribe', matchId: Number(matchId) });
    },
    [sendMessage]
  );

  const unsubscribeMatch = useCallback(
    (matchId: string | number) => {
      const normalized = normalizeId(matchId);
      subscribedMatchIdsRef.current.delete(normalized);
      sendMessage({ type: 'unsubscribe', matchId: Number(matchId) });
    },
    [sendMessage]
  );

  const disconnect = useCallback(() => {
    isIntentionalClose.current = true;
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
      reconnectTimeout.current = null;
    }

    if (ws.current) {
      const s = ws.current;
      s.onopen = null;
      s.onmessage = null;
      s.onerror = null;
      s.onclose = null;
      try {
        s.close();
      } catch {}
      ws.current = null;
    }
    setStatus('disconnected');
  }, []);

  useEffect(() => {
    initConnection();
    return () => {
      isIntentionalClose.current = true;
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
        reconnectTimeout.current = null;
      }
      if (ws.current) {
        const s = ws.current;
        s.onopen = null;
        s.onmessage = null;
        s.onerror = null;
        s.onclose = null;
        try {
          s.close();
        } catch {}
        ws.current = null;
      }
    };
  }, [initConnection]);

  return { status, connectGlobal, subscribeMatch, unsubscribeMatch, disconnect };
};
