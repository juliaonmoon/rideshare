package ca.rideshare.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.app.NotificationManager;
import android.content.Intent;

/** Runs when the driver swipes the "Update route" alert away without tapping it. The helper then shows it again a minute later. */
public class RouteDismissReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        boolean stop = i != null && i.getBooleanExtra("stop", false);   // the Dismiss button: do not bring it back
        c.getSharedPreferences("rideshare_tracking", Context.MODE_PRIVATE).edit()
                .putString("route_state", stop ? "done" : "dismissed").putLong("route_dismissed_at", System.currentTimeMillis()).apply();
        if (stop) { try { c.getSystemService(NotificationManager.class).cancel(3000); } catch (Exception ignore) { } }
    }
}
