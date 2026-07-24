import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

/**
 * Field-level validation in the CO app.
 *
 * The app previously answered a bad form with a single `Alert.alert('Error',
 * 'Please fill in all fields')` — which does not say WHICH field, and on some
 * paths returned silently so the button appeared to do nothing at all. These
 * tests pin the corrected behaviour: an error is rendered inline, against the
 * offending input, on the screen itself.
 */
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined)
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import { AuthProvider } from '../contexts/AuthContext';
import { AuthScreen } from '../components/AuthScreen';

const renderScreen = () =>
  render(
    <AuthProvider>
      <AuthScreen />
    </AuthProvider>
  );

describe('AuthScreen field validation', () => {
  it('names the empty fields inline instead of one opaque alert', () => {
    renderScreen();
    fireEvent.press(screen.getByText('Sign in'));

    expect(screen.getByText('Enter your email address')).toBeTruthy();
    expect(screen.getByText('Enter your password')).toBeTruthy();
  });

  it('clears a field error as soon as the officer starts fixing it', () => {
    renderScreen();
    fireEvent.press(screen.getByText('Sign in'));
    expect(screen.getByText('Enter your email address')).toBeTruthy();

    fireEvent.changeText(screen.getByPlaceholderText('Email'), 'officer@rill.com');
    expect(screen.queryByText('Enter your email address')).toBeNull();
  });

  it('enforces the password policy before a pointless round-trip on register', () => {
    renderScreen();
    fireEvent.press(screen.getByText("Don't have an account? Create one"));

    fireEvent.changeText(screen.getByPlaceholderText('Email'), 'officer@rill.com');
    fireEvent.changeText(screen.getByPlaceholderText('Password'), '123');
    fireEvent.changeText(screen.getByPlaceholderText('First name'), 'Field');
    fireEvent.changeText(screen.getByPlaceholderText('Last name'), 'Officer');
    fireEvent.press(screen.getByText('Create account'));

    // Same wording the server uses, so the message does not change shape
    // depending on whether it was caught locally or remotely.
    expect(screen.getByText('Password must be at least 6 characters')).toBeTruthy();
  });

  it('requires a name on register and says which one', () => {
    renderScreen();
    fireEvent.press(screen.getByText("Don't have an account? Create one"));

    fireEvent.changeText(screen.getByPlaceholderText('Email'), 'officer@rill.com');
    fireEvent.changeText(screen.getByPlaceholderText('Password'), 'password123');
    fireEvent.press(screen.getByText('Create account'));

    expect(screen.getByText('First name is required')).toBeTruthy();
    expect(screen.getByText('Last name is required')).toBeTruthy();
  });

  it('drops stale errors when switching between sign-in and register', () => {
    renderScreen();
    fireEvent.press(screen.getByText('Sign in'));
    expect(screen.getByText('Enter your password')).toBeTruthy();

    fireEvent.press(screen.getByText("Don't have an account? Create one"));
    expect(screen.queryByText('Enter your password')).toBeNull();
  });
});
