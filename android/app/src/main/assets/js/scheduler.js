/**
 * Chronoflow Scheduler & Dynamic Rescheduling Engine
 * Handles the ripple-shift algorithm, fixed vs flexible collisions,
 * emergency time injection, and "Now & Up Next" calculations.
 */

const ChronoScheduler = {
  // --- Time Helpers ---
  timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return (h * 60) + (m || 0);
  },

  minutesToTime(totalMins) {
    let normalized = Math.round(totalMins) % (24 * 60);
    if (normalized < 0) normalized += 24 * 60;
    const h = Math.floor(normalized / 60);
    const m = normalized % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  },

  formatTime12(timeStr) {
    if (!timeStr) return '';
    const [hStr, mStr] = timeStr.split(':');
    let h = parseInt(hStr, 10);
    const m = mStr || '00';
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${m} ${ampm}`;
  },

  formatDuration(minutes) {
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  },

  getDayOfWeek(date = new Date()) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[date.getDay()];
  },

  getTodayDateStr() {
    const d = new Date();
    return d.toISOString().split('T')[0];
  },

  // --- Main Schedule Resolver for a Given Date ---
  resolveScheduleForDate(dateStr) {
    const allBaseTasks = ChronoStorage.getTasks();
    const dailyState = ChronoStorage.getDailyState(dateStr);
    const config = ChronoStorage.getConfig();

    const targetDate = new Date(dateStr + 'T12:00:00');
    const dayOfWeek = this.getDayOfWeek(targetDate);

    // 1. Filter tasks applicable for this day of week
    let dayTasks = allBaseTasks.filter(task => {
      // Check if day matches
      const appliesToDay = !task.days || task.days.length === 0 || 
                           task.days.includes('Everyday') || 
                           task.days.includes(dayOfWeek);
      // Check if deleted for today
      const notDeletedToday = !dailyState.deletedTodayIds.includes(task.id);
      return appliesToDay && notDeletedToday;
    });

    // Clone tasks to allow mutation for this resolved schedule
    let schedule = dayTasks.map(t => {
      const startMins = this.timeToMinutes(t.startTime);
      const isCompleted = dailyState.completedTaskIds.includes(t.id);
      const isSkipped = dailyState.skippedTaskIds.includes(t.id);
      return {
        ...t,
        originalStartTime: t.startTime,
        startMins,
        endMins: startMins + t.duration,
        isCompleted,
        isSkipped,
        isRescheduled: false,
        rescheduleReason: null,
        isEmergency: false
      };
    });

    // 2. Add emergency injected blocks
    if (dailyState.emergencyBlocks && dailyState.emergencyBlocks.length > 0) {
      dailyState.emergencyBlocks.forEach(eb => {
        const startMins = this.timeToMinutes(eb.startTime);
        schedule.push({
          id: eb.id,
          title: eb.title || 'Emergency Free Time / Pause',
          category: 'break',
          startTime: eb.startTime,
          originalStartTime: eb.startTime,
          duration: eb.duration,
          startMins,
          endMins: startMins + eb.duration,
          isFixed: true, // Emergency block is anchored where placed
          priority: 'high',
          notes: eb.notes || 'Injected unexpected free time slot',
          isCompleted: false,
          isSkipped: false,
          isRescheduled: false,
          isEmergency: true
        });
      });
    }

    // 3. Dynamic Ripple Adjustment (if sleep wake shifted or manual shift)
    const shiftMinutes = dailyState.shiftMinutes || 0;

    if (shiftMinutes !== 0) {
      // We need to ripple flexible morning tasks without colliding with fixed slots
      schedule = this.applyRippleShift(schedule, shiftMinutes, dailyState);
    }

    // Sort chronologically
    schedule.sort((a, b) => a.startMins - b.startMins);

    // Format start/end times in HH:MM
    schedule.forEach(item => {
      item.startTime = this.minutesToTime(item.startMins);
      item.endTime = this.minutesToTime(item.endMins);
    });

    return {
      date: dateStr,
      dayOfWeek,
      dailyState,
      items: schedule
    };
  },

  // Ripple shift algorithm: shifts flexible activities while respecting fixed commitments (classes, mess, exams)
  applyRippleShift(items, shiftMinutes, dailyState) {
    // Separate fixed and flexible items
    const fixedItems = items.filter(i => i.isFixed).sort((a, b) => a.startMins - b.startMins);
    const flexibleItems = items.filter(i => !i.isFixed).sort((a, b) => a.startMins - b.startMins);

    // Determine cutoff threshold (tasks after midnight or before standard wake)
    // For morning shift, shift applies to flexible tasks starting after standard sleep end
    flexibleItems.forEach(flex => {
      // If task is sleep itself, adjust end time or duration
      if (flex.category === 'sleep') {
        if (dailyState.actualWakeTime) {
          const wakeMins = this.timeToMinutes(dailyState.actualWakeTime);
          flex.endMins = wakeMins;
          flex.duration = Math.max(60, flex.endMins - flex.startMins);
        } else {
          flex.endMins += shiftMinutes;
          flex.duration += shiftMinutes;
        }
        flex.isRescheduled = true;
        flex.rescheduleReason = `Sleep adjusted by ${shiftMinutes > 0 ? '+' : ''}${shiftMinutes}m`;
        return;
      }

      // Propose shifted start time
      const proposedStart = flex.startMins + shiftMinutes;
      const proposedEnd = proposedStart + flex.duration;

      // Check collision with any fixed item
      let collision = fixedItems.find(f => {
        return (proposedStart < f.endMins && proposedEnd > f.startMins);
      });

      if (!collision) {
        // Fits smoothly!
        flex.startMins = proposedStart;
        flex.endMins = proposedEnd;
        flex.isRescheduled = true;
        flex.rescheduleReason = `Shifted +${shiftMinutes}m due to morning adjustment`;
      } else {
        // Collision with a fixed class or mess!
        // Try finding next free window between fixed tasks
        const nextWindow = this.findNextFreeGap(fixedItems, proposedStart, flex.duration);
        if (nextWindow) {
          flex.startMins = nextWindow.start;
          flex.endMins = nextWindow.start + flex.duration;
          flex.isRescheduled = true;
          flex.rescheduleReason = `Moved around fixed ${collision.title} to free slot`;
        } else {
          // If no full gap, compress duration to fit before collision or shift right after
          if (collision.startMins - proposedStart >= 25) {
            // Compress to fit before
            flex.startMins = proposedStart;
            flex.endMins = collision.startMins;
            flex.duration = flex.endMins - flex.startMins;
            flex.isRescheduled = true;
            flex.rescheduleReason = `Shortened to fit before ${collision.title}`;
          } else {
            // Place immediately after fixed collision
            flex.startMins = collision.endMins + 10;
            flex.endMins = flex.startMins + flex.duration;
            flex.isRescheduled = true;
            flex.rescheduleReason = `Shifted after ${collision.title}`;
          }
        }
      }
    });

    return [...fixedItems, ...flexibleItems];
  },

  findNextFreeGap(fixedItems, afterMins, neededDuration) {
    for (let i = 0; i < fixedItems.length; i++) {
      const current = fixedItems[i];
      if (current.endMins < afterMins) continue;

      const next = fixedItems[i + 1];
      const gapStart = Math.max(afterMins, current.endMins + 10);
      const gapEnd = next ? next.startMins - 10 : 23 * 60 + 59;

      if (gapEnd - gapStart >= neededDuration) {
        return { start: gapStart, end: gapEnd };
      }
    }
    return null;
  },

  // --- "Now Doing & What to Do Next" Engine ---
  getCurrentAndNext(resolvedSchedule, now = new Date()) {
    const currentMins = now.getHours() * 60 + now.getMinutes();
    const currentSeconds = now.getSeconds();
    const items = resolvedSchedule.items.filter(i => !i.isSkipped);

    let activeItem = null;
    let nextItem = null;
    let upcomingList = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.startMins <= currentMins && currentMins < item.endMins) {
        activeItem = item;
      } else if (item.startMins > currentMins) {
        if (!nextItem) {
          nextItem = item;
        }
        upcomingList.push(item);
      }
    }

    // Calculations for active item
    let activeMetrics = null;
    if (activeItem) {
      const totalDurationMins = activeItem.duration;
      const elapsedMins = currentMins - activeItem.startMins;
      const remainingMins = Math.max(0, activeItem.endMins - currentMins);
      const elapsedTotalSeconds = (elapsedMins * 60) + currentSeconds;
      const totalSeconds = totalDurationMins * 60;
      const progressPercent = Math.min(100, Math.max(0, (elapsedTotalSeconds / totalSeconds) * 100));

      activeMetrics = {
        item: activeItem,
        remainingMinutes: remainingMins,
        remainingSeconds: (remainingMins * 60) - currentSeconds,
        progressPercent: Math.round(progressPercent * 10) / 10,
        formattedRemaining: this.formatRemainingTime(remainingMins, currentSeconds)
      };
    } else {
      // Currently in free buffer time between activities
      const freeUntilMins = nextItem ? nextItem.startMins - currentMins : null;
      activeMetrics = {
        isFreeTime: true,
        remainingMinutes: freeUntilMins,
        formattedRemaining: freeUntilMins ? this.formatRemainingTime(freeUntilMins, currentSeconds) : 'No more tasks',
        nextStart: nextItem ? nextItem.startTime : null
      };
    }

    let nextMetrics = null;
    if (nextItem) {
      const minsUntilNext = nextItem.startMins - currentMins;
      nextMetrics = {
        item: nextItem,
        minsUntil: minsUntilNext,
        formattedStartsIn: this.formatDuration(minsUntilNext)
      };
    }

    return {
      activeMetrics,
      nextMetrics,
      upcomingList: upcomingList.slice(0, 5),
      currentMins
    };
  },

  formatRemainingTime(mins, currentSec = 0) {
    if (mins <= 0) return 'Ending now';
    const totalSec = Math.max(0, (mins * 60) - currentSec);
    const m = Math.floor(totalSec / 60);
    const s = Math.floor(totalSec % 60);
    if (m >= 60) {
      const h = Math.floor(m / 60);
      const remM = m % 60;
      return `${h}h ${remM}m`;
    }
    return `${m}m ${String(s).padStart(2, '0')}s`;
  },

  // --- Dynamic Adjustment Handlers ---
  handleSleepAdjustment(dateStr, actualSleepTimeStr, actualWakeTimeStr) {
    const config = ChronoStorage.getConfig();
    const standardSleepMins = this.timeToMinutes(config.standardSleepTime);
    let actualSleepMins = this.timeToMinutes(actualSleepTimeStr);

    // If actual sleep was in early morning (e.g., 02:00 vs 01:00)
    let sleepDelayMins = actualSleepMins - standardSleepMins;
    if (sleepDelayMins < -720) sleepDelayMins += 1440; // wrap around midnight

    let shiftMins = 0;
    let calculatedWakeTime = actualWakeTimeStr;

    if (actualWakeTimeStr) {
      // User explicitly stated wake time (e.g. "I woke up at 09:15")
      const wakeMins = this.timeToMinutes(actualWakeTimeStr);
      const standardWakeMins = (standardSleepMins + Math.round(config.targetSleepHours * 60)) % 1440;
      shiftMins = wakeMins - standardWakeMins;
    } else {
      // Auto-calculate wake time by maintaining target sleep duration
      shiftMins = Math.max(0, sleepDelayMins);
      const wakeMins = (actualSleepMins + Math.round(config.targetSleepHours * 60)) % 1440;
      calculatedWakeTime = this.minutesToTime(wakeMins);
    }

    // Save daily state update
    ChronoStorage.updateDailyState(dateStr, state => {
      return {
        ...state,
        sleepAdjusted: true,
        actualSleepTime: actualSleepTimeStr,
        actualWakeTime: calculatedWakeTime,
        shiftMinutes: shiftMins
      };
    });

    // Record in sleep log
    const sleepDurationHours = Math.round((config.targetSleepHours + (shiftMins / 60)) * 10) / 10;
    ChronoStorage.addSleepLog({
      date: dateStr,
      sleptAt: actualSleepTimeStr,
      wokeAt: calculatedWakeTime,
      actualHours: config.targetSleepHours,
      targetHours: config.targetSleepHours,
      quality: shiftMins > 60 ? 'Adjusted (Late Sleep)' : 'Good',
      notes: `Smart dynamic ripple applied (+${shiftMins}m morning adjustment).`
    });

    return {
      shiftMinutes: shiftMins,
      calculatedWakeTime
    };
  },

  injectEmergencyFreeTime(dateStr, durationMinutes, title = 'Emergency Free Time') {
    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();
    const startTime = this.minutesToTime(currentMins);

    const block = {
      id: 'emergency-' + Date.now(),
      title,
      startTime,
      duration: durationMinutes,
      createdAt: now.toISOString()
    };

    ChronoStorage.updateDailyState(dateStr, state => {
      const existing = state.emergencyBlocks || [];
      return {
        ...state,
        emergencyBlocks: [...existing, block]
      };
    });

    return block;
  },

  skipTask(dateStr, taskId) {
    ChronoStorage.updateDailyState(dateStr, state => {
      const skipped = state.skippedTaskIds || [];
      if (!skipped.includes(taskId)) {
        skipped.push(taskId);
      }
      return { ...state, skippedTaskIds: skipped };
    });
  },

  unskipTask(dateStr, taskId) {
    ChronoStorage.updateDailyState(dateStr, state => {
      return {
        ...state,
        skippedTaskIds: (state.skippedTaskIds || []).filter(id => id !== taskId)
      };
    });
  },

  toggleTaskComplete(dateStr, taskId) {
    ChronoStorage.updateDailyState(dateStr, state => {
      const completed = state.completedTaskIds || [];
      const isDone = completed.includes(taskId);
      return {
        ...state,
        completedTaskIds: isDone ? completed.filter(id => id !== taskId) : [...completed, taskId]
      };
    });
  },

  deleteTaskToday(dateStr, taskId) {
    ChronoStorage.updateDailyState(dateStr, state => {
      const deleted = state.deletedTodayIds || [];
      if (!deleted.includes(taskId)) deleted.push(taskId);
      return { ...state, deletedTodayIds: deleted };
    });
  },

  extendTask(dateStr, taskId, addMinutes = 15) {
    // Extends current task by addMinutes, shifts subsequent flexible tasks
    ChronoStorage.updateDailyState(dateStr, state => {
      const shift = (state.shiftMinutes || 0) + addMinutes;
      return { ...state, shiftMinutes: shift };
    });
  },

  // Daily review metrics
  getDailyReviewStats(dateStr) {
    const schedule = this.resolveScheduleForDate(dateStr);
    const totalTasks = schedule.items.filter(i => !i.isEmergency && i.category !== 'sleep');
    const completed = totalTasks.filter(i => i.isCompleted);
    const skipped = totalTasks.filter(i => i.isSkipped);
    const pending = totalTasks.filter(i => !i.isCompleted && !i.isSkipped);

    const completionRate = totalTasks.length > 0 
      ? Math.round((completed.length / totalTasks.length) * 100) 
      : 100;

    return {
      date: dateStr,
      totalCount: totalTasks.length,
      completedCount: completed.length,
      skippedCount: skipped.length,
      pendingCount: pending.length,
      completionRate,
      tasks: totalTasks
    };
  },

  // --- Android Native Calendar & Alarm Sync (.ics Generator) ---
  generateICS(dateStr) {
    const schedule = this.resolveScheduleForDate(dateStr);
    const dateFormatted = dateStr.replace(/-/g, ''); // YYYYMMDD

    let ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Chronoflow//Life & Study Scheduler//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Chronoflow Schedule'
    ];

    schedule.items.forEach(item => {
      if (item.isSkipped) return;

      const [sH, sM] = item.startTime.split(':');
      const [eH, eM] = item.endTime.split(':');

      const dtStart = `${dateFormatted}T${sH.padStart(2, '0')}${sM.padStart(2, '0')}00`;
      const dtEnd = `${dateFormatted}T${eH.padStart(2, '0')}${eM.padStart(2, '0')}00`;
      const uid = `chronoflow-${item.id}-${dateFormatted}@chronoflow.local`;

      ics.push('BEGIN:VEVENT');
      ics.push(`UID:${uid}`);
      ics.push(`DTSTAMP:${dtStart}Z`);
      ics.push(`DTSTART:${dtStart}`);
      ics.push(`DTEND:${dtEnd}`);
      ics.push(`SUMMARY:${item.title}`);
      ics.push(`DESCRIPTION:${item.notes || 'Scheduled activity in Chronoflow'}`);
      ics.push(`STATUS:CONFIRMED`);

      // Add Native Android Alarm Reminder 5 minutes before
      ics.push('BEGIN:VALARM');
      ics.push('TRIGGER:-PT5M');
      ics.push('ACTION:AUDIO');
      ics.push(`DESCRIPTION:Reminder: ${item.title} starts in 5 minutes`);
      ics.push('END:VALARM');

      ics.push('END:VEVENT');
    });

    ics.push('END:VCALENDAR');
    return ics.join('\r\n');
  }
};

window.ChronoScheduler = ChronoScheduler;
