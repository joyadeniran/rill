import React, { useState } from 'react';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';
import {
  LayoutDashboard,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  Zap,
  Search,
  Filter,
  MoreVertical,
  LogOut,
  Settings,
  User as UserIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer
} from 'recharts';
import { Merchant, CheckInLog, Repayment } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { ProfileSettings } from './ProfileSettings';

interface LenderDashboardProps {
  merchants: Merchant[];
  logs: CheckInLog[];
  repayments: Repayment[];
  riskBriefing: string;
  onTriggerGsi: (id: string) => void;
  isGsiSimulating: boolean;
}

const StatCard = ({ title, value, subValue, icon: Icon, trend }: any) => (
  <div className="bg-white p-6 rounded-2xl border border-zinc-100 shadow-sm">
    <div className="flex justify-between items-start mb-4">
      <div className="p-2 bg-zinc-50 rounded-lg">
        <Icon className="w-5 h-5 text-zinc-600" />
      </div>
      {trend && (
        <span className={`text-xs font-medium px-2 py-1 rounded-full ${trend > 0 ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>
          {trend > 0 ? '+' : ''}{trend}%
        </span>
      )}
    </div>
    <h3 className="text-zinc-500 text-sm font-medium mb-1">{title}</h3>
    <div className="flex items-baseline gap-2">
      <span className="text-2xl font-bold text-zinc-900">{value}</span>
      {subValue && <span className="text-zinc-400 text-sm">{subValue}</span>}
    </div>
  </div>
);

export const LenderDashboard: React.FC<LenderDashboardProps> = ({
  merchants, logs, repayments, riskBriefing, onTriggerGsi, isGsiSimulating
}) => {
  const { userData } = useAuth();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'profile' | 'settings'>('profile');

  const handleLogout = () => signOut(auth);

  const initial = userData?.firstName ? userData.firstName.charAt(0).toUpperCase() : 'L';
  const fullName = userData?.firstName ? `${userData.firstName} ${userData.lastName || ''}` : 'Lender User';

  const totalCollected = repayments.reduce((sum, r) => sum + r.amount, 0);
  const avgStreak = merchants.reduce((sum, m) => sum + m.streak, 0) / merchants.length;
  const atRiskCount = merchants.filter(m => m.status !== 'active').length;

  const chartData = merchants.map(m => ({
    name: m.name.split(' ')[0],
    balance: m.balance / 1000,
    streak: m.streak
  }));

  return (
    <div className="bg-zinc-50 min-h-screen">
      <nav className="bg-white border-b border-zinc-200 px-8 py-4 flex justify-between items-center sticky top-0 z-20">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2 hidden sm:flex">
            <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight">RILL LENDER</span>
          </div>
          <div className="hidden md:flex items-center gap-6">
            <a href="#" className="text-sm font-bold text-zinc-900 border-b-2 border-zinc-900 pb-1">Dashboard</a>
            <a href="#" className="text-sm font-medium text-zinc-500 hover:text-zinc-900">Portfolio</a>
            <a href="#" className="text-sm font-medium text-zinc-500 hover:text-zinc-900">Field Ops</a>
          </div>
        </div>

        {/* Avatar Dropdown in top right */}
        <div className="relative">
          <button onClick={() => setIsProfileOpen(!isProfileOpen)} className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700 font-bold border border-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-all">
            {initial}
          </button>
          <AnimatePresence>
            {isProfileOpen && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="absolute top-12 right-0 w-48 bg-white border border-zinc-200 shadow-xl rounded-2xl py-2 z-50 origin-top-right"
              >
                <div className="px-4 py-2 border-b border-zinc-100 mb-2">
                  <p className="text-sm font-bold text-zinc-900 truncate">{fullName}</p>
                  <p className="text-[10px] text-zinc-500">Lender</p>
                </div>
                <button
                  onClick={() => { setIsSettingsModalOpen(true); setSettingsTab('profile'); setIsProfileOpen(false); }}
                  className="w-full text-left px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 flex items-center gap-2"
                >
                  <UserIcon className="w-4 h-4" /> Profile
                </button>
                <button
                  onClick={() => { setIsSettingsModalOpen(true); setSettingsTab('settings'); setIsProfileOpen(false); }}
                  className="w-full text-left px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 flex items-center gap-2"
                >
                  <Settings className="w-4 h-4" /> Settings
                </button>
                <div className="h-px bg-zinc-100 my-2"></div>
                <button onClick={handleLogout} className="w-full text-left px-4 py-2 text-sm text-rose-600 hover:bg-rose-50 flex items-center gap-2">
                  <LogOut className="w-4 h-4" /> Log out
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </nav>

      <main className="p-8 max-w-7xl mx-auto space-y-8">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-bold text-zinc-900">Portfolio Intelligence</h1>
            <p className="text-zinc-500">Real-time risk stabilization for Balogun Cluster</p>
          </div>
          <div className="flex gap-3">
            <button className="flex items-center gap-2 px-4 py-2 bg-white border border-zinc-200 rounded-xl text-sm font-bold hover:bg-zinc-50">
              <Filter className="w-4 h-4" /> Filter
            </button>
            <button className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-xl text-sm font-bold">
              <TrendingUp className="w-4 h-4" /> Export Report
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard title="Total Collected" value={`₦${totalCollected.toLocaleString()}`} trend={12} icon={TrendingUp} />
          <StatCard title="Avg. Repayment Streak" value={`${avgStreak.toFixed(1)} Days`} trend={5} icon={CheckCircle2} />
          <StatCard title="At-Risk Merchants" value={atRiskCount} trend={-2} icon={AlertCircle} />
          <StatCard title="Stability Pool" value="₦245,000" subValue="Grace Fund" icon={ShieldCheck} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <div className="bg-white p-8 rounded-3xl border border-zinc-100 shadow-sm">
              <h2 className="text-xl font-bold mb-8">Repayment Trends</h2>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#71717a' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#71717a' }} />
                    <RechartsTooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                    <Bar dataKey="balance" fill="#18181b" radius={[4, 4, 0, 0]} barSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white rounded-3xl border border-zinc-100 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-zinc-100">
                <h2 className="text-xl font-bold">Merchant Portfolio</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-zinc-50 text-[10px] uppercase tracking-widest text-zinc-400 font-bold">
                      <th className="px-6 py-4">Merchant</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">Balance</th>
                      <th className="px-6 py-4">Streak</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {merchants.map(m => (
                      <tr key={m.id} className="hover:bg-zinc-50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-bold text-zinc-900">{m.name}</div>
                          <div className="text-xs text-zinc-500">{m.businessType}</div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${m.status === 'active' ? "bg-emerald-50 text-emerald-600" :
                            m.status === 'at-risk' ? "bg-amber-50 text-amber-600" : "bg-rose-50 text-rose-600"
                            }`}>
                            {m.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 font-mono text-sm">₦{m.balance.toLocaleString()}</td>
                        <td className="px-6 py-4 text-xs font-bold">{m.streak}d</td>
                        <td className="px-6 py-4 text-right">
                          {m.gsiLinked && m.status !== 'active' && (
                            <button
                              onClick={() => onTriggerGsi(m.id)}
                              disabled={isGsiSimulating}
                              className="p-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 disabled:opacity-50"
                            >
                              <Zap className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="space-y-8">
            <div className="bg-indigo-900 text-white p-8 rounded-3xl shadow-xl">
              <div className="flex items-center gap-2 mb-4">
                <Zap className="w-5 h-5 text-indigo-300" />
                <span className="text-xs font-bold uppercase tracking-widest text-indigo-200">AI Risk Briefing</span>
              </div>
              <p className="text-indigo-100 text-sm leading-relaxed">
                {riskBriefing || "Analyzing field logs to generate risk briefing..."}
              </p>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-zinc-100 shadow-sm">
              <h3 className="font-bold mb-4 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-500" /> Recent Field Logs
              </h3>
              <div className="space-y-4">
                {logs.slice().reverse().slice(0, 3).map(log => (
                  <div key={log.id} className="p-3 bg-zinc-50 rounded-xl border border-zinc-100">
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-xs font-bold text-zinc-900">{merchants.find(m => m.id === log.merchantId)?.name}</span>
                    </div>
                    <p className="text-xs text-zinc-600 line-clamp-2">{log.notes}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>

      <ProfileSettings
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        initialTab={settingsTab}
      />
    </div>
  );
};
