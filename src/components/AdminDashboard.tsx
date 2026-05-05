import React, { useState } from 'react';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';
import {
  Users,
  MapPin,
  TrendingUp,
  ShieldCheck,
  Zap,
  Search,
  Filter,
  Navigation,
  DollarSign,
  AlertTriangle,
  Activity,
  ChevronDown,
  ChevronRight,
  Plus,
  X,
  CheckCircle2,
  Clock,
  LogOut,
  Settings,
  User as UserIcon,
  ArrowLeft
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  LineChart,
  Line
} from 'recharts';
import { FieldOfficer, CashReconciliation, CollectionRoute, Merchant } from '../types';
import { MOCK_OFFICERS, MOCK_RECONCILIATIONS, MOCK_ROUTES, MOCK_MERCHANTS } from '../mockData';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { ProfileSettings } from './ProfileSettings';

const StatCard = ({ title, value, subValue, icon: Icon, color }: any) => (
  <div className="bg-white p-6 rounded-2xl border border-zinc-100 shadow-sm">
    <div className="flex justify-between items-start mb-4">
      <div className={`p-2 ${color} rounded-lg`}>
        <Icon className="w-5 h-5" />
      </div>
    </div>
    <h3 className="text-zinc-500 text-sm font-medium mb-1">{title}</h3>
    <div className="flex items-baseline gap-2">
      <span className="text-2xl font-bold text-zinc-900">{value}</span>
      {subValue && <span className="text-zinc-400 text-sm">{subValue}</span>}
    </div>
  </div>
);

