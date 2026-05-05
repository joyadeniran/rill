import { Merchant, FieldOfficer, CashReconciliation, CollectionRoute, MarketCluster } from './types';

export const MOCK_CLUSTERS: MarketCluster[] = [
  {
    id: 'c1',
    name: 'Balogun Market',
    location: { lat: 6.4531, lng: 3.3958 },
    totalMerchants: 1250,
    activeOfficers: ['co1', 'co4']
  },
  {
    id: 'c2',
    name: 'Computer Village Ikeja',
    location: { lat: 6.5922, lng: 3.3427 },
    totalMerchants: 840,
    activeOfficers: ['co2']
  }
];

export const MOCK_MERCHANTS: Merchant[] = [
  {
    id: 'm1',
    name: 'Mama Ngozi',
    businessType: 'Food Vendor',
    location: 'Balogun Market, Block A',
    clusterId: 'c1',
    balance: 145000,
    dailyInstallment: 2500,
    propensityToPay: 85,
    streak: 12,
    lastPaymentDate: '2024-03-01',
    status: 'active',
    gsiLinked: true,
  },
  {
    id: 'm2',
    name: 'Ibrahim Textiles',
    businessType: 'Fabrics',
    location: 'Balogun Market, Block C',
    clusterId: 'c1',
    balance: 210000,
    dailyInstallment: 5000,
    propensityToPay: 45,
    streak: 0,
    lastPaymentDate: '2024-02-28',
    status: 'delinquent',
    gsiLinked: true,
  },
  {
    id: 'm3',
    name: 'Chidi Electronics',
    businessType: 'Mobile Accessories',
    location: 'Computer Village, Block B',
    clusterId: 'c2',
    balance: 85000,
    dailyInstallment: 1500,
    propensityToPay: 65,
    streak: 4,
    lastPaymentDate: '2024-03-01',
    status: 'active',
    gsiLinked: false,
  },
  {
    id: 'm4',
    name: 'Amina Provisions',
    businessType: 'Grocery',
    location: 'Balogun Market, Block A',
    clusterId: 'c1',
    balance: 120000,
    dailyInstallment: 2000,
    propensityToPay: 72,
    streak: 8,
    lastPaymentDate: '2024-03-01',
    status: 'active',
    gsiLinked: true,
  },
  {
    id: 'm5',
    name: 'Kelechi Shoes',
    businessType: 'Footwear',
    location: 'Computer Village, Block D',
    clusterId: 'c2',
    balance: 180000,
    dailyInstallment: 3500,
    propensityToPay: 30,
    streak: 1,
    lastPaymentDate: '2024-02-25',
    status: 'at-risk',
    gsiLinked: true,
  },
];

export const MOCK_OFFICERS: FieldOfficer[] = [
  {
    id: 'co1',
    name: 'John Doe',
    status: 'active',
    currentLocation: 'Balogun Market, Block A',
    assignedCluster: 'Balogun',
    merchantsCount: 250,
    collectionTarget: 500000,
    collectedToday: 345000,
    efficiency: 92,
  },
  {
    id: 'co2',
    name: 'Sarah Smith',
    status: 'active',
    currentLocation: 'Oshodi Market, Sector 2',
    assignedCluster: 'Oshodi',
    merchantsCount: 220,
    collectionTarget: 450000,
    collectedToday: 120000,
    efficiency: 78,
  },
  {
    id: 'co3',
    name: 'Emeka Okafor',
    status: 'offline',
    currentLocation: 'Home',
    assignedCluster: 'Yaba',
    merchantsCount: 180,
    collectionTarget: 350000,
    collectedToday: 0,
    efficiency: 85,
  },
];

export const MOCK_RECONCILIATIONS: CashReconciliation[] = [
  {
    id: 'r1',
    officerId: 'co1',
    date: '2024-03-01',
    expectedAmount: 345000,
    actualAmount: 345000,
    variance: 0,
    status: 'matched',
  },
  {
    id: 'r2',
    officerId: 'co2',
    date: '2024-03-01',
    expectedAmount: 120000,
    actualAmount: 118500,
    variance: -1500,
    status: 'discrepancy',
  },
];

export const MOCK_ROUTES: CollectionRoute[] = [
  {
    id: 'route1',
    officerId: 'co1',
    name: 'Balogun Morning Sweep',
    cluster: 'Balogun',
    merchantIds: ['m1', 'm3', 'm4'],
    status: 'in-progress',
    progress: 65,
  },
  {
    id: 'route2',
    officerId: 'co2',
    name: 'Oshodi Sector 2',
    cluster: 'Oshodi',
    merchantIds: ['m2', 'm5'],
    status: 'pending',
    progress: 0,
  },
];
