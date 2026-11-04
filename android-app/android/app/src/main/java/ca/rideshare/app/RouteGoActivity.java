package ca.rideshare.app;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

/** The "Update route" tap: remembers that the driver acted (so the alert is not shown again), then opens Google Maps with the new stops. */
public class RouteGoActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Uri nav = getIntent() == null ? null : getIntent().getData();
        getSharedPreferences("rideshare_tracking", MODE_PRIVATE).edit().putString("route_state", "done").remove("route_gone_at").apply();
        try { getSystemService(NotificationManager.class).cancel(3000); } catch (Exception ignore) { }
        if (nav != null) {
            Intent maps = new Intent(Intent.ACTION_VIEW, nav).setPackage("com.google.android.apps.maps");
            try { startActivity(maps); } catch (ActivityNotFoundException e) {
                try { startActivity(new Intent(Intent.ACTION_VIEW, nav)); } catch (Exception ignore) { }
            }
        }
        finish();
    }
}
