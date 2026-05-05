export type UserRole = 'onboarding' | 'lender' | 'admin' | 'co';

export interface Merchant {
  id: string;
  name: string;
  businessType: string;
  location: string;
  clusterId: string;
  balance: number;
  dailyInstallment: number;
  propensityToPay: number;
  streak: number;
  lastPaymentDate: string;
  status: 'active' | 'delinquent' | 'at-risk';
  gsiLinked: boolean;
}

export interface CheckInLog {
  id: string;
  merchantId: string;
  timestamp: string;
  mood: 'positive' | 'neutral' | 'negative';
  stockLevel: 'high' | 'medium' | 'low';
  marketTraffic: 'busy' | 'normal' | 'slow';
  notes: string;
}

export interface Repayment {
  id: string;
  merchantId: string;
  amount: number;
  timestamp: string;
  method: 'cash' | 'pos' | 'transfer';
  officerId: string;
}
