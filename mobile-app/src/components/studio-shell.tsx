import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import * as Network from 'expo-network';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Image,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import type { ComponentProps } from 'react';

const BASE_URL = 'https://kivideostudio.de';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

type AppSection = {
  key: 'video' | 'songs' | 'images' | 'studio' | 'account';
  label: string;
  path: string;
  icon: IoniconName;
  activeIcon: IoniconName;
};

const APP_SECTIONS: readonly AppSection[] = [
  {
    key: 'video',
    label: 'Video',
    path: '/ki-video-erstellen',
    icon: 'film-outline',
    activeIcon: 'film',
  },
  {
    key: 'songs',
    label: 'Songs',
    path: '/ki-song-erstellen',
    icon: 'musical-notes-outline',
    activeIcon: 'musical-notes',
  },
  {
    key: 'images',
    label: 'Bilder',
    path: '/ki-bilder-erstellen',
    icon: 'image-outline',
    activeIcon: 'image',
  },
  {
    key: 'studio',
    label: 'Studio',
    path: '/video-studio',
    icon: 'sparkles-outline',
    activeIcon: 'sparkles',
  },
  {
    key: 'account',
    label: 'Konto',
    path: '/konto',
    icon: 'person-circle-outline',
    activeIcon: 'person-circle',
  },
] as const;

const IN_APP_HOSTS = new Set([
  'kivideostudio.de',
  'www.kivideostudio.de',
  'yjpszodbvwhbmgxdmfpj.supabase.co',
  'accounts.google.com',
  'github.com',
  'appleid.apple.com',
  'checkout.stripe.com',
  'billing.stripe.com',
]);

const NATIVE_BRIDGE_SCRIPT = `
  window.__KI_VIDEO_STUDIO_NATIVE_APP__ = true;
  document.documentElement.dataset.nativeApp = 'true';
  true;
`;

function getSectionForUrl(url: string): AppSection['key'] | null {
  try {
    const pathname = new URL(url).pathname;

    if (pathname.startsWith('/ki-song-erstellen') || pathname.startsWith('/songs')) {
      return 'songs';
    }

    if (pathname.startsWith('/ki-bilder-erstellen')) {
      return 'images';
    }

    if (pathname.startsWith('/video-studio') || pathname.startsWith('/sound-studio')) {
      return 'studio';
    }

    if (pathname.startsWith('/konto') || pathname.startsWith('/anmelden')) {
      return 'account';
    }

    if (pathname === '/' || pathname.startsWith('/ki-video-erstellen')) {
      return 'video';
    }
  } catch {
    return null;
  }

  return null;
}

function shouldStayInsideApp(url: string) {
  if (
    url === 'about:blank' ||
    url.startsWith('blob:') ||
    url.startsWith('data:')
  ) {
    return true;
  }

  try {
    const parsedUrl = new URL(url);
    return (
      parsedUrl.protocol === 'https:' &&
      (IN_APP_HOSTS.has(parsedUrl.hostname) ||
        parsedUrl.hostname.endsWith('.kivideostudio.de'))
    );
  } catch {
    return false;
  }
}

function LoadingView() {
  return (
    <View style={styles.loadingView}>
      <Image
        source={require('@/assets/images/ki-video-studio-icon.png')}
        style={styles.loadingLogo}
      />
      <ActivityIndicator color="#9b7cff" size="large" />
      <Text style={styles.loadingTitle}>KI Video Studio wird geladen</Text>
      <Text style={styles.loadingText}>Deine Kreativstudios werden vorbereitet.</Text>
    </View>
  );
}

type ConnectionViewProps = {
  hasError: boolean;
  onRetry: () => void;
};

function ConnectionView({ hasError, onRetry }: ConnectionViewProps) {
  return (
    <View style={styles.connectionView}>
      <View style={styles.connectionIcon}>
        <Ionicons
          color="#bca7ff"
          name={hasError ? 'cloud-offline-outline' : 'wifi-outline'}
          size={30}
        />
      </View>
      <Text style={styles.connectionTitle}>
        {hasError ? 'Studio nicht erreichbar' : 'Keine Internetverbindung'}
      </Text>
      <Text style={styles.connectionText}>
        Für Video-, Song- und Bildgenerierungen wird eine sichere
        Internetverbindung benötigt.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Verbindung erneut versuchen"
        onPress={onRetry}
        style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
      >
        <Ionicons color="#ffffff" name="refresh" size={18} />
        <Text style={styles.retryButtonText}>Erneut versuchen</Text>
      </Pressable>
    </View>
  );
}

