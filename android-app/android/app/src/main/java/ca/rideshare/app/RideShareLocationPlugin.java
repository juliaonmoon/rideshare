package ca.rideshare.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** The bridge between the RideShare web page and the Android background location service. */
@CapacitorPlugin(
        name = "RideShareLocation",
        permissions = {
                @Permission(alias = "location", strings = {Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}),
                @Permission(alias = "notifications", strings = {"android.permission.POST_NOTIFICATIONS"})
        })
public class RideShareLocationPlugin extends Plugin {

    /** start({ url, key, token }): asks for permission if needed, then starts the foreground service. */
    @PluginMethod
    public void start(PluginCall call) {
        if (call.getString("token") == null || call.getString("url") == null) {
            call.reject("Missing token or url");
            return;
        }
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "locationResult");
            return;
        }
        afterLocation(call);
    }

    @PermissionCallback
    private void locationResult(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) {
            afterLocation(call);
        } else {
            call.reject("Location permission was not granted");
        }
    }

    private void afterLocation(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationResult");
            return;
        }
        launch(call);
    }

    @PermissionCallback
    private void notificationResult(PluginCall call) {
        launch(call); // a denied notification permission does not stop the service from running
    }

    private void launch(PluginCall call) {
        Intent i = new Intent(getContext(), LocationService.class)
                .putExtra("url", call.getString("url"))
                .putExtra("key", call.getString("key", ""))
                .putExtra("token", call.getString("token"));
        ContextCompat.startForegroundService(getContext(), i);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), LocationService.class));
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("running", LocationService.running);
        r.put("lastOk", LocationService.lastOk);
        r.put("error", LocationService.lastError);
        call.resolve(r);
    }

    /** overlayStatus(): { allowed } is true when the floating RideShare button may be shown over other apps. */
    @PluginMethod
    public void overlayStatus(PluginCall call) {
        JSObject r = new JSObject();
        r.put("allowed", LocationService.canOverlay(getContext()));
        r.put("hidden", getContext().getSharedPreferences("rideshare_bubble", android.content.Context.MODE_PRIVATE).getBoolean("hidden", false));
        call.resolve(r);
    }

    /** setBubbleHidden({ hidden }): switches the floating RideShare button off (or on again) for good. */
    @PluginMethod
    public void setBubbleHidden(PluginCall call) {
        boolean h = Boolean.TRUE.equals(call.getBoolean("hidden", false));
        getContext().getSharedPreferences("rideshare_bubble", android.content.Context.MODE_PRIVATE).edit().putBoolean("hidden", h).apply();
        call.resolve();
    }

    /** openOverlaySettings(): opens the phone's "Display over other apps" switch for RideShare. */
    @PluginMethod
    public void openOverlaySettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open the settings");
        }
    }

    /** fakeLocation({ lat, lng }): for testing without driving. The helper pretends the car is at this point for 15 minutes (clearFakeLocation() ends it). */
    @PluginMethod
    public void fakeLocation(PluginCall call) {
        Double lat = call.getDouble("lat"), lng = call.getDouble("lng");
        if (lat == null || lng == null) { call.reject("Missing lat or lng"); return; }
        LocationService.fakeLat = lat; LocationService.fakeLng = lng;
        LocationService.fakeUntil = System.currentTimeMillis() + 15 * 60 * 1000;
        call.resolve();
    }

    /** setAutopilot({ on }): admin test mode only. The helper drives the pretend car to each stop by itself. */
    @PluginMethod
    public void setAutopilot(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        LocationService.autopilot = on;
        if (!on) LocationService.fakeUntil = 0;
        call.resolve();
    }

    @PluginMethod
    public void clearFakeLocation(PluginCall call) {
        LocationService.fakeUntil = 0;
        call.resolve();
    }

    /** Make sure the seat-request alert channel exists (same settings as the service uses), so its settings page can be opened. */
    private NotificationChannel alertChannel() {
        NotificationManager nm = getContext().getSystemService(NotificationManager.class);
        NotificationChannel ch = nm.getNotificationChannel(LocationService.ALERT_CHANNEL);
        if (ch == null) {
            ch = new NotificationChannel(LocationService.ALERT_CHANNEL, "Seat requests", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("An alert when a rider asks for a seat while you are driving");
            ch.setBypassDnd(true); // only honoured once the phone's owner allows it in settings
            nm.createNotificationChannel(ch);
        }
        return ch;
    }

    /** dndStatus(): { bypass } is true when seat-request alerts may break through Do Not Disturb / Sleeping mode. */
    @PluginMethod
    public void dndStatus(PluginCall call) {
        JSObject r = new JSObject();
        r.put("bypass", Build.VERSION.SDK_INT >= 26 && alertChannel().canBypassDnd());
        call.resolve(r);
    }

    /** openAlertSettings(): opens the phone's settings page for the seat-request alerts (one switch: Override Do Not Disturb). */
    @PluginMethod
    public void openAlertSettings(PluginCall call) {
        Intent i;
        if (Build.VERSION.SDK_INT >= 26) {
            alertChannel();
            i = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName())
                    .putExtra(Settings.EXTRA_CHANNEL_ID, LocationService.ALERT_CHANNEL);
        } else {
            i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        }
        try {
            getContext().startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open the settings");
        }
    }

    /** openUrl({ url }): opens a link in the Google Maps app (voice directions), or the browser if Maps is missing. */
    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("Missing url");
            return;
        }
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            i.setPackage("com.google.android.apps.maps");
            getContext().startActivity(i);
        } catch (ActivityNotFoundException e) {
            i.setPackage(null);
            try {
                getContext().startActivity(i);
            } catch (Exception x) {
                call.reject("Could not open the link");
                return;
            }
        }
        call.resolve();
    }
}
