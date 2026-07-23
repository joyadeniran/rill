import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';

// The app imports native modules at MODULE-LOAD time (before React mounts):
//   - expo-secure-store            (src/services/session.ts)
//   - @react-native-async-storage  (src/services/paymentQueue.ts)
// If either fails to resolve, the failure happens above the ErrorBoundary and
// the user sees a BLANK screen with no recovery. Mock them so this test
// exercises the JS boot graph deterministically under jest.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined)
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Imported AFTER the mocks above are registered.
import App from '../../App';

describe('App boot (blank-screen guard)', () => {
  it('commits a first frame (the loading screen) without a module-load or render throw', async () => {
    render(<App />);

    // On the very first frame AuthContext.loading is true, so App renders the
    // "Loading Rill CO..." branch. If any top-level import or the initial
    // render had thrown, this text would never mount — the exact "nothing at
    // all is showing" symptom. Reaching this assertion proves the boot graph
    // loads and React commits a frame.
    expect(screen.getByText('Loading Rill CO...')).toBeTruthy();

    // Let the async session-restore effect settle so it doesn't leak an
    // act() warning into the next test.
    await waitFor(() => expect(screen.getByText('Loading Rill CO...')).toBeTruthy());
  });

  it('does not re-enable expo-updates in app.json', () => {
    // Enabling expo-updates put the app on the release blank-screen path
    // (updates mediates bundle loading in a bare gradlew build). The app does
    // not use OTA, so this must stay absent.
    const appConfig = require('../../app.json') as { expo: { updates?: unknown } };
    expect(appConfig.expo.updates).toBeUndefined();
  });
});
