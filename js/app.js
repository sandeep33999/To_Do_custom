/**
 * Chronoflow Main Application Controller
 * Handles UI interactions, live timers, view routing, modals, and PWA installation.
 */

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

const App = {
  activeView: 'dashboard',
  selectedTimetableDay: 'Mon',
  currentActiveItem: null,
  pendingDeleteTaskId: null,
  deferredInstallPrompt: null,

  init() {
    // 1. Initialize Theme
    this.initTheme();

    // 2. Initialize Navigation Tabs
    this.initNavigation();

    // 3. Initialize Live Clock & HUD Timer Loop
    this.startLiveTimer();

    // 4. Initialize Modals and Buttons
    this.initModals();
    this.initTaskActions();
    this.initSettings();
    this.initPWA();

    // 5. Initialize Notifications & Audio
    if (window.ChronoNotifications) {
      ChronoNotifications.init();
    }

    // 6. Listen for storage updates
    window.addEventListener('chronoflow:dailystate_updated', () => this.refreshAllViews());
    window.addEventListener('chronoflow:tasks_updated', () => this.refreshAllViews());
    window.addEventListener('chronoflow:deadlines_updated', () => this.renderDeadlines());
    window.addEventListener('chronoflow:sleeplogs_updated', () => this.renderSleepLogs());

    // 7. Initial Render
    this.refreshAllViews();
  },

  // ==========================================================================
  // THEME MANAGEMENT
  // ==========================================================================
  initTheme() {
    const savedTheme = localStorage.getItem('chronoflow_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    this.updateThemeIcons(savedTheme);

    const themeToggleBtn = document.getElementById('btn-theme-toggle');
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('chronoflow_theme', newTheme);
        this.updateThemeIcons(newTheme);
      });
    }
  },

  updateThemeIcons(theme) {
    const sun = document.getElementById('theme-icon-sun');
    const moon = document.getElementById('theme-icon-moon');
    if (!sun || !moon) return;
    if (theme === 'dark') {
      sun.classList.add('hidden');
      moon.classList.remove('hidden');
    } else {
      sun.classList.remove('hidden');
      moon.classList.add('hidden');
    }
  },

  // ==========================================================================
  // VIEW NAVIGATION
  // ==========================================================================
  initNavigation() {
    const tabs = document.querySelectorAll('.nav-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetView = tab.getAttribute('data-view');
        this.switchView(targetView);
      });
    });

    // Match today's day of week for timetable tab default
    const dayOfWeek = ChronoScheduler.getDayOfWeek();
    this.selectedTimetableDay = dayOfWeek;
  },

  switchView(viewName) {
    this.activeView = viewName;

    // Update Tab states
    document.querySelectorAll('.nav-tab').forEach(t => {
      if (t.getAttribute('data-view') === viewName) {
        t.classList.add('active');
      } else {
        t.classList.remove('active');
      }
    });

    // Update Views visibility
    document.querySelectorAll('.app-view').forEach(v => {
      if (v.id === `view-${viewName}`) {
        v.classList.add('active');
      } else {
        v.classList.remove('active');
      }
    });

    // Refresh view specific data
    if (viewName === 'timetable') this.renderTimetableSlots();
    if (viewName === 'deadlines') this.renderDeadlines();
    if (viewName === 'sleeplog') this.renderSleepLogs();
    if (viewName === 'review') this.renderDailyReview();
    if (viewName === 'settings') this.loadSettingsForm();
  },

  // ==========================================================================
  // LIVE CLOCK & DASHBOARD HUD LOOP
  // ==========================================================================
  startLiveTimer() {
    this.updateClockAndHud();
    setInterval(() => {
      this.updateClockAndHud();
    }, 1000);
  },

  updateClockAndHud() {
    const now = new Date();
    
    // 1. Update Header Clock
    const headerTime = document.getElementById('header-time');
    const headerDate = document.getElementById('header-date');
    if (headerTime && headerDate) {
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      headerTime.textContent = `${hours}:${minutes}:${seconds}`;

      const options = { weekday: 'short', month: 'short', day: 'numeric' };
      headerDate.textContent = now.toLocaleDateString(undefined, options);
    }

    // 2. Resolve Today's Schedule & Up Next
    const todayStr = ChronoScheduler.getTodayDateStr();
    const resolvedSchedule = ChronoScheduler.resolveScheduleForDate(todayStr);
    const { activeMetrics, nextMetrics, upcomingList } = ChronoScheduler.getCurrentAndNext(resolvedSchedule, now);

    // 3. Update HUD "Now Doing" Card
    this.updateNowCard(activeMetrics);

    // 4. Update HUD "Up Next" Card
    this.updateNextCard(nextMetrics, upcomingList);

    // 5. Update Focus Mode Overlay if open
    this.updateFocusOverlay(activeMetrics, nextMetrics);

    // 6. Update Ripple Status Banner
    this.updateRippleBanner(resolvedSchedule.dailyState);
  },

  updateNowCard(metrics) {
    const ringCircle = document.getElementById('now-progress-circle');
    const remainingTimeEl = document.getElementById('now-remaining-time');
    const taskTitleEl = document.getElementById('now-task-title');
    const categoryTagEl = document.getElementById('now-category-tag');
    const timeRangeEl = document.getElementById('now-time-range');
    const slotNatureEl = document.getElementById('now-slot-nature');
    const notesEl = document.getElementById('now-task-notes');
    const actionsBar = document.querySelector('.now-actions-bar');

    const circumference = 2 * Math.PI * 72; // 452.39

    if (!metrics || metrics.isFreeTime) {
      this.currentActiveItem = null;
      if (taskTitleEl) taskTitleEl.textContent = 'Free Buffer Time / Relax';
      if (remainingTimeEl) remainingTimeEl.textContent = metrics ? metrics.formattedRemaining : '00m 00s';
      if (categoryTagEl) {
        categoryTagEl.className = 'category-pill pill-break';
        categoryTagEl.textContent = 'Free Time';
      }
      if (timeRangeEl) timeRangeEl.textContent = metrics && metrics.nextStart ? `Free until ${ChronoScheduler.formatTime12(metrics.nextStart)}` : 'Rest of the day';
      if (slotNatureEl) {
        slotNatureEl.className = 'meta-badge-flex';
        slotNatureEl.textContent = 'Unallocated Gap';
      }
      if (notesEl) notesEl.textContent = 'Use this time to relax, hydrate, or review ahead without rushing.';
      if (ringCircle) ringCircle.style.strokeDashoffset = '0';
      if (actionsBar) actionsBar.style.display = 'none';
      return;
    }

    const item = metrics.item;
    this.currentActiveItem = item;

    if (actionsBar) actionsBar.style.display = 'flex';
    if (taskTitleEl) taskTitleEl.textContent = item.title;
    if (remainingTimeEl) remainingTimeEl.textContent = metrics.formattedRemaining;
    if (notesEl) notesEl.textContent = item.notes || 'No extra notes recorded.';

    if (timeRangeEl) {
      timeRangeEl.textContent = `${ChronoScheduler.formatTime12(item.startTime)} – ${ChronoScheduler.formatTime12(item.endTime)} (${item.duration}m)`;
    }

    if (categoryTagEl) {
      categoryTagEl.className = `category-pill pill-${item.category || 'study'}`;
      categoryTagEl.textContent = item.category || 'Task';
    }

    if (slotNatureEl) {
      if (item.isFixed) {
        slotNatureEl.className = 'meta-badge-fixed';
        slotNatureEl.textContent = 'Fixed Slot';
      } else {
        slotNatureEl.className = 'meta-badge-flex';
        slotNatureEl.textContent = 'Flexible Slot';
      }
    }

    // Update Progress Ring
    if (ringCircle) {
      const offset = circumference - ((metrics.progressPercent / 100) * circumference);
      ringCircle.style.strokeDashoffset = String(offset);
    }
  },

  updateNextCard(nextMetrics, upcomingList) {
    const nextBadge = document.getElementById('next-starts-in-badge');
    const nextCategory = document.getElementById('next-category-tag');
    const nextTitle = document.getElementById('next-task-title');
    const nextTimeRange = document.getElementById('next-time-range');
    const nextNotes = document.getElementById('next-task-notes');
    const subsequentContainer = document.getElementById('subsequent-items-container');

    if (!nextMetrics) {
      if (nextBadge) nextBadge.textContent = 'None Scheduled';
      if (nextCategory) nextCategory.textContent = 'Done for Today';
      if (nextTitle) nextTitle.textContent = 'All tasks completed for today!';
      if (nextTimeRange) nextTimeRange.textContent = 'Rest well tonight.';
      if (nextNotes) nextNotes.textContent = 'Check your daily review or plan for tomorrow.';
      if (subsequentContainer) subsequentContainer.innerHTML = '<div class="subsequent-chip-item"><span>No further activities</span></div>';
      return;
    }

    const item = nextMetrics.item;
    if (nextBadge) nextBadge.textContent = `Starts in ${nextMetrics.formattedStartsIn}`;
    if (nextCategory) {
      nextCategory.className = `category-pill pill-${item.category || 'study'}`;
      nextCategory.textContent = item.category || 'Upcoming';
    }
    if (nextTitle) nextTitle.textContent = item.title;
    if (nextTimeRange) {
      nextTimeRange.textContent = `${ChronoScheduler.formatTime12(item.startTime)} – ${ChronoScheduler.formatTime12(item.endTime)} (${item.duration}m)`;
    }
    if (nextNotes) nextNotes.textContent = item.notes || 'Scheduled upcoming commitment.';

    // Subsequent list preview
    if (subsequentContainer) {
      const rest = upcomingList.slice(1, 4);
      if (rest.length === 0) {
        subsequentContainer.innerHTML = '<div class="subsequent-chip-item"><span>Final task of the day</span></div>';
      } else {
        subsequentContainer.innerHTML = rest.map(task => `
          <div class="subsequent-chip-item">
            <span class="title">${task.title}</span>
            <span class="time">${ChronoScheduler.formatTime12(task.startTime)}</span>
          </div>
        `).join('');
      }
    }
  },

  updateFocusOverlay(activeMetrics, nextMetrics) {
    const overlay = document.getElementById('focus-overlay');
    if (!overlay || overlay.classList.contains('hidden')) return;

    const titleEl = document.getElementById('focus-task-title');
    const digitsEl = document.getElementById('focus-timer-digits');
    const catEl = document.getElementById('focus-category-tag');
    const fillEl = document.getElementById('focus-progress-fill');
    const notesEl = document.getElementById('focus-notes');
    const nextEl = document.getElementById('focus-next-title');

    if (!activeMetrics || activeMetrics.isFreeTime) {
      if (titleEl) titleEl.textContent = 'Free Time / Pause';
      if (digitsEl) digitsEl.textContent = activeMetrics ? activeMetrics.formattedRemaining : '--:--';
      if (catEl) catEl.textContent = 'Rest';
      if (fillEl) fillEl.style.width = '100%';
      if (notesEl) notesEl.textContent = 'Relax or get ready for your next activity.';
    } else {
      const item = activeMetrics.item;
      if (titleEl) titleEl.textContent = item.title;
      if (digitsEl) digitsEl.textContent = activeMetrics.formattedRemaining;
      if (catEl) {
        catEl.className = `category-pill pill-${item.category || 'study'}`;
        catEl.textContent = item.category || 'Focus';
      }
      if (fillEl) fillEl.style.width = `${activeMetrics.progressPercent}%`;
      if (notesEl) notesEl.textContent = item.notes || 'Stay present with this task.';
    }

    if (nextEl) {
      if (nextMetrics) {
        nextEl.textContent = `${nextMetrics.item.title} (${ChronoScheduler.formatTime12(nextMetrics.item.startTime)})`;
      } else {
        nextEl.textContent = 'None remaining today';
      }
    }
  },

  updateRippleBanner(dailyState) {
    const banner = document.getElementById('ripple-status-banner');
    const bannerText = document.getElementById('ripple-banner-text');
    if (!banner || !bannerText) return;

    if (dailyState.shiftMinutes !== 0 || (dailyState.emergencyBlocks && dailyState.emergencyBlocks.length > 0)) {
      banner.classList.remove('hidden');
      const shiftMsg = dailyState.shiftMinutes > 0 
        ? `Morning ripple active: Flexible tasks shifted +${dailyState.shiftMinutes}m due to sleep adjustments.`
        : `Dynamic schedule active: Tasks adjusted by ${dailyState.shiftMinutes}m.`;
      bannerText.textContent = shiftMsg;
    } else {
      banner.classList.add('hidden');
    }
  },

  // ==========================================================================
  // RENDER VIEWS
  // ==========================================================================
  refreshAllViews() {
    this.renderTodayTimeline();
    this.renderTimetableSlots();
    this.renderDeadlines();
    this.renderSleepLogs();
    this.renderDailyReview();
  },

  renderTodayTimeline() {
    const container = document.getElementById('today-timeline-list');
    const dateLabel = document.getElementById('timeline-date-label');
    if (!container) return;

    const todayStr = ChronoScheduler.getTodayDateStr();
    const resolved = ChronoScheduler.resolveScheduleForDate(todayStr);

    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();

    if (dateLabel) {
      const options = { weekday: 'long', month: 'long', day: 'numeric' };
      dateLabel.textContent = `${now.toLocaleDateString(undefined, options)} • Adaptive dynamic timeline`;
    }

    if (resolved.items.length === 0) {
      container.innerHTML = `
        <div class="empty-state-box">
          <p>No slots scheduled for today. Tap "+ Add Slot" above to schedule classes or study sessions.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = resolved.items.map(task => {
      const isActive = (task.startMins <= currentMins && currentMins < task.endMins && !task.isSkipped);
      const isPast = (currentMins >= task.endMins);

      let rowClasses = 'timeline-row';
      if (isActive) rowClasses += ' is-active-task';
      if (task.isCompleted) rowClasses += ' is-completed-task';
      if (task.isSkipped) rowClasses += ' is-skipped-task';

      return `
        <div class="${rowClasses}" data-task-id="${task.id}">
          <div class="timeline-time-col">
            <span class="time-start">${ChronoScheduler.formatTime12(task.startTime)}</span>
            <span class="time-duration">${task.duration} mins</span>
          </div>

          <div class="timeline-body-col">
            <div class="timeline-title-row">
              <span class="timeline-title">${task.title}</span>
              <span class="category-pill pill-${task.category || 'study'}">${task.category || 'Task'}</span>
              ${task.isFixed ? '<span class="meta-badge-fixed">Fixed</span>' : '<span class="meta-badge-flex">Flexible</span>'}
              ${task.isRescheduled ? `<span class="reschedule-tag" title="${task.rescheduleReason || 'Rescheduled'}">⚡ ${task.rescheduleReason || 'Shifted'}</span>` : ''}
              ${task.isEmergency ? '<span class="reschedule-tag text-danger">⚠️ Emergency Break</span>' : ''}
              ${task.isSkipped ? '<span class="reschedule-tag text-warning">Skipped Today</span>' : ''}
            </div>
            ${task.notes ? `<div class="timeline-notes">${task.notes}</div>` : ''}
          </div>

          <div class="timeline-actions-col">
            <!-- Complete Checkbox Button -->
            <button class="btn-icon-sm ${task.isCompleted ? 'btn-check-active' : ''}" 
                    onclick="App.toggleTaskComplete('${task.id}')" 
                    title="${task.isCompleted ? 'Mark incomplete' : 'Mark completed'}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </button>

            <!-- Skip Button -->
            <button class="btn-icon-sm" 
                    onclick="App.toggleSkipTask('${task.id}', ${task.isSkipped})" 
                    title="${task.isSkipped ? 'Unskip task' : 'Skip for today'}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="5 4 15 12 5 20 5 4"/>
                <line x1="19" y1="5" x2="19" y2="19"/>
              </svg>
            </button>

            <!-- Delete Choice Button -->
            <button class="btn-icon-sm" 
                    onclick="App.promptDeleteTask('${task.id}', '${task.title.replace(/'/g, "\\'")}')" 
                    title="Delete today or permanently">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  renderTimetableSlots() {
    const container = document.getElementById('timetable-slots-grid');
    if (!container) return;

    const allTasks = ChronoStorage.getTasks();
    const filterDay = this.selectedTimetableDay;

    let filtered = allTasks;
    if (filterDay !== 'All') {
      filtered = allTasks.filter(t => !t.days || t.days.includes('Everyday') || t.days.includes(filterDay));
    }

    filtered.sort((a, b) => ChronoScheduler.timeToMinutes(a.startTime) - ChronoScheduler.timeToMinutes(b.startTime));

    if (filtered.length === 0) {
      container.innerHTML = `<div class="empty-state-box"><p>No slots found for ${filterDay}. Tap "+ New Slot" to add a class or activity.</p></div>`;
      return;
    }

    const allDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    container.innerHTML = filtered.map(slot => {
      const daysBadges = allDays.map(d => {
        const matches = slot.days && (slot.days.includes(d) || slot.days.includes('Everyday'));
        return `<span class="day-mini-badge ${matches ? 'match' : ''}">${d[0]}</span>`;
      }).join('');

      return `
        <div class="slot-card" data-slot-id="${slot.id}">
          <div class="slot-top-row">
            <div>
              <span class="category-pill pill-${slot.category || 'class'}">${slot.category || 'Slot'}</span>
              <h4 class="slot-title" style="margin-top: 8px;">${slot.title}</h4>
              <div class="slot-days-badges">${daysBadges}</div>
            </div>
            ${slot.isFixed ? '<span class="meta-badge-fixed">Fixed</span>' : '<span class="meta-badge-flex">Flexible</span>'}
          </div>

          <div>
            <div class="meta-item" style="margin-bottom: 6px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <span>${ChronoScheduler.formatTime12(slot.startTime)} • ${slot.duration} mins</span>
            </div>
            ${slot.notes ? `<div class="timeline-notes">${slot.notes}</div>` : ''}
          </div>

          <div class="slot-bottom-row">
            <button class="btn-text" onclick="App.editSlot('${slot.id}')">Edit Slot</button>
            <button class="btn-text text-danger" onclick="App.deleteSlotPermanently('${slot.id}')">Delete</button>
          </div>
        </div>
      `;
    }).join('');
  },

  renderDeadlines() {
    const container = document.getElementById('deadlines-list-container');
    const badgeCounter = document.getElementById('badge-deadline-count');
    const deadlines = ChronoStorage.getDeadlines();

    const activeDeadlines = deadlines.filter(d => !d.completed);
    if (badgeCounter) badgeCounter.textContent = String(activeDeadlines.length);

    if (!container) return;

    if (deadlines.length === 0) {
      container.innerHTML = `<div class="empty-state-box"><p>No deadlines scheduled. Tap "+ Add Deadline" to track examinations and assignments.</p></div>`;
      return;
    }

    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);

    container.innerHTML = deadlines.map(dl => {
      const dueDate = new Date(dl.dueDate + 'T23:59:59');
      const diffDays = Math.ceil((dueDate - todayDate) / (1000 * 60 * 60 * 24));

      let countdownText = `${diffDays} days left`;
      let isUrgent = diffDays <= 2 && !dl.completed;
      if (diffDays === 0) countdownText = 'Due Today!';
      if (diffDays < 0) countdownText = 'Overdue';

      return `
        <div class="deadline-card is-${dl.type || 'exam'} ${dl.completed ? 'completed' : ''}">
          <div class="deadline-header-row">
            <span class="category-pill pill-${dl.type === 'exam' ? 'exam' : 'study'}">${dl.type ? dl.type.toUpperCase() : 'DEADLINE'}</span>
            <span class="deadline-countdown-badge ${isUrgent ? 'due-soon' : ''}">
              ${dl.completed ? 'Completed' : countdownText}
            </span>
          </div>

          <div>
            <h4 class="deadline-title">${dl.title}</h4>
            <div class="deadline-meta-row" style="margin-top: 6px;">
              <span>Due: ${dl.dueDate} at ${dl.dueTime || '23:59'}</span>
              <span>• Priority: ${dl.priority || 'High'}</span>
            </div>
            ${dl.notes ? `<p class="timeline-notes" style="margin-top: 8px;">${dl.notes}</p>` : ''}
          </div>

          <div class="slot-bottom-row">
            <button class="btn-action ${dl.completed ? 'btn-action-extend' : 'btn-action-done'}" onclick="App.toggleDeadlineComplete('${dl.id}')">
              ${dl.completed ? 'Mark Incomplete' : 'Mark Completed'}
            </button>
            <button class="btn-text text-danger" onclick="App.deleteDeadline('${dl.id}')">Delete</button>
          </div>
        </div>
      `;
    }).join('');
  },

  renderSleepLogs() {
    const container = document.getElementById('sleep-history-list');
    const targetSleepEl = document.getElementById('stat-target-sleep');
    const avgSleepEl = document.getElementById('stat-avg-sleep');
    const bedtimeCfgEl = document.getElementById('stat-bedtime-cfg');

    const config = ChronoStorage.getConfig();
    const logs = ChronoStorage.getSleepLogs();

    if (targetSleepEl) targetSleepEl.textContent = `${config.targetSleepHours} hrs`;
    if (bedtimeCfgEl) bedtimeCfgEl.textContent = ChronoScheduler.formatTime12(config.standardSleepTime);

    if (avgSleepEl) {
      if (logs.length > 0) {
        const sum = logs.slice(0, 7).reduce((acc, l) => acc + (Number(l.actualHours) || 0), 0);
        const avg = Math.round((sum / Math.min(logs.length, 7)) * 10) / 10;
        avgSleepEl.textContent = `${avg} hrs`;
      } else {
        avgSleepEl.textContent = `${config.targetSleepHours} hrs`;
      }
    }

    if (!container) return;

    if (logs.length === 0) {
      container.innerHTML = `<div class="empty-state-box"><p>No sleep logs recorded yet. Tap "Log Sleep / Wake Now" above to start tracking.</p></div>`;
      return;
    }

    container.innerHTML = logs.map(log => `
      <div class="sleep-log-row">
        <div>
          <div class="sleep-log-date">${log.date}</div>
          <div class="sleep-log-times">Bed: ${ChronoScheduler.formatTime12(log.sleptAt)} • Wake: ${ChronoScheduler.formatTime12(log.wokeAt)}</div>
          ${log.notes ? `<div class="timeline-notes">${log.notes}</div>` : ''}
        </div>
        <div style="text-align: right;">
          <div class="sleep-log-dur">${log.actualHours} hrs</div>
          <span class="category-pill pill-sleep">${log.quality || 'Good'}</span>
        </div>
      </div>
    `).join('');
  },

  renderDailyReview() {
    const todayStr = ChronoScheduler.getTodayDateStr();
    const stats = ChronoScheduler.getDailyReviewStats(todayStr);

    const percentEl = document.getElementById('review-completion-percent');
    const circleEl = document.getElementById('review-score-circle');
    const compEl = document.getElementById('rev-completed-count');
    const skipEl = document.getElementById('rev-skipped-count');
    const pendEl = document.getElementById('rev-pending-count');
    const breakdownEl = document.getElementById('review-tasks-breakdown');

    if (percentEl) percentEl.textContent = `${stats.completionRate}%`;
    if (compEl) compEl.textContent = String(stats.completedCount);
    if (skipEl) skipEl.textContent = String(stats.skippedCount);
    if (pendEl) pendEl.textContent = String(stats.pendingCount);

    if (circleEl) {
      const circumference = 2 * Math.PI * 68; // 427.25
      const offset = circumference - ((stats.completionRate / 100) * circumference);
      circleEl.style.strokeDashoffset = String(offset);
    }

    if (breakdownEl) {
      if (stats.tasks.length === 0) {
        breakdownEl.innerHTML = '<div class="empty-state-box"><p>No tasks recorded today.</p></div>';
      } else {
        breakdownEl.innerHTML = stats.tasks.map(t => {
          let statusLabel = '<span class="text-muted">Pending</span>';
          if (t.isCompleted) statusLabel = '<span class="text-success bold">✓ Completed</span>';
          if (t.isSkipped) statusLabel = '<span class="text-warning bold">⚠ Skipped</span>';

          return `
            <div class="review-item-row">
              <div>
                <strong>${t.title}</strong>
                <span class="timeline-notes" style="margin-left: 8px;">${ChronoScheduler.formatTime12(t.startTime)} (${t.duration}m)</span>
              </div>
              <div>${statusLabel}</div>
            </div>
          `;
        }).join('');
      }
    }

    // Load saved review reflection if any
    const reviews = ChronoStorage.getDailyReviews();
    const todayReview = reviews[todayStr];
    const notesInput = document.getElementById('review-notes-input');
    if (notesInput && todayReview && todayReview.notes) {
      notesInput.value = todayReview.notes;
    }
  },

  // ==========================================================================
  // MODALS & EVENT HANDLERS
  // ==========================================================================
  initModals() {
    // Open Sleep Modal Buttons
    const btnSleep = document.getElementById('btn-sleep-adjust');
    const btnSleep2 = document.getElementById('btn-open-sleep-modal-2');
    if (btnSleep) btnSleep.addEventListener('click', () => this.openModal('modal-sleep'));
    if (btnSleep2) btnSleep2.addEventListener('click', () => this.openModal('modal-sleep'));

    // Open Emergency Modal
    const btnEmergency = document.getElementById('btn-emergency-time');
    if (btnEmergency) btnEmergency.addEventListener('click', () => this.openModal('modal-emergency'));

    // Open Task Modal
    const btnAddSlot1 = document.getElementById('btn-quick-add-task');
    const btnAddSlot2 = document.getElementById('btn-add-slot-modal');
    if (btnAddSlot1) btnAddSlot1.addEventListener('click', () => this.openNewTaskModal());
    if (btnAddSlot2) btnAddSlot2.addEventListener('click', () => this.openNewTaskModal());

    // Open Deadline Modal
    const btnAddDl = document.getElementById('btn-add-deadline-modal');
    if (btnAddDl) btnAddDl.addEventListener('click', () => this.openModal('modal-deadline'));

    // Modal Close Buttons
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modalId = btn.getAttribute('data-close');
        this.closeModal(modalId);
      });
    });

    // Close on backdrop click
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
          backdrop.classList.add('hidden');
        }
      });
    });

    // Reset Ripple Button
    const btnResetRipple = document.getElementById('btn-reset-ripple');
    if (btnResetRipple) {
      btnResetRipple.addEventListener('click', () => {
        const todayStr = ChronoScheduler.getTodayDateStr();
        ChronoStorage.updateDailyState(todayStr, s => ({ ...s, shiftMinutes: 0, emergencyBlocks: [] }));
        ChronoNotifications.showToast('Schedule reset to standard timings', 'info');
      });
    }

    // Submit Sleep Ripple
    const btnSubmitSleep = document.getElementById('btn-submit-sleep-ripple');
    if (btnSubmitSleep) {
      btnSubmitSleep.addEventListener('click', () => {
        const sleptVal = document.getElementById('sleep-input-slept').value;
        const wokeVal = document.getElementById('sleep-input-woke').value || null;
        const todayStr = ChronoScheduler.getTodayDateStr();

        const result = ChronoScheduler.handleSleepAdjustment(todayStr, sleptVal, wokeVal);
        this.closeModal('modal-sleep');

        ChronoNotifications.playChime('alert');
        ChronoNotifications.showToast(
          `Smart Ripple Applied!`,
          'success',
          `Flexible morning tasks shifted by +${result.shiftMinutes} mins (Wake: ${ChronoScheduler.formatTime12(result.calculatedWakeTime)}). Fixed classes remain locked.`
        );
      });
    }

    // Emergency Duration Selector Buttons
    document.querySelectorAll('.duration-selector-row .btn-chip-choice').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.duration-selector-row .btn-chip-choice').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Submit Emergency Free Time
    const btnSubmitEmergency = document.getElementById('btn-submit-emergency');
    if (btnSubmitEmergency) {
      btnSubmitEmergency.addEventListener('click', () => {
        const activeChoice = document.querySelector('.duration-selector-row .btn-chip-choice.active');
        const durationMins = activeChoice ? parseInt(activeChoice.getAttribute('data-mins'), 10) : 30;
        const title = document.getElementById('emergency-input-title').value || 'Emergency Break';
        const todayStr = ChronoScheduler.getTodayDateStr();

        ChronoScheduler.injectEmergencyFreeTime(todayStr, durationMins, title);
        this.closeModal('modal-emergency');

        ChronoNotifications.playChime('alert');
        ChronoNotifications.showToast(
          `Injected ${durationMins}m Emergency Break`,
          'warning',
          'Subsequent flexible tasks have been automatically cascaded forward.'
        );
      });
    }

    // Activity Nature (Scheduled Slot vs Reminder)
    const btnNatureSlot = document.getElementById('btn-nature-slot');
    const btnNatureReminder = document.getElementById('btn-nature-reminder');
    const natureInput = document.getElementById('task-form-nature');
    const durationGroup = document.getElementById('task-form-duration-container');
    const fixedGroup = document.getElementById('task-form-fixed-container');
    const labelStart = document.getElementById('label-task-start');
    const titleInput = document.getElementById('task-form-title');

    if (btnNatureSlot && btnNatureReminder) {
      btnNatureSlot.addEventListener('click', () => {
        btnNatureSlot.classList.add('active');
        btnNatureReminder.classList.remove('active');
        if (natureInput) natureInput.value = 'slot';
        if (durationGroup) durationGroup.style.display = '';
        if (fixedGroup) fixedGroup.style.display = '';
        if (labelStart) labelStart.textContent = 'Start Time *';
        if (titleInput) titleInput.placeholder = 'e.g. Operating Systems Slot B, Mess Breakfast, Self-Study';
      });

      btnNatureReminder.addEventListener('click', () => {
        btnNatureReminder.classList.add('active');
        btnNatureSlot.classList.remove('active');
        if (natureInput) natureInput.value = 'reminder';
        if (durationGroup) durationGroup.style.display = 'none';
        if (fixedGroup) fixedGroup.style.display = 'none';
        if (labelStart) labelStart.textContent = 'Reminder Alarm Time *';
        if (titleInput) titleInput.placeholder = 'e.g. Take medicine, Pay hostel fee, Submit quiz';
      });
    }

    // Form Task Submit
    const formTask = document.getElementById('form-task');
    if (formTask) {
      formTask.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveTaskFromForm();
      });
    }

    // Form Deadline Submit
    const formDeadline = document.getElementById('form-deadline');
    if (formDeadline) {
      formDeadline.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveDeadlineFromForm();
      });
    }

    // Timetable Day Filter Chips
    document.querySelectorAll('.day-filter-bar .day-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.day-filter-bar .day-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.selectedTimetableDay = chip.getAttribute('data-day');
        this.renderTimetableSlots();
      });
    });

    // Save Daily Review Reflection
    const btnSaveReview = document.getElementById('btn-save-review');
    if (btnSaveReview) {
      btnSaveReview.addEventListener('click', () => {
        const notes = document.getElementById('review-notes-input').value;
        const todayStr = ChronoScheduler.getTodayDateStr();
        ChronoStorage.saveDailyReview(todayStr, { date: todayStr, notes, savedAt: new Date().toISOString() });
        ChronoNotifications.showToast('Daily reflection saved!', 'success');
      });
    }
  },

  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('hidden');
  },

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('hidden');
  },

  // ==========================================================================
  // TASK ACTIONS (DONE, EXTEND, SKIP, DELETE)
  // ==========================================================================
  initTaskActions() {
    // Current Card Action: Done Early
    const btnDone = document.getElementById('btn-action-done');
    if (btnDone) {
      btnDone.addEventListener('click', () => {
        if (!this.currentActiveItem) return;
        const todayStr = ChronoScheduler.getTodayDateStr();
        ChronoScheduler.toggleTaskComplete(todayStr, this.currentActiveItem.id);
        ChronoNotifications.playChime('done');
        ChronoNotifications.showToast(`Completed: ${this.currentActiveItem.title}`, 'success');
      });
    }

    // Current Card Action: Extend +15m
    const btnExtend = document.getElementById('btn-action-extend');
    if (btnExtend) {
      btnExtend.addEventListener('click', () => {
        if (!this.currentActiveItem) return;
        const todayStr = ChronoScheduler.getTodayDateStr();
        ChronoScheduler.extendTask(todayStr, this.currentActiveItem.id, 15);
        ChronoNotifications.showToast(`Extended +15m. Flexible tasks shifted.`, 'info');
      });
    }

    // Current Card Action: Skip
    const btnSkip = document.getElementById('btn-action-skip');
    if (btnSkip) {
      btnSkip.addEventListener('click', () => {
        if (!this.currentActiveItem) return;
        const todayStr = ChronoScheduler.getTodayDateStr();
        ChronoScheduler.skipTask(todayStr, this.currentActiveItem.id);
        ChronoNotifications.showToast(`Skipped: ${this.currentActiveItem.title}`, 'warning');
      });
    }

    // Current Card Action: Delete
    const btnDelete = document.getElementById('btn-action-delete');
    if (btnDelete) {
      btnDelete.addEventListener('click', () => {
        if (!this.currentActiveItem) return;
        this.promptDeleteTask(this.currentActiveItem.id, this.currentActiveItem.title);
      });
    }

    // Focus Mode Controls
    const btnEnterFocus = document.getElementById('btn-enter-focus');
    const btnExitFocus = document.getElementById('btn-exit-focus');
    const focusOverlay = document.getElementById('focus-overlay');
    if (btnEnterFocus && focusOverlay) {
      btnEnterFocus.addEventListener('click', () => {
        focusOverlay.classList.remove('hidden');
      });
    }
    if (btnExitFocus && focusOverlay) {
      btnExitFocus.addEventListener('click', () => {
        focusOverlay.classList.add('hidden');
      });
    }

    const btnFocusDone = document.getElementById('btn-focus-done');
    if (btnFocusDone) {
      btnFocusDone.addEventListener('click', () => {
        if (this.currentActiveItem) {
          const todayStr = ChronoScheduler.getTodayDateStr();
          ChronoScheduler.toggleTaskComplete(todayStr, this.currentActiveItem.id);
          ChronoNotifications.playChime('done');
          ChronoNotifications.showToast(`Finished: ${this.currentActiveItem.title}`, 'success');
        }
      });
    }

    const btnFocusExtend = document.getElementById('btn-focus-extend');
    if (btnFocusExtend) {
      btnFocusExtend.addEventListener('click', () => {
        if (this.currentActiveItem) {
          const todayStr = ChronoScheduler.getTodayDateStr();
          ChronoScheduler.extendTask(todayStr, this.currentActiveItem.id, 15);
          ChronoNotifications.showToast(`Extended by 15 mins`, 'info');
        }
      });
    }

    // Delete Modal Options
    const btnDeleteTodayOnly = document.getElementById('btn-delete-today-only');
    const btnDeleteForever = document.getElementById('btn-delete-forever');

    if (btnDeleteTodayOnly) {
      btnDeleteTodayOnly.addEventListener('click', () => {
        if (!this.pendingDeleteTaskId) return;
        const todayStr = ChronoScheduler.getTodayDateStr();
        ChronoScheduler.deleteTaskToday(todayStr, this.pendingDeleteTaskId);
        this.closeModal('modal-delete-choice');
        ChronoNotifications.showToast('Removed for today only. Weekly timetable unchanged.', 'info');
      });
    }

    if (btnDeleteForever) {
      btnDeleteForever.addEventListener('click', () => {
        if (!this.pendingDeleteTaskId) return;
        ChronoStorage.deleteTask(this.pendingDeleteTaskId);
        this.closeModal('modal-delete-choice');
        ChronoNotifications.showToast('Permanently deleted from timetable.', 'warning');
      });
    }
  },

  toggleTaskComplete(taskId) {
    const todayStr = ChronoScheduler.getTodayDateStr();
    ChronoScheduler.toggleTaskComplete(todayStr, taskId);
    ChronoNotifications.playChime('done');
  },

  toggleSkipTask(taskId, currentlySkipped) {
    const todayStr = ChronoScheduler.getTodayDateStr();
    if (currentlySkipped) {
      ChronoScheduler.unskipTask(todayStr, taskId);
      ChronoNotifications.showToast('Task unskipped', 'info');
    } else {
      ChronoScheduler.skipTask(todayStr, taskId);
      ChronoNotifications.showToast('Task skipped for today', 'warning');
    }
  },

  promptDeleteTask(taskId, taskTitle) {
    this.pendingDeleteTaskId = taskId;
    const titleEl = document.getElementById('delete-modal-task-name');
    if (titleEl) titleEl.textContent = taskTitle;
    this.openModal('modal-delete-choice');
  },

  // ==========================================================================
  // TASK & DEADLINE CRUD
  // ==========================================================================
  openNewTaskModal() {
    document.getElementById('task-form-id').value = '';
    document.getElementById('modal-task-title-heading').textContent = 'Create Timetable Slot / Task';
    document.getElementById('task-form-title').value = '';
    document.getElementById('task-form-category').value = 'class';
    document.getElementById('task-form-start').value = '09:00';
    document.getElementById('task-form-duration').value = '60';
    document.getElementById('task-form-fixed').checked = true;
    document.getElementById('task-form-notes').value = '';

    // Reset nature to slot
    const btnSlot = document.getElementById('btn-nature-slot');
    const btnReminder = document.getElementById('btn-nature-reminder');
    if (btnSlot) btnSlot.classList.add('active');
    if (btnReminder) btnReminder.classList.remove('active');
    const natureInput = document.getElementById('task-form-nature');
    if (natureInput) natureInput.value = 'slot';
    const durationGroup = document.getElementById('task-form-duration-container');
    const fixedGroup = document.getElementById('task-form-fixed-container');
    if (durationGroup) durationGroup.style.display = '';
    if (fixedGroup) fixedGroup.style.display = '';

    // Check weekday boxes by default
    document.querySelectorAll('input[name="task-days"]').forEach(box => {
      box.checked = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(box.value);
    });

    this.openModal('modal-task');
  },

  editSlot(slotId) {
    const tasks = ChronoStorage.getTasks();
    const slot = tasks.find(t => t.id === slotId);
    if (!slot) return;

    document.getElementById('task-form-id').value = slot.id;
    document.getElementById('modal-task-title-heading').textContent = slot.isReminder ? 'Edit Reminder' : 'Edit Timetable Slot';
    document.getElementById('task-form-title').value = slot.title;
    document.getElementById('task-form-category').value = slot.category || 'class';
    document.getElementById('task-form-priority').value = slot.priority || 'medium';
    document.getElementById('task-form-start').value = slot.startTime;
    document.getElementById('task-form-duration').value = slot.duration || 60;
    document.getElementById('task-form-fixed').checked = !!slot.isFixed;
    document.getElementById('task-form-notes').value = slot.notes || '';

    const btnSlot = document.getElementById('btn-nature-slot');
    const btnReminder = document.getElementById('btn-nature-reminder');
    const natureInput = document.getElementById('task-form-nature');
    const durationGroup = document.getElementById('task-form-duration-container');
    const fixedGroup = document.getElementById('task-form-fixed-container');

    if (slot.isReminder) {
      if (btnReminder) btnReminder.classList.add('active');
      if (btnSlot) btnSlot.classList.remove('active');
      if (natureInput) natureInput.value = 'reminder';
      if (durationGroup) durationGroup.style.display = 'none';
      if (fixedGroup) fixedGroup.style.display = 'none';
    } else {
      if (btnSlot) btnSlot.classList.add('active');
      if (btnReminder) btnReminder.classList.remove('active');
      if (natureInput) natureInput.value = 'slot';
      if (durationGroup) durationGroup.style.display = '';
      if (fixedGroup) fixedGroup.style.display = '';
    }

    document.querySelectorAll('input[name="task-days"]').forEach(box => {
      box.checked = slot.days && (slot.days.includes(box.value) || slot.days.includes('Everyday'));
    });

    this.openModal('modal-task');
  },

  saveTaskFromForm() {
    const id = document.getElementById('task-form-id').value;
    const title = document.getElementById('task-form-title').value.trim();
    const category = document.getElementById('task-form-category').value;
    const priority = document.getElementById('task-form-priority').value;
    const startTime = document.getElementById('task-form-start').value;
    const durationVal = parseInt(document.getElementById('task-form-duration').value, 10);
    const isFixedVal = document.getElementById('task-form-fixed').checked;
    const notes = document.getElementById('task-form-notes').value.trim();
    const isReminder = document.getElementById('task-form-nature').value === 'reminder';

    const selectedDays = [];
    document.querySelectorAll('input[name="task-days"]:checked').forEach(box => {
      selectedDays.push(box.value);
    });

    const taskObj = {
      id: id || ('task-' + Date.now()),
      title,
      category: isReminder ? 'personal' : category,
      priority,
      startTime,
      duration: isReminder ? 5 : (durationVal || 60),
      isFixed: isReminder ? true : isFixedVal,
      isReminder: !!isReminder,
      days: selectedDays.length === 7 ? ['Everyday'] : selectedDays,
      notes
    };

    if (id) {
      ChronoStorage.updateTask(taskObj);
      ChronoNotifications.showToast(`Updated: ${title}`, 'success');
    } else {
      ChronoStorage.addTask(taskObj);
      ChronoNotifications.showToast(`Added ${isReminder ? 'reminder' : 'slot'}: ${title}`, 'success');
    }

    // Schedule exact Android native alarm if running inside APK
    if (window.AndroidNative && window.AndroidNative.scheduleNativeAlarm) {
      try {
        const [h, m] = startTime.split(':').map(Number);
        const d = new Date();
        d.setHours(h, m, 0, 0);
        if (d.getTime() > Date.now()) {
          const alarmLabel = (isReminder ? '🔔 Reminder: ' : 'Upcoming Slot: ') + title;
          window.AndroidNative.scheduleNativeAlarm(taskObj.id, alarmLabel, notes || 'Scheduled in Chronoflow', d.getTime());
        }
      } catch (err) {
        console.warn('Native alarm schedule failed', err);
      }
    }

    this.closeModal('modal-task');
  },

  deleteSlotPermanently(slotId) {
    if (confirm('Permanently delete this slot from the weekly timetable?')) {
      ChronoStorage.deleteTask(slotId);
      ChronoNotifications.showToast('Slot deleted permanently', 'warning');
    }
  },

  saveDeadlineFromForm() {
    const title = document.getElementById('dl-title').value.trim();
    const type = document.getElementById('dl-type').value;
    const priority = document.getElementById('dl-priority').value;
    const dueDate = document.getElementById('dl-due-date').value;
    const dueTime = document.getElementById('dl-due-time').value || '23:59';
    const notes = document.getElementById('dl-notes').value.trim();

    const dlObj = {
      id: 'dl-' + Date.now(),
      title,
      type,
      priority,
      dueDate,
      dueTime,
      notes,
      completed: false
    };

    ChronoStorage.addDeadline(dlObj);
    this.closeModal('modal-deadline');
    ChronoNotifications.showToast(`Saved deadline: ${title}`, 'success');
  },

  toggleDeadlineComplete(id) {
    ChronoStorage.toggleDeadlineComplete(id);
    ChronoNotifications.playChime('done');
  },

  deleteDeadline(id) {
    if (confirm('Delete this deadline?')) {
      ChronoStorage.deleteDeadline(id);
      ChronoNotifications.showToast('Deadline deleted', 'info');
    }
  },

  // ==========================================================================
  // SETTINGS & BACKUP (GITHUB PAGES READY)
  // ==========================================================================
  initSettings() {
    const btnSaveCfg = document.getElementById('btn-save-settings');
    if (btnSaveCfg) {
      btnSaveCfg.addEventListener('click', () => {
        const config = ChronoStorage.getConfig();
        config.userName = document.getElementById('cfg-user-name').value.trim() || 'Student';
        config.standardSleepTime = document.getElementById('cfg-standard-sleep').value || '01:00';
        config.targetSleepHours = parseFloat(document.getElementById('cfg-target-sleep-hours').value) || 7.5;
        config.notifyBeforeMinutes = parseInt(document.getElementById('cfg-notify-before').value, 10) || 5;
        config.soundAlerts = document.getElementById('cfg-sound-alerts').checked;

        ChronoStorage.saveConfig(config);
        ChronoNotifications.showToast('Settings saved successfully!', 'success');
      });
    }

    const btnNotifPerm = document.getElementById('btn-request-notif-perm');
    if (btnNotifPerm) {
      btnNotifPerm.addEventListener('click', () => {
        ChronoNotifications.requestPermission();
      });
    }

    // Sync Native Android Phone Alarms (.ics)
    const btnSyncAlarms = document.getElementById('btn-sync-alarms');
    const btnSyncAlarmsSettings = document.getElementById('btn-sync-alarms-settings');
    if (btnSyncAlarms) {
      btnSyncAlarms.addEventListener('click', () => this.downloadICSAlarms());
    }
    if (btnSyncAlarmsSettings) {
      btnSyncAlarmsSettings.addEventListener('click', () => this.downloadICSAlarms());
    }

    // Export JSON Backup
    const btnExport = document.getElementById('btn-export-backup');
    if (btnExport) {
      btnExport.addEventListener('click', () => {
        const jsonStr = ChronoStorage.exportAllData();
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `chronoflow_backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        ChronoNotifications.showToast('Backup downloaded! Safe to store or transfer.', 'success');
      });
    }

    // Import JSON Backup
    const importInput = document.getElementById('import-file-input');
    if (importInput) {
      importInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
          const res = ChronoStorage.importData(event.target.result);
          if (res.success) {
            ChronoNotifications.showToast('Schedule restored from backup successfully!', 'success');
            App.refreshAllViews();
          } else {
            ChronoNotifications.showToast(`Import error: ${res.error}`, 'warning');
          }
        };
        reader.readAsText(file);
      });
    }

    // Reset Default Schedule
    const btnReset = document.getElementById('btn-reset-default');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        if (confirm('Reset your timetable, deadlines, and logs back to default student template?')) {
          ChronoStorage.resetToDefaults();
          ChronoNotifications.showToast('Schedule reset to default sample data', 'info');
          App.refreshAllViews();
        }
      });
    }
  },

  loadSettingsForm() {
    const config = ChronoStorage.getConfig();
    const nameEl = document.getElementById('cfg-user-name');
    const sleepEl = document.getElementById('cfg-standard-sleep');
    const hoursEl = document.getElementById('cfg-target-sleep-hours');
    const notifyEl = document.getElementById('cfg-notify-before');
    const soundEl = document.getElementById('cfg-sound-alerts');

    if (nameEl) nameEl.value = config.userName || '';
    if (sleepEl) sleepEl.value = config.standardSleepTime || '01:00';
    if (hoursEl) hoursEl.value = config.targetSleepHours || 7.5;
    if (notifyEl) notifyEl.value = config.notifyBeforeMinutes || 5;
    if (soundEl) soundEl.checked = !!config.soundAlerts;
  },

  // ==========================================================================
  // PWA INSTALLATION SUPPORT
  // ==========================================================================
  initPWA() {
    const installBtn = document.getElementById('btn-pwa-install');
    if (!installBtn) return;

    window.addEventListener('beforeinstallprompt', (e) => {
      // Prevent automatic banner and show custom install button
      e.preventDefault();
      this.deferredInstallPrompt = e;
      installBtn.classList.remove('hidden');
    });

    installBtn.addEventListener('click', async () => {
      if (!this.deferredInstallPrompt) return;
      this.deferredInstallPrompt.prompt();
      const choice = await this.deferredInstallPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        ChronoNotifications.showToast('Chronoflow installed as an app!', 'success');
      }
      this.deferredInstallPrompt = null;
      installBtn.classList.add('hidden');
    });

    window.addEventListener('appinstalled', () => {
      installBtn.classList.add('hidden');
      ChronoNotifications.showToast('App installed successfully!', 'success');
    });
  },

  downloadICSAlarms() {
    const todayStr = ChronoScheduler.getTodayDateStr();
    const icsContent = ChronoScheduler.generateICS(todayStr);
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chronoflow_alarms_${todayStr}.ics`;
    a.click();
    URL.revokeObjectURL(url);
    ChronoNotifications.playChime('done');
    ChronoNotifications.showToast('Alarms File Downloaded!', 'success', 'Open it with your Android Calendar/Clock to set loud device alarms.');
  }
};

window.App = App;
