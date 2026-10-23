import {WebView} from '@amazon-devices/webview';
import * as React from 'react';
import {useRef} from 'react';
import {View, StyleSheet} from 'react-native';
import {
  useHideSplashScreenCallback,
  usePreventHideSplashScreen,
} from '@amazon-devices/react-native-kepler';
import {
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
  WebViewNavigationEvent,
} from '@amazon-devices/webview/dist/types/WebViewTypes';
import {SERVER_URL} from './playerConfig';

const PLAYER_BASE = SERVER_URL ? `${SERVER_URL}/player.html` : 'file:///pkg/assets/index.html';
const PLAYER_URI = PLAYER_BASE + (__DEV__ ? '?tv=1&debug=1&reset=1' : '?tv=1');

export const App = () => {
  const webRef = useRef(null);
  usePreventHideSplashScreen();
  const hideSplashScreenCallback = useHideSplashScreenCallback();
  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        style={styles.webview}
        source={{uri: PLAYER_URI}}
        allowSystemKeyEvents
        domStorageEnabled
        hasTVPreferredFocus
        javaScriptEnabled
        mediaPlaybackRequiresUserAction={false}
        mixedContentMode="never"
        onLoad={(_event: WebViewNavigationEvent) => {
          console.info('[PromptToTV] Player loaded');
          hideSplashScreenCallback();
        }}
        onError={({nativeEvent: {code, url, description}}: WebViewErrorEvent) => {
          console.error(`[PromptToTV] load error (${code}: ${url}) ${description}`);
        }}
        onHttpError={({nativeEvent: {url, statusCode, description}}: WebViewHttpErrorEvent) => {
          console.error(`[PromptToTV] HTTP ${statusCode} for ${url}: ${description}`);
        }}
        onMessage={(event: {nativeEvent: {data: string}}) => {
          if (__DEV__ && typeof event.nativeEvent.data === 'string' && event.nativeEvent.data.startsWith('PTV_STATE ')) {
            console.info('[PromptToTV] ' + event.nativeEvent.data);
          }
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#000000'},
  webview: {backgroundColor: '#000000'},
});
