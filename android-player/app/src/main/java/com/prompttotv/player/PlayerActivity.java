package com.prompttotv.player;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.TextUtils;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;

public class PlayerActivity extends Activity {

    private static final String TAG = "PromptToTVPlayer";
    private static final String PREFS = "ptv_prefs";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String KEY_MODE = "mode";
    private static final String MODE_OFFLINE = "offline";
    private static final String MODE_SERVER = "server";

    private static final String OFFLINE_HOST = "appassets.androidplatform.net";
    private static final String OFFLINE_ORIGIN = "https://" + OFFLINE_HOST;

    private static final String SANDBOX_CSP =
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'";

    private static final Pattern APP_ID = Pattern.compile("^app_[0-9a-f]{12}$");
    private static final Pattern OFFLINE_FILE = Pattern.compile("^/offline/[A-Za-z0-9_-]+\\.(js|json)$");

    private SharedPreferences prefs;
    private FrameLayout root;
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);

        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (debuggable) {
            WebView.setWebContentsDebuggingEnabled(true);
            applyTestLaunchExtras(getIntent());
        }

        String mode = prefs.getString(KEY_MODE, null);
        String serverUrl = prefs.getString(KEY_SERVER_URL, null);
        if (MODE_OFFLINE.equals(mode)) {
            loadOffline();
        } else if (serverUrl != null) {
            loadServer(serverUrl);
        } else {
            showSetupScreen();
        }
    }

    private void applyTestLaunchExtras(Intent intent) {
        if (intent == null) return;
        String mode = intent.getStringExtra("ptv_mode");
        String url = intent.getStringExtra("ptv_server_url");
        if (MODE_OFFLINE.equals(mode)) {
            prefs.edit().putString(KEY_MODE, MODE_OFFLINE).apply();
        } else if ("setup".equals(mode)) {
            prefs.edit().remove(KEY_MODE).remove(KEY_SERVER_URL).apply();
        } else if (url != null && !url.trim().isEmpty()) {
            prefs.edit().putString(KEY_MODE, MODE_SERVER).putString(KEY_SERVER_URL, url.trim()).apply();
        }
    }


    private void showSetupScreen() {
        teardownWebView();
        root.removeAllViews();

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(80, 60, 80, 60);
        layout.setBackgroundColor(0xFF0B0F14);

        TextView title = new TextView(this);
        title.setText("App Studio");
        title.setTextColor(Color.WHITE);
        title.setTextSize(30);
        title.setPadding(0, 0, 0, 24);
        layout.addView(title);

        Button offline = new Button(this);
        offline.setText("Offline demo (no server needed)");
        offline.setTextSize(22);
        offline.setOnClickListener(v -> {
            prefs.edit().putString(KEY_MODE, MODE_OFFLINE).apply();
            loadOffline();
        });
        layout.addView(offline);

        TextView offlineHint = new TextView(this);
        offlineHint.setText("Runs the Player with apps bundled in this APK. Use this on cloud test devices.");
        offlineHint.setTextColor(0xFF9FB0C0);
        offlineHint.setTextSize(18);
        offlineHint.setPadding(0, 8, 0, 40);
        layout.addView(offlineHint);

        TextView label = new TextView(this);
        label.setText("Or connect to an App Studio server. On the computer running server.js, run\n"
                + "adb reverse tcp:4848 tcp:4848, then use http://localhost:4848");
        label.setTextColor(Color.WHITE);
        label.setTextSize(20);
        layout.addView(label);

        final EditText input = new EditText(this);
        String saved = prefs.getString(KEY_SERVER_URL, null);
        input.setText(saved != null ? saved : "http://localhost:4848");
        input.setTextColor(Color.WHITE);
        input.setTextSize(20);
        input.setSingleLine(true);
        layout.addView(input);

        Button connect = new Button(this);
        connect.setText("Connect");
        connect.setTextSize(20);
        connect.setOnClickListener(v -> {
            String url = input.getText().toString().trim();
            if (url.isEmpty() || url.equals("http://") || url.equals("https://")) return;
            prefs.edit().putString(KEY_MODE, MODE_SERVER).putString(KEY_SERVER_URL, url).apply();
            loadServer(url);
        });
        layout.addView(connect);

        TextView menuHint = new TextView(this);
        menuHint.setText("Press the Menu (☰) button on the remote at any time to come back here.");
        menuHint.setTextColor(0xFF9FB0C0);
        menuHint.setTextSize(18);
        menuHint.setPadding(0, 40, 0, 0);
        layout.addView(menuHint);

        root.addView(layout);
        offline.requestFocus();
    }


    private void loadServer(String baseUrl) {
        String playerUrl = baseUrl.replaceAll("/+$", "") + "/player.html?tv=1";
        Log.i(TAG, "Mode=server, loading " + playerUrl);
        cancelRetry();
        retryUrl = playerUrl;
        createWebView(false).loadUrl(playerUrl);
    }

    private void loadOffline() {
        String playerUrl = OFFLINE_ORIGIN + "/player.html?tv=1";
        Log.i(TAG, "Mode=offline, loading " + playerUrl);
        cancelRetry();
        retryUrl = null;
        createWebView(true).loadUrl(playerUrl);
    }


    private static final long RETRY_MS = 3000;
    private final Handler retryHandler = new Handler(Looper.getMainLooper());
    private String retryUrl;
    private final Runnable retryLoad = () -> {
        if (webView != null && retryUrl != null) {
            Log.i(TAG, "Retrying " + retryUrl);
            webView.loadUrl(retryUrl);
        }
    };

    private void cancelRetry() {
        retryHandler.removeCallbacks(retryLoad);
    }

    private void showServerUnreachable(WebView view, String failingUrl, String reason) {
        Log.w(TAG, "Player page failed to load (" + reason + "): " + failingUrl);
        String safeUrl = TextUtils.htmlEncode(String.valueOf(retryUrl));
        String safeReason = TextUtils.htmlEncode(String.valueOf(reason));
        String html = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head>"
                + "<body style=\"margin:0;background:#0b0f14;color:#fff;font-family:sans-serif;"
                + "display:flex;align-items:center;justify-content:center;height:100vh;text-align:center\">"
                + "<div><div style=\"font-size:34px;font-weight:700;margin-bottom:18px\">Can't reach App Studio</div>"
                + "<div style=\"font-size:22px;color:#9fb0c0;line-height:1.5\">" + safeUrl + "<br>"
                + "Retrying every few seconds. Press Menu (&#9776;) to change the address.</div>"
                + "<div style=\"font-size:16px;color:#6b7a89;margin-top:18px\">" + safeReason + "</div></div></body></html>";
        view.loadDataWithBaseURL("about:blank", html, "text/html", "utf-8", null);
        cancelRetry();
        retryHandler.postDelayed(retryLoad, RETRY_MS);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private WebView createWebView(final boolean offline) {
        teardownWebView();
        root.removeAllViews();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setGeolocationEnabled(false);
        settings.setMediaPlaybackRequiresUserGesture(false);

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage msg) {
                Log.d(TAG, "[webview console] " + msg.message() + " (" + msg.sourceId() + ":" + msg.lineNumber() + ")");
                return true;
            }
        });

        final Uri home = Uri.parse(offline ? OFFLINE_ORIGIN : prefs.getString(KEY_SERVER_URL, ""));
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return offline ? offlineResponse(request.getUrl()) : null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                boolean sameOrigin = sameOrigin(request.getUrl(), home);
                if (!sameOrigin) Log.w(TAG, "Blocked navigation to " + request.getUrl());
                return !sameOrigin;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!offline && request.isForMainFrame()) {
                    showServerUnreachable(view, String.valueOf(request.getUrl()), String.valueOf(error.getDescription()));
                }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (!offline && request.isForMainFrame()) {
                    showServerUnreachable(view, String.valueOf(request.getUrl()), "HTTP " + response.getStatusCode());
                }
            }
        });

        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        webView.requestFocus();
        return webView;
    }

    private void teardownWebView() {
        cancelRetry();
        if (webView != null) {
            root.removeView(webView);
            webView.destroy();
            webView = null;
        }
    }

    @Override
    protected void onDestroy() {
        teardownWebView();
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    private static boolean sameOrigin(Uri a, Uri b) {
        if (a == null || b == null || a.getScheme() == null || a.getHost() == null) return false;
        return a.getScheme().equalsIgnoreCase(String.valueOf(b.getScheme()))
                && a.getHost().equalsIgnoreCase(String.valueOf(b.getHost()))
                && a.getPort() == b.getPort();
    }


    private WebResourceResponse offlineResponse(Uri url) {
        if (!OFFLINE_HOST.equalsIgnoreCase(String.valueOf(url.getHost()))) {
            Log.w(TAG, "Offline mode refused a request to " + url);
            return text(403, "Forbidden", "text/plain", "offline demo mode makes no network requests");
        }
        String path = url.getPath() == null ? "/" : url.getPath();
        try {
            if (path.equals("/") || path.equals("/player.html")) {
                String html = new String(readAsset("player.html"), StandardCharsets.UTF_8);
                String shim = "<script src=\"/offline/offline-backend.js\"></script>";
                int head = html.indexOf("<head>");
                html = head >= 0 ? html.substring(0, head + 6) + shim + html.substring(head + 6) : shim + html;
                return text(200, "OK", "text/html", html);
            }
            if (OFFLINE_FILE.matcher(path).matches()) {
                String mime = path.endsWith(".json") ? "application/json" : "application/javascript";
                return bytes(200, "OK", mime, readAsset(path.substring(1)), null);
            }
            if (path.equals("/sandbox")) {
                String appId = url.getQueryParameter("t");
                if (appId == null || !APP_ID.matcher(appId).matches()) {
                    return text(403, "Forbidden", "text/plain", "bad link");
                }
                Map<String, String> headers = new HashMap<>();
                headers.put("Content-Security-Policy", SANDBOX_CSP);
                return bytes(200, "OK", "text/html", readAsset("offline/apps/" + appId + ".html"), headers);
            }
        } catch (IOException e) {
            return text(404, "Not Found", "text/plain", "not found");
        }
        return text(404, "Not Found", "text/plain", "not found");
    }

    private byte[] readAsset(String name) throws IOException {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    private static WebResourceResponse text(int status, String reason, String mime, String body) {
        return bytes(status, reason, mime, body.getBytes(StandardCharsets.UTF_8), null);
    }

    private static WebResourceResponse bytes(int status, String reason, String mime, byte[] body,
                                             Map<String, String> extraHeaders) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        if (extraHeaders != null) headers.putAll(extraHeaders);
        return new WebResourceResponse(mime, "utf-8", status, reason, headers, new ByteArrayInputStream(body));
    }


    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (webView == null) return super.dispatchKeyEvent(event);

        int keyCode = event.getKeyCode();
        boolean up = event.getAction() == KeyEvent.ACTION_UP;

        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (up && !event.isCanceled()) handleBack();
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MENU) {
            if (up) {
                prefs.edit().remove(KEY_MODE).apply();
                showSetupScreen();
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    private void handleBack() {
        final WebView wv = webView;
        wv.evaluateJavascript(
                "(function(){var f=document.getElementById('frame');return !!(f&&f.style.display==='block');})()",
                value -> {
                    if (wv != webView) return;
                    if ("true".equals(value)) {
                        Log.i(TAG, "Back -> running app (Escape)");
                        long now = SystemClock.uptimeMillis();
                        wv.dispatchKeyEvent(new KeyEvent(now, now, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ESCAPE, 0));
                        wv.dispatchKeyEvent(new KeyEvent(now, now, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ESCAPE, 0));
                    } else {
                        Log.i(TAG, "Back -> exit Player");
                        finish();
                    }
                });
    }
}
