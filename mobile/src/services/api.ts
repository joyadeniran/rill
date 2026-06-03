import { Platform } from 'react-native';
import type { CheckInLog, Merchant, Repayment } from '../types';

// Production HTTPS endpoint. Used for release builds (and whenever a build-time
// EXPO_PUBLIC_API_BASE_URL is not supplied) so we never silently fall back to a
// cleartext localhost URL that Android release builds block.
const productionApiBaseUrl = 'https://rill-app.onrender.com/api';

const devApiBaseUrl =
  Platform.OS === 'android' ? 'http://10.0.2.2:3001/api' : 'http://localhost:3001/api';

const defaultApiBaseUrl =
  typeof __DEV__ !== 'undefined' && __DEV__ ? devApiBaseUrl : productionApiBaseUrl;

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || defaultApiBaseUrl;

// Render free-tier cold starts can take 30-60s; without a ceiling a request can
// hang forever, leaving the UI stuck on a spinner. Abort instead so callers can
// surface a friendly error.
const REQUEST_TIMEOUT_MS = 30000;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out. Please check your connection and retry.');
    }
    throw new Error('Network request failed. Please check your connection.');
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({} as { error?: string }));
    throw new Error(errorData.error || `Request failed with status ${response.status}`);
  }

  // A 200 response can still carry a non-JSON body (proxy/HTML error page,
  // empty body during cold start). Guard the parse so it surfaces as a handled
  // error instead of an unguarded throw inside a render path.
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error('Received an invalid response from the server.');
  }
}

// --- AUTH ---

export interface AuthResponse {
  officer: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
}

export async function register(data: { email: string; password: string; firstName: string; lastName: string }): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

// --- USERS / MERCHANTS ---

export async function getTodayRoute(): Promise<Merchant[]> {
  const data = await request<Merchant[]>('/today');
  // The server returns a JSON array; defend the render path against any
  // unexpected shape (proxy error object, etc.) that would break `[...data]`.
  return Array.isArray(data) ? data : [];
}

export async function createUser(data: { name: string; phone: string; location: string; groupId?: string }) {
  return request<{ id: string; name: string; status: string }>('/users', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

// --- ACTIONS ---

export async function recordRepayment(data: { userId: string; amount: number; method: string; officerId: string }) {
  return request<{ success: boolean; id: string }>('/payments', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function recordAudit(data: { userId: string; mood: string; stockLevel: string; marketTraffic: string; notes: string }) {
  return request<{ success: boolean; id: string }>('/audits', {
    method: 'POST',
    body: JSON.stringify({
      ...data,
      traffic: data.marketTraffic
    })
  });
}

export async function recordEscalation(data: { userId: string; reason: string }) {
  return request<{ success: boolean; id: string }>('/escalations', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

// --- AI (EXISTING) ---

export async function getRouteOptimization(merchants: Merchant[]) {
  return request<{ prioritizedIds: string[]; reasoning: string }>('/optimize-route', {
    method: 'POST',
    body: JSON.stringify({ merchants })
  });
}

export async function getAIRebuttal(merchantName: string, excuse: string) {
  const data = await request<{ text: string }>('/rebuttal', {
    method: 'POST',
    body: JSON.stringify({ merchantName, excuse })
  });
  return data.text;
}

export async function getLenderRiskBriefing(logs: CheckInLog[], merchants: Merchant[]) {
  const data = await request<{ text: string }>('/risk-briefing', {
    method: 'POST',
    body: JSON.stringify({ logs, merchants })
  });
  return data.text;
}
