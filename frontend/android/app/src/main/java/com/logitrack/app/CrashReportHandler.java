package com.logitrack.app;

import android.content.Context;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Capture toutes les exceptions non gérées du main thread et les écrit dans un fichier
 * accessible (debug : /data/data/com.logitrack.app/files/crash_*.log via run-as) pour
 * diagnostiquer les crashs "app s'arrête systématiquement" que le logcat MIUI/Samsung
 * verrouille. Non bloquant : le crash original se propage ensuite normalement (l'app
 * sera tuée, mais la cause est tracée).
 */
public final class CrashReportHandler implements Thread.UncaughtExceptionHandler {

    private static final String TAG = "LogiTrackCrash";
    private static final String CRASH_PREFIX = "crash_";

    private final Thread.UncaughtExceptionHandler defaultHandler;
    private final Context context;

    public CrashReportHandler(Context context) {
        this.context = context.getApplicationContext();
        this.defaultHandler = Thread.getDefaultUncaughtExceptionHandler();
    }

    public static void install(Context context) {
        try {
            Thread.setDefaultUncaughtExceptionHandler(new CrashReportHandler(context));
            Log.i(TAG, "CrashReportHandler installé");
        } catch (Throwable t) {
            // Ne jamais casser le démarrage pour le handler de crash lui-même.
            Log.w(TAG, "Échec installation CrashReportHandler: " + t.getMessage());
        }
    }

    @Override
    public void uncaughtException(Thread thread, Throwable throwable) {
        try {
            writeCrashLog(thread, throwable);
        } catch (Throwable t) {
            Log.e(TAG, "Échec écriture du crash log: " + t.getMessage());
        }
        if (defaultHandler != null) {
            defaultHandler.uncaughtException(thread, throwable);
        }
    }

    private void writeCrashLog(Thread thread, Throwable throwable) {
        String ts = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date());
        File dir = new File(context.getFilesDir().getAbsolutePath());
        if (!dir.exists() && !dir.mkdirs()) {
            return;
        }
        File out = new File(dir.getAbsolutePath() + File.separator + CRASH_PREFIX + ts + ".log");
        try (FileOutputStream fos = new FileOutputStream(out); PrintWriter pw = new PrintWriter(fos)) {
            pw.println("=== CRASH " + new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date()) + " ===");
            pw.println("Thread: " + (thread != null ? thread.getName() : "?"));
            pw.println("Package: " + context.getPackageName());
            pw.println("App version: " + safeVersion());
            pw.println("Android SDK: " + android.os.Build.VERSION.SDK_INT + " (" + android.os.Build.VERSION.RELEASE + ")");
            pw.println("Device: " + android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL);
            pw.println("--- stack trace ---");
            if (throwable != null) {
                throwable.printStackTrace(pw);
            } else {
                pw.println("(null throwable)");
            }
            pw.println("--- fin ---");
            pw.flush();
            Log.e(TAG, "Crash log écrit: " + out.getAbsolutePath());
        } catch (Throwable t) {
            Log.e(TAG, "Impossible d'écrire le crash log: " + t.getMessage());
        }
    }

    private String safeVersion() {
        try {
            return context.getPackageManager()
                .getPackageInfo(context.getPackageName(), 0)
                .versionName + " (code " + context.getPackageManager()
                .getPackageInfo(context.getPackageName(), 0).versionCode + ")";
        } catch (Throwable t) {
            return "?";
        }
    }
}
