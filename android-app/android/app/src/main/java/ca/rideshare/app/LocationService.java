package ca.rideshare.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageView;
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
    static final String ACTION_STEP = "ca.rideshare.app.STEP";
    static final String ACTION_QUIET = "ca.rideshare.app.QUIET";
    static final String STEPS_CHANNEL = "rideshare_steps";
    private static final double ARRIVE_M = 250;   // close enough to a pickup to say "your driver is here" (stop points are only known to about 100 m)
    private static final double DROP_M = 300;     // close enough to a drop-off to offer the Dropped off button
    static volatile boolean running = false;
    // Testing without driving: the app can tell the helper to pretend the car is at a point (used only from the admin test tools).
    static volatile double fakeLat = 0, fakeLng = 0;
    static volatile long fakeUntil = 0;
    // Test autopilot (admin test mode only): the helper drives the pretend car to each pickup / drop-off by itself.
    static volatile boolean autopilot = false;
    private String apKey = ""; private long apSince = 0;
    private boolean fakeLooping = false;
    private final Runnable fakeLoop = new Runnable() {
        @Override public void run() {
            if (!io.isShutdown() && fakeActive()) io.execute(LocationService.this::tickFake);
            main.postDelayed(this, 4000);
        }
    };
    static boolean fakeActive() { return System.currentTimeMillis() < fakeUntil; }
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
    private volatile boolean tripOn = false;   // the driver has a trip on today (so the floating button shows for the whole trip, not only while a rider is on board)
    private volatile JSONArray rides = new JSONArray();   // riders on the way (from the last check): who, which step, where
    private volatile Location lastLoc = null;
    private final Set<String> nearShown = new HashSet<>();   // "near a stop" pop-ups already shown ("pick:id", "drop:id")
    private final Set<Integer> stepIds = new HashSet<>();    // step notifications currently shown
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
        if (!fakeLooping) { fakeLooping = true; main.post(fakeLoop); }
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
                if (loc == null || fakeActive()) return;   // while testing with a pretend position, the real one is ignored
                lastLoc = loc;
                io.execute(() -> { post(loc); checkStops(loc); });
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
            tripOn = o.optBoolean("active", false);
            if (o.optBoolean("active", false)) inactive = 0;
            else if (++inactive >= 4) { main.post(this::stopSelf); return; }   // nothing on today: about a minute of quiet, then off
            JSONArray pend = o.optJSONArray("pending");
            if (pend != null) {
                for (int i = 0; i < pend.length(); i++) {
                    JSONObject p = pend.getJSONObject(i);
                    String id = p.optString("id");
                    if (id.isEmpty() || !notified.add(id)) continue;
                    if (!firstPoll) announce(id, p.optString("name", "A rider"), p.optString("pickup"), p.optString("dropoff"), detourText(p));
                }
            }
            firstPoll = false;
            JSONArray rs = o.optJSONArray("rides");
            rides = rs == null ? new JSONArray() : rs;
            updateStepNotes();
            runAutopilot();
            main.post(this::syncBubble);
            Location here = fakeActive() ? fakeLocation() : lastLoc;
            if (here != null) checkStops(here);
        } catch (Exception e) {
            // no network right now: try again next time
        } finally {
            if (c != null) c.disconnect();
        }
    }

    // ---------- a small floating RideShare button over Google Maps while a ride is under way: one tap brings the driver back to RideShare ----------
    private View bubble;
    private View closeTarget;                    // the X shown at the bottom while the button is being dragged
    private boolean bubbleDismissed = false;      // dragged onto the X: stay away until the next ride
    private boolean hadRides = false;
    private WindowManager.LayoutParams bubbleLp;

    static boolean canOverlay(android.content.Context c) { return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(c); }

    private void syncBubble() {
        boolean need = (tripOn || rides.length() > 0) && !getSharedPreferences("rideshare_bubble", MODE_PRIVATE).getBoolean("hidden", false);
        if (!tripOn && rides.length() == 0) bubbleDismissed = false;   // a new ride brings it back
        if (need && !bubbleDismissed && bubble == null && canOverlay(this)) showBubble(); else if ((!need || bubbleDismissed) && bubble != null) hideBubble();
    }

    private void showBubble() {
        try {
            final WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
            final float d = getResources().getDisplayMetrics().density;
            int size = (int) (58 * d);
            ImageView v = new ImageView(this);
            GradientDrawable bg = new GradientDrawable();
            bg.setShape(GradientDrawable.OVAL); bg.setColor(0xFFFFFFFF); bg.setStroke((int) (3 * d), 0xFF0B7A5B);
            v.setBackground(bg);
            int pad = (int) (8 * d); v.setPadding(pad, pad, pad, pad);
            v.setImageDrawable(getPackageManager().getApplicationIcon(getPackageName()));
            v.setElevation(8 * d);
            int type = Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
            final WindowManager.LayoutParams lp = new WindowManager.LayoutParams(size, size, type,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS, PixelFormat.TRANSLUCENT);
            lp.gravity = Gravity.TOP | Gravity.START;
            // the top-right corner to start with; after that, wherever the driver last dragged it
            SharedPreferences bp = getSharedPreferences("rideshare_bubble", MODE_PRIVATE);
            if (!bp.getBoolean("pos_v3", false)) bp.edit().remove("x").remove("y").putBoolean("pos_v3", true).apply();
            int screenW = getResources().getDisplayMetrics().widthPixels;
            lp.x = bp.getInt("x", screenW - size - (int) (10 * d)); lp.y = bp.getInt("y", topLimit());
            if (lp.x < 0 || lp.x > screenW - size) lp.x = screenW - size - (int) (10 * d);
            int screenH = getResources().getDisplayMetrics().heightPixels;
            if (lp.y < topLimit() || lp.y > screenH - size - (int) (80 * d)) lp.y = topLimit();
            v.setOnTouchListener(new View.OnTouchListener() {
                private float sx, sy; private int ox, oy; private boolean moved;
                private final Runnable hold = new Runnable() { @Override public void run() {   // press and hold: the button goes away until the next ride
                    if (!moved) { try { ((android.os.Vibrator) getSystemService(VIBRATOR_SERVICE)).vibrate(40); } catch (Exception ignore) { } bubbleDismissed = true; hideBubble(); } } };
                @Override public boolean onTouch(View view, MotionEvent e) {
                    switch (e.getAction()) {
                        case MotionEvent.ACTION_DOWN: sx = e.getRawX(); sy = e.getRawY(); ox = lp.x; oy = lp.y; moved = false; main.postDelayed(hold, 700); return true;
                        case MotionEvent.ACTION_MOVE:
                            if (Math.abs(e.getRawX() - sx) > 12 * d || Math.abs(e.getRawY() - sy) > 12 * d) { moved = true; main.removeCallbacks(hold); }
                            if (moved) {
                                lp.x = ox + (int) (e.getRawX() - sx); lp.y = oy + (int) (e.getRawY() - sy);
                                lp.x = Math.max(0, Math.min(lp.x, getResources().getDisplayMetrics().widthPixels - lp.width)); lp.y = Math.max(topLimit(), Math.min(lp.y, getResources().getDisplayMetrics().heightPixels - lp.height));
                                try { wm.updateViewLayout(view, lp); } catch (Exception ignore) { }
                                showCloseTarget(true, overTarget(e.getRawX(), e.getRawY()));
                            }
                            return true;
                        case MotionEvent.ACTION_UP:
                            main.removeCallbacks(hold);
                            if (bubble == null) return true;   // already dismissed by press and hold
                            if (moved && overTarget(e.getRawX(), e.getRawY())) { showCloseTarget(false, false); bubbleDismissed = true; main.post(LocationService.this::hideBubble); return true; }
                            showCloseTarget(false, false);
                            if (moved) { getSharedPreferences("rideshare_bubble", MODE_PRIVATE).edit().putInt("x", lp.x).putInt("y", lp.y).apply(); }
                            if (!moved) { try { startActivity(new Intent(LocationService.this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)); } catch (Exception ignore) { } }
                            return true;
                        default: return false;
                    }
                }
            });
            wm.addView(v, lp);
            bubble = v; bubbleLp = lp;
        } catch (Exception e) {
            bubble = null;   // no permission or the system refused: the notifications still work
        }
    }

    /** Is the finger over the X at the bottom centre of the screen? */
    private int topLimit() {
        int id = getResources().getIdentifier("status_bar_height", "dimen", "android");
        int sb = id > 0 ? getResources().getDimensionPixelSize(id) : (int) (28 * getResources().getDisplayMetrics().density);
        return sb + (int) (8 * getResources().getDisplayMetrics().density);
    }

    private boolean overTarget(float rawX, float rawY) {
        android.util.DisplayMetrics m = getResources().getDisplayMetrics();
        return rawY > m.heightPixels - 190 * m.density && Math.abs(rawX - m.widthPixels / 2f) < 90 * m.density;
    }

    private void showCloseTarget(boolean show, boolean hot) {
        try {
            WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
            float d = getResources().getDisplayMetrics().density;
            if (show && closeTarget == null) {
                android.widget.TextView t = new android.widget.TextView(this);
                t.setText("X"); t.setTextColor(0xFFFFFFFF); t.setTextSize(22); t.setGravity(Gravity.CENTER);
                int size = (int) (64 * d);
                int type = Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
                WindowManager.LayoutParams lp = new WindowManager.LayoutParams(size, size, type,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE, PixelFormat.TRANSLUCENT);
                lp.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL; lp.y = (int) (70 * d);
                wm.addView(t, lp);
                closeTarget = t;
            }
            if (closeTarget != null && show) {
                GradientDrawable g = new GradientDrawable();
                g.setShape(GradientDrawable.OVAL); g.setColor(hot ? 0xFFB42318 : 0xCC333333);
                closeTarget.setBackground(g);
            }
            if (!show && closeTarget != null) { wm.removeView(closeTarget); closeTarget = null; }
        } catch (Exception ignore) { closeTarget = null; }
    }

    private void hideBubble() {
        showCloseTarget(false, false);
        if (bubble == null) return;
        try { ((WindowManager) getSystemService(WINDOW_SERVICE)).removeView(bubble); } catch (Exception ignore) { }
        bubble = null;
    }

    /** Test autopilot: 20 s after a ride starts the pretend car reaches the pickup; 15 s after Picked up it reaches the drop-off. */
    private void runAutopilot() {
        if (!autopilot) return;
        JSONArray rs = rides;
        if (rs.length() == 0) { if (apKey.length() > 0) { apKey = ""; fakeUntil = 0; } return; }   // all rides done: back to the real GPS
        JSONObject r = rs.optJSONObject(0);
        if (r == null) return;
        boolean picked = "picked_up".equals(r.optString("stage"));
        String key = r.optString("id") + (picked ? ":drop" : ":pick");
        long now = System.currentTimeMillis();
        if (!key.equals(apKey)) { apKey = key; apSince = now; }
        String la = picked ? "dropoff_lat" : "pickup_lat", lo = picked ? "dropoff_lng" : "pickup_lng";
        if (now - apSince >= (picked ? 15000 : 20000) && !r.isNull(la)) { fakeLat = r.optDouble(la); fakeLng = r.optDouble(lo); fakeUntil = now + 15 * 60 * 1000; }
    }

    // ---------- the steps of a ride: Arrived (automatic), Picked up and Dropped off (one tap in a notification) ----------

    private static double meters(double lat1, double lng1, double lat2, double lng2) {
        double r = 6371000, p1 = Math.toRadians(lat1), p2 = Math.toRadians(lat2), dp = p2 - p1, dl = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
        return 2 * r * Math.asin(Math.sqrt(a));
    }

    private Location fakeLocation() {
        Location l = new Location("rideshare-test");
        l.setLatitude(fakeLat); l.setLongitude(fakeLng); l.setSpeed(0f); l.setAccuracy(10f);
        return l;
    }

    /** While a pretend position is active: send it like a real one and check the stops. */
    private void tickFake() {
        Location l = fakeLocation();
        lastLoc = l;
        post(l);
        checkStops(l);
    }

    // ID ranges (never overlapping): seat requests 100000.., step notes 200000.., stop pop-ups 300000.., error notes 400000.., each + 0..4095
    static final int ID_REQ = 100000, ID_STEP = 200000, ID_POP = 300000, ID_ERR = 400000;
    private static int idOf(int base, String matchId) { return base + (matchId.hashCode() & 0xfff); }

    private PendingIntent stepIntent(String step, String matchId, String name, int nid) {
        Intent i = new Intent(this, LocationService.class).setAction(ACTION_STEP).putExtra("match", matchId).putExtra("step", step).putExtra("name", name).putExtra("nid", nid);
        return PendingIntent.getService(this, nid * 8 + ("picked_up".equals(step) ? 3 : 5), i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private PendingIntent openIntent() {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(this, 2, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** A quiet notification per rider with the next step and its button (nothing pops up; it sits in the notification shade). */
    private void updateStepNotes() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        Set<Integer> now = new HashSet<>();
        JSONArray rs = rides;
        for (int i = 0; i < rs.length(); i++) {
            JSONObject r = rs.optJSONObject(i);
            if (r == null) continue;
            String id = r.optString("id"), name = r.optString("name", "Rider"), stage = r.optString("stage");
            boolean picked = "picked_up".equals(stage);
            int nid = idOf(ID_STEP, id);
            now.add(nid);
            Notification n = new NotificationCompat.Builder(this, STEPS_CHANNEL)
                    .setContentTitle(picked ? "Drop off " + name : "Pick up " + name)
                    .setContentText(picked ? r.optString("dropoff_name") : r.optString("pickup_name"))
                    .setSmallIcon(android.R.drawable.ic_menu_directions)
                    .setPriority(NotificationCompat.PRIORITY_LOW)
                    .setOnlyAlertOnce(true)
                    .setOngoing(true)
                    .setContentIntent(openIntent())
                    .addAction(0, picked ? "Dropped off " + name : "Picked up " + name, stepIntent(picked ? "dropped_off" : "picked_up", id, name, nid))
                    .build();
            try { nm.notify(nid, n); } catch (Exception ignore) { }
        }
        for (Integer old : new HashSet<>(stepIds)) if (!now.contains(old)) { nm.cancel(old); nm.cancel(old + (ID_POP - ID_STEP)); }
        // also clear step notifications left over from before the helper restarted (a ride that is already finished)
        try {
            for (android.service.notification.StatusBarNotification sbn : nm.getActiveNotifications()) {
                int id = sbn.getId();
                boolean step = id >= ID_STEP && id <= ID_STEP + 0xfff, pop = id >= ID_POP && id <= ID_POP + 0xfff;
                if ((step && !now.contains(id)) || (pop && !now.contains(id - (ID_POP - ID_STEP)))) nm.cancel(id);
            }
        } catch (Exception ignore) { }
        stepIds.clear(); stepIds.addAll(now);
    }

    /** Near a pickup: tell the rider "your driver is here" (automatic) and pop up the Picked up button. Near a drop-off: pop up Dropped off. */
    private void checkStops(Location loc) {
        JSONArray rs = rides;
        for (int i = 0; i < rs.length(); i++) {
            JSONObject r = rs.optJSONObject(i);
            if (r == null) continue;
            String id = r.optString("id"), name = r.optString("name", "Rider"), stage = r.optString("stage");
            long now = System.currentTimeMillis();
            if ("picked_up".equals(stage)) {
                if (r.optBoolean("dropoff_exact", false) && !r.isNull("dropoff_lat")
                        && meters(loc.getLatitude(), loc.getLongitude(), r.optDouble("dropoff_lat"), r.optDouble("dropoff_lng")) <= DROP_M && dueAlert("drop:" + id, now)) {
                    headsUp(id, "Near " + name + "'s drop-off", "Tap when " + name + " is out of the car.", "dropped_off", "Dropped off " + name, name);
                }
            } else if (r.optBoolean("pickup_exact", false) && !r.isNull("pickup_lat")
                    && meters(loc.getLatitude(), loc.getLongitude(), r.optDouble("pickup_lat"), r.optDouble("pickup_lng")) <= ARRIVE_M && dueAlert("pick:" + id, now)) {
                if ("on_my_way".equals(stage)) stepCall(id, "arrived");   // automatic: the rider sees "your driver has arrived"
                headsUp(id, "At " + name + "'s pickup", "Tap when " + name + " is in the car.", "picked_up", "Picked up " + name, name);
            }
        }
    }

    /** Android keeps a pop-up on screen for only a few seconds, so while the car is at a stop and the button has not been tapped,
     *  pop it up again every 10 seconds (at most 90 times, about 15 minutes). The button also stays in the notification list the whole time. */
    private final java.util.Map<String, long[]> alertTimes = new java.util.HashMap<>();   // key -> { last time, times shown }
    private boolean dueAlert(String key, long now) {
        long[] a = alertTimes.get(key);
        if (a == null) { alertTimes.put(key, new long[]{now, 1}); return true; }
        if (a[1] < 90 && now - a[0] >= 10000) { a[0] = now; a[1]++; return true; }
        return false;
    }

    private void headsUp(String matchId, String title, String text, String step, String button, String name) {
        int nid = idOf(ID_POP, matchId);
        // Swiping the pop-up away means "stop reminding me for this stop" (the quiet notification with the button stays in the list).
        String key = ("picked_up".equals(step) ? "pick:" : "drop:") + matchId;
        Intent quiet = new Intent(this, LocationService.class).setAction(ACTION_QUIET).putExtra("key", key).putExtra("nid", nid);
        PendingIntent quietPi = PendingIntent.getService(this, nid * 8 + 7, quiet, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, ALERT_CHANNEL)
                .setContentTitle(title).setContentText(text)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setDefaults(Notification.DEFAULT_ALL)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setContentIntent(openIntent())
                .setDeleteIntent(quietPi)
                .addAction(0, button, stepIntent(step, matchId, name, nid))
                .addAction(0, "Not yet", quietPi)
                .build();
        try { getSystemService(NotificationManager.class).notify(nid, n); } catch (Exception ignore) { }
    }

    /** Calls ride_step_token. Returns an empty string on success, or the reason it failed. */
    private String stepCall(String matchId, String step) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url + "/rest/v1/rpc/ride_step_token").openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(8000);
            c.setReadTimeout(8000);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("apikey", key);
            try (OutputStream os = c.getOutputStream()) {
                os.write(new JSONObject().put("p_token", token).put("p_match", matchId).put("p_step", step).toString().getBytes(StandardCharsets.UTF_8));
            }
            int code = c.getResponseCode();
            if (code >= 200 && code < 300) return "";
            InputStream is = c.getErrorStream();
            StringBuilder sb = new StringBuilder();
            if (is != null) {
                try (BufferedReader br = new BufferedReader(new InputStreamReader(is))) {
                    String line;
                    while ((line = br.readLine()) != null && sb.length() < 600) sb.append(line);
                }
            }
            String msg = "Please open RideShare and try there.";
            try { msg = new JSONObject(sb.toString()).optString("message", msg); } catch (Exception ignore) { }
            return msg;
        } catch (Exception e) {
            return "No connection. Open RideShare to update this step.";
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** A step button was tapped in a notification. */
    private void doStep(String matchId, String step, String name, int nid) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        String err = stepCall(matchId, step);
        if (err.isEmpty()) {
            nm.cancel(idOf(ID_POP, matchId));
            nm.cancel(idOf(ID_STEP, matchId));
            pollAlerts();   // refresh right away: shows the next step, or clears the finished rider
        } else {
            post2("Could not update " + name, err, ID_ERR + (nid & 0xfff));
        }
    }

    private PendingIntent answerIntent(String action, String id, String name, int nid) {
        Intent i = new Intent(this, LocationService.class).setAction(action).putExtra("match", id).putExtra("name", name).putExtra("nid", nid);
        return PendingIntent.getService(this, nid * 2 + (ACTION_ACCEPT.equals(action) ? 1 : 2), i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** "+4 min detour (+1.8 km). Total +9 of 15 min" from the numbers the database sends with the request (empty if it did not send any). */
    private static String detourText(JSONObject p) {
        if (p.isNull("detour_min")) return "";
        StringBuilder b = new StringBuilder("+").append(Math.round(p.optDouble("detour_min", 0))).append(" min detour");
        if (!p.isNull("detour_km") && p.optDouble("detour_km", 0) > 0.05) b.append(" (+").append(String.format(java.util.Locale.US, "%.1f", p.optDouble("detour_km", 0))).append(" km)");
        if (!p.isNull("total_min") && !p.isNull("limit_min")) {
            b.append(". Total +").append(Math.round(p.optDouble("total_min", 0))).append(" of ").append(Math.round(p.optDouble("limit_min", 0))).append(" min");
            if (!p.isNull("limit_km") && !p.isNull("total_km")) b.append(", +").append(String.format(java.util.Locale.US, "%.1f", p.optDouble("total_km", 0))).append(" of ").append(Math.round(p.optDouble("limit_km", 0))).append(" km");
        }
        return b.toString();
    }

    private void announce(String id, String name, String pickup, String dropoff, String detour) {
        final int nid = idOf(ID_REQ, id);
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, ALERT_CHANNEL)
                .setContentTitle(name + " asked for a seat")
                .setContentText(pickup + " to " + dropoff + (detour.isEmpty() ? "" : ". " + detour) + ". Accept or decline below.")
                .setStyle(new NotificationCompat.BigTextStyle().bigText(pickup + " to " + dropoff + (detour.isEmpty() ? "" : "\n" + detour)))
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
        if (ACTION_QUIET.equals(intent.getAction())) {   // the pop-up was swiped away: no more reminders for this stop
            String key = intent.getStringExtra("key");
            if (key != null) alertTimes.put(key, new long[]{System.currentTimeMillis(), 99});
            int qn = intent.getIntExtra("nid", 0);
            if (qn != 0) { try { getSystemService(NotificationManager.class).cancel(qn); } catch (Exception ignore) { } }   // the Not yet button closes the pop-up
            return;
        }
        if (ACTION_STEP.equals(intent.getAction())) {
            final String mid = intent.getStringExtra("match"), step = intent.getStringExtra("step");
            final String nm2 = intent.getStringExtra("name") == null ? "The rider" : intent.getStringExtra("name");
            final int nid2 = intent.getIntExtra("nid", 0);
            if (mid != null && step != null && !io.isShutdown()) io.execute(() -> doStep(mid, step, nm2, nid2));
            return;
        }
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
                post2("Could not answer " + name, msg, ID_ERR + (nid & 0xfff));
            }
        } catch (Exception e) {
            post2("Could not answer " + name, "No connection. Open RideShare to answer.", ID_ERR + (nid & 0xfff));
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** After an accept: one tap re-opens Google Maps with the new stop (RideShare keeps counting the drive time and distance). */
    private void routeAlert(String name) {
        Intent link = new Intent(Intent.ACTION_VIEW, Uri.parse("ca.rideshare.app://plan"))
                .setClass(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 7, link, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, ALERT_CHANNEL)
                .setContentTitle(name + " is added to your trip")
                .setContentText("Tap to preview your trip and stops, then start when you are ready.")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setDefaults(Notification.DEFAULT_ALL)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .addAction(0, "Preview trip", pi)
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
            NotificationChannel st = new NotificationChannel(STEPS_CHANNEL, "Trip steps", NotificationManager.IMPORTANCE_LOW);
            st.setDescription("The next step of each ride (Picked up, Dropped off), one tap each");
            getSystemService(NotificationManager.class).createNotificationChannel(st);
        }
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Location sharing", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while RideShare shares your location during a trip");
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
    }

    @Override
    public void onDestroy() {
        main.post(this::hideBubble);
        running = false;
        main.removeCallbacks(poller);
        main.removeCallbacks(fakeLoop);
        autopilot = false; fakeUntil = 0;
        polling = false;
        if (client != null && callback != null) client.removeLocationUpdates(callback);
        callback = null;
        io.shutdown();
        getSharedPreferences("rideshare_tracking", MODE_PRIVATE).edit().clear().apply();
        super.onDestroy();
    }
}
