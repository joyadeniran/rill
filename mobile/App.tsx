import React from 'react';
import { ActivityIndicator, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { AuthScreen } from './src/components/AuthScreen';
import { FieldOfficerApp } from './src/components/FieldOfficerApp';
import { ErrorBoundary } from './src/components/ErrorBoundary';

function AppContent() {
  const { loading, role } = useAuth();

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator size="large" color="#312e81" />
        <Text style={styles.loadingText}>Loading Rill CO...</Text>
      </SafeAreaView>
    );
  }

  if (role !== 'co') {
    return (
      <SafeAreaView style={styles.centered}>
        <StatusBar barStyle="dark-content" />
        <Text style={styles.title}>Rill CO</Text>
        <Text style={styles.subtitle}>This mobile app is currently built for field officers only.</Text>
        <AuthScreen />
      </SafeAreaView>
    );
  }

  return <FieldOfficerApp />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#0f172a'
  },
  subtitle: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    marginBottom: 16
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#475569'
  }
});
