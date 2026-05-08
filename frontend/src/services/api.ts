const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

function getToken(): string | null {
  return sessionStorage.getItem('access_token');
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.message ?? 'Erro na requisição');
  }

  return res.json();
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Game Service ──────────────────────────────────────────────────────────────

export const gameApi = {
  getCurrentRound: () =>
    request<any>('/games/rounds/current'),

  getHistory: (page = 1, limit = 20) =>
    request<any>(`/games/rounds/history?page=${page}&limit=${limit}`),

  verifyRound: (roundId: string) =>
    request<any>(`/games/rounds/${roundId}/verify`),

  placeBet: (amountCents: number) =>
    request<any>('/games/bet', {
      method: 'POST',
      body:   JSON.stringify({ amountCents }),
    }),

  cashOut: () =>
    request<any>('/games/bet/cashout', { method: 'POST' }),

  getMyBets: (page = 1) =>
    request<any>(`/games/bets/me?page=${page}`),
};

// ── Wallet Service ────────────────────────────────────────────────────────────

export const walletApi = {
  createWallet: () =>
    request<any>('/wallets/wallets', { method: 'POST' }),

  getMyWallet: () =>
    request<any>('/wallets/wallets/me'),
};

// ── Auth (Keycloak OIDC) ──────────────────────────────────────────────────────

const KEYCLOAK_URL    = import.meta.env.VITE_KEYCLOAK_URL   ?? 'http://localhost:8080';
const REALM           = import.meta.env.VITE_REALM           ?? 'crash-game';
const CLIENT_ID       = import.meta.env.VITE_CLIENT_ID       ?? 'crash-game-client';
const REDIRECT_URI    = `${window.location.origin}/callback`;

export const authApi = {
  /** Redireciona para a página de login do Keycloak (Authorization Code + PKCE) */
  login: async () => {
    const verifier  = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const state     = Math.random().toString(36).slice(2);

    sessionStorage.setItem('pkce_verifier', verifier);
    sessionStorage.setItem('oauth_state',   state);

    const params = new URLSearchParams({
      client_id:             CLIENT_ID,
      redirect_uri:          REDIRECT_URI,
      response_type:         'code',
      scope:                 'openid profile email',
      code_challenge:        challenge,
      code_challenge_method: 'S256',
      state,
    });

    window.location.href =
      `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/auth?${params}`;
  },

  /** Troca o authorization code pelo access token */
  handleCallback: async (code: string, state: string): Promise<string> => {
    const savedState  = sessionStorage.getItem('oauth_state');
    const verifier    = sessionStorage.getItem('pkce_verifier');

    if (state !== savedState) throw new Error('State inválido — possível CSRF');
    if (!verifier)            throw new Error('PKCE verifier não encontrado');

    const body = new URLSearchParams({
      grant_type:    'authorization_code',
      client_id:     CLIENT_ID,
      redirect_uri:  REDIRECT_URI,
      code,
      code_verifier: verifier,
    });

    const res = await fetch(
      `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`,
      { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    if (!res.ok) throw new Error('Falha ao trocar o código');
    const data = await res.json();

    sessionStorage.setItem('access_token',  data.access_token);
    sessionStorage.setItem('refresh_token', data.refresh_token ?? '');
    sessionStorage.removeItem('pkce_verifier');
    sessionStorage.removeItem('oauth_state');

    return data.access_token;
  },

  logout: () => {
    sessionStorage.clear();
    window.location.href =
      `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/logout?redirect_uri=${encodeURIComponent(window.location.origin)}`;
  },

  parseJwt: (token: string) => {
    try {
      return JSON.parse(atob(token.split('.')[1]));
    } catch {
      return null;
    }
  },
};

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const enc  = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', enc);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
