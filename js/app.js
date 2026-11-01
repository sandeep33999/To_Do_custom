/**
 * AuraFlow Main Application Controller
 * Handles UI interactions, live timers, view routing, modals,
 * Gaussian sleep curves, 1-tap sleep tracking, mission deadlines, and Android native bridge.
 */

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

const App = {
  activeView: 'dashboard',
  selectedTimetableDay: 'Mon',
  timelineFilter: 'all',
  currentActiveItem: null,
  pendingDeleteTaskId: null,
  deferredInstallPrompt: null,
  lastResolvedMinute: -1,
  cachedResolvedSchedule: null,
  lastAction: null, // For instant undo: { type: 'complete'|'skip', taskId, taskTitle }

  init() {
    // 1. Initialize Theme
    this.initTheme();

    // 2. Initialize Navigation Tabs
    this.initNavigation();

    // 3. Initialize Top Quick Action Strip
    this.initTopActionStrip();

    // 4. Initialize Modals and Forms
    this.initModals();
    this.initTaskActions();
    this.initTimelineFilters();
    this.initSleepTrackerActions();
    this.initJournalReviewActions();
    this.initSettings();
    this.initPWA();
    this.initAndroidBridge();

    // 5. Initialize Notifications & Audio
    if (window.ChronoNotifications) {
      ChronoNotifications.init();
    }

    // 6. Listen for storage updates
    window.addEventListener('chronoflow:dailystate_updated', () => {
      this.invalidateScheduleCache();
      this.refreshAllViews();
    });
    window.addEventListener('chronoflow:tasks_updated', () => {
      this.invalidateScheduleCache();
      this.refreshAllViews();
    });
    window.addEventListener('chronoflow:deadlines_updated', () => this.renderDeadlines());
    window.addEventListener('chronoflow:sleeplogs_updated', () => this.renderSleepLogs());
    window.addEventListener('chronoflow:journal_updated', () => this.renderDailyReview());
    window.addEventListener('chronoflow:sleep_session_updated', () => this.updateSleepSessionUI());

    // 7. Match today's day of week for timetable tab default
    this.selectedTimetableDay = ChronoScheduler.getDayOfWeek();

    // 8. Start Live Clock & Timer Loop
    this.startLiveTimer();

    // 9. Initial Render
    this.refreshAllViews();
  },

  invalidateScheduleCache() {
    this.lastResolvedMinute = -1;
    this.cachedResolvedSchedule = null;
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

    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  // ==========================================================================
  // TOP HORIZONTAL ACTION STRIP
  // ==========================================================================
  initTopActionStrip() {
    const btnQuickAdd = document.getElementById('btn-top-quick-add');
    if (btnQuickAdd) {
      btnQuickAdd.addEventListener('click', () => this.openNewTaskModal());
    }

    const btnBufferSelect = document.getElementById('buffer-activity-select');
    if (btnBufferSelect) {
      const todayStr = ChronoScheduler.getTodayDateStr();
      btnBufferSelect.value = ChronoStorage.getBufferActivity(todayStr);
      btnBufferSelect.addEventListener('change', (e) => {
        ChronoStorage.setBufferActivity(todayStr, e.target.value);
        if (window.ChronoNotifications) {
          ChronoNotifications.showToast(`Buffer activity set: ${e.target.value}`, 'info');
        }
      });
    }

    // Instant Undo Button on Now Doing card
    const btnNowUndo = document.getElementById('btn-now-undo');
    if (btnNowUndo) {
      btnNowUndo.addEventListener('click', () => this.performUndo());
    }
  },

  // ==========================================================================
  // ANDROID NATIVE BRIDGE & BACK BUTTON HANDLING
  // ==========================================================================
  initAndroidBridge() {
    // Expose back button handler for Android MainActivity bridge
    window.handleAndroidBack = () => this.handleAndroidBack();

    // Browser back button / Escape key support
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.handleAndroidBack();
      }
    });
  },

  handleAndroidBack() {
    // 1. Close any open modal backdrop
    const openModals = document.querySelectorAll('.modal-backdrop:not(.hidden)');
    if (openModals.length > 0) {
      openModals.forEach(m => m.classList.add('hidden'));
      return true;
    }

    // 2. Close focus overlay if visible
    const focusOverlay = document.getElementById('focus-overlay');
    if (focusOverlay && !focusOverlay.classList.contains('hidden')) {
      focusOverlay.classList.add('hidden');
      return true;
    }

    // 3. Close inline edit forms on sleep card
    const inlineTarget = document.getElementById('wrap-edit-target-sleep');
    if (inlineTarget && !inlineTarget.classList.contains('hidden')) {
      inlineTarget.classList.add('hidden');
      return true;
    }
    const inlineBedtime = document.getElementById('wrap-edit-bedtime');
    if (inlineBedtime && !inlineBedtime.classList.contains('hidden')) {
      inlineBedtime.classList.add('hidden');
      return true;
    }

    // 4. If on secondary tab, return to main Dashboard tab
    if (this.activeView !== 'dashboard') {
      this.switchView('dashboard');
      return true;
    }

    // Return false so Android native layer can handle double-tap exit
    return false;
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

    // 1. Update Header Clock & Date
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

    // 2. Schedule resolution caching per minute (eliminates DOM stutter)
    const currentMinute = now.getHours() * 60 + now.getMinutes();
    const todayStr = ChronoScheduler.getTodayDateStr();

    if (this.lastResolvedMinute !== currentMinute || !this.cachedResolvedSchedule) {
      this.cachedResolvedSchedule = ChronoScheduler.resolveScheduleForDate(todayStr);
      this.lastResolvedMinute = currentMinute;
    }

    const { activeMetrics, nextMetrics, upcomingList } = ChronoScheduler.getCurrentAndNext(this.cachedResolvedSchedule, now);

    // 3. Update HUD "Now Doing" Card
    this.updateNowCard(activeMetrics, todayStr);

    // 4. Update HUD "Up Next" Card
    this.updateNextCard(nextMetrics, upcomingList);

    // 5. Update Focus Mode Overlay if open
    this.updateFocusOverlay(activeMetrics, nextMetrics);

    // 6. Update Ripple Status Banner
    this.updateRippleBanner(this.cachedResolvedSchedule.dailyState);

    // 7. Update Live Active Sleep Session if currently sleeping
    this.updateSleepSessionLiveCounter(now);
  },

  updateNowCard(metrics, todayStr) {
    const ringCircle = document.getElementById('now-progress-circle');
    const remainingTimeEl = document.getElementById('now-remaining-time');
    const taskTitleEl = document.getElementById('now-task-title');
    const categoryTagEl = document.getElementById('now-category-tag');
    const timeRangeEl = document.getElementById('now-time-range');
    const slotNatureEl = document.getElementById('now-slot-nature');
    const notesEl = document.getElementById('now-task-notes');
    const actionsBar = document.querySelector('.now-actions-bar');
    const bufferContainer = document.getElementById('buffer-activity-container');

    // Compact ring: radius 40 => circumference = 2 * PI * 40 ≈ 251.32
    const circumference = 251.32;

    if (!metrics || metrics.isFreeTime) {
      this.currentActiveItem = null;
      const bufferActivity = ChronoStorage.getBufferActivity(todayStr || ChronoScheduler.getTodayDateStr());

      if (taskTitleEl) taskTitleEl.textContent = bufferActivity || 'Free Buffer Time / Relax';
      if (remainingTimeEl) remainingTimeEl.textContent = metrics ? metrics.formattedRemaining : '00m 00s';
      if (categoryTagEl) {
        categoryTagEl.className = 'category-pill pill-break';
        categoryTagEl.textContent = 'Buffer Time';
      }
      if (timeRangeEl) {
        timeRangeEl.textContent = metrics && metrics.nextStart
          ? `Free until ${ChronoScheduler.formatTime12(metrics.nextStart)}`
          : 'Rest of the day';
      }
      if (slotNatureEl) {
        slotNatureEl.className = 'meta-badge-flex';
        slotNatureEl.textContent = 'Buffer Gap';
      }
      if (notesEl) notesEl.textContent = 'Relax, hydrate, or choose a custom activity from the selector below.';
      if (ringCircle) ringCircle.style.strokeDashoffset = '0';
      if (actionsBar) actionsBar.style.display = 'none';
      if (bufferContainer) bufferContainer.classList.remove('hidden');
      return;
    }

    const item = metrics.item;
    this.currentActiveItem = item;

    if (bufferContainer) bufferContainer.classList.add('hidden');
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
      ringCircle.style.strokeDashoffset = String(Math.max(0, offset));
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
    if (subsequentContainer && upcomingList) {
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
    if (!banner || !bannerText || !dailyState) return;

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
  // TIMELINE FILTERS & TASK LIST RENDERING
  // ==========================================================================
  initTimelineFilters() {
    const filterButtons = document.querySelectorAll('[data-timeline-filter]');
    filterButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        filterButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.timelineFilter = btn.getAttribute('data-timeline-filter') || 'all';
        this.renderTodayTimeline();
      });
    });
  },

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

    if (!resolved.items || resolved.items.length === 0) {
      container.innerHTML = `
        <div class="empty-state-box">
          <p>No slots scheduled for today. Tap "+ Add Slot" above to schedule classes or study sessions.</p>
        </div>
      `;
      return;
    }

    // Apply active timeline filter chip
    let filteredItems = resolved.items;
    if (this.timelineFilter === 'pending') {
      filteredItems = resolved.items.filter(t => !t.isCompleted && !t.isSkipped);
    } else if (this.timelineFilter === 'completed') {
      filteredItems = resolved.items.filter(t => t.isCompleted);
    } else if (this.timelineFilter === 'skipped') {
      filteredItems = resolved.items.filter(t => t.isSkipped);
    }

    if (filteredItems.length === 0) {
      container.innerHTML = `
        <div class="empty-state-box">
          <p>No tasks matching filter "${this.timelineFilter}".</p>
        </div>
      `;
      return;
    }

    container.innerHTML = filteredItems.map(task => {
      const isActive = (task.startMins <= currentMins && currentMins < task.endMins && !task.isSkipped);

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

  // ==========================================================================
  // TIMETABLE SLOTS GRID
  // ==========================================================================
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

  // ==========================================================================
  // MISSIONS (EXAMS & DEADLINES) - Requirement 1(a) to 1(e)
  // ==========================================================================
  renderDeadlines() {
    const container = document.getElementById('deadlines-list-container');
    const badgeCounter = document.getElementById('badge-deadline-count');
    const deadlines = ChronoStorage.getDeadlines();

    const activeDeadlines = deadlines.filter(d => !d.completed);
    if (badgeCounter) badgeCounter.textContent = String(activeDeadlines.length);

    if (!container) return;

    if (deadlines.length === 0) {
      container.innerHTML = `<div class="empty-state-box"><p>No active missions. Tap "+ Add Mission" to track examinations, deliverables, and assignments.</p></div>`;
      return;
    }

    // Requirement 1(a): Sort chronologically ascending by Date and Time
    deadlines.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      const timeA = new Date(`${a.dueDate}T${a.dueTime || '23:59'}:00`).getTime();
      const timeB = new Date(`${b.dueDate}T${b.dueTime || '23:59'}:00`).getTime();
      return timeA - timeB;
    });

    const nowTime = new Date().getTime();

    container.innerHTML = deadlines.map(dl => {
      const dueTimestamp = new Date(`${dl.dueDate}T${dl.dueTime || '23:59'}:00`).getTime();
      const diffMs = dueTimestamp - nowTime;
      const diffHours = Math.round(diffMs / (1000 * 60 * 60));
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      // Requirement 1(b): If less than 24h, countdown in hours without bouncing animation
      let countdownText = `${diffDays} days left`;
      let isUrgent = diffMs > 0 && diffMs <= (24 * 60 * 60 * 1000);

      if (diffMs < 0) {
        countdownText = 'Overdue';
      } else if (diffHours < 1) {
        const diffMins = Math.max(1, Math.round(diffMs / (1000 * 60)));
        countdownText = `${diffMins}m left`;
      } else if (diffHours < 24) {
        countdownText = `${diffHours}h left`;
      } else if (diffDays === 1) {
        countdownText = 'Tomorrow';
      }

      return `
        <div class="deadline-card is-${dl.type || 'exam'} ${dl.completed ? 'completed' : ''}">
          <div class="deadline-header-row">
            <span class="category-pill pill-${dl.type === 'exam' ? 'exam' : 'study'}">${dl.type ? dl.type.toUpperCase() : 'MISSION'}</span>
            <span class="deadline-countdown-badge ${isUrgent && !dl.completed ? 'due-soon' : ''}">
              ${dl.completed ? 'Completed' : countdownText}
            </span>
          </div>

          <div>
            <h4 class="deadline-title">${dl.title}</h4>
            <div class="deadline-meta-row" style="margin-top: 6px;">
              <span>Due: ${dl.dueDate} at ${dl.dueTime || '23:59'}</span>
            </div>
            ${dl.notes ? `<p class="timeline-notes" style="margin-top: 8px;">${dl.notes}</p>` : ''}
          </div>

          <!-- Requirement 1(a): Edit option between Mark Completed and Delete -->
          <div class="slot-bottom-row">
            <button class="btn-action ${dl.completed ? 'btn-action-extend' : 'btn-action-done'}" onclick="App.toggleDeadlineComplete('${dl.id}')">
              ${dl.completed ? 'Mark Incomplete' : 'Mark Completed'}
            </button>
            <button class="btn-text" onclick="App.editDeadline('${dl.id}')">Edit</button>
            <button class="btn-text text-danger" onclick="App.deleteDeadline('${dl.id}')">Delete</button>
          </div>
        </div>
      `;
    }).join('');
  },

  openNewDeadlineModal() {
    const editIdInput = document.getElementById('dl-edit-id');
    const titleInput = document.getElementById('dl-title');
    const typeSelect = document.getElementById('dl-type');
    const dateInput = document.getElementById('dl-due-date');
    const timeInput = document.getElementById('dl-due-time');
    const notesInput = document.getElementById('dl-notes');
    const heading = document.getElementById('modal-deadline-title-heading');

    if (editIdInput) editIdInput.value = '';
    if (heading) heading.textContent = 'Add Mission';
    if (titleInput) titleInput.value = '';
    if (typeSelect) typeSelect.value = 'exam';
    if (dateInput) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      dateInput.value = tomorrow.toISOString().split('T')[0];
    }
    if (timeInput) timeInput.value = '23:59';
    if (notesInput) notesInput.value = '';

    this.openModal('modal-deadline');
  },

  editDeadline(id) {
    const deadlines = ChronoStorage.getDeadlines();
    const dl = deadlines.find(d => d.id === id);
    if (!dl) return;

    const editIdInput = document.getElementById('dl-edit-id');
    const titleInput = document.getElementById('dl-title');
    const typeSelect = document.getElementById('dl-type');
    const dateInput = document.getElementById('dl-due-date');
    const timeInput = document.getElementById('dl-due-time');
    const notesInput = document.getElementById('dl-notes');
    const heading = document.getElementById('modal-deadline-title-heading');

    if (editIdInput) editIdInput.value = dl.id;
    if (heading) heading.textContent = 'Edit Mission';
    if (titleInput) titleInput.value = dl.title || '';
    if (typeSelect) typeSelect.value = dl.type || 'exam';
    if (dateInput) dateInput.value = dl.dueDate || '';
    if (timeInput) timeInput.value = dl.dueTime || '23:59';
    if (notesInput) notesInput.value = dl.notes || '';

    this.openModal('modal-deadline');
  },

  saveDeadlineFromForm() {
    const editId = document.getElementById('dl-edit-id').value;
    const title = document.getElementById('dl-title').value.trim();
    const type = document.getElementById('dl-type').value;
    const dueDate = document.getElementById('dl-due-date').value;
    const dueTime = document.getElementById('dl-due-time').value || '23:59';
    const notes = document.getElementById('dl-notes').value.trim();

    if (!title || !dueDate) {
      if (window.ChronoNotifications) ChronoNotifications.showToast('Please enter subject title and date', 'warning');
      return;
    }

    if (editId) {
      // Update existing
      const updated = {
        id: editId,
        title,
        type,
        dueDate,
        dueTime,
        notes,
        priority: 'high'
      };
      ChronoStorage.updateDeadline(updated);
      if (window.ChronoNotifications) ChronoNotifications.showToast(`Updated mission: ${title}`, 'success');
    } else {
      // Create new
      const newDl = {
        id: 'dl-' + Date.now(),
        title,
        type,
        priority: 'high',
        dueDate,
        dueTime,
        notes,
        completed: false
      };
      ChronoStorage.addDeadline(newDl);
      if (window.ChronoNotifications) ChronoNotifications.showToast(`Mission added: ${title}`, 'success');
    }

    this.closeModal('modal-deadline');
  },

  toggleDeadlineComplete(id) {
    ChronoStorage.toggleDeadlineComplete(id);
    if (window.ChronoNotifications) ChronoNotifications.playChime('done');
  },

  deleteDeadline(id) {
    if (confirm('Delete this mission?')) {
      ChronoStorage.deleteDeadline(id);
      if (window.ChronoNotifications) ChronoNotifications.showToast('Mission deleted', 'info');
    }
  },

  // ==========================================================================
  // SLEEP TRACKER & GAUSSIAN CURVES - Requirement 3.1 to 3.6
  // ==========================================================================
  initSleepTrackerActions() {
    // 3.1: 1-Tap Sleep Now and Wake Now Buttons
    const btnSleepNow = document.getElementById('btn-quick-sleep-now');
    const btnWakeNow = document.getElementById('btn-quick-wake-now');

    if (btnSleepNow) {
      btnSleepNow.addEventListener('click', () => {
        const now = new Date();
        ChronoStorage.setActiveSleepSession({
          startTime: now.toISOString(),
          status: 'asleep'
        });
        if (window.ChronoNotifications) {
          ChronoNotifications.playChime('alert');
          ChronoNotifications.showToast('🌙 Sleep session started. Rest well!', 'success');
        }
      });
    }

    if (btnWakeNow) {
      btnWakeNow.addEventListener('click', () => {
        const session = ChronoStorage.getActiveSleepSession();
        const now = new Date();
        let actualHours = 7.5;

        if (session && session.startTime) {
          const startMs = new Date(session.startTime).getTime();
          const diffHours = (now.getTime() - startMs) / (1000 * 60 * 60);
          actualHours = Math.max(0.5, Math.round(diffHours * 10) / 10);
        }

        const sleptTimeStr = session && session.startTime
          ? new Date(session.startTime).toTimeString().substring(0, 5)
          : '01:00';
        const wokeTimeStr = now.toTimeString().substring(0, 5);
        const todayStr = ChronoScheduler.getTodayDateStr();

        // Save sleep log
        ChronoStorage.addSleepLog({
          date: todayStr,
          sleptAt: sleptTimeStr,
          wokeAt: wokeTimeStr,
          actualHours: actualHours,
          quality: actualHours >= 7 ? 'Good' : 'Moderate',
          notes: 'Tracked via 1-tap sleep button'
        });

        // Clear active session
        ChronoStorage.setActiveSleepSession(null);

        // Calculate and apply ripple if woken after standard wake
        const config = ChronoStorage.getConfig();
        const standardWake = ChronoScheduler.calculateWakeTime(config.standardSleepTime, config.targetSleepHours);
        const wokeMins = ChronoScheduler.timeToMinutes(wokeTimeStr);
        const stdWakeMins = ChronoScheduler.timeToMinutes(standardWake);

        if (wokeMins > stdWakeMins) {
          const shift = wokeMins - stdWakeMins;
          ChronoStorage.updateDailyState(todayStr, s => ({ ...s, shiftMinutes: shift }));
          if (window.ChronoNotifications) {
            ChronoNotifications.showToast(
              `☀️ Good morning! Logged ${actualHours} hrs`,
              'success',
              `Morning ripple applied (+${shift}m). Fixed classes remain locked.`
            );
          }
        } else {
          if (window.ChronoNotifications) {
            ChronoNotifications.showToast(`☀️ Good morning! Logged ${actualHours} hrs sleep.`, 'success');
          }
        }

        this.renderSleepLogs();
      });
    }

    // 3.2: Target Sleep Inline Edit
    const cardTarget = document.getElementById('card-edit-target-sleep');
    const wrapTarget = document.getElementById('wrap-edit-target-sleep');
    const inputTarget = document.getElementById('input-edit-target-sleep');
    const btnSaveTarget = document.getElementById('btn-save-inline-target');

    if (cardTarget && wrapTarget) {
      cardTarget.addEventListener('click', (e) => {
        if (e.target.closest('#wrap-edit-target-sleep')) return;
        wrapTarget.classList.toggle('hidden');
      });
    }
    if (btnSaveTarget && inputTarget) {
      btnSaveTarget.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = parseFloat(inputTarget.value) || 7.5;
        const config = ChronoStorage.getConfig();
        config.targetSleepHours = val;
        ChronoStorage.saveConfig(config);
        wrapTarget.classList.add('hidden');
        this.renderSleepLogs();
        if (window.ChronoNotifications) ChronoNotifications.showToast(`Target sleep set to ${val} hrs`, 'success');
      });
    }

    // 3.4: Bedtime Inline Edit
    const cardBedtime = document.getElementById('card-edit-bedtime');
    const wrapBedtime = document.getElementById('wrap-edit-bedtime');
    const inputBedtime = document.getElementById('input-edit-bedtime');
    const btnSaveBedtime = document.getElementById('btn-save-inline-bedtime');

    if (cardBedtime && wrapBedtime) {
      cardBedtime.addEventListener('click', (e) => {
        if (e.target.closest('#wrap-edit-bedtime')) return;
        wrapBedtime.classList.toggle('hidden');
      });
    }
    if (btnSaveBedtime && inputBedtime) {
      btnSaveBedtime.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = inputBedtime.value || '01:00';
        const config = ChronoStorage.getConfig();
        config.standardSleepTime = val;
        ChronoStorage.saveConfig(config);
        wrapBedtime.classList.add('hidden');
        this.renderSleepLogs();
        if (window.ChronoNotifications) ChronoNotifications.showToast(`Standard bedtime set to ${ChronoScheduler.formatTime12(val)}`, 'success');
      });
    }
  },

  updateSleepSessionUI() {
    const session = ChronoStorage.getActiveSleepSession();
    const btnSleepNow = document.getElementById('btn-quick-sleep-now');
    const btnWakeNow = document.getElementById('btn-quick-wake-now');
    const statusText = document.getElementById('sleep-status-text');
    const headline = document.getElementById('sleep-session-headline');
    const subtext = document.getElementById('sleep-session-subtext');

    if (session && session.status === 'asleep') {
      if (btnSleepNow) btnSleepNow.classList.add('hidden');
      if (btnWakeNow) btnWakeNow.classList.remove('hidden');
      if (statusText) statusText.textContent = 'CURRENTLY ASLEEP';
      if (headline) headline.textContent = '🌙 Sleep Session in Progress';
      if (subtext) subtext.textContent = 'Resting now... Tap "Wake Up Now" as soon as you wake to complete your log.';
    } else {
      if (btnSleepNow) btnSleepNow.classList.remove('hidden');
      if (btnWakeNow) btnWakeNow.classList.add('hidden');
      if (statusText) statusText.textContent = 'CURRENTLY AWAKE';
      if (headline) headline.textContent = 'Ready for rest tonight?';
      if (subtext) subtext.textContent = 'Tap "Sleep Now" when you go to bed. AuraFlow will count your exact sleep duration.';
    }
  },

  updateSleepSessionLiveCounter(now) {
    const session = ChronoStorage.getActiveSleepSession();
    if (!session || session.status !== 'asleep' || !session.startTime) return;

    const startMs = new Date(session.startTime).getTime();
    const diffMs = Math.max(0, now.getTime() - startMs);
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((diffMs % (1000 * 60)) / 1000);

    const headline = document.getElementById('sleep-session-headline');
    if (headline) {
      headline.textContent = `🌙 Sleeping for ${hours}h ${mins}m ${secs}s`;
    }
  },

  renderSleepLogs() {
    const container = document.getElementById('sleep-history-list');
    const targetSleepEl = document.getElementById('stat-target-sleep');
    const avgSleepEl = document.getElementById('stat-avg-sleep');
    const bedtimeCfgEl = document.getElementById('stat-bedtime-cfg');
    const avgStatusEl = document.getElementById('stat-avg-status');
    const rippleStatusEl = document.getElementById('stat-ripple-status');

    const config = ChronoStorage.getConfig();
    const logs = ChronoStorage.getSleepLogs();

    if (targetSleepEl) targetSleepEl.textContent = `${config.targetSleepHours} hrs`;
    if (bedtimeCfgEl) bedtimeCfgEl.textContent = ChronoScheduler.formatTime12(config.standardSleepTime);

    // 3.3: 7-Day Average sleep duration
    let avg = config.targetSleepHours;
    if (logs.length > 0) {
      const recent = logs.slice(0, 7);
      const sum = recent.reduce((acc, l) => acc + (Number(l.actualHours) || 0), 0);
      avg = Math.round((sum / recent.length) * 10) / 10;
      if (avgSleepEl) avgSleepEl.textContent = `${avg} hrs`;
      if (avgStatusEl) {
        if (avg >= config.targetSleepHours) {
          avgStatusEl.textContent = 'Optimal recovery';
          avgStatusEl.className = 'stat-sub text-success';
        } else {
          avgStatusEl.textContent = `${Math.round((config.targetSleepHours - avg) * 10) / 10}h sleep debt`;
          avgStatusEl.className = 'stat-sub text-warning';
        }
      }
    } else {
      if (avgSleepEl) avgSleepEl.textContent = `${config.targetSleepHours} hrs`;
    }

    const todayStr = ChronoScheduler.getTodayDateStr();
    const resolved = ChronoScheduler.resolveScheduleForDate(todayStr);
    if (rippleStatusEl) {
      if (resolved.dailyState && resolved.dailyState.shiftMinutes !== 0) {
        rippleStatusEl.textContent = `+${resolved.dailyState.shiftMinutes}m`;
        rippleStatusEl.className = 'stat-value text-accent';
      } else {
        rippleStatusEl.textContent = 'Standard';
        rippleStatusEl.className = 'stat-value text-success';
      }
    }

    // Update 1-tap sleep UI
    this.updateSleepSessionUI();

    // 3.5: Graphical Bar Chart
    this.renderSleepBarChart(logs, config.targetSleepHours);

    // 3.6: Two Gaussian Distribution Curves
    this.drawNightGaussianCurve(logs, config);
    this.drawNapGaussianCurve();

    // Render sleep log history cards
    if (!container) return;

    if (logs.length === 0) {
      container.innerHTML = `<div class="empty-state-box"><p>No sleep logs recorded yet. Tap "Log Sleep Now" above to track your circadian rhythm.</p></div>`;
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

  // 3.5: 7-Day Sleep Duration Bar Chart
  renderSleepBarChart(logs, targetHours) {
    const container = document.getElementById('sleep-barchart-container');
    if (!container) return;

    // Last 7 days in chronological order
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const weekday = d.toLocaleDateString(undefined, { weekday: 'short' });
      const foundLog = logs.find(l => l.date === dateStr);
      days.push({
        date: dateStr,
        weekday,
        hours: foundLog ? Number(foundLog.actualHours) : (i === 0 ? 0 : 7.2)
      });
    }

    const maxScale = Math.max(10, Math.ceil(Math.max(...days.map(d => d.hours), targetHours + 1)));

    container.innerHTML = `
      <div class="barchart-target-line" style="bottom: ${(targetHours / maxScale) * 100}%;" title="Target: ${targetHours}h">
        <span class="target-label">Target ${targetHours}h</span>
      </div>
      <div class="barchart-bars-row">
        ${days.map(d => {
          const heightPercent = Math.min(100, Math.round((d.hours / maxScale) * 100));
          const isMet = d.hours >= targetHours;
          return `
            <div class="barchart-col">
              <div class="bar-val">${d.hours > 0 ? `${d.hours}h` : '-'}</div>
              <div class="bar-track">
                <div class="bar-fill ${isMet ? 'fill-optimal' : 'fill-deficit'}" style="height: ${heightPercent}%;"></div>
              </div>
              <div class="bar-day">${d.weekday}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  // 3.6: Gaussian Distribution Curve 1 - Night Sleep & Peak Deep Sleep
  drawNightGaussianCurve(logs, config) {
    const svg = document.getElementById('svg-night-curve');
    if (!svg) return;

    // Dimensions: 600 x 200
    // Gaussian formula: f(x) = H * exp( -((x - mu)^2) / (2 * sigma^2) )
    const width = 600;
    const height = 200;
    const baseline = 170;
    const peakHeight = 135;
    const mu = 300; // Peak deep sleep midpoint
    const sigma = 80;

    let pathD = `M 40,${baseline}`;
    const points = [];

    for (let x = 40; x <= 560; x += 8) {
      const exponent = -Math.pow(x - mu, 2) / (2 * Math.pow(sigma, 2));
      const y = baseline - (peakHeight * Math.exp(exponent));
      points.push({ x, y });
      pathD += ` L ${x.toFixed(1)},${y.toFixed(1)}`;
    }
    pathD += ` L 560,${baseline} Z`;

    const peakY = baseline - peakHeight;

    svg.innerHTML = `
      <defs>
        <linearGradient id="auroraCurveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#05d5b0" stop-opacity="0.25"/>
          <stop offset="50%" stop-color="#00f0aa" stop-opacity="0.75"/>
          <stop offset="100%" stop-color="#a855f7" stop-opacity="0.3"/>
        </linearGradient>
        <linearGradient id="auroraStrokeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#05d5b0"/>
          <stop offset="50%" stop-color="#00f0aa"/>
          <stop offset="100%" stop-color="#a855f7"/>
        </linearGradient>
      </defs>

      <!-- Baseline axis -->
      <line x1="30" y1="${baseline}" x2="570" y2="${baseline}" stroke="rgba(255,255,255,0.12)" stroke-width="1.5" />

      <!-- Area fill -->
      <path d="${pathD}" fill="url(#auroraCurveGrad)" />

      <!-- Curve Stroke -->
      <path d="${pathD.replace(/ Z$/, '')}" fill="none" stroke="url(#auroraStrokeGrad)" stroke-width="3.5" stroke-linecap="round" />

      <!-- Peak deep sleep marker -->
      <line x1="${mu}" y1="${peakY}" x2="${mu}" y2="${baseline}" stroke="#00f0aa" stroke-dasharray="4,4" stroke-width="1.5" opacity="0.8"/>
      <circle cx="${mu}" cy="${peakY}" r="5" fill="#00f0aa" />
      <text x="${mu}" y="${peakY - 12}" fill="#00f0aa" font-size="12" font-weight="700" text-anchor="middle">Deep Sleep Midpoint (~04:45)</text>

      <!-- Bedtime point -->
      <circle cx="120" cy="${baseline - 15}" r="4" fill="#05d5b0" />
      <text x="120" y="${baseline + 20}" fill="#94a3b8" font-size="11" text-anchor="middle">Bedtime (01:00)</text>

      <!-- Wake point -->
      <circle cx="480" cy="${baseline - 15}" r="4" fill="#a855f7" />
      <text x="480" y="${baseline + 20}" fill="#94a3b8" font-size="11" text-anchor="middle">Wake Up (08:30)</text>
    `;
  },

  // 3.6: Gaussian Distribution Curve 2 - Daytime Power Naps (1-2hr)
  drawNapGaussianCurve() {
    const svg = document.getElementById('svg-nap-curve');
    if (!svg) return;

    // Dimensions: 600 x 160
    const baseline = 135;
    const peakHeight = 90;
    const mu = 300; // 14:30 peak
    const sigma = 55;

    let pathD = `M 80,${baseline}`;

    for (let x = 80; x <= 520; x += 8) {
      const exponent = -Math.pow(x - mu, 2) / (2 * Math.pow(sigma, 2));
      const y = baseline - (peakHeight * Math.exp(exponent));
      pathD += ` L ${x.toFixed(1)},${y.toFixed(1)}`;
    }
    pathD += ` L 520,${baseline} Z`;

    const peakY = baseline - peakHeight;

    svg.innerHTML = `
      <defs>
        <linearGradient id="napGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.15"/>
          <stop offset="50%" stop-color="#f59e0b" stop-opacity="0.65"/>
          <stop offset="100%" stop-color="#00f0aa" stop-opacity="0.25"/>
        </linearGradient>
      </defs>

      <line x1="60" y1="${baseline}" x2="540" y2="${baseline}" stroke="rgba(255,255,255,0.12)" stroke-width="1.5" />
      <path d="${pathD}" fill="url(#napGrad)" />
      <path d="${pathD.replace(/ Z$/, '')}" fill="none" stroke="#f59e0b" stroke-width="3" stroke-linecap="round" />

      <!-- Nap Midpoint -->
      <circle cx="${mu}" cy="${peakY}" r="4.5" fill="#f59e0b" />
      <text x="${mu}" y="${peakY - 10}" fill="#f59e0b" font-size="11" font-weight="700" text-anchor="middle">Power Nap Peak (14:15 - 15:00)</text>

      <text x="160" y="${baseline + 18}" fill="#94a3b8" font-size="11" text-anchor="middle">Onset 13:30</text>
      <text x="440" y="${baseline + 18}" fill="#94a3b8" font-size="11" text-anchor="middle">Wake Refresh 15:30</text>
    `;
  },

  // ==========================================================================
  // DAILY REVIEW & REFLECTION JOURNAL - Requirement 2.1
  // ==========================================================================
  initJournalReviewActions() {
    const btnSaveReview = document.getElementById('btn-save-review');
    const notesInput = document.getElementById('review-notes-input');

    if (btnSaveReview && notesInput) {
      btnSaveReview.addEventListener('click', () => {
        const text = notesInput.value.trim();
        if (!text) {
          if (window.ChronoNotifications) ChronoNotifications.showToast('Please type your reflection first', 'warning');
          return;
        }

        const todayStr = ChronoScheduler.getTodayDateStr();
        const entry = {
          id: 'journal-' + Date.now(),
          date: todayStr,
          timestamp: new Date().toISOString(),
          notes: text
        };

        ChronoStorage.saveJournalEntry(entry);
        if (window.ChronoNotifications) {
          ChronoNotifications.playChime('done');
          ChronoNotifications.showToast('Reflection journal saved!', 'success');
        }
        this.renderDailyReview();
      });
    }
  },

  deleteJournalEntry(id) {
    if (confirm('Delete this journal reflection?')) {
      ChronoStorage.deleteJournalEntry(id);
      if (window.ChronoNotifications) ChronoNotifications.showToast('Journal entry deleted', 'info');
      this.renderDailyReview();
    }
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
    const journalList = document.getElementById('saved-journal-entries-list');
    const journalBadge = document.getElementById('journal-count-badge');

    if (percentEl) percentEl.textContent = `${stats.completionRate}%`;
    if (compEl) compEl.textContent = String(stats.completedCount);
    if (skipEl) skipEl.textContent = String(stats.skippedCount);
    if (pendEl) pendEl.textContent = String(stats.pendingCount);

    if (circleEl) {
      const circumference = 364.42; // 2 * PI * 58
      const offset = circumference - ((stats.completionRate / 100) * circumference);
      circleEl.style.strokeDashoffset = String(Math.max(0, offset));
    }

    // Task breakdown
    if (breakdownEl) {
      if (!stats.tasks || stats.tasks.length === 0) {
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

    // Requirement 2.1: Saved Reflection Journal History with date/timestamp and delete option
    const entries = ChronoStorage.getJournalEntries();
    if (journalBadge) journalBadge.textContent = `${entries.length} reflections recorded`;

    if (journalList) {
      if (entries.length === 0) {
        journalList.innerHTML = `<div class="empty-state-box"><p>No reflections saved yet. Type above and tap "Save Reflection".</p></div>`;
      } else {
        journalList.innerHTML = entries.map(item => {
          const formattedDate = new Date(item.timestamp).toLocaleString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });

          return `
            <div class="journal-entry-card" data-journal-id="${item.id}">
              <div class="journal-entry-header">
                <span class="journal-entry-time">🗓️ ${formattedDate}</span>
                <button class="btn-text text-danger" onclick="App.deleteJournalEntry('${item.id}')">Delete</button>
              </div>
              <p class="journal-entry-text">${item.notes.replace(/\n/g, '<br>')}</p>
            </div>
          `;
        }).join('');
      }
    }
  },

  // ==========================================================================
  // TASK ACTIONS (COMPLETE, EXTEND, SKIP, DELETE, UNDO)
  // ==========================================================================
  initTaskActions() {
    // Current Card Action: Done Early
    const btnDone = document.getElementById('btn-action-done');
    if (btnDone) {
      btnDone.addEventListener('click', () => {
        if (!this.currentActiveItem) return;
        const task = this.currentActiveItem;
        const todayStr = ChronoScheduler.getTodayDateStr();
        ChronoScheduler.toggleTaskComplete(todayStr, task.id);

        this.setLastAction('complete', task.id, task.title);
        if (window.ChronoNotifications) {
          ChronoNotifications.playChime('done');
          ChronoNotifications.showToast(`Completed: ${task.title}`, 'success');
        }
      });
    }

    // Current Card Action: Extend +15m
    const btnExtend = document.getElementById('btn-action-extend');
    if (btnExtend) {
      btnExtend.addEventListener('click', () => {
        if (!this.currentActiveItem) return;
        const todayStr = ChronoScheduler.getTodayDateStr();
        ChronoScheduler.extendTask(todayStr, this.currentActiveItem.id, 15);
        if (window.ChronoNotifications) ChronoNotifications.showToast(`Extended +15m. Flexible tasks shifted.`, 'info');
      });
    }

    // Current Card Action: Skip
    const btnSkip = document.getElementById('btn-action-skip');
    if (btnSkip) {
      btnSkip.addEventListener('click', () => {
        if (!this.currentActiveItem) return;
        const task = this.currentActiveItem;
        const todayStr = ChronoScheduler.getTodayDateStr();
        ChronoScheduler.skipTask(todayStr, task.id);

        this.setLastAction('skip', task.id, task.title);
        if (window.ChronoNotifications) ChronoNotifications.showToast(`Skipped: ${task.title}`, 'warning');
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
          if (window.ChronoNotifications) {
            ChronoNotifications.playChime('done');
            ChronoNotifications.showToast(`Finished: ${this.currentActiveItem.title}`, 'success');
          }
        }
      });
    }

    const btnFocusExtend = document.getElementById('btn-focus-extend');
    if (btnFocusExtend) {
      btnFocusExtend.addEventListener('click', () => {
        if (this.currentActiveItem) {
          const todayStr = ChronoScheduler.getTodayDateStr();
          ChronoScheduler.extendTask(todayStr, this.currentActiveItem.id, 15);
          if (window.ChronoNotifications) ChronoNotifications.showToast(`Extended by 15 mins`, 'info');
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
        if (window.ChronoNotifications) ChronoNotifications.showToast('Removed for today only. Weekly timetable unchanged.', 'info');
      });
    }

    if (btnDeleteForever) {
      btnDeleteForever.addEventListener('click', () => {
        if (!this.pendingDeleteTaskId) return;
        ChronoStorage.deleteTask(this.pendingDeleteTaskId);
        this.closeModal('modal-delete-choice');
        if (window.ChronoNotifications) ChronoNotifications.showToast('Permanently deleted from timetable.', 'warning');
      });
    }
  },

  // Instant Undo Banner Handling
  setLastAction(type, taskId, taskTitle) {
    this.lastAction = { type, taskId, taskTitle };
    const undoBanner = document.getElementById('now-undo-banner');
    const undoText = document.getElementById('now-undo-text');
    if (undoBanner && undoText) {
      undoText.textContent = type === 'complete' ? `Marked "${taskTitle}" as finished.` : `Skipped "${taskTitle}" for today.`;
      undoBanner.classList.remove('hidden');
      setTimeout(() => {
        if (undoBanner) undoBanner.classList.add('hidden');
      }, 9000);
    }
  },

  performUndo() {
    if (!this.lastAction) return;
    const { type, taskId, taskTitle } = this.lastAction;
    const todayStr = ChronoScheduler.getTodayDateStr();

    if (type === 'complete') {
      ChronoScheduler.toggleTaskComplete(todayStr, taskId);
    } else if (type === 'skip') {
      ChronoScheduler.unskipTask(todayStr, taskId);
    }

    const undoBanner = document.getElementById('now-undo-banner');
    if (undoBanner) undoBanner.classList.add('hidden');
    this.lastAction = null;

    if (window.ChronoNotifications) ChronoNotifications.showToast(`Undone: ${taskTitle} restored`, 'info');
  },

  toggleTaskComplete(taskId) {
    const todayStr = ChronoScheduler.getTodayDateStr();
    ChronoScheduler.toggleTaskComplete(todayStr, taskId);
    if (window.ChronoNotifications) ChronoNotifications.playChime('done');
  },

  toggleSkipTask(taskId, currentlySkipped) {
    const todayStr = ChronoScheduler.getTodayDateStr();
    if (currentlySkipped) {
      ChronoScheduler.unskipTask(todayStr, taskId);
      if (window.ChronoNotifications) ChronoNotifications.showToast('Task unskipped', 'info');
    } else {
      ChronoScheduler.skipTask(todayStr, taskId);
      if (window.ChronoNotifications) ChronoNotifications.showToast('Task skipped for today', 'warning');
    }
  },

  promptDeleteTask(taskId, taskTitle) {
    this.pendingDeleteTaskId = taskId;
    const titleEl = document.getElementById('delete-modal-task-name');
    if (titleEl) titleEl.textContent = taskTitle;
    this.openModal('modal-delete-choice');
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

    // Open Deadline (Mission) Modal
    const btnAddDl = document.getElementById('btn-add-deadline-modal');
    if (btnAddDl) btnAddDl.addEventListener('click', () => this.openNewDeadlineModal());

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
        if (window.ChronoNotifications) ChronoNotifications.showToast('Schedule reset to standard timings', 'info');
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

        if (window.ChronoNotifications) {
          ChronoNotifications.playChime('alert');
          ChronoNotifications.showToast(
            `Smart Ripple Applied!`,
            'success',
            `Flexible morning tasks shifted by +${result.shiftMinutes} mins (Wake: ${ChronoScheduler.formatTime12(result.calculatedWakeTime)}). Fixed classes remain locked.`
          );
        }
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

        if (window.ChronoNotifications) {
          ChronoNotifications.playChime('alert');
          ChronoNotifications.showToast(
            `Injected ${durationMins}m Emergency Break`,
            'warning',
            'Subsequent flexible tasks have been automatically cascaded forward.'
          );
        }
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
  // TASK FORM CRUD
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
    const prio = document.getElementById('task-form-priority');
    if (prio) prio.value = slot.priority || 'medium';
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
    const priority = document.getElementById('task-form-priority') ? document.getElementById('task-form-priority').value : 'high';
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
      if (window.ChronoNotifications) ChronoNotifications.showToast(`Updated: ${title}`, 'success');
    } else {
      ChronoStorage.addTask(taskObj);
      if (window.ChronoNotifications) ChronoNotifications.showToast(`Added ${isReminder ? 'reminder' : 'slot'}: ${title}`, 'success');
    }

    // Schedule Android native alarm if running inside APK
    if (window.AndroidNative && window.AndroidNative.scheduleNativeAlarm) {
      try {
        const [h, m] = startTime.split(':').map(Number);
        const d = new Date();
        d.setHours(h, m, 0, 0);
        if (d.getTime() > Date.now()) {
          const alarmLabel = (isReminder ? '🔔 Reminder: ' : 'Upcoming Slot: ') + title;
          window.AndroidNative.scheduleNativeAlarm(taskObj.id, alarmLabel, notes || 'Scheduled in AuraFlow', d.getTime());
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
      if (window.ChronoNotifications) ChronoNotifications.showToast('Slot deleted permanently', 'warning');
    }
  },

  // ==========================================================================
  // SETTINGS & BACKUP
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
        if (window.ChronoNotifications) ChronoNotifications.showToast('Settings saved successfully!', 'success');
      });
    }

    const btnNotifPerm = document.getElementById('btn-request-notif-perm');
    if (btnNotifPerm) {
      btnNotifPerm.addEventListener('click', () => {
        if (window.ChronoNotifications) ChronoNotifications.requestPermission();
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
        a.download = `auraflow_backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        if (window.ChronoNotifications) ChronoNotifications.showToast('Backup downloaded! Safe to store or transfer.', 'success');
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
            if (window.ChronoNotifications) ChronoNotifications.showToast('Schedule restored from backup successfully!', 'success');
            App.refreshAllViews();
          } else {
            if (window.ChronoNotifications) ChronoNotifications.showToast(`Import error: ${res.error}`, 'warning');
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
          if (window.ChronoNotifications) ChronoNotifications.showToast('Schedule reset to default sample data', 'info');
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
      e.preventDefault();
      this.deferredInstallPrompt = e;
      installBtn.classList.remove('hidden');
    });

    installBtn.addEventListener('click', async () => {
      if (!this.deferredInstallPrompt) return;
      this.deferredInstallPrompt.prompt();
      const choice = await this.deferredInstallPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        if (window.ChronoNotifications) ChronoNotifications.showToast('AuraFlow installed as an app!', 'success');
      }
      this.deferredInstallPrompt = null;
      installBtn.classList.add('hidden');
    });

    window.addEventListener('appinstalled', () => {
      installBtn.classList.add('hidden');
      if (window.ChronoNotifications) ChronoNotifications.showToast('App installed successfully!', 'success');
    });
  },

  downloadICSAlarms() {
    const todayStr = ChronoScheduler.getTodayDateStr();
    const icsContent = ChronoScheduler.generateICS(todayStr);
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `auraflow_alarms_${todayStr}.ics`;
    a.click();
    URL.revokeObjectURL(url);
    if (window.ChronoNotifications) {
      ChronoNotifications.playChime('done');
      ChronoNotifications.showToast('Alarms File Downloaded!', 'success', 'Open it with your Android Calendar/Clock to set loud device alarms.');
    }
  }
};

window.App = App;
