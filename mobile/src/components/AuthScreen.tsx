import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { ApiError, login, register } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

export function AuthScreen() {
  const [isLogin, setIsLogin] = useState(true);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  // Per-field messages, fed from the API's `fields` map so the officer sees
  // which input the server rejected rather than one opaque alert.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { signIn } = useAuth();

  const clearError = (key: string) => setErrors((e) => ({ ...e, [key]: '' }));

  const handleAuth = async () => {
    // Validate locally first so an obvious mistake gets an instant answer with
    // no round-trip; the server stays the authority and overwrites these.
    const local: Record<string, string> = {};
    if (!email.trim()) local.email = 'Enter your email address';
    if (!password) local.password = 'Enter your password';
    if (!isLogin) {
      if (!firstName.trim()) local.firstName = 'First name is required';
      if (!lastName.trim()) local.lastName = 'Last name is required';
      if (password && password.length < 6) local.password = 'Password must be at least 6 characters';
    }
    if (Object.keys(local).length > 0) {
      setErrors(local);
      return;
    }

    setLoading(true);
    setErrors({});
    try {
      if (isLogin) {
        // Password is sent exactly as typed — never trim a password.
        const response = await login(email.trim(), password);
        signIn(response.token, { ...response.officer, role: 'co' });
      } else {
        const response = await register({
          email: email.trim(),
          password,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          inviteCode: inviteCode.trim() || undefined
        });
        signIn(response.token, { ...response.officer, role: 'co' });
      }
    } catch (error) {
      if (error instanceof ApiError && Object.keys(error.fields).length > 0) {
        setErrors(error.fields);
      }
      Alert.alert(
        isLogin ? 'Could not sign in' : 'Could not create account',
        error instanceof Error ? error.message : 'Authentication failed'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.heading}>{isLogin ? 'Welcome back' : 'Create CO account'}</Text>
        <Text style={styles.caption}>
          {isLogin ? 'Sign in to continue your route.' : 'This mobile app currently supports field officers only.'}
        </Text>

        {!isLogin ? (
          <View style={styles.row}>
            <View style={styles.halfInput}>
              <TextInput
                placeholder="First name"
                value={firstName}
                onChangeText={(t) => { setFirstName(t); clearError('firstName'); }}
                style={[styles.input, !!errors.firstName && styles.inputError]}
              />
              {errors.firstName ? <Text style={styles.errorText}>{errors.firstName}</Text> : null}
            </View>
            <View style={styles.halfInput}>
              <TextInput
                placeholder="Last name"
                value={lastName}
                onChangeText={(t) => { setLastName(t); clearError('lastName'); }}
                style={[styles.input, !!errors.lastName && styles.inputError]}
              />
              {errors.lastName ? <Text style={styles.errorText}>{errors.lastName}</Text> : null}
            </View>
          </View>
        ) : null}

        <TextInput
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="Email"
          value={email}
          onChangeText={(t) => { setEmail(t); clearError('email'); }}
          style={[styles.input, !!errors.email && styles.inputError]}
        />
        {errors.email ? <Text style={styles.errorText}>{errors.email}</Text> : null}
        <TextInput
          secureTextEntry
          placeholder="Password"
          value={password}
          onChangeText={(t) => { setPassword(t); clearError('password'); }}
          style={[styles.input, !!errors.password && styles.inputError]}
        />
        {errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}

        {!isLogin ? (
          <View>
            <TextInput
              autoCapitalize="none"
              placeholder="Invite code (from your supervisor)"
              value={inviteCode}
              onChangeText={(t) => { setInviteCode(t); clearError('inviteCode'); }}
              style={[styles.input, !!errors.inviteCode && styles.inputError]}
            />
            {errors.inviteCode ? <Text style={styles.errorText}>{errors.inviteCode}</Text> : null}
          </View>
        ) : null}

        <Pressable onPress={handleAuth} style={styles.primaryButton} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.primaryButtonText}>{isLogin ? 'Sign in' : 'Create account'}</Text>
          )}
        </Pressable>

        <Pressable onPress={() => { setIsLogin((value) => !value); setErrors({}); }} style={styles.linkButton}>
          <Text style={styles.linkText}>
            {isLogin ? "Don't have an account? Create one" : 'Already have an account? Sign in'}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    width: '100%'
  },
  card: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 20,
    gap: 12
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0f172a'
  },
  caption: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 8
  },
  row: {
    flexDirection: 'row',
    gap: 10
  },
  input: {
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16
  },
  halfInput: {
    flex: 1
  },
  inputError: {
    borderColor: '#dc2626'
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 12,
    marginTop: 4
  },
  primaryButton: {
    backgroundColor: '#111827',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700'
  },
  linkButton: {
    alignItems: 'center',
    paddingVertical: 8
  },
  linkText: {
    color: '#4338ca',
    fontSize: 14,
    fontWeight: '600'
  }
});
