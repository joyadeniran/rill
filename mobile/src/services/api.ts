import { Platform } from 'react-native';
import type { CheckInLog, Merchant, Repayment } from '../types';

const defaultApiBaseUrl =
  Platform.OS === 'android' ? 'http://10.0.2.2:3001/api' : 'http://localhost:3001/api';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || defaultApiBaseUrl;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
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
  return request<Merchant[]>('/today');
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

export async function recordAudit(data: { userId: string; mood: string; stockLevel: string; traffic: string; notes: string }) {
  return request<{ success: boolean; id: string }>('/audits', {
    method: 'POST',
    body: JSON.stringify(data)
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
