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

// The bearer token for authenticated endpoints. Held in module scope so it can
// be attached to every request without threading it through each call site.
let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

// Called when the server rejects our token (expired / revoked). Registered by
// AuthContext so a stale persisted session degrades to a clean re-login
// instead of an endless wall of failing requests.
let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(handler: (() => void) | null) {
  onUnauthorized = handler;
}

/** Couldn't reach the server at all (offline / timeout) — as opposed to the
 * server reaching a decision we must respect. The offline payment queue only
 * retries these. */
export class NetworkError extends Error {}

/**
 * The server reached a decision and said no. Carries per-field messages so
 * forms can show the error against the offending input rather than a single
 * opaque alert.
 */
export class ApiError extends Error {
  status: number;
  fields: Record<string, string>;

  constructor(message: string, status: number, fields: Record<string, string> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fields = fields;
  }
}

export function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof ApiError ? error.fields : {};
}

export function isNetworkError(error: unknown): boolean {
  return error instanceof NetworkError;
}

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
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...options.headers
      }
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new NetworkError('Request timed out. Please check your connection and retry.');
    }
    throw new NetworkError('Network request failed. Please check your connection.');
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401 && !path.startsWith('/auth/')) {
    onUnauthorized?.();
  }

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({} as { error?: string; fields?: Record<string, string> }));
    const message =
      errorData.error ||
      (response.status >= 500
        ? 'The server hit an unexpected problem. Please try again.'
        : `Request failed with status ${response.status}`);
    throw new ApiError(message, response.status, errorData.fields || {});
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
  token: string;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
}

export async function register(data: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  inviteCode?: string;
}): Promise<AuthResponse> {
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

export async function getUserHistory(userId: string) {
  return request<{
    payments: Array<{ amount: number; method: string; timestamp: string }>;
    audits: Array<{ mood: string | null; stockLevel: string | null; traffic: string | null; notes: string | null; timestamp: string }>;
    disbursements: Array<{ amount: number; dailyInstallment: number; timestamp: string }>;
  }>(`/users/${userId}/history`);
}

// --- ACTIONS ---

export type PaymentMethod = 'cash' | 'pos' | 'transfer';

export interface RepaymentRequest {
  userId: string;
  amount: number;
  method: PaymentMethod;
  /** Generated client-side per confirmed payment; the server dedupes on it so
   * retries (manual or from the offline queue) can never double-decrement. */
  idempotencyKey: string;
}

export function newIdempotencyKey(): string {
  return `pay-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function recordRepayment(data: RepaymentRequest) {
  return request<{ success: boolean; id: string; duplicate?: boolean }>('/payments', {
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

// --- PHOTOS (field evidence) ---

export type PhotoKind = 'audit' | 'payment' | 'merchant' | 'escalation';

export interface PhotoMeta {
  id: string;
  kind: PhotoKind;
  mimeType: string;
  caption: string | null;
  sizeBytes: number;
  timestamp: string;
  url: string;
  officerName: string | null;
}

export async function uploadPhoto(data: {
  userId: string;
  kind: PhotoKind;
  dataUrl: string;
  caption?: string;
}) {
  return request<{ id: string; kind: PhotoKind; sizeBytes: number; mimeType: string }>('/photos', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function getUserPhotos(userId: string): Promise<PhotoMeta[]> {
  const data = await request<PhotoMeta[]>(`/users/${userId}/photos`);
  return Array.isArray(data) ? data : [];
}

/** Absolute URL for rendering a photo in an <Image source={{uri}} /> tag. */
export function photoUri(photoId: string): string {
  return `${API_BASE_URL}/photos/${photoId}`;
}

/** Auth header for <Image>, which does not go through `request`. */
export function photoHeaders(): Record<string, string> {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

export async function changePassword(currentPassword: string, newPassword: string) {
  return request<{ success: boolean }>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword })
  });
}
