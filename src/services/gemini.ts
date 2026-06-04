import { Merchant, CheckInLog } from "../types";

// The web dashboard is served same-origin by the Express server (from `dist`),
// so default to a relative '/api'. Override with VITE_API_BASE for split
// deployments. Previously hard-coded to localhost, which broke in production.
const API_BASE = import.meta.env.VITE_API_BASE || '/api';

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
