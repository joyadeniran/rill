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
import { login, register } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

export function AuthScreen() {
  const [isLogin, setIsLogin] = useState(true);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();

  const handleAuth = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      if (isLogin) {
        // Password is sent exactly as typed — never trim a password.
        const response = await login(email.trim(), password);
        signIn(response.token, { ...response.officer, role: 'co' });
      } else {
        if (!firstName || !lastName) {
          Alert.alert('Error', 'Please provide your name');
          setLoading(false);
          return;
        }
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
      const message = error instanceof Error ? error.message : 'Authentication failed';
      Alert.alert('Rill CO', message);
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
            <TextInput
              placeholder="First name"
              value={firstName}
              onChangeText={setFirstName}
              style={[styles.input, styles.halfInput]}
            />
            <TextInput
              placeholder="Last name"
              value={lastName}
              onChangeText={setLastName}
              style={[styles.input, styles.halfInput]}
            />
          </View>
        ) : null}

        <TextInput
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          style={styles.input}
        />
        <TextInput
          secureTextEntry
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          style={styles.input}
        />

        {!isLogin ? (
          <TextInput
            autoCapitalize="none"
            placeholder="Invite code (from your supervisor)"
            value={inviteCode}
            onChangeText={setInviteCode}
            style={styles.input}
          />
        ) : null}

        <Pressable onPress={handleAuth} style={styles.primaryButton} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.primaryButtonText}>{isLogin ? 'Sign in' : 'Create account'}</Text>
          )}
        </Pressable>

        <Pressable onPress={() => setIsLogin((value) => !value)} style={styles.linkButton}>
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
