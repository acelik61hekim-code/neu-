import { useEffect } from 'react';
import { Platform } from 'react-native';

import * as NavigationBar from 'expo-navigation-bar';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const APP_BACKGROUND = '#06060c';

export default function RootLayout() {
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(APP_BACKGROUND);

    if (Platform.OS === 'android') {
      NavigationBar.setStyle('dark');
    }
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          animation: 'fade',
          contentStyle: { backgroundColor: APP_BACKGROUND },
          headerShown: false,
        }}
      />
    </SafeAreaProvider>
  );
}
