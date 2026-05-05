import { Merchant } from './types';

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
    gsiLinked: true
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
    gsiLinked: true
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
    gsiLinked: false
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
    gsiLinked: true
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
    gsiLinked: true
  }
];
