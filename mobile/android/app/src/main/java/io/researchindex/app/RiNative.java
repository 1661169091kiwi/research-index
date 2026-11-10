package io.researchindex.app;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import androidx.core.content.FileProvider;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.Reader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Network requests and API keys for the paper feed.
 *
 * request: an HTTP request made natively (no CORS), whose reply streams back to the page as "http"
 * events: head (status, headers), data (text chunks), end, or error. A header value containing
 * "@native:<provider>" gets that provider's API key swapped in, but only when the request goes to the
 * host the key was saved for, so the key itself never enters the page.
 *
 * Keys are encrypted with an AES key that lives in the Android Keystore.
 *
 * shareImage / saveImage: a paper's share card (a PNG) to the Android share sheet, or into Pictures/Research
 * Index; openUrl: a web page (a new version's download) in the browser.
 */
@CapacitorPlugin(name = "RiNative")
public class RiNative extends Plugin {
    private static final String PREFS = "ri_keys";
    private static final String KEY_ALIAS = "ri_api_keys";
    private static final Pattern FIGURE = Pattern.compile("<figure[^>]*>[\\s\\S]*?<img[^>]*src=\"(?!data:)[^\"]+\"[\\s\\S]*?</figure>");
    private static final int MAX_FIGURE_SCAN = 3_000_000;

    private final ExecutorService pool = Executors.newFixedThreadPool(6);
    private final Map<Integer, HttpURLConnection> open = new ConcurrentHashMap<>();
    private final Map<Integer, Boolean> cancelled = new ConcurrentHashMap<>();

    // ---------- requests ----------
    @PluginMethod
    public void request(PluginCall call) {
        final int rid = call.getInt("rid", 0);
        final String url = call.getString("url", "");
        final String method = call.getString("method", "GET");
        final String body = call.getString("body", null);
        final String until = call.getString("until", "");
        final int timeout = call.getInt("timeout", 60000);
        final JSObject headers = call.getObject("headers", new JSObject());
        call.resolve();
        pool.execute(() -> run(rid, url, method, headers, body, until, timeout));
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        int rid = call.getInt("rid", 0);
        cancelled.put(rid, true);
        HttpURLConnection c = open.remove(rid);
        if (c != null) {
            pool.execute(c::disconnect);
        }
        call.resolve();
    }

    private void emit(int rid, String type, JSObject extra) {
        JSObject ev = extra == null ? new JSObject() : extra;
        ev.put("rid", rid);
        ev.put("type", type);
        notifyListeners("http", ev);
    }

    private void run(int rid, String url, String method, JSObject headers, String body, String until, int timeout) {
        HttpURLConnection c = null;
        try {
            URL u = new URL(url);
            if (!"https".equals(u.getProtocol()) && !"http".equals(u.getProtocol())) throw new Exception("unsupported URL");
            c = (HttpURLConnection) u.openConnection();
            open.put(rid, c);
            c.setInstanceFollowRedirects(true);
            c.setConnectTimeout(Math.min(timeout, 30000));
            c.setReadTimeout(timeout);
            c.setRequestMethod(method);
            boolean hasUa = false;
            Iterator<String> names = headers.keys();
            while (names.hasNext()) {
                String name = names.next();
                String value = headers.getString(name, "");
                if (value != null && value.contains("@native:")) value = withKey(value, u.getHost());
                if ("user-agent".equalsIgnoreCase(name)) hasUa = true;
                c.setRequestProperty(name, value);
            }
            if (!hasUa) c.setRequestProperty("User-Agent", "ResearchIndex/1.6 (personal paper reader; Android)");
            if (body != null) {
                c.setDoOutput(true);
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                c.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream os = c.getOutputStream()) { os.write(bytes); }
            }
            int status = c.getResponseCode();
            JSObject head = new JSObject();
            head.put("status", status);
            JSObject hs = new JSObject();
            for (Map.Entry<String, List<String>> h : c.getHeaderFields().entrySet()) {
                if (h.getKey() != null && h.getValue() != null && !h.getValue().isEmpty()) hs.put(h.getKey().toLowerCase(), h.getValue().get(0));
            }
            head.put("headers", hs);
            emit(rid, "head", head);
            InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in != null) {
                boolean figure = "figure".equals(until);
                StringBuilder seen = figure ? new StringBuilder() : null;
                try (Reader r = new InputStreamReader(in, StandardCharsets.UTF_8)) {
                    char[] buf = new char[32768];
                    int n;
                    while (!Boolean.TRUE.equals(cancelled.get(rid)) && (n = r.read(buf)) > 0) {
                        String chunk = new String(buf, 0, n);
                        JSObject d = new JSObject();
                        d.put("text", chunk);
                        emit(rid, "data", d);
                        if (figure) {
                            seen.append(chunk);
                            if ((chunk.contains("</figure>") && FIGURE.matcher(seen).find()) || seen.length() > MAX_FIGURE_SCAN) break;
                        }
                    }
                }
            }
            if (!Boolean.TRUE.equals(cancelled.get(rid))) emit(rid, "end", null);
        } catch (Exception e) {
            if (!Boolean.TRUE.equals(cancelled.get(rid))) {
                JSObject err = new JSObject();
                err.put("message", e.getClass().getSimpleName() + ": " + (e.getMessage() == null ? "" : e.getMessage()));
                emit(rid, "error", err);
            }
        } finally {
            open.remove(rid);
            cancelled.remove(rid);
            if (c != null) c.disconnect();
        }
    }

    // ---------- API keys ----------
    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private SecretKey secret() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return kg.generateKey();
    }

    private String encrypt(String plain) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, secret());
        byte[] iv = cipher.getIV();
        byte[] ct = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP);
    }

    private String decrypt(String stored) throws Exception {
        String[] parts = stored.split(":", 2);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, secret(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }

    /** Swaps "@native:<provider>" for that provider's key, if the request goes to the key's own host. */
    private String withKey(String value, String host) throws Exception {
        java.util.regex.Matcher m = Pattern.compile("@native:([a-z]+)").matcher(value);
        if (!m.find()) return value;
        String provider = m.group(1);
        String stored = prefs().getString(provider + ".key", null);
        String allowed = prefs().getString(provider + ".host", "");
        if (stored == null || allowed.isEmpty() || !allowed.equalsIgnoreCase(host)) throw new Exception("API key is not available for " + host);
        return value.replace(m.group(0), decrypt(stored));
    }

    @PluginMethod
    public void setKey(PluginCall call) {
        String provider = call.getString("provider", "deepseek");
        String key = call.getString("key", "").trim();
        String host = call.getString("host", "");
        try {
            SharedPreferences.Editor e = prefs().edit();
            if (key.isEmpty()) {
                e.remove(provider + ".key").remove(provider + ".hint").remove(provider + ".host");
            } else {
                e.putString(provider + ".key", encrypt(key));
                e.putString(provider + ".hint", key.length() > 4 ? key.substring(key.length() - 4) : "");
                e.putString(provider + ".host", host);
            }
            e.apply();
            call.resolve();
        } catch (Exception ex) {
            call.reject("Could not store the key: " + ex.getMessage());
        }
    }

    @PluginMethod
    public void setKeyHost(PluginCall call) {
        String provider = call.getString("provider", "deepseek");
        if (prefs().contains(provider + ".key")) prefs().edit().putString(provider + ".host", call.getString("host", "")).apply();
        call.resolve();
    }

    @PluginMethod
    public void keyInfo(PluginCall call) {
        JSObject out = new JSObject();
        try {
            JSArray providers = call.getArray("providers", new JSArray());
            for (int i = 0; i < providers.length(); i++) {
                String p = providers.getString(i);
                JSObject info = new JSObject();
                info.put("has", prefs().contains(p + ".key"));
                info.put("hint", prefs().getString(p + ".hint", ""));
                out.put(p, info);
            }
        } catch (Exception ignored) {
            // no keys yet
        }
        call.resolve(out);
    }

    // ---------- sharing a paper as an image ----------
    private static String pngName(String name) {
        String n = (name == null ? "" : name).replaceAll("[^A-Za-z0-9._-]+", "-");
        if (n.isEmpty() || n.length() > 80) n = "paper";
        return n.endsWith(".png") ? n : n + ".png";
    }

    private static byte[] png(PluginCall call) {
        String data = call.getString("data", "");
        byte[] bytes = Base64.decode(data, Base64.DEFAULT);
        boolean ok = bytes.length > 8 && bytes.length < 30_000_000 && (bytes[0] & 0xff) == 0x89 && bytes[1] == 'P' && bytes[2] == 'N' && bytes[3] == 'G';
        return ok ? bytes : null;
    }

    @PluginMethod
    public void shareImage(PluginCall call) {
        byte[] bytes = png(call);
        if (bytes == null) { call.reject("not a PNG"); return; }
        try {
            File dir = new File(getContext().getCacheDir(), "share");
            if (!dir.isDirectory() && !dir.mkdirs()) throw new Exception("no cache folder");
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) f.delete();
            File file = new File(dir, pngName(call.getString("name")));
            try (FileOutputStream out = new FileOutputStream(file)) { out.write(bytes); }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("image/png");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.setClipData(ClipData.newRawUri("", uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            String text = call.getString("text", "");
            if (!text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
            Intent chooser = Intent.createChooser(send, call.getString("title", "Share"));
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().runOnUiThread(() -> getActivity().startActivity(chooser));
            call.resolve();
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }

    @PluginMethod
    public void saveImage(PluginCall call) {
        byte[] bytes = png(call);
        if (bytes == null) { call.reject("not a PNG"); return; }
        if (Build.VERSION.SDK_INT < 29) { call.reject("old-android"); return; } // before Android 10 this needs a storage permission: share instead
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues v = new ContentValues();
        v.put(MediaStore.Images.Media.DISPLAY_NAME, pngName(call.getString("name")));
        v.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
        v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Research Index");
        v.put(MediaStore.Images.Media.IS_PENDING, 1);
        Uri uri = null;
        try {
            uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new Exception("no media store");
            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) throw new Exception("cannot write");
                out.write(bytes);
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.Images.Media.IS_PENDING, 0);
            resolver.update(uri, done, null, null);
            JSObject res = new JSObject();
            res.put("where", Environment.DIRECTORY_PICTURES + "/Research Index");
            call.resolve(res);
        } catch (Exception e) {
            if (uri != null) resolver.delete(uri, null, null);
            call.reject(String.valueOf(e.getMessage()));
        }
    }

    // a paper's figure, for its share card (the page could not draw one from another site and export it)
    @PluginMethod
    public void fetchImage(PluginCall call) {
        final String url = call.getString("url", "");
        if (!url.startsWith("https://")) { call.reject("only https"); return; }
        pool.execute(() -> {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(15000);
                c.setReadTimeout(20000);
                c.setInstanceFollowRedirects(true);
                c.setRequestProperty("User-Agent", "research-index-app");
                String type = c.getContentType();
                if (c.getResponseCode() / 100 != 2 || type == null || !type.startsWith("image/")) { call.reject("not an image"); return; }
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                try (InputStream in = c.getInputStream()) {
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        if (out.size() > 15_000_000) throw new Exception("too large");
                    }
                }
                JSObject res = new JSObject();
                res.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                res.put("type", type);
                call.resolve(res);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            } finally {
                if (c != null) c.disconnect();
            }
        });
    }

    // ---------- a web page in the browser (only https) ----------
    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.startsWith("https://")) { call.reject("only https"); return; }
        try {
            Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().runOnUiThread(() -> getActivity().startActivity(view));
            call.resolve();
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }
}
