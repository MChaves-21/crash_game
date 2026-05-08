import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useGameStore } from '../stores/game.store';
import { useToast }     from './useToast';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'http://localhost:8000';

/**
 * useWebSocket
 *
 * Conecta ao Game Service via socket.io e alimenta o Zustand store
 * com todos os eventos em tempo real.
 *
 * Estratégia de reconexão: socket.io cuida automaticamente.
 * Em caso de queda, o cliente reconecta e chama GET /rounds/current
 * para sincronizar o estado antes de continuar recebendo ticks.
 */
export function useWebSocket() {
  const socketRef = useRef<Socket | null>(null);
  const store     = useGameStore();
  const toast     = useToast();

  useEffect(() => {
    const socket = io(`${WS_URL}/games`, {
      transports:       ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      store.setWsConnected(true);
      toast.info('Conectado ao servidor');
    });

    socket.on('disconnect', () => {
      store.setWsConnected(false);
      toast.warn('Conexão perdida — reconectando...');
    });

    // ── Eventos do jogo ──────────────────────────────────────────────────

    socket.on('round:new', (payload) => {
      store.onRoundNew(payload);
    });

    socket.on('round:betting-end', (payload) => {
      store.onBettingEnd(payload);
      toast.info('Apostas encerradas — boa sorte!');
    });

    socket.on('multiplier:tick', (payload) => {
      store.onMultiplierTick(payload);
    });

    socket.on('round:crashed', (payload) => {
      store.onRoundCrashed(payload);
    });

    socket.on('bet:placed', (payload) => {
      store.onBetPlaced(payload);
    });

    socket.on('bet:cashout', (payload) => {
      store.onBetCashout(payload);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { socket: socketRef.current };
}