export const AdminDashboard: React.FC = () => {
  const { userData } = useAuth();
  const [routes, setRoutes] = useState<CollectionRoute[]>(MOCK_ROUTES);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<'dashboard' | 'create-route'>('dashboard');
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'profile' | 'settings'>('profile');

  const handleLogout = () => signOut(auth);

  const initial = userData?.firstName ? userData.firstName.charAt(0).toUpperCase() : 'A';
  const fullName = userData?.firstName ? `${userData.firstName} ${userData.lastName || ''}` : 'Admin User';

  const handleAssignOfficer = (routeId: string, officerId: string) => {
    setRoutes(routes.map(r => r.id === routeId ? { ...r, officerId, status: officerId ? 'in-progress' : 'pending' } : r));
  };

  const selectedRoute = routes.find(r => r.id === selectedRouteId);
  const routeMerchants = selectedRoute ? MOCK_MERCHANTS.filter(m => selectedRoute.merchantIds.includes(m.id)) : [];

  return (
    <div className="bg-zinc-50 min-h-screen">
      <nav className="bg-white border-b border-zinc-200 px-8 py-4 flex justify-between items-center sticky top-0 z-20">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2 hidden sm:flex">
            <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center">
              <Users className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight">RILL ADMIN</span>
          </div>
          <div className="hidden md:flex items-center gap-6">
            <button onClick={() => setCurrentView('dashboard')} className={`text-sm font-bold pb-1 ${currentView === 'dashboard' ? 'text-zinc-900 border-b-2 border-zinc-900' : 'text-zinc-500 hover:text-zinc-900'}`}>Fleet</button>
            <button className="text-sm font-medium text-zinc-500 hover:text-zinc-900">Tracking</button>
            <button className="text-sm font-medium text-zinc-500 hover:text-zinc-900">Reconciliation</button>
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
                  <p className="text-[10px] text-zinc-500">Admin</p>
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

      {currentView === 'dashboard' ? (
        <main className="p-8 max-w-7xl mx-auto space-y-8">
          <div className="flex justify-between items-end">
            <div>
              <h1 className="text-3xl font-bold text-zinc-900">Fleet Management</h1>
              <p className="text-zinc-500">Monitoring 12 Field Officers across 4 clusters</p>
            </div>
            <div className="flex gap-3">
              <button className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-xl text-sm font-bold">
                <Navigation className="w-4 h-4" /> Live Map
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatCard title="Active Officers" value="8" subValue="/ 12 Total" icon={Activity} color="bg-emerald-50 text-emerald-600" />
            <StatCard title="Total Collected Today" value="₦465,000" icon={DollarSign} color="bg-indigo-50 text-indigo-600" />
            <StatCard title="Reconciliation Status" value="92%" subValue="Matched" icon={ShieldCheck} color="bg-blue-50 text-blue-600" />
            <StatCard title="Pending Discrepancies" value="2" icon={AlertTriangle} color="bg-rose-50 text-rose-600" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-8">
              <div className="bg-white rounded-3xl border border-zinc-100 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-zinc-100">
                  <h2 className="text-xl font-bold">Field Officer Performance</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-zinc-50 text-[10px] uppercase tracking-widest text-zinc-400 font-bold">
                        <th className="px-6 py-4">Officer</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4">Location</th>
                        <th className="px-6 py-4">Collected</th>
                        <th className="px-6 py-4 text-right">Efficiency</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {MOCK_OFFICERS.map(officer => (
                        <tr key={officer.id} className="hover:bg-zinc-50 transition-colors">
                          <td className="px-6 py-4 font-bold text-zinc-900">{officer.name}</td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${officer.status === 'active' ? 'bg-emerald-50 text-emerald-600' : 'bg-zinc-100 text-zinc-500'
                              }`}>
                              {officer.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm text-zinc-500 flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> {officer.currentLocation}
                          </td>
                          <td className="px-6 py-4 font-mono text-sm">₦{officer.collectedToday.toLocaleString()}</td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-xs font-bold">{officer.efficiency}%</span>
                              <div className="w-12 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                                <div className="h-full bg-indigo-500" style={{ width: `${officer.efficiency}%` }}></div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white rounded-3xl border border-zinc-100 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-zinc-100 flex justify-between items-center">
                  <h2 className="text-xl font-bold">Collection Routes</h2>
                  <button
                    onClick={() => setCurrentView('create-route')}
                    className="text-sm font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" /> New Route
                  </button>
                </div>
                <div className="p-6 space-y-4">
                  {routes.map(route => (
                    <div
                      key={route.id}
                      className={`p-4 rounded-2xl border transition-all flex flex-col gap-4 ${selectedRouteId === route.id ? 'bg-indigo-50/50 border-indigo-200' : 'bg-zinc-50 border-zinc-100 hover:border-zinc-200'
                        }`}
                    >
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-4 cursor-pointer flex-1" onClick={() => setSelectedRouteId(selectedRouteId === route.id ? null : route.id)}>
                          <div className="p-3 bg-white rounded-xl border border-zinc-100">
                            <Navigation className="w-5 h-5 text-zinc-600" />
                          </div>
                          <div>
                            <h3 className="font-bold text-zinc-900 flex items-center gap-2">
                              {route.name}
                              <ChevronRight className={`w-4 h-4 text-zinc-400 transition-transform ${selectedRouteId === route.id ? 'rotate-90' : ''}`} />
                            </h3>
                            <p className="text-xs text-zinc-500">{route.cluster} Cluster • {route.merchantIds.length} Merchants</p>
                          </div>
                        </div>

                        <div className="flex-1 max-w-xs">
                          <div className="flex justify-between text-[10px] font-bold uppercase text-zinc-400 mb-1">
                            <span>Progress</span>
                            <span>{route.progress}%</span>
                          </div>
                          <div className="w-full h-2 bg-zinc-200 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${route.progress}%` }}></div>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="relative group">
                            <select
                              value={route.officerId}
                              onChange={(e) => handleAssignOfficer(route.id, e.target.value)}
                              className="appearance-none bg-white border border-zinc-200 rounded-xl px-4 py-2 pr-10 text-xs font-bold text-zinc-900 outline-none focus:ring-1 ring-zinc-300 cursor-pointer"
                            >
                              <option value="">Unassigned</option>
                              {MOCK_OFFICERS.map(o => (
                                <option key={o.id} value={o.id}>{o.name}</option>
                              ))}
                            </select>
                            <ChevronDown className="w-3 h-3 absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                          </div>
                          <div className={
                            `px-2 py-1 rounded-full text-[10px] font-bold uppercase ${route.status === 'in-progress' ? 'bg-indigo-50 text-indigo-600' :
                              route.status === 'completed' ? 'bg-emerald-50 text-emerald-600' : 'bg-zinc-100 text-zinc-500'
                            }`
                          }>
                            {route.status}
                          </div>
                        </div>
                      </div>

                      <AnimatePresence>
                        {selectedRouteId === route.id && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="pt-4 border-t border-indigo-100 grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {routeMerchants.map(merchant => (
                                <div key={merchant.id} className="bg-white p-3 rounded-xl border border-indigo-100 flex justify-between items-center">
                                  <div>
                                    <p className="text-sm font-bold text-zinc-900">{merchant.name}</p>
                                    <p className="text-[10px] text-zinc-500">{merchant.location}</p>
                                  </div>
                                  {merchant.status === 'active' ? (
                                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                  ) : (
                                    <Clock className="w-4 h-4 text-amber-500" />
                                  )}
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-8">
              <div className="bg-white p-6 rounded-3xl border border-zinc-100 shadow-sm">
                <h3 className="font-bold mb-6 flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-emerald-600" /> Cash Reconciliation
                </h3>
                <div className="space-y-4">
                  {MOCK_RECONCILIATIONS.map(recon => (
                    <div key={recon.id} className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-bold">{MOCK_OFFICERS.find(o => o.id === recon.officerId)?.name}</span>
                        <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full ${recon.status === 'matched' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                          }`}>
                          {recon.status}
                        </span>
                      </div>
                      <div className="flex justify-between text-xs text-zinc-500 mb-1">
                        <span>Expected: ₦{recon.expectedAmount.toLocaleString()}</span>
                        <span>Actual: ₦{recon.actualAmount.toLocaleString()}</span>
                      </div>
                      {recon.variance !== 0 && (
                        <div className="text-[10px] font-bold text-rose-600 mt-2 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> Variance: ₦{recon.variance.toLocaleString()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <button className="w-full mt-6 py-3 border-2 border-dashed border-zinc-200 rounded-2xl text-zinc-400 text-sm font-bold hover:border-zinc-400 hover:text-zinc-600 transition-colors">
                  Run Daily Reconcile
                </button>
              </div>

              <div className="bg-zinc-900 text-white p-6 rounded-3xl shadow-xl">
                <div className="flex items-center gap-2 mb-4">
                  <Zap className="w-5 h-5 text-amber-400" />
                  <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">Fleet Intelligence</span>
                </div>
                <h3 className="text-lg font-bold mb-2">Productivity Alert</h3>
                <p className="text-zinc-400 text-sm leading-relaxed">
                  Oshodi cluster is showing a 15% decline in collection velocity. Suggesting route re-optimization for Sarah Smith.
                </p>
              </div>
            </div>
          </div>
        </main>
      ) : (
        <main className="p-8 max-w-2xl mx-auto">
          <button
            onClick={() => setCurrentView('dashboard')}
            className="flex items-center gap-2 text-zinc-500 hover:text-zinc-900 font-medium mb-8 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Fleet
          </button>

          <div className="bg-white rounded-3xl shadow-sm border border-zinc-100 overflow-hidden">
            <div className="p-8 border-b border-zinc-100">
              <h1 className="text-2xl font-bold text-zinc-900">Create Collection Route</h1>
              <p className="text-zinc-500 text-sm mt-1">Design a new prioritized sweep path for a field officer.</p>
            </div>
            <div className="p-8 space-y-8">
              <div className="space-y-3">
                <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Route Name</label>
                <input placeholder="e.g. Balogun Afternoon Sweep" className="w-full p-4 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm font-medium" />
              </div>
              <div className="space-y-3">
                <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Select Cluster</label>
                <select className="w-full p-4 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm font-medium">
                  <option>Balogun</option>
                  <option>Oshodi</option>
                  <option>Yaba</option>
                  <option>Ikeja</option>
                </select>
              </div>
              <div className="space-y-3">
                <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Select Merchants</label>
                <div className="max-h-64 overflow-y-auto border border-zinc-100 rounded-xl divide-y divide-zinc-100 shadow-inner bg-zinc-50/50">
                  {MOCK_MERCHANTS.map(m => (
                    <label key={m.id} className="flex items-center gap-4 p-4 hover:bg-zinc-50 cursor-pointer transition-colors bg-white m-2 rounded-xl shadow-sm border border-zinc-100">
                      <input type="checkbox" className="w-5 h-5 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500" />
                      <div>
                        <p className="text-sm font-bold text-zinc-900">{m.name}</p>
                        <p className="text-[11px] font-medium text-zinc-500 mt-0.5">{m.location}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <div className="pt-4 border-t border-zinc-100">
                <button
                  onClick={() => setCurrentView('dashboard')}
                  className="w-full py-4 bg-zinc-900 text-white rounded-2xl font-bold hover:bg-zinc-800 transition-colors shadow-lg shadow-zinc-900/20 flex justify-center items-center gap-2"
                >
                  <Plus className="w-5 h-5" /> Generate Route Path
                </button>
              </div>
            </div>
          </div>
        </main>
      )}

      <ProfileSettings
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        initialTab={settingsTab}
      />
    </div>
  );
};
