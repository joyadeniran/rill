import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  Camera,
  KeyRound,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  UserX,
  Wallet
} from 'lucide-react';
import {
  ApiError,
  NetworkError,
  adminLogin,
  assignDefaulter,
  changePassword,
  createOfficer,
  deleteUser,
  disburse,
  fetchPhotoObjectUrl,
  getDefaulters,
  getEscalations,
  getOfficers,
  getStoredOfficer,
  getToken,
  getUserPhotos,
  getUsers,
  lenderLogin,
  setUserStatus,
  signOut,
  updateOfficer,
  type AdminOfficer,
  type AdminUser,
  type Defaulter,
  type Escalation,
  type PhotoMeta
} from './services/adminApi';
import { Badge, Banner, Button, EmptyState, Field, Loading, Modal, inputClass, ngn, sinceLabel } from './components/ui';

/**
 * Rill Console — the web surface for the two non-field roles.
 *
 *   admin  — Supplya admin. Money (disbursement), merchant lifecycle,
 *            defaulter assignment, officer provisioning.
 *   lender — capital provider. Read-only oversight of the same portfolio.
 *
 * COs work from the mobile app; this is deliberately not a CO surface.
 *
 * Every async action here follows the same contract: disable while in flight,
 * surface server field errors against the offending input, and confirm success
 * explicitly. Silence is never an acceptable outcome of a click.
 */

/** Turn any thrown value into {message, fields} the UI can render. */
function describeError(err: unknown): { message: string; fields: Record<string, string> } {
  if (err instanceof ApiError) return { message: err.message, fields: err.fields };
  if (err instanceof NetworkError) return { message: err.message, fields: {} };
  return { message: err instanceof Error ? err.message : 'Something went wrong.', fields: {} };
}

// ---------------------------------------------------------------- login

