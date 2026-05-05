import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldCheck, LayoutDashboard, Users, Smartphone, Mail, Lock, User as UserIcon, ArrowRight } from 'lucide-react';
import { UserRole } from '../types';
import { auth, db } from '../firebase';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';

export const Onboarding: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState<UserRole>('lender');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { setRole } = useAuth();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        // Role will be fetched by AuthContext automatically
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Save role to Firestore
        await setDoc(doc(db, 'users', user.uid), {
          firstName,
          lastName,
          email,
          role: selectedRole,
          createdAt: new Date().toISOString()
        });

        setRole(selectedRole);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const roles = [
    { id: 'lender', title: 'The Lender', icon: LayoutDashboard, color: 'bg-indigo-50 text-indigo-600' },
    { id: 'admin', title: 'Admin', icon: Users, color: 'bg-emerald-50 text-emerald-600' },
    { id: 'co', title: 'Field CO', icon: Smartphone, color: 'bg-amber-50 text-amber-600' },
  ];

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full"
      >
        <div className="flex items-center justify-center gap-2 mb-12">
          <div className="w-12 h-12 bg-zinc-900 rounded-2xl flex items-center justify-center shadow-lg">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <span className="font-bold text-4xl tracking-tight">RILL</span>
        </div>

        <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-xl">
          <h2 className="text-2xl font-bold text-zinc-900 mb-2">
            {isLogin ? 'Welcome Back' : 'Create Account'}
          </h2>
          <p className="text-zinc-500 text-sm mb-8">
            {isLogin ? 'Enter your credentials to access your dashboard.' : 'Join the repayment discipline infrastructure.'}
          </p>

          <form onSubmit={handleAuth} className="space-y-4">
            {error && (
              <div className="p-3 bg-rose-50 text-rose-600 text-xs font-bold rounded-xl border border-rose-100">
                {error}
              </div>
            )}

            {!isLogin && (
              <div className="flex gap-4">
                <div className="space-y-1 flex-1">
                  <label className="text-[10px] font-bold uppercase text-zinc-400 ml-1">First Name</label>
                  <div className="relative">
                    <UserIcon className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input
                      type="text"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="w-full pl-11 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:ring-1 ring-zinc-900 placeholder:text-zinc-300"
                      placeholder="John"
                    />
                  </div>
                </div>
                <div className="space-y-1 flex-1">
                  <label className="text-[10px] font-bold uppercase text-zinc-400 ml-1">Last Name</label>
                  <div className="relative">
                    <UserIcon className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input
                      type="text"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="w-full pl-11 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:ring-1 ring-zinc-900 placeholder:text-zinc-300"
                      placeholder="Doe"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-zinc-400 ml-1">Email Address</label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:ring-1 ring-zinc-900"
                  placeholder="name@company.com"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-zinc-400 ml-1">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:ring-1 ring-zinc-900"
                  placeholder="••••••••"
                />
              </div>
            </div>

            {!isLogin && (
              <div className="space-y-3 pt-2">
                <label className="text-[10px] font-bold uppercase text-zinc-400 ml-1">Select Your Role</label>
                <div className="grid grid-cols-3 gap-2">
                  {roles.map((role) => (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => setSelectedRole(role.id as UserRole)}
                      className={`p-3 rounded-2xl border transition-all flex flex-col items-center gap-2 ${selectedRole === role.id ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-zinc-50 border-zinc-200 text-zinc-400 hover:border-zinc-300'
                        }`}
                    >
                      <role.icon className="w-5 h-5" />
                      <span className="text-[10px] font-bold">{role.title.split(' ')[0]}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-zinc-900 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-zinc-800 transition-all disabled:opacity-50 mt-4"
            >
              {loading ? 'Processing...' : (isLogin ? 'Sign In' : 'Create Account')}
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-zinc-100 text-center">
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="text-sm font-bold text-zinc-500 hover:text-zinc-900 transition-colors"
            >
              {isLogin ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
            </button>
          </div>
        </div>
      </motion.div>

      <p className="mt-12 text-zinc-400 text-xs font-mono uppercase tracking-widest">
        Repayment Discipline Infrastructure • v1.0
      </p>
    </div>
  );
};
