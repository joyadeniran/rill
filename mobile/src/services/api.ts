import { Platform } from 'react-native';
import type { CheckInLog, Merchant } from '../types';

const defaultApiBaseUrl =
  Platform.OS === 'android' ? 'http://10.0.2.2:3001/api' : 'http://localhost:3001/api';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || defaultApiBaseUrl;

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function getRouteOptimization(merchants: Merchant[]) {
  return postJson<{ prioritizedIds: string[]; reasoning: string }>('/optimize-route', { merchants });
}

export async function getAIRebuttal(merchantName: string, excuse: string) {
  const data = await postJson<{ text: string }>('/rebuttal', { merchantName, excuse });
  return data.text;
}

export async function getLenderRiskBriefing(logs: CheckInLog[], merchants: Merchant[]) {
  const data = await postJson<{ text: string }>('/risk-briefing', { logs, merchants });
  return data.text;
}
