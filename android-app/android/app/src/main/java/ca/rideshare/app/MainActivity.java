package ca.rideshare.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RideShareLocationPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onResume() {
        super.onResume();
        LocationService.appVisible(true);
    }

    @Override
    public void onPause() {
        LocationService.appVisible(false);
        super.onPause();
    }
}
