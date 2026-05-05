/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Onboarding } from './components/Onboarding';
import { LenderDashboard } from './components/LenderDashboard';
import { AdminDashboard } from './components/AdminDashboard';
import { FieldApp } from './components/FieldApp';
import { MOCK_MERCHANTS } from './mockData';
import { Merchant, CheckInLog, Repayment } from './types';
import { getRouteOptimization, getLenderRiskBriefing } from './services/gemini';
import { LogOut, Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { auth } from './firebase';
import { signOut } from 'firebase/auth';

function AppContent() {
  const { role, loading } = useAuth();
  const [merchants, setMerchants] = useState<Merchant[]>(MOCK_MERCHANTS);
  const [logs, setLogs] = useState<CheckInLog[]>([]);
  const [repayments, setRepayments] = useState<Repayment[]>([]);
  const [routeOrder, setRouteOrder] = useState<string[]>([]);
  const [routeReasoning, setRouteReasoning] = useState('');
  const [riskBriefing, setRiskBriefing] = useState('');
  const [isGsiSimulating, setIsGsiSimulating] = useState(false);

  useEffect(() => {
    const optimize = async () => {
      try {
        const result = await getRouteOptimization(merchants);
        setRouteOrder(result.prioritizedIds || []);
        setRouteReasoning(result.reasoning || '');
      } catch (e) {
        console.error("Optimization failed", e);
      }
    };
    optimize();
  }, []);

  useEffect(() => {
    if (role === 'lender' && logs.length > 0) {
      const fetchBriefing = async () => {
        const briefing = await getLenderRiskBriefing(logs, merchants);
        setRiskBriefing(briefing || '');
      };
      fetchBriefing();
    }
  }, [role, logs]);

  const handleRepayment = (merchantId: string) => {
    const merchant = merchants.find(m => m.id === merchantId);
    if (!merchant) return;

    const amount = merchant.dailyInstallment;
    const newRepayment: Repayment = {
      id: Math.random().toString(36).substr(2, 9),
      merchantId,
      amount,
      timestamp: new Date().toISOString(),
      method: 'cash',
      officerId: 'co1'
    };

    setRepayments([...repayments, newRepayment]);
    setMerchants(merchants.map(m =>
      m.id === merchantId
        ? { ...m, balance: m.balance - amount, streak: m.streak + 1, lastPaymentDate: new Date().toISOString().split('T')[0], status: 'active' }
        : m
    ));
    alert(`Payment of ₦${amount.toLocaleString()} recorded for ${merchant.name}`);
  };

  const handleCheckIn = (logData: Omit<CheckInLog, 'id' | 'timestamp'>) => {
    const newLog: CheckInLog = {
      ...logData,
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
    };
    setLogs([...logs, newLog]);
  };

  const triggerGsiSweep = (merchantId: string) => {
    setIsGsiSimulating(true);
    setTimeout(() => {
      setMerchants(merchants.map(m =>
        m.id === merchantId ? { ...m, status: 'active', streak: 0 } : m
      ));
      setIsGsiSimulating(false);
      alert("GSI Sweep Successful.");
    }, 2000);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Logout failed', err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center">
        <Loader2 className="w-12 h-12 text-zinc-900 animate-spin mb-4" />
        <p className="text-zinc-500 font-medium">Loading Rill Infrastructure...</p>
      </div>
    );
  }

  const renderContent = () => {
    switch (role) {
      case 'onboarding':
        return <Onboarding />;
      case 'lender':
        return (
          <LenderDashboard
            merchants={merchants}
            logs={logs}
            repayments={repayments}
            riskBriefing={riskBriefing}
            onTriggerGsi={triggerGsiSweep}
            isGsiSimulating={isGsiSimulating}
          />
        );
      case 'admin':
        return <AdminDashboard />;
      case 'co':
        return (
          <FieldApp
            merchants={merchants}
            routeOrder={routeOrder}
            routeReasoning={routeReasoning}
            onRepayment={handleRepayment}
            onCheckIn={handleCheckIn}
          />
        );
      default:
        return <Onboarding />;
    }
  };

  return (
    <div className="relative">
      {renderContent()}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
