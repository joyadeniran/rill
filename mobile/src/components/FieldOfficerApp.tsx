import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import {
  getTodayRoute,
  recordRepayment,
  recordAudit,
  recordEscalation,
  createUser,
  getUserHistory,
  getAIRebuttal,
  getRouteOptimization,
  isNetworkError,
  newIdempotencyKey,
  type PaymentMethod
} from '../services/api';
import { enqueuePayment, flushQueue, hasPendingFor, pendingCount } from '../services/paymentQueue';
import { captureAndUpload } from '../services/photos';
import { ApiError } from '../services/api';
import type { CheckInLog, Merchant } from '../types';

type ChatMessage = { role: 'user' | 'ai'; text: string };
type UserHistory = {
  payments: Array<{ amount: number; method: string; timestamp: string }>;
  audits: Array<{ mood: string | null; stockLevel: string | null; traffic: string | null; notes: string | null; timestamp: string }>;
  disbursements: Array<{ amount: number; dailyInstallment: number; timestamp: string }>;
};

const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'pos', 'transfer'];

/**
 * The server already produces a precise, human-readable message for every
 * failure. Replacing it with a generic "Failed to record audit" throws that
 * away and leaves the officer with no idea what to fix — so always prefer the
 * server's text, and only fall back when there genuinely isn't one.
 */
function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/** Per-field messages from the API, for showing errors under the right input. */
function fieldsOf(error: unknown): Record<string, string> {
  return error instanceof ApiError ? error.fields : {};
}

const emptyCheckIn = {
  mood: 'positive' as CheckInLog['mood'],
  stockLevel: 'high' as CheckInLog['stockLevel'],
  marketTraffic: 'busy' as CheckInLog['marketTraffic'],
  notes: ''
};

