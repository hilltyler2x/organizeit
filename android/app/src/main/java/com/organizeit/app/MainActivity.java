package com.organizeit.app;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The Back button first closes whatever is open in the app (a photo, a dialog, Select,
        // the menu, a category; see src/ui/back.ts), and only leaves the app from the overview.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (bridge == null || bridge.getWebView() == null) {
                    leave(this);
                    return;
                }
                bridge.getWebView().evaluateJavascript("window.organizeitBack ? window.organizeitBack() : false", (handled) -> {
                    if (!"true".equals(handled)) leave(this);
                });
            }
        });
    }

    private void leave(OnBackPressedCallback callback) {
        callback.setEnabled(false);
        getOnBackPressedDispatcher().onBackPressed();
        callback.setEnabled(true);
    }
}
