/**
 * Chronoflow Storage Manager
 * Handles local persistence, preset seeding, and backup export/import.
 */

const STORAGE_KEYS = {
  CONFIG: 'chronoflow_config',
  TASKS: 'chronoflow_tasks',
  DAILY_STATE: 'chronoflow_daily_state', // overrides, skips, emergency blocks for specific dates
  SLEEP_LOGS: 'chronoflow_sleep_logs',
  DEADLINES: 'chronoflow_deadlines',
  REVIEWS: 'chronoflow_reviews',
  THEME: 'chronoflow_theme'
};

const DEFAULT_CONFIG = {
  userName: 'Student',
  standardSleepTime: '01:00',
  targetSleepHours: 7.5,
  wakeGraceMinutes: 30, // Time needed after waking before 1st task
  notifyBeforeMinutes: 5,
  soundAlerts: true,
  autoRipplePrompt: true
};

const DEFAULT_TASKS = [
  {
    id: 'task-sleep-regular',
    title: 'Sleep & Night Recovery',
    category: 'sleep',
    startTime: '01:00',
    duration: 450, // 7.5 hrs
    isFixed: false,
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    priority: 'high',
    notes: 'Core recharge period. Can be dynamically adjusted.'
  },
  {
    id: 'task-morning-routine',
    title: 'Morning Routine & Freshen Up',
    category: 'personal',
    startTime: '08:30',
    duration: 30,
    isFixed: false,
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    priority: 'medium',
    notes: 'Hydrate, stretch, get ready.'
  },
  {
    id: 'task-breakfast',
    title: 'Mess Breakfast',
    category: 'meal',
    startTime: '09:00',
    duration: 30,
    isFixed: true,
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    priority: 'high',
    notes: 'Mess hall closes at 9:45 AM.'
  },
  {
    id: 'task-class-slot-1',
    title: 'Class Slot A: Operating Systems',
    category: 'class',
    startTime: '09:45',
    duration: 75,
    isFixed: true,
    days: ['Mon', 'Wed', 'Fri'],
    priority: 'high',
    notes: 'Hall 302, Prof. Sharma. Attendance mandatory.'
  },
  {
    id: 'task-class-slot-2',
    title: 'Class Slot B: Database Systems',
    category: 'class',
    startTime: '11:15',
    duration: 75,
    isFixed: true,
    days: ['Mon', 'Wed', 'Fri'],
    priority: 'high',
    notes: 'Seminar Block 2.'
  },
  {
    id: 'task-class-slot-tue-thu',
    title: 'Class Slot C: Computer Networks',
    category: 'class',
    startTime: '10:00',
    duration: 90,
    isFixed: true,
    days: ['Tue', 'Thu'],
    priority: 'high',
    notes: 'Lab building 4th floor.'
  },
  {
    id: 'task-quick-study',
    title: 'Post-Lecture Quick Revision & Notes',
    category: 'study',
    startTime: '12:35',
    duration: 40,
    isFixed: false,
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    priority: 'medium',
    notes: 'Convert rough lecture notes to clean summaries.'
  },
  {
    id: 'task-lunch',
    title: 'Mess Lunch',
    category: 'meal',
    startTime: '13:15',
    duration: 45,
    isFixed: true,
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    priority: 'high',
    notes: 'Refuel and short walk.'
  },
  {
    id: 'task-lab-slot',
    title: 'Practical Lab / Coding Project',
    category: 'class',
    startTime: '14:30',
    duration: 105,
    isFixed: true,
    days: ['Mon', 'Thu'],
    priority: 'high',
    notes: 'Systems Programming Lab.'
  },
  {
    id: 'task-afternoon-study',
    title: 'Deep Work: Self-Study & Assignments',
    category: 'study',
    startTime: '16:30',
    duration: 90,
    isFixed: false,
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    priority: 'high',
    notes: 'Tackle deadline priorities or problem solving.'
  },
  {
    id: 'task-tea-break',
    title: 'Evening Snack & Walk / Gym',
    category: 'break',
    startTime: '18:15',
    duration: 45,
    isFixed: false,
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    priority: 'low',
    notes: 'Unwind, get blood pumping.'
  },
  {
    id: 'task-dinner',
    title: 'Mess Dinner',
    category: 'meal',
    startTime: '20:00',
    duration: 45,
    isFixed: true,
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    priority: 'high',
    notes: 'Mess hall open until 21:15.'
  },
  {
    id: 'task-evening-focus',
    title: 'Evening Study & Exam Prep',
    category: 'study',
    startTime: '21:15',
    duration: 105,
    isFixed: false,
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sun'],
    priority: 'high',
    notes: 'Intense uninterrupted study block.'
  },
  {
    id: 'task-wind-down',
    title: 'Day Wrap-up, Tomorrow Planning & Wind Down',
    category: 'personal',
    startTime: '23:30',
    duration: 45,
    isFixed: false,
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    priority: 'low',
    notes: 'Review completed items, dim lights, prepare for sleep.'
  }
];

