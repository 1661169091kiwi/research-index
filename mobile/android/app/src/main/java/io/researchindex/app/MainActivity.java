package io.researchindex.app;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RiNative.class);
        super.onCreate(savedInstanceState);
        // Back closes what is open on the page (a paper, a menu) first; then goes back a page;
        // on the first page it puts the app away instead of closing it, so it reopens where you were.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = getBridge() == null ? null : getBridge().getWebView();
                if (web == null) { moveTaskToBack(true); return; }
                web.evaluateJavascript("(window.__riBack && window.__riBack()) ? 'yes' : 'no'", (handled) -> {
                    if (handled != null && handled.contains("yes")) return;
                    if (web.canGoBack()) web.goBack();
                    else moveTaskToBack(true);
                });
            }
        });
    }
}
