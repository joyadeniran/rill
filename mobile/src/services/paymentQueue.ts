import AsyncStorage from '@react-native-async-storage/async-storage';
import { recordRepayment, isNetworkError, type RepaymentRequest } from './api';

// Minimal offline queue for payments ONLY (the one action that must never be
// lost in the field). Each entry carries the idempotency key generated at the
// moment the CO confirmed the payment, so a flush can never double-record —
// the server dedupes on the key even if the original request actually landed.

const QUEUE_KEY = 'rill.paymentQueue.v1';

export interface QueuedPayment extends RepaymentRequest {
  merchantName: string;
  queuedAt: string;
}

async function readQueue(): Promise<QueuedPayment[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: QueuedPayment[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Best effort; worst case the CO re-enters the payment and the
    // idempotency key on the server side still protects the ledger.
  }
}

export async function enqueuePayment(payment: QueuedPayment): Promise<number> {
  const queue = await readQueue();
  // Never queue the same idempotency key twice.
  if (!queue.some((q) => q.idempotencyKey === payment.idempotencyKey)) {
    queue.push(payment);
    await writeQueue(queue);
  }
  return queue.length;
}

export async function pendingCount(): Promise<number> {
  return (await readQueue()).length;
}

/** True if a payment for this merchant is already awaiting sync. Used to stop
 * a CO from recording a second offline payment for the same merchant before
 * the first one lands (the most likely accidental-duplicate path). */
export async function hasPendingFor(userId: string): Promise<boolean> {
  return (await readQueue()).some((q) => q.userId === userId);
}

/**
 * Attempt to send every queued payment. Entries that reach the server are
 * removed — including server-side rejections (4xx), which are reported back
 * so the CO knows the entry did NOT count. Entries that still cannot reach
 * the server stay queued. Safe to call repeatedly.
 */
export async function flushQueue(): Promise<{ sent: number; rejected: string[]; remaining: number }> {
  const queue = await readQueue();
  if (queue.length === 0) return { sent: 0, rejected: [], remaining: 0 };

  const stillQueued: QueuedPayment[] = [];
  const rejected: string[] = [];
  let sent = 0;

  for (const payment of queue) {
    try {
      await recordRepayment(payment);
      sent += 1;
    } catch (error) {
      if (isNetworkError(error)) {
        stillQueued.push(payment); // still offline — keep for next flush
      } else {
        // The server heard us and said no (e.g. exceeds balance after another
        // payment landed first). Drop it and surface the reason.
        const message = error instanceof Error ? error.message : 'rejected';
        rejected.push(`${payment.merchantName}: NGN ${payment.amount} — ${message}`);
      }
    }
  }

  await writeQueue(stillQueued);
  return { sent, rejected, remaining: stillQueued.length };
}
