import { Merchant, CheckInLog } from "../types";

const API_BASE = 'http://localhost:3001/api';

export const getRouteOptimization = async (merchants: Merchant[]) => {
  const response = await fetch(`${API_BASE}/optimize-route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ merchants })
  });
  return response.json();
};

export const getAIRebuttal = async (merchantName: string, excuse: string) => {
  const response = await fetch(`${API_BASE}/rebuttal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ merchantName, excuse })
  });
  const data = await response.json();
  return data.text;
};

export const getLenderRiskBriefing = async (logs: CheckInLog[], merchants: Merchant[]) => {
  const response = await fetch(`${API_BASE}/risk-briefing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ logs, merchants })
  });
  const data = await response.json();
  return data.text;
};
