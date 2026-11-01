package com.chronoflow.app;

import android.annotation.SuppressLint;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.PermissionRequest;
import android.os.Build;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import android.content.pm.PackageManager;
import android.Manifest;

public class MainActivity extends AppCompatActivity {

    private WebView webView;

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        // Request notification permissions for Android 13+ (Tiramisu)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ActivityCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, 101);
            }
        }

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // Register Native JavaScript Bridge
        webView.addJavascriptInterface(new WebAppInterface(this), "AndroidNative");

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                request.grant(request.getResources());
            }
        });

        // Load bundled web assets
        webView.loadUrl("file:///android_asset/index.html");
    }

    private long backPressedTime = 0;
    private android.widget.Toast backToast;

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }

        // Check if any modal or overlay is open in the web application
        webView.evaluateJavascript("(function() { return (typeof window.handleAndroidBack === 'function') ? window.handleAndroidBack() : false; })();", value -> {
            // "true" means a modal or form was open and was closed by the web app
            if ("true".equalsIgnoreCase(value) || "\"true\"".equalsIgnoreCase(value)) {
                return;
            }

            // If history can go back, do that
            if (webView.canGoBack()) {
                webView.goBack();
                return;
            }

            // Standard double-tap back to exit application
            long currentTime = System.currentTimeMillis();
            if (currentTime - backPressedTime < 2000) {
                if (backToast != null) backToast.cancel();
                finish();
            } else {
                backPressedTime = currentTime;
                backToast = android.widget.Toast.makeText(MainActivity.this, "Press back again to exit ZenRhythm", android.widget.Toast.LENGTH_SHORT);
                backToast.show();
            }
        });
    }
}
