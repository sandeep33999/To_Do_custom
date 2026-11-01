/**
 * ZenRhythm Main Application Controller
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
    this.initNotesActions();
    this.initSettings();
    this.initSettingsArchive();
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
    window.addEventListener('chronoflow:sleeplogs_updated', () => this.renderAnalysis());
    window.addEventListener('chronoflow:journal_updated', () => {
      this.renderDailyReview();
      this.renderSettingsArchive();
    });
    window.addEventListener('chronoflow:sleep_session_updated', () => this.updateSleepSessionUI());
    window.addEventListener('chronoflow:notes_updated', () => this.renderNotes());
    window.addEventListener('chronoflow:buffer_updated', () => {
      this.renderAnalysis();
      this.renderSettingsArchive();
    });

    // 7. Match today's day of week for timetable tab default
    this.selectedTimetableDay = ChronoScheduler.getDayOfWeek();

    // 8. Start Live Clock & Timer Loop
    this.startLiveTimer();

    // 9. Initial Render
    this.refreshAllViews();

    // 10. Handle URL Shortcuts (from Android Widgets or PWA shortcuts)
    this.handleUrlShortcuts();
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
    if (viewName === 'analysis' || viewName === 'sleeplog') this.renderAnalysis();
    if (viewName === 'notes') this.renderNotes();
    if (viewName === 'review') this.renderDailyReview();
    if (viewName === 'settings') {
      this.loadSettingsForm();
      this.renderSettingsArchive();
    }

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
      const currentAct = ChronoStorage.getBufferActivity(todayStr);
      btnBufferSelect.value = currentAct;
      
      const bufferTextEl = document.getElementById('alloc-buffer-current-text');
      if (bufferTextEl) bufferTextEl.textContent = currentAct || 'Free buffer time / Relax';

      btnBufferSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        ChronoStorage.setBufferActivity(todayStr, val);
        ChronoStorage.logBufferTime(val);

        const currentText = document.getElementById('alloc-buffer-current-text');
        if (currentText) currentText.textContent = val;

        if (window.ChronoNotifications) {
          ChronoNotifications.showToast(`Buffer activity logged: ${val}`, 'info');
        }
        this.renderAnalysis();
        this.renderSettingsArchive();
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
    this.renderAnalysis();
    this.renderNotes();
    this.renderDailyReview();
    this.renderSettingsArchive();
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
  // SLEEP TRACKER, ANALYSIS & CIRCADIAN CURVES
  // ==========================================================================
  toggleSleepSession() {
    const session = ChronoStorage.getActiveSleepSession();
    if (session && session.status === 'asleep') {
      this.endSleepSession();
    } else {
      this.startSleepSession();
    }
  },

  startSleepSession() {
    const now = new Date();
    ChronoStorage.setActiveSleepSession({
      startTime: now.toISOString(),
      status: 'asleep'
    });
    if (window.ChronoNotifications) {
      ChronoNotifications.playChime('alert');
      ChronoNotifications.showToast('🌙 Sleep session started. Rest well!', 'success');
    }
    this.updateSleepSessionUI();
  },

  endSleepSession() {
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

    this.renderAnalysis();
  },

  initSleepTrackerActions() {
    // 3.1: 1-Tap Sleep Now and Wake Now Buttons
    const btnSleepNow = document.getElementById('btn-quick-sleep-now');
    const btnWakeNow = document.getElementById('btn-quick-wake-now');

    if (btnSleepNow) {
      btnSleepNow.addEventListener('click', () => this.startSleepSession());
    }

    if (btnWakeNow) {
      btnWakeNow.addEventListener('click', () => this.endSleepSession());
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
      if (subtext) subtext.textContent = 'Tap "Sleep Now" when you go to bed. ZenRhythm will count your exact sleep duration.';
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

  renderAnalysis() {
    const todayStr = ChronoScheduler.getTodayDateStr();
    const resolved = ChronoScheduler.resolveScheduleForDate(todayStr);
    const config = ChronoStorage.getConfig();

    // 1. Calculate time spent in each category (in minutes)
    let studyMins = 0;
    let classMins = 0;
    let routineMins = 120; // Default estimate for morning, lunch, dinner routine
    let sleepMins = Math.round((config.targetSleepHours || 7.5) * 60);

    // Check today's actual sleep log if available
    const sleepLogs = ChronoStorage.getSleepLogs();
    const todaySleep = sleepLogs.find(l => l.date === todayStr);
    if (todaySleep && todaySleep.actualHours) {
      sleepMins = Math.round(Number(todaySleep.actualHours) * 60);
    }

    let completedStudyOrClassMins = 0;
    let totalScheduledStudyOrClassMins = 0;

    if (resolved && resolved.items) {
      resolved.items.forEach(item => {
        const dur = Number(item.duration) || 30;
        if (item.category === 'study' || item.category === 'exam') {
          studyMins += dur;
          totalScheduledStudyOrClassMins += dur;
          if (item.isCompleted) completedStudyOrClassMins += dur;
        } else if (item.category === 'class') {
          classMins += dur;
          totalScheduledStudyOrClassMins += dur;
          if (item.isCompleted) completedStudyOrClassMins += dur;
        } else if (item.category === 'routine' || item.category === 'meals') {
          routineMins += dur;
        }
      });
    }

    // Buffer minutes is remaining time in a 24-hr (1440 mins) day
    const accountedMins = studyMins + classMins + routineMins + sleepMins;
    let bufferMins = Math.max(60, 1440 - accountedMins);

    // Productivity Efficiency Score
    let efficiency = 88;
    if (totalScheduledStudyOrClassMins > 0) {
      efficiency = Math.min(100, Math.max(25, Math.round((completedStudyOrClassMins / totalScheduledStudyOrClassMins) * 100)));
    } else {
      efficiency = (todaySleep && todaySleep.actualHours >= config.targetSleepHours) ? 92 : 85;
    }

    // Update DOM score badge
    const scoreValEl = document.getElementById('score-efficiency-val');
    if (scoreValEl) scoreValEl.textContent = `${efficiency}%`;

    // Calculate percentage widths for 24-hour bar
    const totalDayMins = studyMins + classMins + sleepMins + routineMins + bufferMins;
    const pStudy = ((studyMins / totalDayMins) * 100).toFixed(1);
    const pClass = ((classMins / totalDayMins) * 100).toFixed(1);
    const pSleep = ((sleepMins / totalDayMins) * 100).toFixed(1);
    const pRoutine = ((routineMins / totalDayMins) * 100).toFixed(1);
    const pBuffer = ((bufferMins / totalDayMins) * 100).toFixed(1);

    const segStudy = document.getElementById('seg-study');
    const segClass = document.getElementById('seg-class');
    const segSleep = document.getElementById('seg-sleep');
    const segRoutine = document.getElementById('seg-routine');
    const segBuffer = document.getElementById('seg-buffer');

    if (segStudy) segStudy.style.width = `${pStudy}%`;
    if (segClass) segClass.style.width = `${pClass}%`;
    if (segSleep) segSleep.style.width = `${pSleep}%`;
    if (segRoutine) segRoutine.style.width = `${pRoutine}%`;
    if (segBuffer) segBuffer.style.width = `${pBuffer}%`;

    // Update metrics numbers
    const vStudy = document.getElementById('val-study-hrs');
    const vClass = document.getElementById('val-class-hrs');
    const vSleep = document.getElementById('val-sleep-hrs');
    const vBuffer = document.getElementById('val-buffer-hrs');
    const vRoutine = document.getElementById('val-routine-hrs');

    if (vStudy) vStudy.textContent = `${(studyMins / 60).toFixed(1)}h`;
    if (vClass) vClass.textContent = `${(classMins / 60).toFixed(1)}h`;
    if (vSleep) vSleep.textContent = `${(sleepMins / 60).toFixed(1)}h`;
    if (vBuffer) vBuffer.textContent = `${(bufferMins / 60).toFixed(1)}h`;
    if (vRoutine) vRoutine.textContent = `${(routineMins / 60).toFixed(1)}h`;

    // Active buffer activity text
    const bufferTextEl = document.getElementById('alloc-buffer-current-text');
    if (bufferTextEl) {
      bufferTextEl.textContent = ChronoStorage.getBufferActivity(todayStr) || 'Free buffer time / Relax';
    }

    // Render sleep logs, sleep curves, and charts
    this.renderSleepLogs();
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

  // 3.6: Circadian Sleep Curves - Night Sleep Cycle & Daytime Nap Architecture
  drawNightGaussianCurve(logs, config) {
    const svg = document.getElementById('svg-night-curve');
    if (!svg) return;

    // Dimensions: 600 x 210
    const baseline = 155;
    const peakHeight = 115;
    const peakY = baseline - peakHeight; // 40

    // Dynamic timing based on user config
    const stdBedtime = config && config.standardSleepTime ? config.standardSleepTime : '01:00';
    const targetHours = config && config.targetSleepHours ? config.targetSleepHours : 7.5;
    const stdWake = ChronoScheduler.calculateWakeTime(stdBedtime, targetHours);

    // Calculate midpoint
    const [bH, bM] = stdBedtime.split(':').map(Number);
    const bedTotalMins = (bH * 60 + bM);
    const midTotalMins = (bedTotalMins + (targetHours * 60) / 2) % 1440;
    const midH = Math.floor(midTotalMins / 60);
    const midM = Math.round(midTotalMins % 60);
    const midpointFormatted = `${String(midH).padStart(2, '0')}:${String(midM).padStart(2, '0')}`;

    // Update legend row to match settings precisely
    const legendEl = document.getElementById('night-curve-legend');
    if (legendEl) {
      legendEl.innerHTML = `
        <span class="legend-item"><span class="legend-color color-bed"></span> Bedtime (${ChronoScheduler.formatTime12(stdBedtime)})</span>
        <span class="legend-item"><span class="legend-color color-deep"></span> Peak Deep Sleep (~${ChronoScheduler.formatTime12(midpointFormatted)})</span>
        <span class="legend-item"><span class="legend-color color-wake"></span> Wake Up (${ChronoScheduler.formatTime12(stdWake)})</span>
      `;
    }

    // X-Axis Time Scale: 11 PM to 10 AM (11 hours)
    const hours = ['11 PM', '12 AM', '1 AM', '2 AM', '3 AM', '4 AM', '5 AM', '6 AM', '7 AM', '8 AM', '9 AM', '10 AM'];
    const startX = 40;
    const endX = 560;
    const step = (endX - startX) / (hours.length - 1); // ~47.27px per hour

    // Align peak around 4:45 AM (between 4 AM at index 5 and 5 AM at index 6)
    const mu = startX + (5.75 * step); // ~312px
    const sigma = 72;

    // Generate bell curve path
    let pathD = `M 30,${baseline}`;
    for (let x = 30; x <= 570; x += 6) {
      const exponent = -Math.pow(x - mu, 2) / (2 * Math.pow(sigma, 2));
      const y = baseline - (peakHeight * Math.exp(exponent));
      pathD += ` L ${x.toFixed(1)},${y.toFixed(1)}`;
    }
    pathD += ` L 570,${baseline} Z`;

    // Coordinates for bedtime (~01:00 AM) and wake up (~08:30 AM)
    const bedX = startX + (2 * step); // 1 AM
    const wakeX = startX + (9.5 * step); // 8:30 AM

    // Calculate Y on curve for bedtime and wake
    const bedY = baseline - (peakHeight * Math.exp(-Math.pow(bedX - mu, 2) / (2 * Math.pow(sigma, 2))));
    const wakeY = baseline - (peakHeight * Math.exp(-Math.pow(wakeX - mu, 2) / (2 * Math.pow(sigma, 2))));

    // Build X-axis ticks and labels
    const axisElements = hours.map((lbl, idx) => {
      const hx = startX + idx * step;
      const isKey = lbl === '1 AM' || lbl === '5 AM' || lbl === '8 AM';
      const isPeakHour = lbl === '5 AM';
      const tickColor = isPeakHour ? '#00f0aa' : (isKey ? '#05d5b0' : 'rgba(255,255,255,0.22)');
      const textColor = isPeakHour ? '#00f0aa' : (isKey ? '#cbd5e1' : 'rgba(255,255,255,0.45)');
      const fontWeight = isPeakHour ? '700' : (isKey ? '600' : '400');

      return `
        <line x1="${hx.toFixed(1)}" y1="${baseline}" x2="${hx.toFixed(1)}" y2="${baseline + 5}" stroke="${tickColor}" stroke-width="${isKey ? '1.5' : '1'}"/>
        <text x="${hx.toFixed(1)}" y="${baseline + 18}" fill="${textColor}" font-size="9" font-weight="${fontWeight}" text-anchor="middle">${lbl}</text>
      `;
    }).join('');

    svg.innerHTML = `
      <defs>
        <linearGradient id="auroraCurveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#05d5b0" stop-opacity="0.12"/>
          <stop offset="25%" stop-color="#05d5b0" stop-opacity="0.35"/>
          <stop offset="50%" stop-color="#00f0aa" stop-opacity="0.75"/>
          <stop offset="75%" stop-color="#a855f7" stop-opacity="0.4"/>
          <stop offset="100%" stop-color="#a855f7" stop-opacity="0.12"/>
        </linearGradient>
        <linearGradient id="auroraStrokeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#05d5b0"/>
          <stop offset="50%" stop-color="#00f0aa"/>
          <stop offset="100%" stop-color="#a855f7"/>
        </linearGradient>
      </defs>

      <!-- Baseline axis -->
      <line x1="25" y1="${baseline}" x2="575" y2="${baseline}" stroke="rgba(255,255,255,0.18)" stroke-width="1.5" />

      <!-- Area fill -->
      <path d="${pathD}" fill="url(#auroraCurveGrad)" />

      <!-- Curve Stroke -->
      <path d="${pathD.replace(/ Z$/, '')}" fill="none" stroke="url(#auroraStrokeGrad)" stroke-width="3" stroke-linecap="round" />

      <!-- Vertical drop dashed line from Peak down to X-axis time scale -->
      <line x1="${mu.toFixed(1)}" y1="${peakY}" x2="${mu.toFixed(1)}" y2="${baseline}" stroke="#00f0aa" stroke-dasharray="3,3" stroke-width="1.5" opacity="0.8"/>

      <!-- Glowing peak marker -->
      <circle cx="${mu.toFixed(1)}" cy="${peakY}" r="7" fill="rgba(0, 240, 170, 0.25)"/>
      <circle cx="${mu.toFixed(1)}" cy="${peakY}" r="4.5" fill="#00f0aa" />
      <text x="${mu.toFixed(1)}" y="${peakY - 12}" fill="#00f0aa" font-size="10" font-weight="700" text-anchor="middle" letter-spacing="0.5">PEAK DEEP RECOVERY</text>

      <!-- Bedtime point on curve -->
      <circle cx="${bedX.toFixed(1)}" cy="${bedY.toFixed(1)}" r="4" fill="#05d5b0"/>
      <line x1="${bedX.toFixed(1)}" y1="${bedY.toFixed(1)}" x2="${bedX.toFixed(1)}" y2="${baseline}" stroke="#05d5b0" stroke-dasharray="2,2" stroke-width="1" opacity="0.5"/>

      <!-- Wake point on curve -->
      <circle cx="${wakeX.toFixed(1)}" cy="${wakeY.toFixed(1)}" r="4" fill="#f59e0b"/>
      <line x1="${wakeX.toFixed(1)}" y1="${wakeY.toFixed(1)}" x2="${wakeX.toFixed(1)}" y2="${baseline}" stroke="#f59e0b" stroke-dasharray="2,2" stroke-width="1" opacity="0.5"/>

      <!-- X-Axis time scale ticks & labels -->
      ${axisElements}
    `;
  },

  // 3.6: Daytime Power Naps & Rest Window Curve
  drawNapGaussianCurve() {
    const svg = document.getElementById('svg-nap-curve');
    if (!svg) return;

    // Dimensions: 600 x 170
    const baseline = 125;
    const peakHeight = 85;
    const peakY = baseline - peakHeight; // 40

    // X-Axis Time Scale: 12 PM to 5 PM (5 hours)
    const napHours = ['12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM'];
    const startX = 50;
    const endX = 550;
    const step = (endX - startX) / (napHours.length - 1); // 100px per hour

    // Peak at 2:30 PM (between 2 PM index 2 and 3 PM index 3)
    const mu = startX + 2.5 * step; // 300px
    const sigma = 50;

    // Generate bell curve path
    let pathD = `M 40,${baseline}`;
    for (let x = 40; x <= 560; x += 6) {
      const exponent = -Math.pow(x - mu, 2) / (2 * Math.pow(sigma, 2));
      const y = baseline - (peakHeight * Math.exp(exponent));
      pathD += ` L ${x.toFixed(1)},${y.toFixed(1)}`;
    }
    pathD += ` L 560,${baseline} Z`;

    // Ticks and labels for Nap X-axis
    const axisElements = napHours.map((lbl, idx) => {
      const hx = startX + idx * step;
      const isPeakHour = lbl === '2 PM' || lbl === '3 PM';
      const tickColor = isPeakHour ? '#f59e0b' : 'rgba(255,255,255,0.2)';
      const textColor = isPeakHour ? '#f59e0b' : 'rgba(255,255,255,0.45)';
      const fontWeight = isPeakHour ? '600' : '400';

      return `
        <line x1="${hx}" y1="${baseline}" x2="${hx}" y2="${baseline + 5}" stroke="${tickColor}" stroke-width="${isPeakHour ? '1.5' : '1'}"/>
        <text x="${hx}" y="${baseline + 18}" fill="${textColor}" font-size="9" font-weight="${fontWeight}" text-anchor="middle">${lbl}</text>
      `;
    }).join('');

    svg.innerHTML = `
      <defs>
        <linearGradient id="napGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.1"/>
          <stop offset="50%" stop-color="#f59e0b" stop-opacity="0.65"/>
          <stop offset="100%" stop-color="#00f0aa" stop-opacity="0.2"/>
        </linearGradient>
      </defs>

      <!-- Baseline axis -->
      <line x1="35" y1="${baseline}" x2="565" y2="${baseline}" stroke="rgba(255,255,255,0.18)" stroke-width="1.5" />

      <!-- Area fill -->
      <path d="${pathD}" fill="url(#napGrad)" />

      <!-- Curve Stroke -->
      <path d="${pathD.replace(/ Z$/, '')}" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" />

      <!-- Vertical drop dashed line from Nap Peak to axis -->
      <line x1="${mu}" y1="${peakY}" x2="${mu}" y2="${baseline}" stroke="#f59e0b" stroke-dasharray="3,3" stroke-width="1.5" opacity="0.8"/>

      <!-- Nap Midpoint Marker -->
      <circle cx="${mu}" cy="${peakY}" r="6.5" fill="rgba(245, 158, 11, 0.25)"/>
      <circle cx="${mu}" cy="${peakY}" r="4" fill="#f59e0b" />
      <text x="${mu}" y="${peakY - 10}" fill="#f59e0b" font-size="10" font-weight="700" text-anchor="middle" letter-spacing="0.5">RESTORE PEAK (~14:30)</text>

      <!-- X-axis ticks & labels -->
      ${axisElements}
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
          id: 'journal-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          date: todayStr,
          timestamp: new Date().toISOString(),
          notes: text
        };

        ChronoStorage.saveJournalEntry(entry);
        notesInput.value = ''; // Reset input field so user can add another reflection anytime!

        if (window.ChronoNotifications) {
          ChronoNotifications.playChime('done');
          ChronoNotifications.showToast('Reflection journal saved! You can add another reflection anytime.', 'success');
        }
        this.renderDailyReview();
        this.renderSettingsArchive();
      });
    }
  },

  deleteJournalEntry(id) {
    if (confirm('Delete this journal reflection?')) {
      ChronoStorage.deleteJournalEntry(id);
      if (window.ChronoNotifications) ChronoNotifications.showToast('Journal entry deleted', 'info');
      this.renderDailyReview();
      this.renderSettingsArchive();
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

    // Open Note Modal
    const btnAddNote = document.getElementById('btn-add-note-modal');
    if (btnAddNote) btnAddNote.addEventListener('click', () => this.openNewNoteModal());

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
          window.AndroidNative.scheduleNativeAlarm(taskObj.id, alarmLabel, notes || 'Scheduled in ZenRhythm', d.getTime());
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
        a.download = `zenrhythm_backup_${new Date().toISOString().split('T')[0]}.json`;
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
        if (window.ChronoNotifications) ChronoNotifications.showToast('ZenRhythm installed as an app!', 'success');
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
    a.download = `zenrhythm_alarms_${todayStr}.ics`;
    a.click();
    URL.revokeObjectURL(url);
    if (window.ChronoNotifications) {
      ChronoNotifications.playChime('done');
      ChronoNotifications.showToast('Alarms File Downloaded!', 'success', 'Open it with your Android Calendar/Clock to set loud device alarms.');
    }
  },

  // ==========================================================================
  // QUICK NOTES & SCRATCHPAD - VIEW 5
  // ==========================================================================
  notesFilter: 'all',
  notesSearchQuery: '',

  initNotesActions() {
    const btnAddNote = document.getElementById('btn-add-note-modal');
    if (btnAddNote) {
      btnAddNote.addEventListener('click', () => this.openNewNoteModal());
    }

    const formNote = document.getElementById('form-note');
    if (formNote) {
      formNote.addEventListener('submit', (e) => this.handleNoteSubmit(e));
    }

    const searchInput = document.getElementById('input-notes-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.notesSearchQuery = e.target.value.toLowerCase().trim();
        this.renderNotes();
      });
    }

    const filterChips = document.querySelectorAll('[data-notes-filter]');
    filterChips.forEach(chip => {
      chip.addEventListener('click', () => {
        filterChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.notesFilter = chip.getAttribute('data-notes-filter') || 'all';
        this.renderNotes();
      });
    });
  },

  openNewNoteModal() {
    const heading = document.getElementById('modal-note-title-heading');
    if (heading) heading.textContent = 'Create Note';
    const formId = document.getElementById('note-form-id');
    const formTitle = document.getElementById('note-form-title');
    const formCat = document.getElementById('note-form-category');
    const formPinned = document.getElementById('note-form-pinned');
    const formContent = document.getElementById('note-form-content');

    if (formId) formId.value = '';
    if (formTitle) formTitle.value = '';
    if (formCat) formCat.value = 'study';
    if (formPinned) formPinned.checked = false;
    if (formContent) formContent.value = '';

    this.openModal('modal-note');
  },

  openEditNoteModal(id) {
    const note = ChronoStorage.getNotes().find(n => n.id === id);
    if (!note) return;
    const heading = document.getElementById('modal-note-title-heading');
    if (heading) heading.textContent = 'Edit Note';
    const formId = document.getElementById('note-form-id');
    const formTitle = document.getElementById('note-form-title');
    const formCat = document.getElementById('note-form-category');
    const formPinned = document.getElementById('note-form-pinned');
    const formContent = document.getElementById('note-form-content');

    if (formId) formId.value = note.id;
    if (formTitle) formTitle.value = note.title;
    if (formCat) formCat.value = note.category || 'study';
    if (formPinned) formPinned.checked = !!note.isPinned;
    if (formContent) formContent.value = note.content;

    this.openModal('modal-note');
  },

  handleNoteSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('note-form-id').value;
    const title = document.getElementById('note-form-title').value.trim();
    const category = document.getElementById('note-form-category').value;
    const isPinned = document.getElementById('note-form-pinned').checked;
    const content = document.getElementById('note-form-content').value.trim();
    if (!title || !content) return;

    ChronoStorage.saveNote({
      id: id || undefined,
      title,
      category,
      isPinned,
      content
    });

    this.closeModal('modal-note');
    if (window.ChronoNotifications) {
      ChronoNotifications.showToast(id ? 'Note updated!' : 'Note saved!', 'success');
    }
    this.renderNotes();
  },

  deleteNote(id) {
    if (confirm('Delete this note?')) {
      ChronoStorage.deleteNote(id);
      if (window.ChronoNotifications) ChronoNotifications.showToast('Note deleted', 'info');
      this.renderNotes();
    }
  },

  togglePinNote(id) {
    ChronoStorage.togglePinNote(id);
    this.renderNotes();
  },

  copyNoteContent(id) {
    const note = ChronoStorage.getNotes().find(n => n.id === id);
    if (!note) return;
    const text = `${note.title}\n\n${note.content}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        if (window.ChronoNotifications) ChronoNotifications.showToast('Note copied to clipboard!', 'info');
      });
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      if (window.ChronoNotifications) ChronoNotifications.showToast('Note copied!', 'info');
    }
  },

  renderNotes() {
    const container = document.getElementById('notes-grid');
    if (!container) return;

    let notes = ChronoStorage.getNotes();

    // Filter by category
    if (this.notesFilter && this.notesFilter !== 'all') {
      notes = notes.filter(n => (n.category || 'study') === this.notesFilter);
    }

    // Filter by search query
    if (this.notesSearchQuery) {
      const q = this.notesSearchQuery;
      notes = notes.filter(n =>
        (n.title && n.title.toLowerCase().includes(q)) ||
        (n.content && n.content.toLowerCase().includes(q))
      );
    }

    // Pinned notes first, then latest updated
    notes.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    });

    if (notes.length === 0) {
      container.innerHTML = `
        <div class="empty-state-box" style="grid-column: 1 / -1; padding: 48px 24px;">
          <div style="font-size: 2.2rem; margin-bottom: 8px;">📝</div>
          <h3 style="color: var(--text-main); margin-bottom: 4px;">No Notes Found</h3>
          <p style="color: var(--text-muted); font-size: 0.9rem;">
            ${this.notesSearchQuery ? 'No notes matched your search query.' : 'Capture your first note, formula, or exam idea! Tap "+ New Note" above.'}
          </p>
        </div>
      `;
      return;
    }

    container.innerHTML = notes.map(note => {
      const catClass = `tag-${note.category || 'study'}`;
      const catLabel = (note.category || 'study').toUpperCase();
      const dateFormatted = new Date(note.updatedAt || note.createdAt || Date.now()).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      const escapeHtml = (str) => (str || '').replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
      }[tag] || tag));

      return `
        <div class="note-card ${note.isPinned ? 'is-pinned' : ''}" data-note-id="${note.id}">
          <div class="note-card-header">
            <span class="note-card-tag ${catClass}">${catLabel}</span>
            <button class="note-pin-btn" onclick="App.togglePinNote('${note.id}')" title="${note.isPinned ? 'Unpin note' : 'Pin note to top'}">
              ${note.isPinned ? '📌' : '📍'}
            </button>
          </div>
          <h4 class="note-card-title">${escapeHtml(note.title)}</h4>
          <p class="note-card-body">${escapeHtml(note.content).replace(/\n/g, '<br>')}</p>
          <div class="note-card-footer">
            <span class="note-date">${dateFormatted}</span>
            <div class="note-actions-row">
              <button class="btn-text" onclick="App.copyNoteContent('${note.id}')" title="Copy to clipboard">📋 Copy</button>
              <button class="btn-text" onclick="App.openEditNoteModal('${note.id}')" title="Edit note">✏️ Edit</button>
              <button class="btn-text text-danger" onclick="App.deleteNote('${note.id}')" title="Delete note">🗑️</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  // ==========================================================================
  // SETTINGS HISTORY & ARCHIVES
  // ==========================================================================
  currentArchiveTab: 'tasks',

  initSettingsArchive() {
    const archiveTabBtns = document.querySelectorAll('[data-archive-tab]');
    archiveTabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        archiveTabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentArchiveTab = btn.getAttribute('data-archive-tab') || 'tasks';
        this.renderSettingsArchive();
      });
    });
  },

  renderSettingsArchive() {
    const container = document.getElementById('archive-list-container');
    const countTasksEl = document.getElementById('count-archive-tasks');
    const countReflectionsEl = document.getElementById('count-archive-reflections');
    const countBufferEl = document.getElementById('count-archive-buffer');

    const completedTasks = ChronoStorage.getCompletedTasksArchive();
    const reflections = ChronoStorage.getJournalEntries();
    const bufferLogs = ChronoStorage.getBufferHistory();

    if (countTasksEl) countTasksEl.textContent = String(completedTasks.length);
    if (countReflectionsEl) countReflectionsEl.textContent = String(reflections.length);
    if (countBufferEl) countBufferEl.textContent = String(bufferLogs.length);

    if (!container) return;

    if (this.currentArchiveTab === 'tasks') {
      if (completedTasks.length === 0) {
        container.innerHTML = `
          <div class="empty-state-box" style="padding: 32px 16px;">
            <p style="color: var(--text-muted);">No completed tasks or missions archived yet. Complete tasks on the dashboard or missions to build your history!</p>
          </div>
        `;
        return;
      }
      container.innerHTML = completedTasks.map(t => {
        const dateStr = t.completedAt ? new Date(t.completedAt).toLocaleDateString(undefined, {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        }) : t.date;
        return `
          <div class="archive-item-card">
            <div class="archive-item-left">
              <span class="archive-item-icon">✅</span>
              <div>
                <strong class="archive-item-title">${t.title || 'Untitled Task'}</strong>
                <div class="archive-item-meta">
                  <span class="category-pill pill-${t.category || 'study'}">${(t.category || 'task').toUpperCase()}</span>
                  <span>Date: ${dateStr}</span>
                  ${t.duration ? `<span>• ${t.duration}m</span>` : ''}
                </div>
              </div>
            </div>
            <span class="text-success bold" style="font-size: 0.8rem;">COMPLETED</span>
          </div>
        `;
      }).join('');
    } else if (this.currentArchiveTab === 'reflections') {
      if (reflections.length === 0) {
        container.innerHTML = `
          <div class="empty-state-box" style="padding: 32px 16px;">
            <p style="color: var(--text-muted);">No reflections written yet. Record reflections in the Daily Review section.</p>
          </div>
        `;
        return;
      }
      container.innerHTML = reflections.map(r => {
        const dateStr = new Date(r.timestamp || r.date).toLocaleDateString(undefined, {
          weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        return `
          <div class="archive-item-card reflection-archive-card">
            <div style="width: 100%;">
              <div class="archive-card-header">
                <span class="archive-item-meta">🗓️ ${dateStr}</span>
                <button class="btn-text text-danger" onclick="App.deleteJournalEntry('${r.id}')">Delete</button>
              </div>
              <p class="archive-reflection-text">${(r.notes || '').replace(/\n/g, '<br>')}</p>
            </div>
          </div>
        `;
      }).join('');
    } else if (this.currentArchiveTab === 'buffer') {
      if (bufferLogs.length === 0) {
        container.innerHTML = `
          <div class="empty-state-box" style="padding: 32px 16px;">
            <p style="color: var(--text-muted);">No buffer activities logged yet. Select your activity in the "What are you doing now?" dropdown.</p>
          </div>
        `;
        return;
      }
      container.innerHTML = bufferLogs.map(b => {
        const timeStr = new Date(b.timestamp).toLocaleDateString(undefined, {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        return `
          <div class="archive-item-card">
            <div class="archive-item-left">
              <span class="archive-item-icon">⏱️</span>
              <div>
                <strong class="archive-item-title">${b.activity}</strong>
                <div class="archive-item-meta">
                  <span>Logged: ${timeStr}</span>
                  ${b.durationMins ? `<span>• ~${b.durationMins} mins</span>` : ''}
                </div>
              </div>
            </div>
            <span class="category-pill pill-routine">LOGGED</span>
          </div>
        `;
      }).join('');
    }
  },

  // ==========================================================================
  // URL SHORTCUT ACTIONS & ANDROID WIDGET DISPATCHER
  // ==========================================================================
  handleUrlShortcuts() {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    if (action) {
      this.handleShortcutAction(action);
    }
  },

  handleShortcutAction(action) {
    if (!action) return;

    if (action === 'sleep_toggle') {
      setTimeout(() => {
        this.switchView('analysis');
        this.toggleSleepSession();
      }, 250);
    } else if (action === 'quick_note') {
      setTimeout(() => {
        this.switchView('notes');
        this.openNewNoteModal();
      }, 250);
    } else if (action === 'add_mission') {
      setTimeout(() => {
        this.switchView('deadlines');
        this.openNewDeadlineModal();
      }, 250);
    } else if (action === 'analysis') {
      setTimeout(() => {
        this.switchView('analysis');
      }, 250);
    }
  }
};

window.App = App;
