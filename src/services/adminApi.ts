// API client for the Rill admin console. Admin identity comes from the
// existing Supplya admin account via the backend's admin-login proxy — Rill
// stores no admin credentials.

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || '/api';

const TOKEN_KEY = 'rill-admin-token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/**
 * Thrown for any non-2xx response. Carries the server's per-field messages so
 * forms can render errors inline against the offending input instead of
 * showing one opaque banner.
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

/** Couldn't reach the server at all — distinct from the server saying no. */
export class NetworkError extends Error {}

const REQUEST_TIMEOUT_MS = 30000;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
      }
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new NetworkError('The server took too long to respond. Please try again.');
    }
    throw new NetworkError('Cannot reach the server. Check your connection and try again.');
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401) {
    setToken(null);
    throw new ApiError('Your session has expired. Please sign in again.', 401);
  }

  // A non-JSON body (proxy HTML error page, empty 502 during a cold start)
  // must not throw an unguarded SyntaxError inside a render path.
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (data && (data.error as string)) ||
      (response.status >= 500
        ? 'The server hit an unexpected problem. Please try again.'
        : `Request failed (${response.status})`);
    throw new ApiError(message, response.status, (data && data.fields) || {});
  }
  return data as T;
}

export interface AdminOfficer {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin';
}

export interface AdminUser {
  id: string;
  name: string;
  phone: string | null;
  location: string;
  groupId: string | null;
  totalOwed: number;
  balance: number;
  dailyInstallment: number;
  status: 'pending' | 'active' | 'deactivated';
  lastPaymentDate: string | null;
}

export interface Escalation {
  id: string;
  userId: string;
  userName: string | null;
  reason: string;
  timestamp: string;
}

export async function adminLogin(email: string, password: string) {
  // Password forwarded exactly as typed — never trim a password.
  const data = await request<{ officer: AdminOfficer; token: string }>('/auth/admin-login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  setToken(data.token);
  return data.officer;
}

export async function getUsers() {
  return request<AdminUser[]>('/users');
}

export async function getEscalations() {
  return request<Escalation[]>('/escalations');
}

export async function disburse(userId: string, amount: number, dailyInstallment: number) {
  return request<{ success: boolean; id: string }>('/disbursements', {
    method: 'POST',
    body: JSON.stringify({ userId, amount, dailyInstallment })
  });
}

export async function setUserStatus(userId: string, status: 'active' | 'deactivated') {
  return request<{ success: boolean }>(`/users/${userId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status })
  });
}
