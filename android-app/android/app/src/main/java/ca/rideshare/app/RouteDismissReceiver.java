package ca.rideshare.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Runs when the driver swipes the "Update route" alert away without tapping it. The helper then shows it again a minute later. */
public class RouteDismissReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        c.getSharedPreferences("rideshare_tracking", Context.MODE_PRIVATE).edit()
                .putString("route_state", "dismissed").putLong("route_dismissed_at", System.currentTimeMillis()).apply();
    }
}
