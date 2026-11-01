package com.chronoflow.app;

import android.content.Context;
import android.content.Intent;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.webkit.JavascriptInterface;
import android.os.Build;
import android.util.Log;

public class WebAppInterface {

    private final Context mContext;
    private static final String TAG = "ChronoflowNative";

    public WebAppInterface(Context context) {
        this.mContext = context;
    }

    @JavascriptInterface
    public void scheduleNativeAlarm(String taskId, String title, String message, long timestampMillis) {
        try {
            AlarmManager alarmManager = (AlarmManager) mContext.getSystemService(Context.ALARM_SERVICE);
            if (alarmManager == null) return;

            int requestCode = Math.abs(taskId.hashCode());

            Intent intent = new Intent(mContext, AlarmReceiver.class);
            intent.putExtra("id", requestCode);
            intent.putExtra("title", title);
            intent.putExtra("message", message);
            intent.putExtra("taskId", taskId);

            PendingIntent pendingIntent = PendingIntent.getBroadcast(
                mContext,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
            );

            // Use setAlarmClock for guaranteed Android wake-up even in deep Doze mode or when cleared from recents
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                Intent showIntent = new Intent(mContext, MainActivity.class);
                PendingIntent showPendingIntent = PendingIntent.getActivity(
                    mContext,
                    requestCode,
                    showIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
                );
                AlarmManager.AlarmClockInfo clockInfo = new AlarmManager.AlarmClockInfo(timestampMillis, showPendingIntent);
                alarmManager.setAlarmClock(clockInfo, pendingIntent);
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, timestampMillis, pendingIntent);
            } else {
                alarmManager.setExact(AlarmManager.RTC_WAKEUP, timestampMillis, pendingIntent);
            }

            Log.d(TAG, "Native Alarm scheduled: " + title + " at " + timestampMillis);
        } catch (Exception e) {
            Log.e(TAG, "Error scheduling native alarm", e);
        }
    }

    @JavascriptInterface
    public void cancelNativeAlarm(String taskId) {
        try {
            AlarmManager alarmManager = (AlarmManager) mContext.getSystemService(Context.ALARM_SERVICE);
            if (alarmManager == null) return;

            int requestCode = Math.abs(taskId.hashCode());
            Intent intent = new Intent(mContext, AlarmReceiver.class);
            PendingIntent pendingIntent = PendingIntent.getBroadcast(
                mContext,
                requestCode,
                intent,
                PendingIntent.FLAG_NO_CREATE | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
            );

            if (pendingIntent != null) {
                alarmManager.cancel(pendingIntent);
                pendingIntent.cancel();
                Log.d(TAG, "Native Alarm cancelled for task: " + taskId);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error cancelling native alarm", e);
        }
    }
}
