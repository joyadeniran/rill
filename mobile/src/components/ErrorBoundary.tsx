import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches render/runtime exceptions anywhere in the child tree so a single bad
 * API payload or unexpected value can no longer crash the whole app in a
 * production (release) build, where the React Native red-screen does not exist.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface in dev tooling / crash logs without taking the app down.
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.subtitle}>
            The app hit an unexpected problem but stayed open. You can retry below.
          </Text>
          {!!this.state.error?.message && (
            <View style={styles.detailBox}>
              <Text style={styles.detailText}>{this.state.error.message}</Text>
            </View>
          )}
          <Pressable style={styles.button} onPress={this.handleReset}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </ScrollView>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    padding: 24,
    gap: 14
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0f172a'
  },
  subtitle: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center'
  },
  detailBox: {
    backgroundColor: '#fee2e2',
    borderRadius: 12,
    padding: 12,
    width: '100%'
  },
  detailText: {
    fontSize: 12,
    color: '#991b1b'
  },
  button: {
    backgroundColor: '#1e1b4b',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 28,
    marginTop: 8
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 16
  }
});
