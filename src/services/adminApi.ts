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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  if (response.status === 401) {
    setToken(null);
    throw new Error('Session expired. Please sign in again.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((data && (data.error as string)) || `Request failed (${response.status})`);
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
