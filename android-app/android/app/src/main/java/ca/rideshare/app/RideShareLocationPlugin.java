package ca.rideshare.app;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

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
