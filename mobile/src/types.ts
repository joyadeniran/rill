export type UserRole = 'onboarding' | 'lender' | 'admin' | 'co';

export interface Merchant {
  id: string;
  name: string;
  phone: string;
  location: string;
  groupId: string | null;
  totalOwed: number;
  balance: number;
  dailyInstallment: number;
  status: 'pending' | 'active' | 'deactivated';
  lastPaymentDate: string | null;
  internalStatus: 'urgent' | 'at-risk' | 'on-track';
}

export interface CheckInLog {
  id: string;
  userId: string;
  timestamp: string;
  mood: 'positive' | 'neutral' | 'negative';
  stockLevel: 'high' | 'medium' | 'low';
  marketTraffic: 'busy' | 'normal' | 'slow';
  notes: string;
}

export interface Repayment {
  id: string;
  userId: string;
  amount: number;
  timestamp: string;
  method: 'cash' | 'pos' | 'transfer';
  officerId: string;
}
