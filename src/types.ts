export type UserRole = 'onboarding' | 'lender' | 'admin' | 'co';

export interface MarketCluster {
  id: string;
  name: string;
  location: { lat: number; lng: number };
  totalMerchants: number;
  activeOfficers: string[];
}

export interface Merchant {
  id: string;
  name: string;
  businessType: string;
  location: string;
  clusterId: string;
  balance: number;
  dailyInstallment: number;
  propensityToPay: number; // 0-100
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

export interface FieldOfficer {
  id: string;
  name: string;
  status: 'active' | 'offline' | 'break';
  currentLocation: string;
  assignedCluster: string;
  merchantsCount: number;
  collectionTarget: number;
  collectedToday: number;
  efficiency: number; // 0-100
}

export interface CashReconciliation {
  id: string;
  officerId: string;
  date: string;
  expectedAmount: number;
  actualAmount: number;
  variance: number;
  status: 'matched' | 'discrepancy' | 'pending';
}

export interface CollectionRoute {
  id: string;
  officerId: string;
  name: string;
  cluster: string;
  merchantIds: string[];
  status: 'pending' | 'in-progress' | 'completed';
  startTime?: string;
  endTime?: string;
  progress: number; // 0-100
}
