package com.chronoflow.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.widget.RemoteViews;

public class ZenRhythmWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.zenrhythm_widget);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }

        // 1. Brand Click -> Open Dashboard
        Intent appIntent = new Intent(context, MainActivity.class);
        PendingIntent piApp = PendingIntent.getActivity(context, 100, appIntent, flags);
        views.setOnClickPendingIntent(R.id.widget_brand_container, piApp);

        // 2. Sleep Button -> 1-Tap Sleep/Wake
        Intent sleepIntent = new Intent(context, MainActivity.class);
        sleepIntent.putExtra("action", "sleep_toggle");
        PendingIntent piSleep = PendingIntent.getActivity(context, 101, sleepIntent, flags);
        views.setOnClickPendingIntent(R.id.widget_btn_sleep, piSleep);

        // 3. Note Button -> Quick Note Scratchpad
        Intent noteIntent = new Intent(context, MainActivity.class);
        noteIntent.putExtra("action", "quick_note");
        PendingIntent piNote = PendingIntent.getActivity(context, 102, noteIntent, flags);
        views.setOnClickPendingIntent(R.id.widget_btn_note, piNote);

        // 4. Mission Button -> Add Mission
        Intent missionIntent = new Intent(context, MainActivity.class);
        missionIntent.putExtra("action", "add_mission");
        PendingIntent piMission = PendingIntent.getActivity(context, 103, missionIntent, flags);
        views.setOnClickPendingIntent(R.id.widget_btn_mission, piMission);

        // 5. Analysis Button -> Analysis & Circadian Rhythm
        Intent analysisIntent = new Intent(context, MainActivity.class);
        analysisIntent.putExtra("action", "analysis");
        PendingIntent piAnalysis = PendingIntent.getActivity(context, 104, analysisIntent, flags);
        views.setOnClickPendingIntent(R.id.widget_btn_analysis, piAnalysis);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}