const DEFAULT_DEADLINES = [
  {
    id: 'dl-1',
    title: 'Mid-Sem Exam: Operating Systems',
    type: 'exam',
    dueDate: getRelativeDate(3),
    dueTime: '10:00',
    priority: 'high',
    notes: 'Chapters 1-5 (CPU Scheduling, Memory Management, Deadlocks)',
    completed: false
  },
  {
    id: 'dl-2',
    title: 'Database Assignment 2: SQL & Normalization',
    type: 'assignment',
    dueDate: getRelativeDate(2),
    dueTime: '23:59',
    priority: 'high',
    notes: 'Submit via university portal. Schema design + 10 queries.',
    completed: false
  },
  {
    id: 'dl-3',
    title: 'Computer Networks Lab Quiz',
    type: 'exam',
    dueDate: getRelativeDate(6),
    dueTime: '14:30',
    priority: 'medium',
    notes: 'TCP/IP socket programming & Wireshark packet analysis',
    completed: false
  }
];

function getRelativeDate(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
}

function getDefaultSleepLogs() {
  const logs = [];
  for (let i = 5; i >= 1; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const sleptHour = (i % 2 === 0) ? '01:15' : '02:00';
    const wokeHour = (i % 2 === 0) ? '08:45' : '09:20';
    const dur = (i % 2 === 0) ? 7.5 : 7.3;
    logs.push({
      date: dateStr,
      sleptAt: sleptHour,
      wokeAt: wokeHour,
      actualHours: dur,
      targetHours: 7.5,
      quality: dur >= 7.5 ? 'Good' : 'Moderate',
      notes: i === 1 ? 'Slept late studying for assignment' : 'Standard rest'
    });
  }
  return logs;
}

