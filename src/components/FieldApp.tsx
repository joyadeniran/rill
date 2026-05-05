import React, { useState, useEffect, useRef } from 'react';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';
import { motion, AnimatePresence } from 'motion/react';
import {
  MapPin,
  CheckCircle2,
  MessageSquare,
  Smartphone,
  Zap,
  ArrowRightLeft,
  Clock,
  Send,
  Loader2,
  X,
  ShieldAlert,
  Bot,
  LogOut,
  Settings,
  User as UserIcon
} from 'lucide-react';
import { Merchant, CheckInLog } from '../types';
import { getAIRebuttal } from '../services/gemini';
import { useAuth } from '../contexts/AuthContext';
import { ProfileSettings } from './ProfileSettings';

interface FieldAppProps {
  merchants: Merchant[];
  routeOrder: string[];
  routeReasoning: string;
  onRepayment: (id: string) => void;
  onCheckIn: (log: Omit<CheckInLog, 'id' | 'timestamp'>) => void;
}

export const FieldApp: React.FC<FieldAppProps> = ({
  merchants, routeOrder, routeReasoning, onRepayment, onCheckIn
}) => {
  const { userData } = useAuth();
  const [selectedMerchant, setSelectedMerchant] = useState<Merchant | null>(null);
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [chatMessage, setChatMessage] = useState('');
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'ai', text: string }[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'profile' | 'settings'>('profile');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const handleLogout = () => signOut(auth);

  const initial = userData?.firstName ? userData.firstName.charAt(0).toUpperCase() : 'F';
  const fullName = userData?.firstName ? `${userData.firstName} ${userData.lastName || ''}` : 'Field Officer';

  const sortedMerchants = [...merchants].sort((a, b) => {
    const indexA = routeOrder.indexOf(a.id);
    const indexB = routeOrder.indexOf(b.id);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });

  useEffect(() => {
    if (isChatting) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, isChatting, isTyping]);

  const handleChat = async () => {
    if (!chatMessage.trim() || !selectedMerchant) return;
    const userMsg = chatMessage.trim();
    setChatHistory([...chatHistory, { role: 'user', text: userMsg }]);
    setChatMessage('');
    setIsTyping(true);

    try {
      const aiResponse = await getAIRebuttal(selectedMerchant.name, userMsg);
      setChatHistory(prev => [...prev, { role: 'ai', text: aiResponse || 'Error generating response.' }]);
    } catch (e) {
      setChatHistory(prev => [...prev, { role: 'ai', text: "Network error while connecting to Rill Intelligence." }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="max-w-md mx-auto bg-slate-50 min-h-screen pb-24 font-sans selection:bg-indigo-500/30">
      <header className="bg-white/80 backdrop-blur-xl p-6 border-b border-slate-200/50 flex flex-col gap-4 sticky top-0 z-10 shadow-sm">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">Field Ops</h1>
            <p className="text-slate-500 text-xs font-semibold tracking-wider uppercase mt-1">Officer: {fullName}</p>
          </div>

          <div className="flex items-center gap-4">
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-3 rounded-2xl shadow-lg shadow-indigo-200 hidden sm:block">
              <Smartphone className="w-5 h-5 text-white" />
            </div>

            {/* Avatar Dropdown in top right */}
            <div className="relative">
              <button onClick={() => setIsProfileOpen(!isProfileOpen)} className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700 font-bold border border-indigo-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-all">
                {initial}
              </button>
              <AnimatePresence>
                {isProfileOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="absolute top-12 right-0 w-48 bg-white border border-slate-200 shadow-xl rounded-2xl py-2 z-50 origin-top-right"
                  >
                    <div className="px-4 py-2 border-b border-slate-100 mb-2">
                      <p className="text-sm font-bold text-slate-900 truncate">{fullName}</p>
                      <p className="text-[10px] text-slate-500">Field Officer</p>
                    </div>
                    <button
                      onClick={() => { setIsSettingsModalOpen(true); setSettingsTab('profile'); setIsProfileOpen(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900 flex items-center gap-2"
                    >
                      <UserIcon className="w-4 h-4" /> Profile
                    </button>
                    <button
                      onClick={() => { setIsSettingsModalOpen(true); setSettingsTab('settings'); setIsProfileOpen(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900 flex items-center gap-2"
                    >
                      <Settings className="w-4 h-4" /> Settings
                    </button>
                    <div className="h-px bg-slate-100 my-2"></div>
                    <button onClick={handleLogout} className="w-full text-left px-4 py-2 text-sm text-rose-600 hover:bg-rose-50 flex items-center gap-2">
                      <LogOut className="w-4 h-4" /> Log out
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {routeReasoning && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative overflow-hidden bg-gradient-to-r from-indigo-50 to-purple-50 p-4 rounded-2xl border border-indigo-100/50 flex gap-3 flex-col"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none" />
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-4 h-4 text-indigo-600 drop-shadow-sm" fill="currentColor" />
              <span className="text-xs font-bold text-indigo-900 uppercase tracking-widest">Rill Intelligence</span>
            </div>
            <p className="text-sm text-indigo-900 leading-relaxed font-medium">
              {routeReasoning}
            </p>
          </motion.div>
        )}
      </header>

      <main className="p-4 space-y-4">
        {sortedMerchants.map((merchant, idx) => (
          <motion.div
            key={merchant.id}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ delay: idx * 0.05, type: 'spring', stiffness: 300, damping: 25 }}
            onClick={() => setSelectedMerchant(merchant)}
            className={`relative group bg-white p-5 rounded-3xl transition-all cursor-pointer overflow-hidden ${selectedMerchant?.id === merchant.id
              ? "shadow-xl shadow-indigo-100 ring-2 ring-indigo-500/50"
              : "border border-slate-200/60 hover:border-slate-300 hover:shadow-md"
              }`}
          >
            {selectedMerchant?.id === merchant.id && (
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-purple-500" />
            )}

            <div className="flex justify-between items-start mb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-lg group-hover:text-indigo-600 transition-colors">{merchant.name}</h3>
                <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-1 font-medium">
                  <MapPin className="w-3.5 h-3.5 text-indigo-400" /> {merchant.location}
                </p>
              </div>
              <div className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${merchant.status === 'active' ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                merchant.status === 'at-risk' ? "bg-amber-50 text-amber-700 border border-amber-200" :
                  "bg-rose-50 text-rose-700 border border-rose-200"
                }`}>
                {merchant.status}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-5">
              <div className="bg-slate-50/80 p-3 rounded-2xl border border-slate-100">
                <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mb-1">Balance</p>
                <p className="font-mono font-bold text-slate-900 text-lg">₦{merchant.balance.toLocaleString()}</p>
              </div>
              <div className="bg-slate-50/80 p-3 rounded-2xl border border-slate-100 flex flex-col justify-center">
                <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mb-1">Streak</p>
                <div className="flex items-center gap-1.5">
                  <p className="font-mono font-bold text-slate-900 text-lg">{merchant.streak}</p>
                  {merchant.streak > 3 && <span className="text-orange-500 text-sm">🔥</span>}
                </div>
              </div>
            </div>

            <AnimatePresence>
              {selectedMerchant?.id === merchant.id && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="mt-5 pt-5 border-t border-slate-100 flex gap-3 overflow-hidden"
                >
                  <button onClick={(e) => { e.stopPropagation(); onRepayment(merchant.id); }} className="flex-1 bg-gradient-to-r from-slate-900 to-slate-800 hover:from-black hover:to-slate-900 text-white py-3 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-slate-900/20 transition-transform active:scale-95">
                    <CheckCircle2 className="w-4 h-4" /> Collect ₦{merchant.dailyInstallment.toLocaleString()}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setIsCheckingIn(true); }} className="p-3 bg-white border border-slate-200 shadow-sm hover:bg-slate-50 rounded-2xl transition-transform active:scale-95 text-indigo-600">
                    <Clock className="w-5 h-5" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setIsChatting(true); }} className="p-3 bg-white border border-slate-200 shadow-sm hover:bg-slate-50 rounded-2xl transition-transform active:scale-95 text-purple-600 relative overflow-hidden group/chat">
                    <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/10 to-purple-500/10 opacity-0 group-hover/chat:opacity-100 transition-opacity" />
                    <MessageSquare className="w-5 h-5 relative z-10" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ))}
      </main>

      <AnimatePresence>
        {isCheckingIn && (
          <motion.div
            initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
            animate={{ opacity: 1, backdropFilter: 'blur(8px)' }}
            exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
            className="fixed inset-0 bg-slate-900/40 z-50 flex items-end p-4 sm:p-6"
          >
            <motion.div
              initial={{ y: "100%", scale: 0.95 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: "100%", scale: 0.95 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="bg-white w-full rounded-3xl p-6 shadow-2xl relative overflow-hidden"
            >
              <button
                onClick={() => setIsCheckingIn(false)}
                className="absolute top-6 right-6 p-2 bg-slate-100 rounded-full text-slate-500 hover:bg-slate-200 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
              <h2 className="text-2xl font-bold mb-6 text-slate-900 flex items-center gap-2">
                <ShieldAlert className="w-6 h-6 text-indigo-500" />
                Environmental Audit
              </h2>

              <form onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                onCheckIn({
                  merchantId: selectedMerchant!.id,
                  mood: fd.get('mood') as any,
                  stockLevel: fd.get('stockLevel') as any,
                  marketTraffic: fd.get('marketTraffic') as any,
                  notes: fd.get('notes') as string,
                });
                setIsCheckingIn(false);
              }} className="space-y-4 relative z-10">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">Merchant Mood</label>
                  <select name="mood" className="w-full p-4 bg-slate-50 border border-slate-200 hover:border-indigo-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 rounded-2xl transition-all outline-none font-medium appearance-none">
                    <option value="positive">🟢 Positive & Receptive</option>
                    <option value="neutral">🟡 Neutral / Busy</option>
                    <option value="negative">🔴 Negative / Aggressive</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">Stock Level Observation</label>
                  <select name="stockLevel" className="w-full p-4 bg-slate-50 border border-slate-200 hover:border-indigo-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 rounded-2xl transition-all outline-none font-medium appearance-none">
                    <option value="high">📦 High (Fully Stocked)</option>
                    <option value="medium">📦 Medium (Normal)</option>
                    <option value="low">📦 Low (Needs Restock)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">Market Traffic</label>
                  <select name="marketTraffic" className="w-full p-4 bg-slate-50 border border-slate-200 hover:border-indigo-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 rounded-2xl transition-all outline-none font-medium appearance-none">
                    <option value="busy">🔥 Busy</option>
                    <option value="normal">🚶 Normal</option>
                    <option value="slow">🐢 Slow</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">Additional Notes</label>
                  <textarea name="notes" rows={2} className="w-full p-4 bg-slate-50 border border-slate-200 hover:border-indigo-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 rounded-2xl transition-all outline-none resize-none font-medium placeholder:text-slate-400" placeholder="Any contextual anomalies?"></textarea>
                </div>

                <div className="pt-2">
                  <button type="submit" className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white py-4 rounded-2xl font-bold shadow-lg shadow-indigo-500/20 transition-all active:scale-[0.98]">Record Soft Data</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}

        {isChatting && (
          <motion.div
            initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
            animate={{ opacity: 1, backdropFilter: 'blur(8px)' }}
            exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
            className="fixed inset-0 bg-slate-900/60 z-50 flex flex-col justify-end p-0 sm:p-4"
          >
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="bg-slate-50 w-full h-[85vh] sm:h-[80vh] sm:rounded-3xl rounded-t-3xl flex flex-col overflow-hidden shadow-2xl relative"
            >
              {/* Header */}
              <div className="bg-white p-5 border-b border-slate-200 flex justify-between items-center shrink-0 z-10 relative">
                <div className="flex items-center gap-3">
                  <div className="bg-purple-100 p-2 rounded-xl border border-purple-200">
                    <Bot className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 leading-tight">Conflict Resolver</h2>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Powered by Gemini</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsChatting(false)}
                  className="bg-slate-100 p-2 rounded-full text-slate-500 hover:bg-slate-200 hover:text-slate-900 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Chat Area */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-slate-50 relative">
                {chatHistory.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center opacity-60">
                    <MessageSquare className="w-12 h-12 text-slate-400 mb-4" />
                    <p className="text-slate-600 font-medium max-w-[250px]">
                      Enter the merchant's excuse below to generate a firm, behavior-nudging rebuttal.
                    </p>
                  </div>
                )}

                {chatHistory.map((msg, i) => (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    key={i}
                    className={`flex ${msg.role === 'user' ? "justify-end" : "justify-start"}`}
                  >
                    <div className={`
                      max-w-[85%] p-4 rounded-3xl text-[15px] leading-relaxed relative
                      ${msg.role === 'user'
                        ? "bg-slate-900 text-white rounded-br-sm shadow-md"
                        : "bg-white text-slate-800 rounded-bl-sm border border-slate-200 shadow-sm"
                      }
                    `}>
                      {msg.role === 'ai' && (
                        <div className="absolute -left-2 -top-2 bg-purple-100 border border-purple-200 p-1 rounded-full shadow-sm">
                          <Bot className="w-3 h-3 text-purple-600" />
                        </div>
                      )}
                      {msg.text}
                    </div>
                  </motion.div>
                ))}

                {isTyping && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                    <div className="bg-white border border-slate-200 p-4 rounded-3xl rounded-bl-sm shadow-sm flex items-center gap-2">
                      <div className="flex gap-1">
                        <motion.div animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0 }} className="w-1.5 h-1.5 bg-purple-400 rounded-full" />
                        <motion.div animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.2 }} className="w-1.5 h-1.5 bg-purple-400 rounded-full" />
                        <motion.div animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.4 }} className="w-1.5 h-1.5 bg-purple-400 rounded-full" />
                      </div>
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400 ml-2">Analyzing excuse...</span>
                    </div>
                  </motion.div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Input Area */}
              <div className="p-4 bg-white border-t border-slate-200 shrink-0 shadow-[0_-10px_40px_rgba(0,0,0,0.03)] z-10 relative">
                <form
                  onSubmit={(e) => { e.preventDefault(); handleChat(); }}
                  className="flex gap-2 relative items-end"
                >
                  <textarea
                    value={chatMessage}
                    onChange={(e) => setChatMessage(e.target.value)}
                    placeholder="E.g. Market is very slow today..."
                    className="flex-1 p-4 pr-12 bg-slate-50 border border-slate-200 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/10 rounded-2xl resize-none outline-none transition-all placeholder:text-slate-400 min-h-[60px] max-h-[120px]"
                    rows={1}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleChat();
                      }
                    }}
                  />
                  <button
                    type="submit"
                    disabled={isTyping || !chatMessage.trim()}
                    className="absolute right-2 bottom-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white p-3 rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center shrink-0"
                  >
                    {isTyping ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                  </button>
                </form>
                <div className="mt-2 text-center">
                  <p className="text-[10px] text-slate-400 font-medium">Use behavior nudging to enforce repayment discipline.</p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ProfileSettings
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        initialTab={settingsTab}
      />
    </div>
  );
};