export default function StudioShell() {
  const webViewRef = useRef<WebView>(null);
  const networkState = Network.useNetworkState();
  const [activeSection, setActiveSection] =
    useState<AppSection['key']>('video');
  const [currentUrl, setCurrentUrl] = useState(
    `${BASE_URL}/ki-video-erstellen`,
  );
  const [canGoBack, setCanGoBack] = useState(false);
  const [hasLoadError, setHasLoadError] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);

  const isOffline =
    networkState.isConnected === false ||
    networkState.isInternetReachable === false;

  const section = useMemo(
    () =>
      APP_SECTIONS.find((item) => item.key === activeSection) ??
      APP_SECTIONS[0],
    [activeSection],
  );

  const source = useMemo(
    () => ({
      uri: `${BASE_URL}${section.path}`,
      headers: {
        'X-KI-Video-Studio-App': '1',
      },
    }),
    [section.path],
  );

  const retry = useCallback(() => {
    setHasLoadError(false);
    setReloadVersion((version) => version + 1);
    webViewRef.current?.reload();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return undefined;
    }

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (!canGoBack) {
          return false;
        }

        webViewRef.current?.goBack();
        return true;
      },
    );

    return () => subscription.remove();
  }, [canGoBack]);

  const openSection = useCallback(
    (nextSection: AppSection) => {
      void Haptics.selectionAsync();

      if (nextSection.key === activeSection) {
        webViewRef.current?.reload();
        return;
      }

      setHasLoadError(false);
      setCanGoBack(false);
      setActiveSection(nextSection.key);
      setCurrentUrl(`${BASE_URL}${nextSection.path}`);
    },
    [activeSection],
  );

  const shareCurrentPage = useCallback(async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Share.share({
      message: `KI Video Studio: ${currentUrl}`,
      title: 'KI Video Studio',
      url: currentUrl,
    });
  }, [currentUrl]);

  const handleNavigationRequest = useCallback((request: { url: string }) => {
    if (shouldStayInsideApp(request.url)) {
      return true;
    }

    if (
      request.url.startsWith('mailto:') ||
      request.url.startsWith('tel:') ||
      request.url.startsWith('https:')
    ) {
      void Linking.openURL(request.url);
    }

    return false;
  }, []);

  return (
    <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safeArea}>
      <View style={styles.header}>
        <View style={styles.brand}>
          <Image
            source={require('@/assets/images/ki-video-studio-icon.png')}
            style={styles.brandLogo}
          />
          <View>
            <Text style={styles.brandName}>KI Video Studio</Text>
            <View style={styles.brandStatusRow}>
              <View
                style={[
                  styles.statusDot,
                  isOffline && styles.statusDotOffline,
                ]}
              />
              <Text style={styles.brandStatus}>
                {isOffline ? 'Offline' : 'Bereit zum Erstellen'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Aktuelle Seite neu laden"
            onPress={retry}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Ionicons color="#d8d5e2" name="refresh" size={20} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Aktuelle Seite teilen"
            onPress={shareCurrentPage}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Ionicons color="#d8d5e2" name="share-outline" size={20} />
          </Pressable>
        </View>
      </View>

      <View style={styles.content}>
        <WebView
          key={`${activeSection}-${reloadVersion}`}
          ref={webViewRef}
          source={source}
          style={styles.webView}
          applicationNameForUserAgent="KIVideoStudioApp/1.0"
          allowsBackForwardNavigationGestures
          allowsFullscreenVideo
          allowsInlineMediaPlayback
          allowFileAccess
          bounces={false}
          cacheEnabled
          domStorageEnabled
          injectedJavaScriptBeforeContentLoaded={NATIVE_BRIDGE_SCRIPT}
          javaScriptEnabled
          mediaPlaybackRequiresUserAction={false}
          mixedContentMode="never"
          onError={() => setHasLoadError(true)}
          onFileDownload={({ nativeEvent }) => {
            void Linking.openURL(nativeEvent.downloadUrl);
          }}
          onLoadStart={() => setHasLoadError(false)}
          onNavigationStateChange={(navigationState) => {
            setCanGoBack(navigationState.canGoBack);
            setCurrentUrl(navigationState.url);

            const detectedSection = getSectionForUrl(navigationState.url);
            if (detectedSection) {
              setActiveSection(detectedSection);
            }
          }}
          onShouldStartLoadWithRequest={handleNavigationRequest}
          originWhitelist={['https://*', 'http://*', 'about:*', 'blob:*', 'data:*']}
          overScrollMode="never"
          pullToRefreshEnabled
          renderLoading={LoadingView}
          setSupportMultipleWindows={false}
          sharedCookiesEnabled
          startInLoadingState
          thirdPartyCookiesEnabled
        />

        {(isOffline || hasLoadError) && (
          <ConnectionView hasError={hasLoadError} onRetry={retry} />
        )}
      </View>

      <View style={styles.navigation}>
        {APP_SECTIONS.map((item) => {
          const isActive = item.key === activeSection;

          return (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityLabel={`${item.label} öffnen`}
              accessibilityState={{ selected: isActive }}
              onPress={() => openSection(item)}
              style={({ pressed }) => [
                styles.navigationItem,
                isActive && styles.navigationItemActive,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                color={isActive ? '#b89cff' : '#797582'}
                name={isActive ? item.activeIcon : item.icon}
                size={21}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.navigationLabel,
                  isActive && styles.navigationLabelActive,
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: '#06060c',
    flex: 1,
  },
  header: {
    alignItems: 'center',
    backgroundColor: '#0b0b12',
    borderBottomColor: 'rgba(255,255,255,0.08)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 64,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  brand: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  brandLogo: {
    borderRadius: 12,
    height: 42,
    width: 42,
  },
  brandName: {
    color: '#f7f5fb',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.25,
  },
  brandStatusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    marginTop: 3,
  },
  statusDot: {
    backgroundColor: '#55d98b',
    borderRadius: 4,
    height: 6,
    width: 6,
  },
  statusDotOffline: {
    backgroundColor: '#f09a69',
  },
  brandStatus: {
    color: '#85818f',
    fontSize: 10,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 6,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  content: {
    backgroundColor: '#07070d',
    flex: 1,
  },
  webView: {
    backgroundColor: '#07070d',
    flex: 1,
  },
  loadingView: {
    alignItems: 'center',
    backgroundColor: '#07070d',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    padding: 32,
  },
  loadingLogo: {
    borderRadius: 22,
    height: 78,
    marginBottom: 8,
    width: 78,
  },
  loadingTitle: {
    color: '#f7f5fb',
    fontSize: 17,
    fontWeight: '800',
    marginTop: 4,
    textAlign: 'center',
  },
  loadingText: {
    color: '#888491',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  connectionView: {
    alignItems: 'center',
    backgroundColor: '#08080f',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    paddingHorizontal: 34,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  connectionIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(139,92,246,0.13)',
    borderColor: 'rgba(167,139,250,0.2)',
    borderRadius: 22,
    borderWidth: 1,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  connectionTitle: {
    color: '#f8f7fb',
    fontSize: 21,
    fontWeight: '800',
    marginTop: 20,
    textAlign: 'center',
  },
  connectionText: {
    color: '#9793a0',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 9,
    maxWidth: 360,
    textAlign: 'center',
  },
  retryButton: {
    alignItems: 'center',
    backgroundColor: '#7c4dff',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    marginTop: 24,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  navigation: {
    alignItems: 'center',
    backgroundColor: '#0a0a11',
    borderTopColor: 'rgba(255,255,255,0.08)',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 64,
    paddingHorizontal: 6,
    paddingTop: 5,
  },
  navigationItem: {
    alignItems: 'center',
    borderRadius: 13,
    flex: 1,
    gap: 3,
    justifyContent: 'center',
    minHeight: 51,
    paddingHorizontal: 2,
  },
  navigationItemActive: {
    backgroundColor: 'rgba(124,77,255,0.12)',
  },
  navigationLabel: {
    color: '#797582',
    fontSize: 10,
    fontWeight: '700',
  },
  navigationLabelActive: {
    color: '#c9b7ff',
  },
  pressed: {
    opacity: 0.7,
  },
});
