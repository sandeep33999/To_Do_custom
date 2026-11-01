# Chronoflow — Dynamic Life & Study Scheduler ⏳⚡

**Chronoflow** is an intelligent, dynamic personal timetable and routine scheduler crafted for students and professionals. Unlike rigid, static calendar apps, Chronoflow automatically ripples and rearranges your flexible activities whenever your sleep schedule shifts, meetings run over, or unexpected emergencies occur — all while strictly protecting your fixed commitments (such as university class slots, lab sessions, mess/meal hours, and exams).

100% zero-backend required: built with vanilla web technologies, persistent in `localStorage`, equipped with PWA (Progressive Web App) offline support, and ready to deploy directly to **GitHub Pages**.

---

## 🌟 Complete Feature Matrix

| Feature | Purpose & Implementation in Chronoflow |
|---|---|
| **Smart Wake-Up Adjustment** | If you sleep late (e.g., 2:30 AM instead of 1:00 AM), tap **"Smart Sleep"**. It automatically ripples your morning routine and flexible study blocks while keeping your required sleep duration intact. |
| **Next Activity Notifications** | Web Notifications API with synthesized harmonic audio chimes (Web Audio API) + in-app floating glassmorphic toasts that alert you before upcoming tasks. |
| **Deadline & Exam Management** | Dedicated tracker for examinations, quizzes, assignments, and project deliverables with urgency countdown badges (e.g. *Due in 2 days*). |
| **Sleep Tracker** | Tracks bedtime, wake time, duration, and sleep quality across a 7-day history with average duration metrics and goal tracking. |
| **Automatic Rescheduling** | Differentiates between **Fixed Slots** (classes, exams, mess hall) and **Flexible Slots** (self-study, gym, revision). When delays occur, flexible tasks automatically slide into open time gaps. |
| **Daily Review & Journal** | Evaluates daily execution with a circular completion score ring, lists completed vs. skipped tasks, and includes a reflection journal. |
| **Focus Mode** | Distraction-free, full-screen Zen HUD displaying a prominent countdown timer, progress bar, current task notes, and up-next preview. |
| **Obsidian Dark & Clean Light Themes** | Default futuristic obsidian dark theme with neon accents and an instant toggle to a high-contrast light theme. |
| **PWA Mobile & Desktop Installation** | Full web manifest and service worker (`sw.js`). Can be installed as a native app on Android, iOS, Windows, and macOS via "Add to Home Screen". |
| **Emergency Free Time** | One-tap **"Emergency Break"** button (15m, 30m, 45m, 1h, 1.5h) to inject unexpected pauses without breaking fixed class commitments. |
| **Non-Continuous Slot System** | Supports weekly recurring class timetables with customizable day-by-day slots (e.g., Mon/Wed/Fri Slot A, Tue/Thu Slot B, lab blocks). |
| **Flexible Task Deletion** | Allows deleting a task for **"Today Only"** (ideal for canceled lectures or holidays) or **"Forever"** from the recurring timetable. |
| **Zero-Server Data Backup** | One-click JSON export and import for seamless backup and transfer between mobile and laptop. |

---

## 🚀 How to Host on GitHub Pages (Free, in 2 Minutes)

Because Chronoflow is built with pure HTML5, CSS3, and ES6 JavaScript, no build steps (`npm run build`) are required:

1. **Initialize Git & Push to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit of Chronoflow scheduler"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo-name>.git
   git push -u origin main
   ```

2. **Enable GitHub Pages**:
   - Go to your repository on GitHub.
   - Click **Settings** ➔ **Pages** (in the left sidebar).
   - Under **Build and deployment > Source**, select **Deploy from a branch**.
   - Select the `main` branch and `/ (root)` folder, then click **Save**.
   - Within 60 seconds, your site will be live at:
     ```
     https://<your-username>.github.io/<your-repo-name>/
     ```

---

## 📱 Installing on Mobile (PWA)

1. Open your hosted GitHub Pages URL in **Google Chrome** (Android) or **Safari** (iPhone).
2. **Android**: Tap the **"Install App"** button in the header, or open Chrome menu (⋮) and tap **"Install App" / "Add to Home Screen"**.
3. **iPhone**: Tap the **Share** button in Safari, scroll down, and select **"Add to Home Screen"**.
4. The app will launch full-screen like a native mobile application and work offline.

---

## 📂 Project Architecture

```
├── index.html            # Main semantic HTML5 structure & views
├── manifest.json         # PWA Manifest configuration
├── sw.js                 # Service worker for offline caching & fast loading
├── css/
│   └── style.css         # Obsidian glassmorphic design system & responsive styling
├── js/
│   ├── app.js            # Main application controller & UI routing
│   ├── scheduler.js      # Core rescheduling engine & ripple-shift logic
│   ├── notifications.js  # Web notifications, audio synthesizer & toast alerts
│   └── storage.js        # LocalStorage persistence, default presets & backup export/import
└── icons/
    ├── icon-192.svg      # PWA App Icon (192x192)
    └── icon-512.svg      # PWA App Icon (512x512)
```