export function FieldOfficerApp() {
  const { userData, logout } = useAuth();
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [routeOrder, setRouteOrder] = useState<string[]>([]);
  const [routeReasoning, setRouteReasoning] = useState('');
  const [routeLoading, setRouteLoading] = useState(false);

  const [selectedMerchant, setSelectedMerchant] = useState<Merchant | null>(null);
  
  // Modals
  const [checkInVisible, setCheckInVisible] = useState(false);
  const [chatVisible, setChatVisible] = useState(false);
  const [escalateVisible, setEscalateVisible] = useState(false);
  const [addUserVisible, setAddUserVisible] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [payVisible, setPayVisible] = useState(false);

  // Payment form. The idempotency key is minted when the modal opens and used
  // for that one logical payment (and any retries of it, incl. offline queue).
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
  const [payKey, setPayKey] = useState('');
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [pendingSync, setPendingSync] = useState(0);

  // Forms
  const [checkInForm, setCheckInForm] = useState(emptyCheckIn);
  const [escalateReason, setEscalateReason] = useState('');
  const [newUserForm, setNewUserForm] = useState({ name: '', phone: '', location: '' });
  // Field-level errors keyed by input name, fed straight from the API so the
  // officer sees exactly which field the server rejected and why.
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [photoStatus, setPhotoStatus] = useState('');
  
  // Chat
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatMessage, setChatMessage] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  // History
  const [userHistory, setUserHistory] = useState<UserHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchData = async () => {
    setRefreshing(true);
    try {
      // Push any offline-queued payments first so the route reflects them.
      const flushed = await flushQueue();
      if (flushed.rejected.length > 0) {
        Alert.alert(
          'Some queued payments were rejected',
          `These did NOT count:\n${flushed.rejected.join('\n')}`
        );
      }
      setPendingSync(flushed.remaining);
      const data = await getTodayRoute();
      setMerchants(data);
    } catch (error) {
      Alert.alert("Couldn't load your route", errorMessage(error, "Today's route could not be loaded."));
      pendingCount().then(setPendingSync).catch(() => {});
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const optimizeRoute = async () => {
    if (merchants.length === 0) return;
    setRouteLoading(true);
    try {
      const result = await getRouteOptimization(merchants);
      setRouteOrder(Array.isArray(result?.prioritizedIds) ? result.prioritizedIds : []);
      setRouteReasoning(typeof result?.reasoning === 'string' ? result.reasoning : '');
    } catch {
      setRouteReasoning('Intelligence unavailable. Using default order.');
    } finally {
      setRouteLoading(false);
    }
  };

  const groupedMerchants = useMemo(() => {
    const sorted = [...merchants].sort((a, b) => {
      const aIndex = routeOrder.indexOf(a.id);
      const bIndex = routeOrder.indexOf(b.id);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return 0;
    });

    return {
      urgent: sorted.filter(m => m.internalStatus === 'urgent'),
      atRisk: sorted.filter(m => m.internalStatus === 'at-risk'),
      onTrack: sorted.filter(m => m.internalStatus === 'on-track' && m.status !== 'pending'),
      pending: sorted.filter(m => m.status === 'pending')
    };
  }, [merchants, routeOrder]);

  const openPayment = async (merchant: Merchant) => {
    const balance = Number(merchant.balance ?? 0);
    if (balance <= 0) {
      Alert.alert('No balance', 'This merchant has no outstanding balance.');
      return;
    }
    if (await hasPendingFor(merchant.id)) {
      Alert.alert(
        'Payment pending sync',
        'A payment for this merchant is already queued. Pull to refresh to sync it before recording another.'
      );
      return;
    }
    const installment = Number(merchant.dailyInstallment ?? 0);
    // Default to the daily installment, capped at what is actually owed.
    const suggested = Math.min(installment > 0 ? installment : balance, balance);
    setPayAmount(String(suggested));
    setPayMethod('cash');
    setPayKey(newIdempotencyKey());
    setPayVisible(true);
  };

  const submitPayment = () => {
    if (!selectedMerchant || paySubmitting) return;
    const merchant = selectedMerchant;
    const balance = Number(merchant.balance ?? 0);
    const amount = parseInt(payAmount, 10);

    if (!Number.isInteger(amount) || amount <= 0) {
      Alert.alert('Invalid amount', 'Enter a whole number greater than zero.');
      return;
    }
    if (amount > balance) {
      Alert.alert('Too much', `Amount exceeds outstanding balance (NGN ${balance.toLocaleString()}).`);
      return;
    }

    // Explicit confirmation before any money write.
    Alert.alert(
      'Confirm payment',
      `Record NGN ${amount.toLocaleString()} (${payMethod}) from ${merchant.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Record',
          onPress: async () => {
            setPaySubmitting(true);
            const payment = { userId: merchant.id, amount, method: payMethod, idempotencyKey: payKey };
            try {
              await recordRepayment(payment);
              setPayVisible(false);
              Alert.alert('Success', `Recorded NGN ${amount.toLocaleString()} from ${merchant.name}`);
              fetchData();
            } catch (error) {
              if (isNetworkError(error)) {
                // Can't reach the server: queue it. The idempotency key makes
                // the eventual sync safe even if the original request landed.
                const count = await enqueuePayment({
                  ...payment,
                  merchantName: merchant.name,
                  queuedAt: new Date().toISOString()
                });
                setPendingSync(count);
                setPayVisible(false);
                Alert.alert(
                  'Saved offline',
                  'No connection — the payment is queued and will sync when you refresh with signal.'
                );
              } else {
                const message = error instanceof Error ? error.message : 'Failed to record payment';
                Alert.alert('Not recorded', message);
              }
            } finally {
              setPaySubmitting(false);
            }
          }
        }
      ]
    );
  };

  const handleCall = (phone: string) => {
    if (!phone) {
      Alert.alert('Error', 'No phone number available for this merchant');
      return;
    }
    Linking.openURL(`tel:${phone}`);
  };

  const fetchHistory = async (merchant: Merchant) => {
    setHistoryVisible(true);
    setHistoryLoading(true);
    try {
      const data = await getUserHistory(merchant.id);
      setUserHistory(data);
    } catch (error) {
      Alert.alert("Couldn't load history", errorMessage(error, 'This merchant\'s history could not be loaded.'));
      setHistoryVisible(false);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleCheckInSubmit = async () => {
    if (!selectedMerchant) return;
    setSubmitting(true);
    setFormErrors({});
    try {
      await recordAudit({
        userId: selectedMerchant.id,
        ...checkInForm
      });
      setCheckInVisible(false);
      setCheckInForm(emptyCheckIn);
      setPhotoStatus('');
      Alert.alert('Audit recorded', `Field audit saved for ${selectedMerchant.name}.`);
    } catch (error) {
      setFormErrors(fieldsOf(error));
      Alert.alert('Audit not recorded', errorMessage(error, 'The audit could not be saved.'));
    } finally {
      setSubmitting(false);
    }
  };

  /** Attach field evidence to the merchant currently open. */
  const attachPhoto = async (kind: 'audit' | 'payment' | 'merchant', source: 'camera' | 'library') => {
    if (!selectedMerchant) return;
    setPhotoStatus('Uploading photo…');
    const result = await captureAndUpload(selectedMerchant.id, kind, undefined, source);
    if (result.ok) {
      setPhotoStatus('Photo attached ✓');
      return;
    }
    setPhotoStatus('');
    // A cancel carries no message — it is not an error and must show nothing.
    if (result.message) Alert.alert('Photo not attached', result.message);
  };

  const handleEscalateSubmit = async () => {
    if (!selectedMerchant) return;
    // Previously this returned silently on an empty reason, so tapping the
    // button appeared to do nothing at all.
    if (!escalateReason.trim()) {
      setFormErrors({ reason: 'Choose or describe a reason for escalating' });
      return;
    }
    setSubmitting(true);
    setFormErrors({});
    try {
      await recordEscalation({
        userId: selectedMerchant.id,
        reason: escalateReason.trim()
      });
      setEscalateVisible(false);
      setEscalateReason('');
      Alert.alert('Escalated', `${selectedMerchant.name} has been flagged for admin review.`);
    } catch (error) {
      setFormErrors(fieldsOf(error));
      Alert.alert('Not escalated', errorMessage(error, 'The escalation could not be sent.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddUserSubmit = async () => {
    // Validate locally first so the officer gets an instant answer instead of a
    // round-trip, but the server remains the authority and its field messages
    // overwrite these if they disagree.
    const local: Record<string, string> = {};
    if (!newUserForm.name.trim()) local.name = 'Merchant name is required';
    if (!newUserForm.location.trim()) local.location = 'Location is required';
    if (Object.keys(local).length > 0) {
      setFormErrors(local);
      return;
    }
    setSubmitting(true);
    setFormErrors({});
    try {
      await createUser({
        name: newUserForm.name.trim(),
        phone: newUserForm.phone.trim(),
        location: newUserForm.location.trim()
      });
      setAddUserVisible(false);
      setNewUserForm({ name: '', phone: '', location: '' });
      Alert.alert('Merchant added', 'They are pending until an admin disburses credit.');
      fetchData();
    } catch (error) {
      setFormErrors(fieldsOf(error));
      Alert.alert('Not added', errorMessage(error, 'The merchant could not be added.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleChat = async () => {
    if (!chatMessage.trim() || !selectedMerchant) return;
    const msg = chatMessage.trim();
    setChatHistory(curr => [...curr, { role: 'user', text: msg }]);
    setChatMessage('');
    setChatLoading(true);
    try {
      const reply = await getAIRebuttal(selectedMerchant.name, msg);
      setChatHistory(curr => [...curr, { role: 'ai', text: reply }]);
    } catch {
      setChatHistory(curr => [...curr, { role: 'ai', text: 'Intelligence link broken.' }]);
    } finally {
      setChatLoading(false);
    }
  };

  const renderMerchantCard = (merchant: Merchant) => {
    const isSelected = selectedMerchant?.id === merchant.id;
    return (
      <Pressable
        key={merchant.id}
        style={[styles.merchantCard, isSelected && styles.selectedMerchantCard]}
        onPress={() => setSelectedMerchant(merchant)}
      >
        <View style={styles.merchantHeader}>
          <View style={styles.merchantMain}>
            <Text style={styles.merchantName}>{merchant.name}</Text>
            <Text style={styles.merchantMeta}>{merchant.location}</Text>
          </View>
          <View style={[styles.statusPill, statusStyles[merchant.internalStatus || 'on-track']]}>
            <Text style={[styles.statusText, statusTextStyles[merchant.internalStatus || 'on-track']]}>
              {merchant.status === 'pending' ? 'PENDING' : merchant.internalStatus}
            </Text>
          </View>
        </View>

        <View style={styles.merchantStats}>
          <View>
            <Text style={styles.statLabel}>Owed</Text>
            <Text style={styles.balanceValue}>N{Number(merchant.balance ?? 0).toLocaleString()}</Text>
          </View>
          <View>
            <Text style={styles.statLabel}>Daily</Text>
            <Text style={styles.balanceValue}>N{Number(merchant.dailyInstallment ?? 0).toLocaleString()}</Text>
          </View>
          <View>
            <Text style={styles.statLabel}>Last</Text>
            <Text style={styles.balanceValue}>{merchant.lastPaymentDate || 'Never'}</Text>
          </View>
        </View>

        {isSelected && (
          <View style={styles.actionsRow}>
            <Pressable style={styles.callButton} onPress={() => handleCall(merchant.phone)}>
              <Text style={styles.callButtonText}>Call</Text>
            </Pressable>
            <Pressable style={styles.primaryButton} onPress={() => openPayment(merchant)}>
              <Text style={styles.primaryButtonText}>Log Payment</Text>
            </Pressable>
            <Pressable style={styles.actionButton} onPress={() => setCheckInVisible(true)}>
              <Text style={styles.actionButtonText}>Audit</Text>
            </Pressable>
            <Pressable style={styles.actionButton} onPress={() => setEscalateVisible(true)}>
              <Text style={styles.escalateText}>Escalate</Text>
            </Pressable>
            <Pressable style={styles.actionButton} onPress={() => fetchHistory(merchant)}>
              <Text style={styles.actionButtonText}>History</Text>
            </Pressable>
            <Pressable style={styles.actionButton} onPress={() => setChatVisible(true)}>
              <Text style={styles.actionButtonText}>AI</Text>
            </Pressable>
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.topHeader}>
        <View>
          <Text style={styles.headerTitle}>Rill Field</Text>
          <Text style={styles.headerSubtitle}>{userData?.firstName} • {new Date().toLocaleDateString()}</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable style={styles.plusButton} onPress={() => setAddUserVisible(true)}>
            <Text style={styles.plusButtonText}>+ User</Text>
          </Pressable>
          <Pressable onPress={logout}>
            <Text style={styles.logoutText}>Exit</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView 
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={fetchData} />}
      >
        {pendingSync > 0 && (
          <View style={styles.syncBanner}>
            <Text style={styles.syncBannerText}>
              {pendingSync} payment{pendingSync > 1 ? 's' : ''} waiting to sync — pull to refresh when you have signal.
            </Text>
          </View>
        )}

        <Pressable style={styles.intelCard} onPress={optimizeRoute} disabled={routeLoading}>
          <Text style={styles.intelTitle}>Route Intelligence</Text>
          {routeLoading ? (
            <ActivityIndicator size="small" color="#4f46e5" />
          ) : (
            <Text style={styles.intelText}>{routeReasoning || "Tap to optimize today's collection order."}</Text>
          )}
        </Pressable>

        {groupedMerchants.urgent.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>🔴 URGENT (48H+ NO PAY)</Text>
            {groupedMerchants.urgent.map(renderMerchantCard)}
          </View>
        )}

        {groupedMerchants.atRisk.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>🟡 AT RISK (24H+ NO PAY)</Text>
            {groupedMerchants.atRisk.map(renderMerchantCard)}
          </View>
        )}

        {groupedMerchants.onTrack.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>🟢 ON TRACK</Text>
            {groupedMerchants.onTrack.map(renderMerchantCard)}
          </View>
        )}

        {groupedMerchants.pending.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>⚪ PENDING DISBURSEMENT</Text>
            {groupedMerchants.pending.map(renderMerchantCard)}
          </View>
        )}
      </ScrollView>

      {/* Add User Modal */}
      <Modal visible={addUserVisible} animationType="slide">
        <SafeAreaView style={styles.modalShell}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New Borrower</Text>
            <Pressable onPress={() => setAddUserVisible(false)}><Text style={styles.closeText}>Close</Text></Pressable>
          </View>
          <View style={styles.modalContent}>
            <TextInput
              placeholder="Full Name"
              style={[styles.input, formErrors.name && styles.inputError]}
              value={newUserForm.name}
              onChangeText={t => { setNewUserForm(f => ({...f, name: t})); setFormErrors(e => ({...e, name: ''})); }}
            />
            {formErrors.name ? <Text style={styles.errorText}>{formErrors.name}</Text> : null}
            <TextInput
              placeholder="Phone Number"
              style={[styles.input, formErrors.phone && styles.inputError]}
              keyboardType="phone-pad"
              value={newUserForm.phone}
              onChangeText={t => { setNewUserForm(f => ({...f, phone: t})); setFormErrors(e => ({...e, phone: ''})); }}
            />
            {formErrors.phone ? <Text style={styles.errorText}>{formErrors.phone}</Text> : null}
            <TextInput
              placeholder="Location (Market/Stall)"
              style={[styles.input, formErrors.location && styles.inputError]}
              value={newUserForm.location}
              onChangeText={t => { setNewUserForm(f => ({...f, location: t})); setFormErrors(e => ({...e, location: ''})); }}
            />
            {formErrors.location ? <Text style={styles.errorText}>{formErrors.location}</Text> : null}
            <Pressable
              style={[styles.primaryButton, submitting && styles.buttonDisabled]}
              onPress={handleAddUserSubmit}
              disabled={submitting}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Register User</Text>}
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Payment Modal */}
      <Modal visible={payVisible} animationType="slide">
        <SafeAreaView style={styles.modalShell}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Log Payment: {selectedMerchant?.name}</Text>
            <Pressable onPress={() => !paySubmitting && setPayVisible(false)}>
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
          <View style={styles.modalContent}>
            <Text style={styles.fieldLabel}>
              Outstanding: N{Number(selectedMerchant?.balance ?? 0).toLocaleString()}
            </Text>
            <Text style={styles.fieldLabel}>Amount (NGN)</Text>
            <TextInput
              style={[styles.input, formErrors.amount && styles.inputError]}
              keyboardType="number-pad"
              value={payAmount}
              onChangeText={(t) => { setPayAmount(t.replace(/[^0-9]/g, '')); setFormErrors(e => ({...e, amount: ''})); }}
              placeholder="Amount collected"
            />
            {formErrors.amount ? <Text style={styles.errorText}>{formErrors.amount}</Text> : null}
            <Text style={styles.fieldLabel}>Method</Text>
            <View style={styles.choiceRow}>
              {PAYMENT_METHODS.map((m) => (
                <Pressable
                  key={m}
                  style={[styles.choiceChip, payMethod === m && styles.choiceChipSelected]}
                  onPress={() => setPayMethod(m)}
                >
                  <Text style={styles.choiceText}>{m}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.fieldLabel}>Receipt photo (optional)</Text>
            <View style={styles.choiceRow}>
              <Pressable style={styles.choiceChip} onPress={() => attachPhoto('payment', 'camera')} disabled={paySubmitting}>
                <Text style={styles.choiceText}>Take photo</Text>
              </Pressable>
              <Pressable style={styles.choiceChip} onPress={() => attachPhoto('payment', 'library')} disabled={paySubmitting}>
                <Text style={styles.choiceText}>Choose photo</Text>
              </Pressable>
            </View>
            {photoStatus ? <Text style={styles.helperText}>{photoStatus}</Text> : null}
            <Pressable
              style={[styles.primaryButton, paySubmitting && styles.buttonDisabled]}
              onPress={submitPayment}
              disabled={paySubmitting}
            >
              {paySubmitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Record Payment</Text>
              )}
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Audit Modal */}
      <Modal visible={checkInVisible} animationType="slide">
        <SafeAreaView style={styles.modalShell}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Field Audit: {selectedMerchant?.name}</Text>
            <Pressable onPress={() => setCheckInVisible(false)}><Text style={styles.closeText}>Close</Text></Pressable>
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.fieldLabel}>Mood</Text>
            <View style={styles.choiceRow}>
              {['positive', 'neutral', 'negative'].map(v => (
                <Pressable key={v} style={[styles.choiceChip, checkInForm.mood === v && styles.choiceChipSelected]} onPress={() => setCheckInForm(f => ({...f, mood: v as any}))}>
                  <Text style={styles.choiceText}>{v}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.fieldLabel}>Stock Level</Text>
            <View style={styles.choiceRow}>
              {['high', 'medium', 'low'].map(v => (
                <Pressable key={v} style={[styles.choiceChip, checkInForm.stockLevel === v && styles.choiceChipSelected]} onPress={() => setCheckInForm(f => ({...f, stockLevel: v as any}))}>
                  <Text style={styles.choiceText}>{v}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.fieldLabel}>Market Traffic</Text>
            <View style={styles.choiceRow}>
              {['busy', 'normal', 'slow'].map(v => (
                <Pressable key={v} style={[styles.choiceChip, checkInForm.marketTraffic === v && styles.choiceChipSelected]} onPress={() => setCheckInForm(f => ({...f, marketTraffic: v as any}))}>
                  <Text style={styles.choiceText}>{v}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              placeholder="Field Notes..."
              style={styles.notesInput}
              multiline
              value={checkInForm.notes}
              onChangeText={t => setCheckInForm(f => ({...f, notes: t}))}
            />
            <Text style={styles.fieldLabel}>Photo evidence (optional)</Text>
            <View style={styles.choiceRow}>
              <Pressable style={styles.choiceChip} onPress={() => attachPhoto('audit', 'camera')} disabled={submitting}>
                <Text style={styles.choiceText}>Take photo</Text>
              </Pressable>
              <Pressable style={styles.choiceChip} onPress={() => attachPhoto('audit', 'library')} disabled={submitting}>
                <Text style={styles.choiceText}>Choose photo</Text>
              </Pressable>
            </View>
            {photoStatus ? <Text style={styles.helperText}>{photoStatus}</Text> : null}
            <Pressable
              style={[styles.primaryButton, submitting && styles.buttonDisabled]}
              onPress={handleCheckInSubmit}
              disabled={submitting}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Save Audit</Text>}
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Escalate Modal */}
      <Modal visible={escalateVisible} animationType="fade" transparent>
        <View style={styles.centeredModal}>
          <View style={styles.alertCard}>
            <Text style={styles.modalTitle}>Escalate Risk</Text>
            <Text style={styles.modalSubtitle}>Flag {selectedMerchant?.name} for immediate admin review.</Text>
            <TextInput 
              placeholder="Reason (e.g. Shop closed, Refusal)" 
              style={styles.input}
              value={escalateReason}
              onChangeText={setEscalateReason}
            />
            <View style={styles.actionsRow}>
              <Pressable style={styles.actionButton} onPress={() => setEscalateVisible(false)}>
                <Text>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.primaryButton, {backgroundColor: '#b91c1c'}]} onPress={handleEscalateSubmit}>
                <Text style={styles.primaryButtonText}>Escalate</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* AI Rebuttal Modal */}
      <Modal visible={chatVisible} animationType="slide">
        <SafeAreaView style={styles.modalShell}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>AI Rebuttal</Text>
            <Pressable onPress={() => setChatVisible(false)}><Text style={styles.closeText}>Close</Text></Pressable>
          </View>
          <View style={styles.chatContainer}>
            <ScrollView style={styles.chatList}>
              {chatHistory.map((m, i) => (
                <View key={i} style={[styles.bubble, m.role === 'user' ? styles.userBubble : styles.aiBubble]}>
                  <Text style={m.role === 'user' ? styles.userText : styles.aiText}>{m.text}</Text>
                </View>
              ))}
              {chatLoading && <ActivityIndicator />}
            </ScrollView>
            <View style={styles.chatInputRow}>
              <TextInput 
                placeholder="Merchant's excuse..." 
                style={[styles.input, {flex: 1}]} 
                value={chatMessage}
                onChangeText={setChatMessage}
              />
              <Pressable style={styles.sendButton} onPress={handleChat}>
                <Text style={styles.sendButtonText}>Go</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      {/* History Modal */}
      <Modal visible={historyVisible} animationType="slide">
        <SafeAreaView style={styles.modalShell}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>History: {selectedMerchant?.name}</Text>
            <Pressable onPress={() => { setHistoryVisible(false); setUserHistory(null); }}><Text style={styles.closeText}>Close</Text></Pressable>
          </View>
          {historyLoading ? (
            <ActivityIndicator size="large" style={{ marginTop: 50 }} />
          ) : (
            <ScrollView style={styles.modalContent}>
              {/* Defensive shape handling throughout: mood/stockLevel/traffic
                  are nullable in the DB, and a partial payload must degrade to
                  placeholders, never a render crash. */}
              <Text style={styles.sectionTitle}>DISBURSEMENTS</Text>
              {!Array.isArray(userHistory?.disbursements) || userHistory.disbursements.length === 0 ? (
                <Text style={styles.emptyText}>No disbursements recorded.</Text>
              ) : (
                userHistory.disbursements.map((d, i) => (
                  <View key={i} style={styles.historyItem}>
                    <Text style={styles.historyMain}>
                      N{Number(d.amount ?? 0).toLocaleString()} (daily: N{Number(d.dailyInstallment ?? 0).toLocaleString()})
                    </Text>
                    <Text style={styles.historySub}>{new Date(d.timestamp).toLocaleString()}</Text>
                  </View>
                ))
              )}

              <Text style={[styles.sectionTitle, { marginTop: 20 }]}>REPAYMENTS</Text>
              {!Array.isArray(userHistory?.payments) || userHistory.payments.length === 0 ? (
                <Text style={styles.emptyText}>No payments recorded.</Text>
              ) : (
                userHistory.payments.map((p, i) => (
                  <View key={i} style={styles.historyItem}>
                    <Text style={styles.historyMain}>N{Number(p.amount ?? 0).toLocaleString()} ({p.method || 'cash'})</Text>
                    <Text style={styles.historySub}>{new Date(p.timestamp).toLocaleString()}</Text>
                  </View>
                ))
              )}

              <Text style={[styles.sectionTitle, { marginTop: 20 }]}>AUDITS</Text>
              {!Array.isArray(userHistory?.audits) || userHistory.audits.length === 0 ? (
                <Text style={styles.emptyText}>No audits recorded.</Text>
              ) : (
                userHistory.audits.map((a, i) => (
                  <View key={i} style={styles.historyItem}>
                    <Text style={styles.historyMain}>
                      {(a.mood ?? 'unknown').toUpperCase()} | Stock: {a.stockLevel ?? '—'} | Traffic: {a.traffic ?? '—'}
                    </Text>
                    {a.notes ? <Text style={styles.historyNotes}>{a.notes}</Text> : null}
                    <Text style={styles.historySub}>{new Date(a.timestamp).toLocaleString()}</Text>
                  </View>
                ))
              )}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const statusStyles = StyleSheet.create({
  urgent: { backgroundColor: '#fee2e2' },
  'at-risk': { backgroundColor: '#fef3c7' },
  'on-track': { backgroundColor: '#dcfce7' }
});

const statusTextStyles = StyleSheet.create({
  urgent: { color: '#991b1b' },
  'at-risk': { color: '#92400e' },
  'on-track': { color: '#166534' }
});

const styles = StyleSheet.create({
  inputError: {
    borderColor: '#dc2626',
    borderWidth: 1
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 12,
    marginTop: -6,
    marginBottom: 10
  },
  helperText: {
    color: '#475569',
    fontSize: 12,
    marginBottom: 10
  },
  safeArea: { flex: 1, backgroundColor: '#f8fafc' },
  topHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#1e1b4b' },
  headerSubtitle: { fontSize: 12, color: '#64748b' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  plusButton: { backgroundColor: '#1e1b4b', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  plusButtonText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  logoutText: { color: '#ef4444', fontWeight: '600' },
  content: { padding: 16, gap: 20 },
  syncBanner: { backgroundColor: '#fef3c7', padding: 12, borderRadius: 12, borderLeftWidth: 4, borderLeftColor: '#d97706' },
  syncBannerText: { fontSize: 13, color: '#92400e', fontWeight: '600' },
  buttonDisabled: { opacity: 0.6 },
  intelCard: { backgroundColor: '#eef2ff', padding: 16, borderRadius: 16, borderLeftWidth: 4, borderLeftColor: '#4f46e5' },
  intelTitle: { fontWeight: '700', color: '#312e81', marginBottom: 4 },
  intelText: { fontSize: 13, color: '#3730a3', lineHeight: 18 },
  section: { gap: 12 },
  sectionTitle: { fontSize: 12, fontWeight: '800', color: '#64748b', marginLeft: 4 },
  merchantCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#e2e8f0', gap: 12 },
  selectedMerchantCard: { borderColor: '#4f46e5', borderWidth: 2 },
  merchantHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  merchantMain: { flex: 1 },
  merchantName: { fontSize: 17, fontWeight: '700', color: '#0f172a' },
  merchantMeta: { fontSize: 13, color: '#64748b', marginTop: 2 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusText: { fontSize: 10, fontWeight: '800' },
  merchantStats: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#f8fafc', padding: 10, borderRadius: 12 },
  statLabel: { fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 2 },
  balanceValue: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  callButton: { flexBasis: '20%', backgroundColor: '#dcfce7', borderRadius: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#166534' },
  callButtonText: { fontSize: 12, fontWeight: '700', color: '#166534' },
  primaryButton: { flexBasis: '45%', backgroundColor: '#1e1b4b', borderRadius: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '700' },
  actionButton: { flexBasis: '22%', backgroundColor: '#f1f5f9', borderRadius: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  actionButtonText: { fontSize: 12, fontWeight: '600', color: '#475569' },
  escalateText: { fontSize: 12, fontWeight: '600', color: '#ef4444' },
  modalShell: { flex: 1, backgroundColor: '#fff' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  closeText: { color: '#4f46e5', fontWeight: '600' },
  modalContent: { padding: 20, gap: 16 },
  input: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 14, fontSize: 16 },
  fieldLabel: { fontWeight: '700', color: '#475569', marginTop: 10 },
  choiceRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  choiceChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0' },
  choiceChipSelected: { backgroundColor: '#eef2ff', borderColor: '#4f46e5' },
  choiceText: { fontWeight: '600', color: '#1e293b' },
  notesInput: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 14, height: 100, textAlignVertical: 'top' },
  centeredModal: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', padding: 20 },
  alertCard: { backgroundColor: '#fff', borderRadius: 20, padding: 20, width: '100%', gap: 16 },
  modalSubtitle: { fontSize: 14, color: '#64748b' },
  chatContainer: { flex: 1, padding: 16 },
  chatList: { flex: 1, gap: 12 },
  bubble: { padding: 12, borderRadius: 16, maxWidth: '85%', marginBottom: 10 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: '#1e1b4b' },
  aiBubble: { alignSelf: 'flex-start', backgroundColor: '#f1f5f9' },
  userText: { color: '#fff' },
  aiText: { color: '#1e293b' },
  chatInputRow: { flexDirection: 'row', gap: 10, paddingVertical: 10 },
  sendButton: { backgroundColor: '#4f46e5', width: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sendButtonText: { color: '#fff', fontWeight: '700' },
  historyItem: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  historyMain: { fontSize: 15, fontWeight: '700', color: '#1e293b' },
  historySub: { fontSize: 12, color: '#94a3b8', marginTop: 4 },
  historyNotes: { fontSize: 14, color: '#475569', fontStyle: 'italic', marginVertical: 4 },
  emptyText: { fontSize: 14, color: '#94a3b8', textAlign: 'center', marginTop: 20 }
});
