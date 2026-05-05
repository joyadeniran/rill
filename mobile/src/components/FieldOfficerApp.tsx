import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { MOCK_MERCHANTS } from '../mockData';
import { getAIRebuttal, getRouteOptimization } from '../services/api';
import { recordCheckIn, recordRepayment, subscribeToMerchants, seedMerchants } from '../services/db';
import type { CheckInLog, Merchant, Repayment } from '../types';

type ChatMessage = { role: 'user' | 'ai'; text: string };

const emptyCheckIn = {
  mood: 'positive' as CheckInLog['mood'],
  stockLevel: 'high' as CheckInLog['stockLevel'],
  marketTraffic: 'busy' as CheckInLog['marketTraffic'],
  notes: ''
};

export function FieldOfficerApp() {
  const { userData } = useAuth();
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [routeOrder, setRouteOrder] = useState<string[]>([]);
  const [routeReasoning, setRouteReasoning] = useState('');
  const [selectedMerchant, setSelectedMerchant] = useState<Merchant | null>(null);
  const [checkInVisible, setCheckInVisible] = useState(false);
  const [chatVisible, setChatVisible] = useState(false);
  const [checkInForm, setCheckInForm] = useState(emptyCheckIn);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatMessage, setChatMessage] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [routeLoading, setRouteLoading] = useState(true);
  const [isSeeding, setIsSeeding] = useState(false);
  const [stats, setStats] = useState({ totalCollected: 0, checkInCount: 0 });

  // Subscribe to live merchant data
  useEffect(() => {
    const unsubscribe = subscribeToMerchants((data) => {
      setMerchants(data);
      // If no data, try to seed with mock data
      if (data.length === 0 && !isSeeding) {
        setIsSeeding(true);
        seedMerchants(MOCK_MERCHANTS).finally(() => setIsSeeding(false));
      }
    });
    return () => unsubscribe();
  }, []);

  // Subscribe to live stats
  useEffect(() => {
    const officerId = userData?.email ?? 'co';
    const unsubscribe = subscribeToTodaysStats(officerId, (newStats) => {
      setStats(newStats);
    });
    return () => unsubscribe();
  }, [userData?.email]);

  // Optimize route when merchants are loaded
  useEffect(() => {
    if (merchants.length === 0) return;
    
    let active = true;
    async function optimize() {
      try {
        const result = await getRouteOptimization(merchants);
        if (!active) return;
        setRouteOrder(result.prioritizedIds ?? []);
        setRouteReasoning(result.reasoning ?? '');
      } catch {
        if (active) {
          setRouteReasoning('Route intelligence is temporarily unavailable. Using default merchant order.');
        }
      } finally {
        if (active) {
          setRouteLoading(false);
        }
      }
    }

    optimize();
    return () => { active = false; };
  }, [merchants.length > 0]); // Only re-run if count changes

  const orderedMerchants = useMemo(() => {
    return [...merchants].sort((left, right) => {
      const leftIndex = routeOrder.indexOf(left.id);
      const rightIndex = routeOrder.indexOf(right.id);
      if (leftIndex === -1 && rightIndex === -1) return left.name.localeCompare(right.name);
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    });
  }, [merchants, routeOrder]);

  const officerName = userData?.firstName ? `${userData.firstName} ${userData.lastName ?? ''}`.trim() : 'Field Officer';
  
  // Note: Local aggregate stats will be simpler now, or we could fetch them from Firestore too.
  // For now, let's keep it simple.

  const handleRepayment = async (merchantId: string) => {
    const merchant = merchants.find((entry) => entry.id === merchantId);
    if (!merchant) return;

    const amount = merchant.dailyInstallment;
    
    try {
      await recordRepayment({
        merchantId,
        amount,
        method: 'cash',
        officerId: userData?.email ?? 'co'
      });
      Alert.alert('Repayment recorded', `${merchant.name} paid NGN ${amount.toLocaleString()}.`);
    } catch (error) {
      Alert.alert('Error', 'Failed to record repayment. Please check your connection.');
    }
  };

  const handleCheckInSubmit = async () => {
    if (!selectedMerchant) return;

    try {
      await recordCheckIn({
        merchantId: selectedMerchant.id,
        ...checkInForm
      });
      setCheckInForm(emptyCheckIn);
      setCheckInVisible(false);
      Alert.alert('Check-in saved', 'Soft signals recorded for this merchant.');
    } catch (error) {
      Alert.alert('Error', 'Failed to save check-in.');
    }
  };

  const handleChat = async () => {
    if (!chatMessage.trim() || !selectedMerchant) {
      return;
    }

    const message = chatMessage.trim();
    setChatHistory((current) => [...current, { role: 'user', text: message }]);
    setChatMessage('');
    setChatLoading(true);

    try {
      const reply = await getAIRebuttal(selectedMerchant.name, message);
      setChatHistory((current) => [...current, { role: 'ai', text: reply }]);
    } catch {
      setChatHistory((current) => [
        ...current,
        { role: 'ai', text: 'Network issue while contacting Rill Intelligence.' }
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerCard}>
          <Text style={styles.kicker}>Rill CO</Text>
          <Text style={styles.headerTitle}>Today&apos;s route</Text>
          <Text style={styles.headerSubtitle}>{officerName}</Text>
          <View style={styles.headerStats}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Collected</Text>
              <Text style={styles.statValue}>NGN {stats.totalCollected.toLocaleString()}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Check-ins</Text>
              <Text style={styles.statValue}>{stats.checkInCount}</Text>
            </View>
          </View>
          <Pressable style={styles.secondaryButton} onPress={() => signOut(auth)}>
            <Text style={styles.secondaryButtonText}>Log out</Text>
          </Pressable>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Route intelligence</Text>
          {routeLoading ? (
            <View style={styles.inlineLoader}>
              <ActivityIndicator color="#4f46e5" />
              <Text style={styles.infoText}>Optimizing merchant order...</Text>
            </View>
          ) : (
            <Text style={styles.infoText}>{routeReasoning}</Text>
          )}
        </View>

        {orderedMerchants.map((merchant, index) => {
          const isSelected = selectedMerchant?.id === merchant.id;
          return (
            <Pressable
              key={merchant.id}
              style={[styles.merchantCard, isSelected ? styles.selectedMerchantCard : null]}
              onPress={() => setSelectedMerchant(merchant)}
            >
              <View style={styles.merchantHeader}>
                <View style={styles.rankBadge}>
                  <Text style={styles.rankText}>{index + 1}</Text>
                </View>
                <View style={styles.merchantMain}>
                  <Text style={styles.merchantName}>{merchant.name}</Text>
                  <Text style={styles.merchantMeta}>{merchant.location}</Text>
                  <Text style={styles.merchantMeta}>{merchant.businessType}</Text>
                </View>
                <View style={[styles.statusPill, statusStyles[merchant.status]]}>
                  <Text style={[styles.statusText, statusTextStyles[merchant.status]]}>{merchant.status}</Text>
                </View>
              </View>

              <View style={styles.merchantStats}>
                <View>
                  <Text style={styles.statLabel}>Balance</Text>
                  <Text style={styles.balanceValue}>NGN {merchant.balance.toLocaleString()}</Text>
                </View>
                <View>
                  <Text style={styles.statLabel}>Daily target</Text>
                  <Text style={styles.balanceValue}>NGN {merchant.dailyInstallment.toLocaleString()}</Text>
                </View>
                <View>
                  <Text style={styles.statLabel}>Streak</Text>
                  <Text style={styles.balanceValue}>{merchant.streak}d</Text>
                </View>
              </View>

              {isSelected ? (
                <View style={styles.actionsRow}>
                  <Pressable style={styles.primaryButton} onPress={() => handleRepayment(merchant.id)}>
                    <Text style={styles.primaryButtonText}>Collect</Text>
                  </Pressable>
                  <Pressable style={styles.actionButton} onPress={() => setCheckInVisible(true)}>
                    <Text style={styles.actionButtonText}>Check-in</Text>
                  </Pressable>
                  <Pressable style={styles.actionButton} onPress={() => setChatVisible(true)}>
                    <Text style={styles.actionButtonText}>AI rebuttal</Text>
                  </Pressable>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <Modal visible={checkInVisible} animationType="slide" onRequestClose={() => setCheckInVisible(false)}>
        <SafeAreaView style={styles.modalShell}>
          <ScrollView contentContainerStyle={styles.modalContent}>
            <Text style={styles.modalTitle}>Merchant check-in</Text>
            <Text style={styles.modalSubtitle}>{selectedMerchant?.name}</Text>

            <Text style={styles.fieldLabel}>Mood</Text>
            <View style={styles.choiceRow}>
              {(['positive', 'neutral', 'negative'] as const).map((value) => (
                <Pressable
                  key={value}
                  style={[styles.choiceChip, checkInForm.mood === value ? styles.choiceChipSelected : null]}
                  onPress={() => setCheckInForm((current) => ({ ...current, mood: value }))}
                >
                  <Text style={[styles.choiceChipText, checkInForm.mood === value ? styles.choiceChipTextSelected : null]}>
                    {value}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Stock level</Text>
            <View style={styles.choiceRow}>
              {(['high', 'medium', 'low'] as const).map((value) => (
                <Pressable
                  key={value}
                  style={[styles.choiceChip, checkInForm.stockLevel === value ? styles.choiceChipSelected : null]}
                  onPress={() => setCheckInForm((current) => ({ ...current, stockLevel: value }))}
                >
                  <Text
                    style={[
                      styles.choiceChipText,
                      checkInForm.stockLevel === value ? styles.choiceChipTextSelected : null
                    ]}
                  >
                    {value}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Traffic</Text>
            <View style={styles.choiceRow}>
              {(['busy', 'normal', 'slow'] as const).map((value) => (
                <Pressable
                  key={value}
                  style={[styles.choiceChip, checkInForm.marketTraffic === value ? styles.choiceChipSelected : null]}
                  onPress={() => setCheckInForm((current) => ({ ...current, marketTraffic: value }))}
                >
                  <Text
                    style={[
                      styles.choiceChipText,
                      checkInForm.marketTraffic === value ? styles.choiceChipTextSelected : null
                    ]}
                  >
                    {value}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Notes</Text>
            <TextInput
              multiline
              placeholder="Any context from the visit?"
              value={checkInForm.notes}
              onChangeText={(notes) => setCheckInForm((current) => ({ ...current, notes }))}
              style={styles.notesInput}
            />

            <View style={styles.modalButtons}>
              <Pressable style={styles.actionButton} onPress={() => setCheckInVisible(false)}>
                <Text style={styles.actionButtonText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.primaryButton} onPress={handleCheckInSubmit}>
                <Text style={styles.primaryButtonText}>Save check-in</Text>
              </Pressable>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={chatVisible} animationType="slide" onRequestClose={() => setChatVisible(false)}>
        <SafeAreaView style={styles.modalShell}>
          <View style={styles.chatContainer}>
            <View>
              <Text style={styles.modalTitle}>AI rebuttal</Text>
              <Text style={styles.modalSubtitle}>{selectedMerchant?.name}</Text>
            </View>

            <ScrollView contentContainerStyle={styles.chatMessages}>
              {chatHistory.length === 0 ? (
                <Text style={styles.emptyChatText}>Enter the merchant&apos;s excuse and get a calm, firm response.</Text>
              ) : null}
              {chatHistory.map((message, index) => (
                <View
                  key={`${message.role}-${index}`}
                  style={[styles.chatBubble, message.role === 'user' ? styles.userBubble : styles.aiBubble]}
                >
                  <Text style={[styles.chatText, message.role === 'user' ? styles.userBubbleText : null]}>
                    {message.text}
                  </Text>
                </View>
              ))}
              {chatLoading ? (
                <View style={styles.inlineLoader}>
                  <ActivityIndicator color="#4f46e5" />
                  <Text style={styles.infoText}>Thinking...</Text>
                </View>
              ) : null}
            </ScrollView>

            <TextInput
              multiline
              placeholder="Example: Sales are slow today."
              value={chatMessage}
              onChangeText={setChatMessage}
              style={styles.notesInput}
            />

            <View style={styles.modalButtons}>
              <Pressable style={styles.actionButton} onPress={() => setChatVisible(false)}>
                <Text style={styles.actionButtonText}>Close</Text>
              </Pressable>
              <Pressable style={styles.primaryButton} onPress={handleChat} disabled={chatLoading}>
                <Text style={styles.primaryButtonText}>Send</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const statusStyles = StyleSheet.create({
  active: { backgroundColor: '#dcfce7' },
  delinquent: { backgroundColor: '#fee2e2' },
  'at-risk': { backgroundColor: '#fef3c7' }
});

const statusTextStyles = StyleSheet.create({
  active: { color: '#166534' },
  delinquent: { color: '#991b1b' },
  'at-risk': { color: '#92400e' }
});

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f8fafc'
  },
  content: {
    padding: 16,
    gap: 16
  },
  headerCard: {
    backgroundColor: '#111827',
    borderRadius: 24,
    padding: 20,
    gap: 10
  },
  kicker: {
    color: '#c7d2fe',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '700'
  },
  headerSubtitle: {
    color: '#cbd5e1',
    fontSize: 15
  },
  headerStats: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8
  },
  statCard: {
    flex: 1,
    backgroundColor: '#1f2937',
    borderRadius: 18,
    padding: 14
  },
  statLabel: {
    color: '#94a3b8',
    fontSize: 12,
    marginBottom: 4
  },
  statValue: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700'
  },
  secondaryButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#312e81',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 4
  },
  secondaryButtonText: {
    color: '#ffffff',
    fontWeight: '600'
  },
  infoCard: {
    backgroundColor: '#eef2ff',
    borderRadius: 20,
    padding: 16,
    gap: 8
  },
  infoTitle: {
    color: '#312e81',
    fontSize: 16,
    fontWeight: '700'
  },
  infoText: {
    color: '#3730a3',
    fontSize: 14,
    lineHeight: 20
  },
  inlineLoader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  merchantCard: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 14
  },
  selectedMerchantCard: {
    borderColor: '#4f46e5',
    shadowColor: '#312e81',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2
  },
  merchantHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start'
  },
  rankBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#e0e7ff',
    alignItems: 'center',
    justifyContent: 'center'
  },
  rankText: {
    color: '#3730a3',
    fontWeight: '700'
  },
  merchantMain: {
    flex: 1,
    gap: 2
  },
  merchantName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a'
  },
  merchantMeta: {
    color: '#64748b',
    fontSize: 13
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  merchantStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12
  },
  balanceValue: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '700'
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15
  },
  actionButton: {
    flex: 1,
    backgroundColor: '#eef2ff',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12
  },
  actionButtonText: {
    color: '#3730a3',
    fontWeight: '700',
    fontSize: 15
  },
  modalShell: {
    flex: 1,
    backgroundColor: '#f8fafc'
  },
  modalContent: {
    padding: 20,
    gap: 16
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0f172a'
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 4
  },
  fieldLabel: {
    color: '#334155',
    fontWeight: '700',
    marginTop: 8
  },
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10
  },
  choiceChip: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  choiceChipSelected: {
    borderColor: '#4f46e5',
    backgroundColor: '#e0e7ff'
  },
  choiceChipText: {
    color: '#475569',
    fontWeight: '600',
    textTransform: 'capitalize'
  },
  choiceChipTextSelected: {
    color: '#3730a3'
  },
  notesInput: {
    minHeight: 110,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 14,
    textAlignVertical: 'top'
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8
  },
  chatContainer: {
    flex: 1,
    padding: 20,
    gap: 16
  },
  chatMessages: {
    flexGrow: 1,
    gap: 12
  },
  emptyChatText: {
    color: '#64748b',
    lineHeight: 20
  },
  chatBubble: {
    maxWidth: '88%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  userBubble: {
    backgroundColor: '#111827',
    alignSelf: 'flex-end'
  },
  aiBubble: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignSelf: 'flex-start'
  },
  chatText: {
    color: '#0f172a',
    lineHeight: 20
  },
  userBubbleText: {
    color: '#ffffff'
  }
});
