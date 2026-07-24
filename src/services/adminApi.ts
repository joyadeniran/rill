// API client for the Rill admin console. Admin identity comes from the
// existing Supplya admin account via the backend's admin-login proxy — Rill
// stores no admin credentials.

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || '/api';

const TOKEN_KEY = 'rill-admin-token';
const OFFICER_KEY = 'rill-admin-officer';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/** Cached so a page refresh keeps the console on the right role's views
 *  without a round-trip. The token remains the only thing the server trusts. */
export function getStoredOfficer(): AdminOfficer | null {
  try {
    const raw = localStorage.getItem(OFFICER_KEY);
    return raw ? (JSON.parse(raw) as AdminOfficer) : null;
  } catch {
    return null;
  }
}

export function setStoredOfficer(officer: AdminOfficer | null) {
  if (officer) localStorage.setItem(OFFICER_KEY, JSON.stringify(officer));
  else localStorage.removeItem(OFFICER_KEY);
}

export function signOut() {
  setToken(null);
  setStoredOfficer(null);
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

export type Role = 'co' | 'admin' | 'lender';

export interface AdminOfficer {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  active?: boolean;
}

export interface Defaulter {
  id: string;
  name: string;
  phone: string | null;
  location: string;
  totalOwed: number;
  balance: number;
  dailyInstallment: number;
  status: string;
  assignedCoId: string | null;
  assignedCoName: string | null;
  lastPaymentTimestamp: string | null;
  hoursSinceLastPayment: number | null;
  neverPaid: boolean;
}

export interface PhotoMeta {
  id: string;
  kind: string;
  mimeType: string;
  caption: string | null;
  sizeBytes: number;
  timestamp: string;
  url: string;
  officerName: string | null;
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
  setStoredOfficer(data.officer);
  return data.officer;
}

/** Lenders (and any Rill-native account) sign in here. Admins use the
 *  Supplya proxy above — Rill stores no admin credentials. */
export async function lenderLogin(email: string, password: string) {
  const data = await request<{ officer: AdminOfficer; token: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  setToken(data.token);
  setStoredOfficer(data.officer);
  return data.officer;
}

export async function changePassword(currentPassword: string, newPassword: string) {
  return request<{ success: boolean }>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword })
  });
}

export async function getDefaulters() {
  const d = await request<Defaulter[]>('/defaulters');
  return Array.isArray(d) ? d : [];
}

export async function assignDefaulter(userId: string, officerId: string | null) {
  return request<{ success: boolean; assignedCoId: string | null }>(`/users/${userId}/assign`, {
    method: 'POST',
    body: JSON.stringify({ officerId })
  });
}

export async function getOfficers() {
  const d = await request<AdminOfficer[]>('/officers');
  return Array.isArray(d) ? d : [];
}

export async function createOfficer(data: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'co' | 'lender';
}) {
  return request<{ officer: AdminOfficer }>('/officers', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateOfficer(id: string, data: { active?: boolean; role?: 'co' | 'lender' }) {
  return request<{ success: boolean }>(`/officers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data)
  });
}

export async function getUserPhotos(userId: string) {
  const d = await request<PhotoMeta[]>(`/users/${userId}/photos`);
  return Array.isArray(d) ? d : [];
}

export async function deleteUser(userId: string) {
  return request<{ success: boolean }>(`/users/${userId}`, { method: 'DELETE' });
}

export async function getRiskBriefing(logs: unknown[], merchants: unknown[]) {
  return request<{ text: string }>('/risk-briefing', {
    method: 'POST',
    body: JSON.stringify({ logs, merchants })
  });
}

/** Photos are auth-gated, so they cannot be used as a bare <img src>.
 *  Fetches with the bearer token and returns an object URL. */
export async function fetchPhotoObjectUrl(photoId: string): Promise<string> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/photos/${photoId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!res.ok) throw new ApiError('Could not load photo', res.status);
  return URL.createObjectURL(await res.blob());
}

export async function getUsers() {
  const d = await request<AdminUser[]>('/users');
  return Array.isArray(d) ? d : [];
}

export async function getEscalations() {
  const d = await request<Escalation[]>('/escalations');
  return Array.isArray(d) ? d : [];
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
