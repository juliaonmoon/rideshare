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

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Keeps reading the phone's GPS while RideShare is not on screen (for example while Google Maps is giving voice
 * directions) and sends each position to the RideShare database with a short-lived tracking token.
 * Android requires the permanent notification below for any app that reads location in the background.
 * The service stops by itself when the server says the ride is over.
 */
public class LocationService extends Service {
    static final String CHANNEL = "rideshare_tracking";
    static volatile boolean running = false;
    static volatile long lastOk = 0;
    static volatile String lastError = "";

    private FusedLocationProviderClient client;
    private LocationCallback callback;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private String url = "", key = "", token = "";

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
                .setContentTitle("RideShare is sharing your location")
                .setContentText("Riders on your trip can see where you are. Tap to open RideShare.")
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
        running = true;
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
                // The ride is over (or the token expired): stop sharing by ourselves.
                if (msg.contains("No ride in progress") || msg.contains("Invalid or expired")) {
                    main.post(this::stopSelf);
                }
            }
        } catch (Exception e) {
            lastError = String.valueOf(e.getMessage());
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Location sharing", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while RideShare shares your location during a trip");
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
    }

    @Override
    public void onDestroy() {
        running = false;
        if (client != null && callback != null) client.removeLocationUpdates(callback);
        callback = null;
        io.shutdown();
        getSharedPreferences("rideshare_tracking", MODE_PRIVATE).edit().clear().apply();
        super.onDestroy();
    }
}