const ChronoStorage = {
  getConfig() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.CONFIG);
      return data ? { ...DEFAULT_CONFIG, ...JSON.parse(data) } : { ...DEFAULT_CONFIG };
    } catch (e) {
      return { ...DEFAULT_CONFIG };
    }
  },

  saveConfig(config) {
    localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(config));
    window.dispatchEvent(new CustomEvent('chronoflow:config_updated', { detail: config }));
  },

  getTasks() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.TASKS);
      if (!data) {
        this.saveTasks(DEFAULT_TASKS);
        return [...DEFAULT_TASKS];
      }
      return JSON.parse(data);
    } catch (e) {
      return [...DEFAULT_TASKS];
    }
  },

  saveTasks(tasks) {
    localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(tasks));
    window.dispatchEvent(new CustomEvent('chronoflow:tasks_updated', { detail: tasks }));
  },

  addTask(task) {
    const tasks = this.getTasks();
    tasks.push(task);
    this.saveTasks(tasks);
    return task;
  },

  updateTask(updatedTask) {
    let tasks = this.getTasks();
    tasks = tasks.map(t => t.id === updatedTask.id ? updatedTask : t);
    this.saveTasks(tasks);
  },

  deleteTask(taskId) {
    let tasks = this.getTasks();
    tasks = tasks.filter(t => t.id !== taskId);
    this.saveTasks(tasks);
  },

  // Daily dynamic state (skips, overrides, emergency free time, completions for a specific date)
  getDailyState(dateStr) {
    try {
      const allStates = JSON.parse(localStorage.getItem(STORAGE_KEYS.DAILY_STATE) || '{}');
      return allStates[dateStr] || {
        date: dateStr,
        sleepAdjusted: false,
        actualSleepTime: null,
        actualWakeTime: null,
        shiftMinutes: 0,
        skippedTaskIds: [],
        completedTaskIds: [],
        deletedTodayIds: [],
        emergencyBlocks: [] // { id, title, startTime, duration }
      };
    } catch (e) {
      return {
        date: dateStr,
        sleepAdjusted: false,
        actualSleepTime: null,
        actualWakeTime: null,
        shiftMinutes: 0,
        skippedTaskIds: [],
        completedTaskIds: [],
        deletedTodayIds: [],
        emergencyBlocks: []
      };
    }
  },

  saveDailyState(dateStr, state) {
    const allStates = JSON.parse(localStorage.getItem(STORAGE_KEYS.DAILY_STATE) || '{}');
    allStates[dateStr] = state;
    localStorage.setItem(STORAGE_KEYS.DAILY_STATE, JSON.stringify(allStates));
    window.dispatchEvent(new CustomEvent('chronoflow:dailystate_updated', { detail: { date: dateStr, state } }));
  },

  updateDailyState(dateStr, updaterFn) {
    const current = this.getDailyState(dateStr);
    const updated = updaterFn(current);
    this.saveDailyState(dateStr, updated);
    return updated;
  },

  // Deadlines
  getDeadlines() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.DEADLINES);
      if (!data) {
        this.saveDeadlines(DEFAULT_DEADLINES);
        return [...DEFAULT_DEADLINES];
      }
      return JSON.parse(data);
    } catch (e) {
      return [...DEFAULT_DEADLINES];
    }
  },

  saveDeadlines(deadlines) {
    localStorage.setItem(STORAGE_KEYS.DEADLINES, JSON.stringify(deadlines));
    window.dispatchEvent(new CustomEvent('chronoflow:deadlines_updated', { detail: deadlines }));
  },

  addDeadline(dl) {
    const list = this.getDeadlines();
    list.push(dl);
    this.saveDeadlines(list);
    return dl;
  },

  toggleDeadlineComplete(id) {
    const list = this.getDeadlines().map(dl => {
      if (dl.id === id) return { ...dl, completed: !dl.completed };
      return dl;
    });
    this.saveDeadlines(list);
  },

  deleteDeadline(id) {
    const list = this.getDeadlines().filter(dl => dl.id !== id);
    this.saveDeadlines(list);
  },

  // Sleep Logs
  getSleepLogs() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SLEEP_LOGS);
      if (!data) {
        const initial = getDefaultSleepLogs();
        this.saveSleepLogs(initial);
        return initial;
      }
      return JSON.parse(data);
    } catch (e) {
      return [];
    }
  },

  saveSleepLogs(logs) {
    localStorage.setItem(STORAGE_KEYS.SLEEP_LOGS, JSON.stringify(logs));
    window.dispatchEvent(new CustomEvent('chronoflow:sleeplogs_updated', { detail: logs }));
  },

  addSleepLog(log) {
    let logs = this.getSleepLogs();
    // remove existing entry for same date if present
    logs = logs.filter(l => l.date !== log.date);
    logs.unshift(log); // newest first
    this.saveSleepLogs(logs);
    return log;
  },

  // Daily Reviews
  getDailyReviews() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.REVIEWS) || '{}');
    } catch (e) {
      return {};
    }
  },

  saveDailyReview(dateStr, review) {
    const all = this.getDailyReviews();
    all[dateStr] = review;
    localStorage.setItem(STORAGE_KEYS.REVIEWS, JSON.stringify(all));
  },

  // Full backup Export / Import
  exportAllData() {
    const backup = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      config: this.getConfig(),
      tasks: this.getTasks(),
      dailyState: JSON.parse(localStorage.getItem(STORAGE_KEYS.DAILY_STATE) || '{}'),
      sleepLogs: this.getSleepLogs(),
      deadlines: this.getDeadlines(),
      reviews: this.getDailyReviews()
    };
    return JSON.stringify(backup, null, 2);
  },

  importData(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (data.config) localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(data.config));
      if (data.tasks) localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(data.tasks));
      if (data.dailyState) localStorage.setItem(STORAGE_KEYS.DAILY_STATE, JSON.stringify(data.dailyState));
      if (data.sleepLogs) localStorage.setItem(STORAGE_KEYS.SLEEP_LOGS, JSON.stringify(data.sleepLogs));
      if (data.deadlines) localStorage.setItem(STORAGE_KEYS.DEADLINES, JSON.stringify(data.deadlines));
      if (data.reviews) localStorage.setItem(STORAGE_KEYS.REVIEWS, JSON.stringify(data.reviews));
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  resetToDefaults() {
    localStorage.removeItem(STORAGE_KEYS.CONFIG);
    localStorage.removeItem(STORAGE_KEYS.TASKS);
    localStorage.removeItem(STORAGE_KEYS.DAILY_STATE);
    localStorage.removeItem(STORAGE_KEYS.SLEEP_LOGS);
    localStorage.removeItem(STORAGE_KEYS.DEADLINES);
    localStorage.removeItem(STORAGE_KEYS.REVIEWS);
    this.saveConfig(DEFAULT_CONFIG);
    this.saveTasks(DEFAULT_TASKS);
    this.saveDeadlines(DEFAULT_DEADLINES);
    this.saveSleepLogs(getDefaultSleepLogs());
  }
};

window.ChronoStorage = ChronoStorage;
