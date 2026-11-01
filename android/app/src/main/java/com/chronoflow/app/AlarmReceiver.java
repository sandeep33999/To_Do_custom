package com.chronoflow.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.app.NotificationManager;
import android.app.NotificationChannel;
import android.app.PendingIntent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import android.media.RingtoneManager;
import android.net.Uri;

public class AlarmReceiver extends BroadcastReceiver {

    public static final String CHANNEL_ID = "chronoflow_alarms_channel";
    public static final String CHANNEL_NAME = "Chronoflow Reminders & Alarms";

    @Override
    public void onReceive(Context context, Intent intent) {
        String title = intent.getStringExtra("title");
        String message = intent.getStringExtra("message");
        int notificationId = intent.getIntExtra("id", (int) System.currentTimeMillis());

        if (title == null || title.isEmpty()) {
            title = "Chronoflow Reminder";
        }
        if (message == null) {
            message = "You have an activity scheduled now.";
        }

        NotificationManager notificationManager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);

        // Create High-Priority Notification Channel for Android 8.0+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Loud alarms and reminders for classes, study slots, and tasks.");
            channel.enableVibration(true);
            channel.enableLights(true);
            channel.setVibrationPattern(new long[]{0, 300, 200, 300});
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(channel);
            }
        }

        // Tap to open app
        Intent openAppIntent = new Intent(context, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            notificationId,
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        Uri alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setSound(alarmSound)
            .setVibrate(new long[]{0, 300, 200, 300})
            .setContentIntent(pendingIntent);

        if (notificationManager != null) {
            notificationManager.notify(notificationId, builder.build());
        }
    }
}
