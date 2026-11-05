package ca.rideshare.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

/** The Picked up / Dropped off tap in a notification: records the step, tells the driver what the next stop is, and refreshes Google Maps. No screen of its own. */
public class StepGoActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        final Intent in = getIntent();
        final String mid = in == null ? null : in.getStringExtra("match"), step = in == null ? null : in.getStringExtra("step");
        final String name = in == null || in.getStringExtra("name") == null ? "The rider" : in.getStringExtra("name");
        final LocationService s = LocationService.get();
        if (mid == null || step == null || s == null) {
            Toast.makeText(getApplicationContext(), "Open RideShare and tap it there.", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        final android.content.Context app = getApplicationContext();
        new Thread(() -> {
            final LocationService.StepResult r = s.stepThenRoute(mid, step, name);
            runOnUiThread(() -> {
                Toast.makeText(app, r.message, Toast.LENGTH_LONG).show();
                if (r.nav != null) {
                    // a moment to read the message, then Maps restarts with the stops that are left
                    new Handler(Looper.getMainLooper()).postDelayed(() -> {
                        Intent maps = new Intent(Intent.ACTION_VIEW, r.nav).setPackage("com.google.android.apps.maps");
                        try { startActivity(maps); } catch (ActivityNotFoundException e) {
                            try { startActivity(new Intent(Intent.ACTION_VIEW, r.nav)); } catch (Exception ignore) { }
                        }
                        finish();
                    }, 1500);
                } else {
                    finish();
                }
            });
        }).start();
    }
}
