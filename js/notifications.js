/**
 * Chronoflow Notifications & Sound Alerts Manager
 * Supports Web Notifications API, Web Audio API pleasant chimes,
 * and in-app floating toast alerts.
 */

const ChronoNotifications = {
  audioCtx: null,
  alertedTaskKeys: new Set(),
  checkInterval: null,

  init() {
    this.startScheduleMonitor();
  },

  // --- Web Audio API Chime Synthesizer ---
  playChime(type = 'start') {
    const config = ChronoStorage.getConfig();
    if (!config.soundAlerts) return;

    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtxClass) return;

      if (!this.audioCtx) {
        this.audioCtx = new AudioCtxClass();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const now = this.audioCtx.currentTime;

      if (type === 'start') {
        // Upbeat 2-note ascending chime (C5 -> G5)
        this.playTone(523.25, now, 0.25);
        this.playTone(783.99, now + 0.15, 0.4);
      } else if (type === 'done') {
        // Success chord (C5 -> E5 -> G5)
        this.playTone(523.25, now, 0.2);
        this.playTone(659.25, now + 0.1, 0.2);
        this.playTone(783.99, now + 0.2, 0.4);
      } else if (type === 'alert') {
        // Notice chime
        this.playTone(440, now, 0.15);
        this.playTone(554.37, now + 0.12, 0.3);
      }
    } catch (e) {
      console.warn('Audio playback error:', e);
    }
  },

  playTone(freq, startTime, duration) {
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.18, startTime + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.connect(gain);
    gain.connect(this.audioCtx.destination);

    osc.start(startTime);
    osc.stop(startTime + duration);
  },

  // --- Notification Permission & Dispatch ---
  async requestPermission() {
    if (!('Notification' in window)) {
      this.showToast('Browser notifications are not supported on this device.', 'warning');
      return false;
    }

    if (Notification.permission === 'granted') {
      this.showToast('Notifications are already active!', 'success');
      return true;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        this.showToast('Notifications enabled! You will get alerts for upcoming tasks.', 'success');
        this.playChime('done');
        return true;
      } else {
        this.showToast('Notification permission was denied.', 'warning');
        return false;
      }
    } catch (e) {
      console.error('Notification permission error', e);
      return false;
    }
  },

  notifyTask(task, minutesUntil) {
    const title = minutesUntil <= 0 
      ? `Starting Now: ${task.title}` 
      : `In ${minutesUntil}m: ${task.title}`;
    
    const body = `${ChronoScheduler.formatTime12(task.startTime)} • ${task.duration} mins • ${task.notes || 'Time to transition'}`;

    // 1. Play synthesized audio chime
    this.playChime('start');

    // 2. In-App Floating Toast
    this.showToast(title, 'info', body);

    // 3. System / Browser Notification
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const notif = new Notification(title, {
          body,
          icon: 'icons/icon-192.svg',
          badge: 'icons/icon-192.svg',
          tag: `task-${task.id}`,
          renotify: true
        });

        notif.onclick = () => {
          window.focus();
          notif.close();
        };
      } catch (err) {
        console.warn('System notification error:', err);
      }
    }
  },

  // --- In-App Floating Toast Notifications ---
  showToast(title, type = 'info', description = '') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast-item toast-${type}`;
    
    const iconSvg = type === 'success' 
      ? `<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`
      : type === 'warning'
      ? `<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`
      : `<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;

    toast.innerHTML = `
      <div class="toast-icon">${iconSvg}</div>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        ${description ? `<div class="toast-desc">${description}</div>` : ''}
      </div>
      <button class="toast-close" aria-label="Close">&times;</button>
    `;

    toast.querySelector('.toast-close').addEventListener('click', () => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 250);
    });

    container.appendChild(toast);

    // Auto remove after 5 seconds
    setTimeout(() => {
      if (toast.isConnected) {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 250);
      }
    }, 5000);
  },

  // --- Background Schedule Monitor (checks every 20 seconds) ---
  startScheduleMonitor() {
    if (this.checkInterval) clearInterval(this.checkInterval);

    this.checkInterval = setInterval(() => {
      this.checkUpcomingAlerts();
    }, 20000);

    // Initial check right away
    this.checkUpcomingAlerts();
  },

  checkUpcomingAlerts() {
    const config = ChronoStorage.getConfig();
    const todayStr = ChronoScheduler.getTodayDateStr();
    const schedule = ChronoScheduler.resolveScheduleForDate(todayStr);
    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();

    const notifyBefore = config.notifyBeforeMinutes || 5;

    schedule.items.forEach(task => {
      if (task.isSkipped || task.isCompleted || task.category === 'sleep') return;

      const diff = task.startMins - currentMins;

      // Check if starts in notifyBefore mins OR starting right now
      if (diff >= 0 && diff <= notifyBefore) {
        const alertKey = `${todayStr}-${task.id}-${task.startTime}-${diff <= 0 ? 'start' : 'before'}`;
        if (!this.alertedTaskKeys.has(alertKey)) {
          this.alertedTaskKeys.add(alertKey);
          this.notifyTask(task, diff);
        }
      }
    });
  }
};

window.ChronoNotifications = ChronoNotifications;