function LoginScreen({ onSignedIn }: { onSignedIn: (o: AdminOfficer) => void }) {
  const [mode, setMode] = useState<'admin' | 'lender'>('admin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setFields({});
    try {
      // Password forwarded exactly as typed — never trim a password.
      const officer = mode === 'admin' ? await adminLogin(email.trim(), password) : await lenderLogin(email.trim(), password);
      onSignedIn(officer);
    } catch (err) {
      const d = describeError(err);
      setError(d.message);
      setFields(d.fields);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-8 w-full max-w-md space-y-5">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-8 h-8 text-indigo-600" />
          <div>
            <h1 className="text-xl font-bold text-zinc-900">Rill Console</h1>
            <p className="text-sm text-zinc-500">Credit oversight for Supplya</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1 bg-zinc-100 p-1 rounded-xl">
          {(['admin', 'lender'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError('');
                setFields({});
              }}
              className={`py-2 rounded-lg text-sm font-semibold transition ${
                mode === m ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              {m === 'admin' ? 'Supplya Admin' : 'Lender'}
            </button>
          ))}
        </div>

        <p className="text-xs text-zinc-500">
          {mode === 'admin'
            ? 'Sign in with your existing Supplya admin account. Rill stores no admin credentials.'
            : 'Sign in with the lender account your administrator created for you.'}
        </p>

        <Field label="Email" error={fields.email} required>
          <input
            className={inputClass(!!fields.email)}
            type="email"
            autoComplete="username"
            placeholder="you@supplya.shop"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>

        <Field label="Password" error={fields.password} required>
          <input
            className={inputClass(!!fields.password)}
            type="password"
            autoComplete="current-password"
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>

        {error ? <Banner tone="error">{error}</Banner> : null}

        <Button type="submit" busy={busy} className="w-full">
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- modals

function DisburseModal({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: (msg: string) => void }) {
  const [amount, setAmount] = useState('');
  const [installment, setInstallment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setFields({});
    try {
      await disburse(user.id, Number(amount), Number(installment));
      onDone(`${ngn(Number(amount))} disbursed to ${user.name}.`);
    } catch (err) {
      const d = describeError(err);
      setError(d.message);
      setFields(d.fields);
    } finally {
      setBusy(false);
    }
  };

  const days = Number(amount) > 0 && Number(installment) > 0 ? Math.ceil(Number(amount) / Number(installment)) : null;

  return (
    <Modal title="Disburse credit" subtitle={`${user.name} · ${user.location}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Amount (₦)" error={fields.amount} required>
          <input
            className={inputClass(!!fields.amount)}
            type="number"
            min={1}
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </Field>
        <Field label="Daily installment (₦)" error={fields.dailyInstallment} hint={days ? `Repaid over about ${days} days.` : undefined} required>
          <input
            className={inputClass(!!fields.dailyInstallment)}
            type="number"
            min={1}
            inputMode="numeric"
            value={installment}
            onChange={(e) => setInstallment(e.target.value)}
            required
          />
        </Field>

        {user.balance > 0 ? (
          <Banner tone="info">
            This merchant already owes {ngn(user.balance)}. Disbursing adds to that balance.
          </Banner>
        ) : null}
        {error ? <Banner tone="error">{error}</Banner> : null}

        <div className="flex gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button type="submit" busy={busy} className="flex-1">
            {busy ? 'Disbursing…' : 'Disburse'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function AssignModal({
  defaulter,
  officers,
  onClose,
  onDone
}: {
  defaulter: Defaulter;
  officers: AdminOfficer[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [officerId, setOfficerId] = useState(defaulter.assignedCoId || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});

  // Only active COs can actually collect — a lender or a disabled account
  // would create a merchant nobody works.
  const eligible = officers.filter((o) => o.role === 'co' && o.active !== false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setFields({});
    try {
      await assignDefaulter(defaulter.id, officerId || null);
      const who = eligible.find((o) => o.id === officerId);
      onDone(officerId ? `${defaulter.name} assigned to ${who?.firstName} ${who?.lastName}.` : `${defaulter.name} returned to the unassigned pool.`);
    } catch (err) {
      const d = describeError(err);
      setError(d.message);
      setFields(d.fields);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Assign to officer" subtitle={`${defaulter.name} · owes ${ngn(defaulter.balance)}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {eligible.length === 0 ? (
          <Banner tone="offline">
            There are no active collection officers to assign to. Create one under Officers first.
          </Banner>
        ) : (
          <Field label="Collection officer" error={fields.officerId} hint="Leave blank to return this merchant to the shared pool.">
            <select className={inputClass(!!fields.officerId)} value={officerId} onChange={(e) => setOfficerId(e.target.value)}>
              <option value="">— Unassigned —</option>
              {eligible.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.firstName} {o.lastName} ({o.email})
                </option>
              ))}
            </select>
          </Field>
        )}

        {error ? <Banner tone="error">{error}</Banner> : null}

        <div className="flex gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button type="submit" busy={busy} disabled={eligible.length === 0} className="flex-1">
            {busy ? 'Saving…' : 'Save assignment'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function NewOfficerModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', role: 'co' as 'co' | 'lender' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setFields({});
    try {
      await createOfficer(form);
      onDone(`${form.firstName} ${form.lastName} can now sign in as a ${form.role === 'co' ? 'collection officer' : 'lender'}.`);
    } catch (err) {
      const d = describeError(err);
      setError(d.message);
      setFields(d.fields);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New officer" subtitle="Create a field officer or a lender account" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" error={fields.firstName} required>
            <input className={inputClass(!!fields.firstName)} value={form.firstName} onChange={set('firstName')} required />
          </Field>
          <Field label="Last name" error={fields.lastName} required>
            <input className={inputClass(!!fields.lastName)} value={form.lastName} onChange={set('lastName')} required />
          </Field>
        </div>
        <Field label="Email" error={fields.email} required>
          <input className={inputClass(!!fields.email)} type="email" value={form.email} onChange={set('email')} required />
        </Field>
        <Field label="Temporary password" error={fields.password} hint="At least 6 characters. They can change it after signing in." required>
          <input className={inputClass(!!fields.password)} type="text" value={form.password} onChange={set('password')} required />
        </Field>
        <Field label="Role" error={fields.role} hint="Admin accounts are managed in Supplya, not here.">
          <select className={inputClass(!!fields.role)} value={form.role} onChange={set('role')}>
            <option value="co">Collection Officer — field work on the mobile app</option>
            <option value="lender">Lender — read-only portfolio oversight</option>
          </select>
        </Field>

        {error ? <Banner tone="error">{error}</Banner> : null}

        <div className="flex gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button type="submit" busy={busy} className="flex-1">
            {busy ? 'Creating…' : 'Create officer'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PasswordModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Caught client-side because the server never sees `confirm` — this is the
    // one validation the API genuinely cannot do for us.
    if (newPassword !== confirm) {
      setFields({ confirm: 'These passwords do not match' });
      setError('Please confirm your new password.');
      return;
    }
    setBusy(true);
    setError('');
    setFields({});
    try {
      await changePassword(currentPassword, newPassword);
      onDone('Your password has been changed.');
    } catch (err) {
      const d = describeError(err);
      setError(d.message);
      setFields(d.fields);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Change password" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Current password" error={fields.currentPassword} required>
          <input className={inputClass(!!fields.currentPassword)} type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field label="New password" error={fields.newPassword} hint="At least 6 characters." required>
          <input className={inputClass(!!fields.newPassword)} type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNew(e.target.value)} required />
        </Field>
        <Field label="Confirm new password" error={fields.confirm} required>
          <input className={inputClass(!!fields.confirm)} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </Field>

        {error ? <Banner tone="error">{error}</Banner> : null}

        <div className="flex gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button type="submit" busy={busy} className="flex-1">
            {busy ? 'Saving…' : 'Change password'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PhotoThumb({ photo }: { photo: PhotoMeta }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    fetchPhotoObjectUrl(photo.id)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        revoked = u;
        setUrl(u);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      // Object URLs leak the whole blob until revoked.
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [photo.id]);

  return (
    <figure className="space-y-1">
      <div className="aspect-square rounded-xl bg-zinc-100 overflow-hidden flex items-center justify-center">
        {failed ? (
          <span className="text-[11px] text-zinc-400 px-2 text-center">Unavailable</span>
        ) : url ? (
          <img src={url} alt={photo.caption || `${photo.kind} photo`} className="w-full h-full object-cover" />
        ) : (
          <div className="w-5 h-5 border-2 border-zinc-300 border-t-transparent rounded-full animate-spin" />
        )}
      </div>
      <figcaption className="text-[11px] text-zinc-500 truncate" title={photo.caption || photo.kind}>
        {photo.caption || photo.kind}
      </figcaption>
    </figure>
  );
}

function PhotosModal({ user, onClose }: { user: { id: string; name: string }; onClose: () => void }) {
  const [photos, setPhotos] = useState<PhotoMeta[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getUserPhotos(user.id)
      .then(setPhotos)
      .catch((err) => setError(describeError(err).message));
  }, [user.id]);

  return (
    <Modal title="Field evidence" subtitle={user.name} onClose={onClose}>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {!photos && !error ? <Loading label="Loading photos…" /> : null}
      {photos && photos.length === 0 ? (
        <EmptyState title="No photos yet" hint="Photos captured by field officers during audits and payments appear here." icon={<Camera className="w-10 h-10" />} />
      ) : null}
      {photos && photos.length > 0 ? (
        <div className="grid grid-cols-3 gap-3">
          {photos.map((p) => (
            <PhotoThumb key={p.id} photo={p} />
          ))}
        </div>
      ) : null}
      <Button variant="secondary" onClick={onClose} className="w-full">
        Close
      </Button>
    </Modal>
  );
}

// ---------------------------------------------------------------- views

function statusTone(status: string) {
  return status === 'active' ? 'green' : status === 'pending' ? 'amber' : 'zinc';
}

function PortfolioView({
  users,
  canAct,
  onDisburse,
  onToggleStatus,
  onPhotos,
  onDelete,
  pendingId
}: {
  users: AdminUser[];
  canAct: boolean;
  onDisburse: (u: AdminUser) => void;
  onToggleStatus: (u: AdminUser) => void;
  onPhotos: (u: AdminUser) => void;
  onDelete: (u: AdminUser) => void;
  pendingId: string | null;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return users;
    return users.filter((u) => u.name.toLowerCase().includes(t) || u.location.toLowerCase().includes(t) || (u.phone || '').includes(t));
  }, [users, q]);

  if (users.length === 0) {
    return <EmptyState title="No merchants yet" hint="Merchants appear here once a collection officer adds them from the field app." icon={<Users className="w-10 h-10" />} />;
  }

  return (
    <div className="space-y-4">
      <input className={inputClass()} placeholder="Search by name, location or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
      {filtered.length === 0 ? (
        <EmptyState title="No matches" hint={`Nothing matches “${q}”.`} />
      ) : (
        <div className="space-y-2">
          {filtered.map((u) => (
            <div key={u.id} className="bg-white border border-zinc-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[180px]">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-zinc-900">{u.name}</p>
                  <Badge tone={statusTone(u.status)}>{u.status}</Badge>
                </div>
                <p className="text-xs text-zinc-500">
                  {u.location}
                  {u.phone ? ` · ${u.phone}` : ''}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-zinc-900">{ngn(u.balance)}</p>
                <p className="text-[11px] text-zinc-500">of {ngn(u.totalOwed)} owed</p>
              </div>
              <div className="flex gap-1.5">
                <Button variant="ghost" onClick={() => onPhotos(u)} title="View field photos">
                  <Camera className="w-4 h-4" />
                </Button>
                {canAct ? (
                  <>
                    <Button variant="secondary" onClick={() => onDisburse(u)}>
                      <Banknote className="w-4 h-4" /> Disburse
                    </Button>
                    <Button variant="ghost" busy={pendingId === u.id} onClick={() => onToggleStatus(u)} title={u.status === 'deactivated' ? 'Reactivate' : 'Deactivate'}>
                      {u.status === 'deactivated' ? <UserCheck className="w-4 h-4" /> : <UserX className="w-4 h-4" />}
                    </Button>
                    <Button variant="ghost" onClick={() => onDelete(u)} title="Delete merchant and all records">
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DefaultersView({
  defaulters,
  canAct,
  onAssign
}: {
  defaulters: Defaulter[];
  canAct: boolean;
  onAssign: (d: Defaulter) => void;
}) {
  if (defaulters.length === 0) {
    return <EmptyState title="No defaulters" hint="Every active merchant with a balance has paid within the last 48 hours." icon={<ShieldCheck className="w-10 h-10" />} />;
  }
  return (
    <div className="space-y-2">
      <Banner tone="info">
        {defaulters.length} merchant{defaulters.length === 1 ? '' : 's'} with an outstanding balance and no payment in over 48 hours. Worst first.
      </Banner>
      {defaulters.map((d) => (
        <div key={d.id} className="bg-white border border-zinc-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[180px]">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-zinc-900">{d.name}</p>
              <Badge tone={d.neverPaid ? 'red' : 'amber'}>{sinceLabel(d.hoursSinceLastPayment, d.neverPaid)}</Badge>
            </div>
            <p className="text-xs text-zinc-500">
              {d.location}
              {d.phone ? ` · ${d.phone}` : ''}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-red-600">{ngn(d.balance)}</p>
            <p className="text-[11px] text-zinc-500">{ngn(d.dailyInstallment)}/day</p>
          </div>
          <div className="min-w-[150px] text-right">
            {d.assignedCoName ? (
              <Badge tone="indigo">{d.assignedCoName}</Badge>
            ) : (
              <span className="text-[11px] text-zinc-400">Unassigned</span>
            )}
          </div>
          {canAct ? (
            <Button variant="secondary" onClick={() => onAssign(d)}>
              <UserCheck className="w-4 h-4" /> Assign
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function OfficersView({
  officers,
  onNew,
  onToggle,
  pendingId
}: {
  officers: AdminOfficer[];
  onNew: () => void;
  onToggle: (o: AdminOfficer) => void;
  pendingId: string | null;
}) {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-zinc-500">{officers.length} account{officers.length === 1 ? '' : 's'}</p>
        <Button onClick={onNew}>
          <UserPlus className="w-4 h-4" /> New officer
        </Button>
      </div>
      {officers.length === 0 ? (
        <EmptyState title="No officers yet" hint="Create a collection officer so merchants can be assigned." />
      ) : (
        <div className="space-y-2">
          {officers.map((o) => (
            <div key={o.id} className="bg-white border border-zinc-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[180px]">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-zinc-900">
                    {o.firstName} {o.lastName}
                  </p>
                  <Badge tone={o.role === 'admin' ? 'indigo' : o.role === 'lender' ? 'amber' : 'green'}>{o.role}</Badge>
                  {o.active === false ? <Badge tone="zinc">deactivated</Badge> : null}
                </div>
                <p className="text-xs text-zinc-500">{o.email}</p>
              </div>
              {o.role === 'admin' ? (
                <span className="text-[11px] text-zinc-400">Managed in Supplya</span>
              ) : (
                <Button variant={o.active === false ? 'secondary' : 'ghost'} busy={pendingId === o.id} onClick={() => onToggle(o)}>
                  {o.active === false ? 'Reactivate' : 'Deactivate'}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EscalationsView({ escalations }: { escalations: Escalation[] }) {
  if (escalations.length === 0) {
    return <EmptyState title="No escalations" hint="Escalations raised by field officers appear here." icon={<AlertTriangle className="w-10 h-10" />} />;
  }
  return (
    <div className="space-y-2">
      {escalations.map((e) => (
        <div key={e.id} className="bg-white border border-zinc-200 rounded-xl p-4">
          <div className="flex justify-between items-start gap-3">
            <div>
              <p className="font-semibold text-zinc-900">{e.userName || 'Unknown merchant'}</p>
              <p className="text-sm text-zinc-600 mt-0.5">{e.reason}</p>
            </div>
            <span className="text-[11px] text-zinc-400 shrink-0">{new Date(e.timestamp).toLocaleString()}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- shell

type Tab = 'portfolio' | 'defaulters' | 'officers' | 'escalations';

export default function App() {
  const [officer, setOfficer] = useState<AdminOfficer | null>(() => (getToken() ? getStoredOfficer() : null));
  const [tab, setTab] = useState<Tab>('portfolio');

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [defaulters, setDefaulters] = useState<Defaulter[]>([]);
  const [officers, setOfficers] = useState<AdminOfficer[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);

  const [disburseFor, setDisburseFor] = useState<AdminUser | null>(null);
  const [assignFor, setAssignFor] = useState<Defaulter | null>(null);
  const [photosFor, setPhotosFor] = useState<AdminUser | null>(null);
  const [newOfficer, setNewOfficer] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const isAdmin = officer?.role === 'admin';

  const load = useCallback(async () => {
    if (!officer) return;
    setLoading(true);
    setError('');
    try {
      // Officers is admin-only; a lender requesting it would 403 and blank the
      // whole console, so it is only fetched for admins.
      const [u, d, e, o] = await Promise.all([
        getUsers(),
        getDefaulters(),
        getEscalations(),
        officer.role === 'admin' ? getOfficers() : Promise.resolve([] as AdminOfficer[])
      ]);
      setUsers(u);
      setDefaulters(d);
      setEscalations(e);
      setOfficers(o);
    } catch (err) {
      const d = describeError(err);
      setError(d.message);
      // A 401 means the token is dead — drop straight back to sign-in rather
      // than leaving an empty console the user cannot refresh out of.
      if (err instanceof ApiError && err.status === 401) {
        signOut();
        setOfficer(null);
      }
    } finally {
      setLoading(false);
    }
  }, [officer]);

  useEffect(() => {
    void load();
  }, [load]);

  // Success banners are transient; an unread one from 5 minutes ago is noise.
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(''), 6000);
    return () => clearTimeout(t);
  }, [success]);

  const afterAction = (msg: string) => {
    setSuccess(msg);
    setDisburseFor(null);
    setAssignFor(null);
    setNewOfficer(false);
    setChangingPassword(false);
    void load();
  };

  const runOn = async (id: string, fn: () => Promise<unknown>, msg: string) => {
    setPendingId(id);
    setError('');
    try {
      await fn();
      setSuccess(msg);
      await load();
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setPendingId(null);
    }
  };

  if (!officer) {
    return (
      <LoginScreen
        onSignedIn={(o) => {
          setOfficer(o);
          setTab('portfolio');
        }}
      />
    );
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'portfolio', label: 'Portfolio', count: users.length },
    { id: 'defaulters', label: 'Defaulters', count: defaulters.length },
    ...(isAdmin ? [{ id: 'officers' as Tab, label: 'Officers', count: officers.length }] : []),
    { id: 'escalations', label: 'Escalations', count: escalations.length }
  ];

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-3">
          <Wallet className="w-6 h-6 text-indigo-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-zinc-900 leading-tight">Rill Console</h1>
            <p className="text-xs text-zinc-500 truncate">
              {officer.firstName} {officer.lastName} · {officer.role === 'admin' ? 'Supplya Admin' : 'Lender'}
            </p>
          </div>
          <Button variant="ghost" onClick={() => setChangingPassword(true)} title="Change password">
            <KeyRound className="w-4 h-4" />
          </Button>
          <Button variant="ghost" busy={loading} onClick={() => void load()} title="Refresh">
            {loading ? null : <RefreshCw className="w-4 h-4" />}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              signOut();
              setOfficer(null);
            }}
          >
            <LogOut className="w-4 h-4" /> Sign out
          </Button>
        </div>
        <div className="max-w-5xl mx-auto px-6 flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm font-semibold border-b-2 whitespace-nowrap transition ${
                tab === t.id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-zinc-500 hover:text-zinc-800'
              }`}
            >
              {t.label}
              {typeof t.count === 'number' ? <span className="ml-1.5 text-xs text-zinc-400">{t.count}</span> : null}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-4">
        {!isAdmin ? (
          <Banner tone="info">You have read-only oversight. Disbursement, assignment and officer management are admin actions.</Banner>
        ) : null}
        {error ? (
          <Banner tone="error" onDismiss={() => setError('')}>
            {error}
          </Banner>
        ) : null}
        {success ? (
          <Banner tone="success" onDismiss={() => setSuccess('')}>
            {success}
          </Banner>
        ) : null}

        {loading ? (
          <Loading label="Loading portfolio…" />
        ) : (
          <>
            {tab === 'portfolio' ? (
              <PortfolioView
                users={users}
                canAct={isAdmin}
                pendingId={pendingId}
                onDisburse={setDisburseFor}
                onPhotos={setPhotosFor}
                onToggleStatus={(u) =>
                  void runOn(
                    u.id,
                    () => setUserStatus(u.id, u.status === 'deactivated' ? 'active' : 'deactivated'),
                    `${u.name} ${u.status === 'deactivated' ? 'reactivated' : 'deactivated'}.`
                  )
                }
                onDelete={(u) => {
                  // Irreversible and cascades to payments/audits/photos, so it
                  // must never be a single unconfirmed click.
                  if (!window.confirm(`Permanently delete ${u.name} and all their payments, audits and photos? This cannot be undone.`)) return;
                  void runOn(u.id, () => deleteUser(u.id), `${u.name} deleted.`);
                }}
              />
            ) : null}

            {tab === 'defaulters' ? <DefaultersView defaulters={defaulters} canAct={isAdmin} onAssign={setAssignFor} /> : null}

            {tab === 'officers' && isAdmin ? (
              <OfficersView
                officers={officers}
                pendingId={pendingId}
                onNew={() => setNewOfficer(true)}
                onToggle={(o) =>
                  void runOn(
                    o.id,
                    () => updateOfficer(o.id, { active: o.active === false }),
                    `${o.firstName} ${o.lastName} ${o.active === false ? 'reactivated' : 'deactivated'}.`
                  )
                }
              />
            ) : null}

            {tab === 'escalations' ? <EscalationsView escalations={escalations} /> : null}
          </>
        )}
      </main>

      {disburseFor ? <DisburseModal user={disburseFor} onClose={() => setDisburseFor(null)} onDone={afterAction} /> : null}
      {assignFor ? <AssignModal defaulter={assignFor} officers={officers} onClose={() => setAssignFor(null)} onDone={afterAction} /> : null}
      {photosFor ? <PhotosModal user={photosFor} onClose={() => setPhotosFor(null)} /> : null}
      {newOfficer ? <NewOfficerModal onClose={() => setNewOfficer(false)} onDone={afterAction} /> : null}
      {changingPassword ? <PasswordModal onClose={() => setChangingPassword(false)} onDone={afterAction} /> : null}
    </div>
  );
}
