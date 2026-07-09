import React, { useCallback, useEffect, useState } from 'react';
import { Banknote, CircleAlert, Loader2, LogOut, RefreshCw, ShieldCheck, UserX, UserCheck } from 'lucide-react';
import {
  adminLogin,
  disburse,
  getEscalations,
  getToken,
  getUsers,
  setToken,
  setUserStatus,
  type AdminUser,
  type Escalation
} from './services/adminApi';

// Rill Admin Console — minimal by design. One job: let a Supplya admin put
// money on merchants' books (disburse), manage status, and watch escalations.
// COs work from the mobile app; this is not a CO surface.

function LoginScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await adminLogin(email.trim(), password);
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-8 w-full max-w-md space-y-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-8 h-8 text-indigo-600" />
          <div>
            <h1 className="text-xl font-bold text-zinc-900">Rill Admin</h1>
            <p className="text-sm text-zinc-500">Sign in with your Supplya admin account</p>
          </div>
        </div>
        <input
          className="w-full border border-zinc-200 rounded-xl px-4 py-3 text-sm"
          type="email"
          placeholder="Supplya admin email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="w-full border border-zinc-200 rounded-xl px-4 py-3 text-sm"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-zinc-900 text-white rounded-xl py-3 font-semibold text-sm disabled:opacity-60 flex justify-center"
        >
          {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

function DisburseModal({
  user,
  onClose,
  onDone
}: {
  user: AdminUser;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [installment, setInstallment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseInt(amount, 10);
    const inst = parseInt(installment, 10);
    if (!Number.isInteger(amt) || amt <= 0 || !Number.isInteger(inst) || inst <= 0) {
      setError('Amount and daily installment must be whole numbers above zero.');
      return;
    }
    if (!window.confirm(`Disburse NGN ${amt.toLocaleString()} to ${user.name} (daily NGN ${inst.toLocaleString()})?`)) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await disburse(user.id, amt, inst);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disbursement failed');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50">
      <form onSubmit={submit} className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4">
        <h2 className="font-bold text-zinc-900">Disburse to {user.name}</h2>
        <p className="text-xs text-zinc-500">
          Current: owed NGN {user.totalOwed.toLocaleString()} · balance NGN {user.balance.toLocaleString()} · status {user.status}
        </p>
        <input
          className="w-full border border-zinc-200 rounded-xl px-4 py-3 text-sm"
          inputMode="numeric"
          placeholder="Amount (NGN)"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
          required
        />
        <input
          className="w-full border border-zinc-200 rounded-xl px-4 py-3 text-sm"
          inputMode="numeric"
          placeholder="Daily installment (NGN)"
          value={installment}
          onChange={(e) => setInstallment(e.target.value.replace(/[^0-9]/g, ''))}
          required
        />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 border border-zinc-200 rounded-xl py-2.5 text-sm font-medium">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="flex-1 bg-indigo-600 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60">
            {busy ? 'Working…' : 'Disburse'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Dashboard({ onSignedOut }: { onSignedOut: () => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [disburseTarget, setDisburseTarget] = useState<AdminUser | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [u, e] = await Promise.all([getUsers(), getEscalations()]);
      setUsers(u);
      setEscalations(e);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load';
      setError(message);
      if (/session expired/i.test(message)) onSignedOut();
    } finally {
      setLoading(false);
    }
  }, [onSignedOut]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggleStatus = async (user: AdminUser) => {
    const next = user.status === 'deactivated' ? 'active' : 'deactivated';
    if (!window.confirm(`Set ${user.name} to ${next}?`)) return;
    try {
      await setUserStatus(user.id, next);
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const signOut = () => {
    setToken(null);
    onSignedOut();
  };

  const statusBadge = (status: AdminUser['status']) => {
    const map = {
      pending: 'bg-zinc-100 text-zinc-600',
      active: 'bg-green-100 text-green-700',
      deactivated: 'bg-red-100 text-red-700'
    } as const;
    return <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${map[status]}`}>{status}</span>;
  };

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="bg-white border-b border-zinc-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-indigo-600" />
          <h1 className="font-bold text-zinc-900">Rill Admin</h1>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={refresh} className="flex items-center gap-1.5 text-sm text-zinc-600 hover:text-zinc-900">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button onClick={signOut} className="flex items-center gap-1.5 text-sm text-red-600">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </header>

      <main className="p-6 max-w-6xl mx-auto space-y-8">
        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <section>
          <h2 className="text-sm font-bold text-zinc-500 uppercase mb-3">Merchants</h2>
          <div className="bg-white rounded-2xl border border-zinc-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500 border-b border-zinc-100">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Owed</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3 text-right">Daily</th>
                  <th className="px-4 py-3">Last payment</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-zinc-50">
                    <td className="px-4 py-3 font-medium text-zinc-900">{u.name}</td>
                    <td className="px-4 py-3 text-zinc-500">{u.location}</td>
                    <td className="px-4 py-3">{statusBadge(u.status)}</td>
                    <td className="px-4 py-3 text-right">₦{u.totalOwed.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-semibold">₦{u.balance.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">₦{u.dailyInstallment.toLocaleString()}</td>
                    <td className="px-4 py-3 text-zinc-500">{u.lastPaymentDate || 'Never'}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setDisburseTarget(u)}
                          disabled={u.status === 'deactivated'}
                          className="flex items-center gap-1 text-xs font-semibold text-indigo-600 disabled:opacity-40"
                          title="Disburse"
                        >
                          <Banknote className="w-4 h-4" /> Disburse
                        </button>
                        <button
                          onClick={() => toggleStatus(u)}
                          className="flex items-center gap-1 text-xs font-semibold text-zinc-600"
                          title={u.status === 'deactivated' ? 'Reactivate' : 'Deactivate'}
                        >
                          {u.status === 'deactivated' ? <UserCheck className="w-4 h-4" /> : <UserX className="w-4 h-4" />}
                          {u.status === 'deactivated' ? 'Activate' : 'Deactivate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-zinc-400">
                      No merchants yet — COs add them from the mobile app.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-bold text-zinc-500 uppercase mb-3">Escalations</h2>
          <div className="bg-white rounded-2xl border border-zinc-200 divide-y divide-zinc-50">
            {escalations.length === 0 ? (
              <p className="px-4 py-6 text-sm text-zinc-400 text-center">No escalations.</p>
            ) : (
              escalations.map((e) => (
                <div key={e.id} className="px-4 py-3 flex items-start gap-3">
                  <CircleAlert className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-zinc-900">
                      {e.userName || 'Unknown merchant'} — {e.reason}
                    </p>
                    <p className="text-xs text-zinc-400">{new Date(e.timestamp).toLocaleString()}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      {disburseTarget ? (
        <DisburseModal
          user={disburseTarget}
          onClose={() => setDisburseTarget(null)}
          onDone={() => {
            setDisburseTarget(null);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

export default function App() {
  const [signedIn, setSignedIn] = useState<boolean>(() => !!getToken());

  return signedIn ? (
    <Dashboard onSignedOut={() => setSignedIn(false)} />
  ) : (
    <LoginScreen onSignedIn={() => setSignedIn(true)} />
  );
}
