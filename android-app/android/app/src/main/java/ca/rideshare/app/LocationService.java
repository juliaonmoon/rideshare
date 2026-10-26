package ca.rideshare.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Keeps running while RideShare is not on screen (for example while Google Maps is giving voice directions):
 * it sends the driver's position to the RideShare database (only while a ride is in progress) and shows a phone
 * notification when a rider asks for a seat. Both use a short-lived tracking token.
 * Android requires the permanent notification below for any app that reads location in the background.
 * The service stops by itself when the token expires or the driver has nothing on for today.
 */
public class LocationService extends Service {
    static final String CHANNEL = "rideshare_tracking";
    static final String ALERT_CHANNEL = "rideshare_requests";
    private static final long POLL_MS = 15000;
    static final String ACTION_ACCEPT = "ca.rideshare.app.ACCEPT";
    static final String ACTION_DECLINE = "ca.rideshare.app.DECLINE";
    static volatile boolean running = false;
    static volatile long lastOk = 0;
    static volatile String lastError = "";

    private FusedLocationProviderClient client;
    private LocationCallback callback;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private String url = "", key = "", token = "";
    private volatile boolean ride = false;        // a ride is in progress, so positions are sent
    private boolean firstPoll = true;             // requests already waiting when we start are not announced
    private int inactive = 0;
    private final Set<String> notified = new HashSet<>();
    private boolean polling = false;
    private final Runnable poller = new Runnable() {
        @Override public void run() {
            if (!io.isShutdown()) io.execute(LocationService.this::pollAlerts);
            main.postDelayed(this, POLL_MS);
        }
    };

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences sp = getSharedPreferences("rideshare_tracking", MODE_PRIVATE);
        if (intent != null && intent.hasExtra("token")) {
            sp.edit().putString("url", intent.getStringExtra("url")).putString("key", intent.getStringExtra("key"))
                    .putString("token", intent.getStringExtra("token")).apply();
        }
        url = sp.getString("url", "");
        key = sp.getString("key", "");
        token = sp.getString("token", "");
        if (token.isEmpty() || url.isEmpty()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        createChannel();
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
                .setContentTitle("RideShare is on while you drive")
                .setContentText("Riders on a ride with you can see where you are, and you get an alert if someone asks for a seat.")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setOngoing(true)
                .setContentIntent(pi)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(1, n);
        }
        startUpdates();
        if (!polling) { polling = true; main.post(poller); }
        running = true;
        if (intent != null && intent.getAction() != null) handleAnswer(intent);   // Accept / Decline pressed on a seat-request alert
        return START_STICKY;
    }

    private void startUpdates() {
        if (callback != null) return;
        client = LocationServices.getFusedLocationProviderClient(this);
        callback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                Location loc = result.getLastLocation();
                if (loc != null) io.execute(() -> post(loc));
            }
        };
        LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 4000)
                .setMinUpdateIntervalMillis(2000).build();
        try {
            client.requestLocationUpdates(req, callback, Looper.getMainLooper());
        } catch (SecurityException e) {
            lastError = "Location permission missing";
            stopSelf();
        }
    }

    private void post(Location loc) {
        if (!ride) return;   // no ride in progress: nothing is sent
        HttpURLConnection c = null;
        try {
            JSONObject body = new JSONObject();
            body.put("p_token", token);
            body.put("p_lat", loc.getLatitude());
            body.put("p_lng", loc.getLongitude());
            body.put("p_speed", loc.hasSpeed() ? (double) Math.max(0f, Math.min(100f, loc.getSpeed() * 3.6f)) : JSONObject.NULL);
            body.put("p_heading", loc.hasBearing() ? (double) loc.getBearing() : JSONObject.NULL);
            body.put("p_accuracy", loc.hasAccuracy() ? (double) loc.getAccuracy() : JSONObject.NULL);
            c = (HttpURLConnection) new URL(url + "/rest/v1/rpc/share_position_token").openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(8000);
            c.setReadTimeout(8000);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("apikey", key);
            try (OutputStream os = c.getOutputStream()) {
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            int code = c.getResponseCode();
            if (code >= 200 && code < 300) {
                lastOk = System.currentTimeMillis();
                lastError = "";
            } else {
                InputStream es = c.getErrorStream();
                String msg = "";
                if (es != null) {
                    try (BufferedReader br = new BufferedReader(new InputStreamReader(es))) {
                        StringBuilder sb = new StringBuilder();
                        String line;
                        while ((line = br.readLine()) != null && sb.length() < 400) sb.append(line);
                        msg = sb.toString();
                    }
                }
                lastError = "HTTP " + code + " " + msg;
                if (msg.contains("No ride in progress")) { ride = false; lastError = ""; }
                // The token expired or was revoked: switch off by ourselves.
                if (msg.contains("Invalid or expired")) {
                    main.post(this::stopSelf);
                }
            }
        } catch (Exception e) {
            lastError = String.valueOf(e.getMessage());
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** Asks the server about this driver: ride in progress? still on duty? any new seat requests? */
    private void pollAlerts() {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url + "/rest/v1/rpc/driver_alerts_token").openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(8000);
            c.setReadTimeout(8000);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("apikey", key);
            try (OutputStream os = c.getOutputStream()) {
                os.write(new JSONObject().put("p_token", token).toString().getBytes(StandardCharsets.UTF_8));
            }
            int code = c.getResponseCode();
            InputStream is = code >= 200 && code < 300 ? c.getInputStream() : c.getErrorStream();
            StringBuilder sb = new StringBuilder();
            if (is != null) {
                try (BufferedReader br = new BufferedReader(new InputStreamReader(is))) {
                    String line;
                    while ((line = br.readLine()) != null && sb.length() < 8000) sb.append(line);
                }
            }
            String body = sb.toString();
            if (code < 200 || code >= 300) {
                if (body.contains("Invalid or expired")) main.post(this::stopSelf);
                else if (code == 404) ride = true;   // older database without alerts: send positions the old way (the server refuses them when there is no ride)
                return;   // no network or an error: try again next time
            }
            JSONObject o = new JSONObject(body);
            ride = o.optBoolean("ride", false);
            if (o.optBoolean("active", false)) inactive = 0;
            else if (++inactive >= 4) { main.post(this::stopSelf); return; }   // nothing on today: about a minute of quiet, then off
            JSONArray pend = o.optJSONArray("pending");
            if (pend != null) {
                for (int i = 0; i < pend.length(); i++) {
                    JSONObject p = pend.getJSONObject(i);
                    String id = p.optString("id");
                    if (id.isEmpty() || !notified.add(id)) continue;
                    if (!firstPoll) announce(id, p.optString("name", "A rider"), p.optString("pickup"), p.optString("dropoff"));
                }
            }
            firstPoll = false;
        } catch (Exception e) {
            // no network right now: try again next time
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private PendingIntent answerIntent(String action, String id, String name, int nid) {
        Intent i = new Intent(this, LocationService.class).setAction(action).putExtra("match", id).putExtra("name", name).putExtra("nid", nid);
        return PendingIntent.getService(this, nid * 2 + (ACTION_ACCEPT.equals(action) ? 1 : 2), i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private void announce(String id, String name, String pickup, String dropoff) {
        final int nid = 1000 + (id.hashCode() & 0xffff);
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, ALERT_CHANNEL)
                .setContentTitle(name + " asked for a seat")
                .setContentText(pickup + " to " + dropoff + ". Tap to open RideShare and accept or decline.")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setDefaults(Notification.DEFAULT_ALL)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .addAction(0, "Accept", answerIntent(ACTION_ACCEPT, id, name, nid))
                .addAction(0, "Decline", answerIntent(ACTION_DECLINE, id, name, nid))
                .build();
        try {
            getSystemService(NotificationManager.class).notify(nid, n);
        } catch (Exception e) {
            // notifications are blocked: the alert is lost, the request is still waiting in the app
        }
    }

    private void handleAnswer(Intent intent) {
        final boolean accept = ACTION_ACCEPT.equals(intent.getAction());
        final String id = intent.getStringExtra("match");
        final String name = intent.getStringExtra("name") == null ? "The rider" : intent.getStringExtra("name");
        final int nid = intent.getIntExtra("nid", 0);
        if (id == null || io.isShutdown()) return;
        io.execute(() -> answer(id, name, accept, nid));
    }

    /** Accepts or declines a request with the same rules as the app. */
    private void answer(String id, String name, boolean accept, int nid) {
        HttpURLConnection c = null;
        NotificationManager nm = getSystemService(NotificationManager.class);
        try {
            c = (HttpURLConnection) new URL(url + "/rest/v1/rpc/respond_match_token").openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(8000);
            c.setReadTimeout(8000);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("apikey", key);
            try (OutputStream os = c.getOutputStream()) {
                os.write(new JSONObject().put("p_token", token).put("p_match", id).put("p_accept", accept).toString().getBytes(StandardCharsets.UTF_8));
            }
            int code = c.getResponseCode();
            InputStream is = code >= 200 && code < 300 ? c.getInputStream() : c.getErrorStream();
            StringBuilder sb = new StringBuilder();
            if (is != null) {
                try (BufferedReader br = new BufferedReader(new InputStreamReader(is))) {
                    String line;
                    while ((line = br.readLine()) != null && sb.length() < 4000) sb.append(line);
                }
            }
            if (code >= 200 && code < 300) {
                nm.cancel(nid);
                if (accept) routeAlert(name);
            } else {
                String msg = "Please open RideShare and try there.";
                try { msg = new JSONObject(sb.toString()).optString("message", msg); } catch (Exception ignore) { }
                nm.cancel(nid);
                post2("Could not answer " + name, msg, 2000 + (nid & 0xfff));
            }
        } catch (Exception e) {
            post2("Could not answer " + name, "No connection. Open RideShare to answer.", 2000 + (nid & 0xfff));
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** After an accept: one tap re-opens Google Maps with the new stop (RideShare keeps counting the drive time and distance). */
    private void routeAlert(String name) {
        Intent link = new Intent(Intent.ACTION_VIEW, Uri.parse("ca.rideshare.app://update-route"))
                .setClass(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 7, link, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, ALERT_CHANNEL)
                .setContentTitle(name + " is added to your trip")
                .setContentText("Tap to update your route in Google Maps. Your drive time and distance keep counting.")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setDefaults(Notification.DEFAULT_ALL)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .addAction(0, "Update route", pi)
                .build();
        try { getSystemService(NotificationManager.class).notify(3000, n); } catch (Exception ignore) { }
    }

    private void post2(String title, String text, int id) {
        Notification n = new NotificationCompat.Builder(this, ALERT_CHANNEL)
                .setContentTitle(title).setContentText(text).setSmallIcon(android.R.drawable.ic_dialog_info)
                .setPriority(NotificationCompat.PRIORITY_HIGH).setAutoCancel(true).build();
        try { getSystemService(NotificationManager.class).notify(id, n); } catch (Exception ignore) { }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel al = new NotificationChannel(ALERT_CHANNEL, "Seat requests", NotificationManager.IMPORTANCE_HIGH);
            al.setDescription("An alert when a rider asks for a seat while you are driving");
            al.setBypassDnd(true); // only honoured once the phone's owner allows it in settings (RideShare asks for that)
            getSystemService(NotificationManager.class).createNotificationChannel(al);
        }
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Location sharing", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while RideShare shares your location during a trip");
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
    }

    @Override
    public void onDestroy() {
        running = false;
        main.removeCallbacks(poller);
        polling = false;
        if (client != null && callback != null) client.removeLocationUpdates(callback);
        callback = null;
        io.shutdown();
        getSharedPreferences("rideshare_tracking", MODE_PRIVATE).edit().clear().apply();
        super.onDestroy();
    }
}
