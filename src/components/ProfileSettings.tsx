import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, User, Lock, Mail, Save, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { doc, updateDoc } from 'firebase/firestore';
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { db, auth } from '../firebase';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    initialTab?: 'profile' | 'settings';
}

export const ProfileSettings: React.FC<Props> = ({ isOpen, onClose, initialTab = 'profile' }) => {
    const { user, userData } = useAuth();
    const [activeTab, setActiveTab] = useState<'profile' | 'settings'>(initialTab);

    // Profile State
    const [firstName, setFirstName] = useState(userData?.firstName || '');
    const [lastName, setLastName] = useState(userData?.lastName || '');

    // Settings State
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        setActiveTab(initialTab);
        if (userData) {
            setFirstName(userData.firstName || '');
            setLastName(userData.lastName || '');
        }
    }, [isOpen, initialTab, userData]);

    const handleUpdateProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
        setLoading(true);
        setError('');
        setSuccess('');

        try {
            await updateDoc(doc(db, 'users', user.uid), {
                firstName,
                lastName
            });
            setSuccess('Profile updated successfully.');
        } catch (err: any) {
            setError(err.message || 'Failed to update profile.');
        } finally {
            setLoading(false);
        }
    };

    const handleUpdatePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user || !user.email) return;
        if (newPassword !== confirmPassword) {
            setError('New passwords do not match.');
            return;
        }
        setLoading(true);
        setError('');
        setSuccess('');

        try {
            const credential = EmailAuthProvider.credential(user.email, currentPassword);
            await reauthenticateWithCredential(user, credential);
            await updatePassword(user, newPassword);
            setSuccess('Password updated successfully.');
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch (err: any) {
            setError(err.message || 'Failed to update password.');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    onClick={onClose}
                    className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                />
                <motion.div
                    initial={{ scale: 0.95, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.95, opacity: 0, y: 20 }}
                    className="relative bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden font-sans"
                >
                    <div className="flex border-b border-zinc-100">
                        <button
                            onClick={() => { setActiveTab('profile'); setError(''); setSuccess(''); }}
                            className={`flex-1 p-4 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${activeTab === 'profile' ? 'border-b-2 border-indigo-600 text-indigo-600 bg-indigo-50/30' : 'text-zinc-500 hover:bg-zinc-50'}`}
                        >
                            <User className="w-4 h-4" /> Profile Info
                        </button>
                        <button
                            onClick={() => { setActiveTab('settings'); setError(''); setSuccess(''); }}
                            className={`flex-1 p-4 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${activeTab === 'settings' ? 'border-b-2 border-indigo-600 text-indigo-600 bg-indigo-50/30' : 'text-zinc-500 hover:bg-zinc-50'}`}
                        >
                            <Lock className="w-4 h-4" /> Security Settings
                        </button>
                        <button onClick={onClose} className="p-4 hover:bg-rose-50 hover:text-rose-500 transition-colors text-zinc-400">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="p-8">
                        {error && <div className="p-3 mb-6 bg-rose-50 text-rose-600 text-xs font-bold rounded-xl border border-rose-100">{error}</div>}
                        {success && <div className="p-3 mb-6 bg-emerald-50 text-emerald-600 text-xs font-bold rounded-xl border border-emerald-100">{success}</div>}

                        {activeTab === 'profile' ? (
                            <form onSubmit={handleUpdateProfile} className="space-y-5">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold uppercase text-zinc-400 ml-1">Email (Read Only)</label>
                                    <div className="relative">
                                        <Mail className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" />
                                        <input type="text" disabled value={userData?.email || ''} className="w-full pl-11 pr-4 py-3 bg-zinc-100 border border-zinc-200 rounded-xl text-zinc-500 outline-none text-sm" />
                                    </div>
                                </div>
                                <div className="flex gap-4">
                                    <div className="space-y-1 flex-1">
                                        <label className="text-[10px] font-bold uppercase text-zinc-400 ml-1">First Name</label>
                                        <div className="relative">
                                            <User className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" />
                                            <input required type="text" value={firstName} onChange={e => setFirstName(e.target.value)} className="w-full pl-11 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:ring-1 ring-indigo-500 text-sm" />
                                        </div>
                                    </div>
                                    <div className="space-y-1 flex-1">
                                        <label className="text-[10px] font-bold uppercase text-zinc-400 ml-1">Last Name</label>
                                        <div className="relative">
                                            <User className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" />
                                            <input required type="text" value={lastName} onChange={e => setLastName(e.target.value)} className="w-full pl-11 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:ring-1 ring-indigo-500 text-sm" />
                                        </div>
                                    </div>
                                </div>
                                <button disabled={loading} type="submit" className="w-full mt-4 py-4 bg-zinc-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-zinc-800 transition-colors disabled:opacity-50">
                                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Save className="w-4 h-4" /> Save Profile</>}
                                </button>
                            </form>
                        ) : (
                            <form onSubmit={handleUpdatePassword} className="space-y-5">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold uppercase text-zinc-400 ml-1">Current Password</label>
                                    <div className="relative">
                                        <Lock className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" />
                                        <input required minLength={6} type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="w-full pl-11 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:ring-1 ring-indigo-500 text-sm" />
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold uppercase text-zinc-400 ml-1">New Password</label>
                                    <div className="relative">
                                        <Lock className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" />
                                        <input required minLength={6} type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full pl-11 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:ring-1 ring-indigo-500 text-sm" />
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold uppercase text-zinc-400 ml-1">Confirm New Password</label>
                                    <div className="relative">
                                        <Lock className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" />
                                        <input required minLength={6} type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-full pl-11 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:ring-1 ring-indigo-500 text-sm" />
                                    </div>
                                </div>
                                <button disabled={loading} type="submit" className="w-full mt-4 py-4 bg-zinc-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-zinc-800 transition-colors disabled:opacity-50">
                                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Lock className="w-4 h-4" /> Update Password</>}
                                </button>
                            </form>
                        )}
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};
