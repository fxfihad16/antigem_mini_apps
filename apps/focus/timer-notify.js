// Focus's live timer notification, shared by the app (app.js) and the background script (background.js).
// Running: the system ticks the countdown itself, in the mode's color, with Pause / Skip buttons.
// Paused: time left, with Resume / Stop. The buttons work with the app closed (background script).
(function () {
  const AG = window.Hina;
  const MODES = {
    focus: { label: 'Focus', color: '#C62828', key: 'focusMin' },
    short: { label: 'Short break', color: '#2E7D32', key: 'shortMin' },
    long: { label: 'Long break', color: '#1565C0', key: 'longMin' },
  };
  const settings = () => Object.assign({ focusMin: 25, shortMin: 5, longMin: 15, goal: 8, sound: true, longEvery: 4 }, AG.storage.get('settings', {}));
  const fmt = ms => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const at = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // "default" importance keeps the timer in the main part of the shade (like Clock's stopwatch); no sound or buzz.
  // (Android never lets an app raise a channel's importance later, so the earlier low "timer" channel is replaced.)
  let channelReady = null;
  function channel() {
    channelReady = channelReady || Promise.all([
      AG.notify.channel({ id: 'countdown', name: 'Running timer', description: 'The countdown while a session runs', importance: 'default', sound: false, vibrate: false }),
      AG.notify.deleteChannel('timer'),
    ]).catch(() => {});
    return channelReady;
  }

  // buttons act without opening the app when the background permission is there, else they open it
  const quiet = () => AG.permissions.query('background') === 'granted';

  async function update(state, taskName) {
    const m = MODES[state.mode] || MODES.focus;
    // the app knows the task's name; a button pressed with the app closed reuses the last one
    if (taskName !== undefined) AG.storage.set('timerTaskName', taskName || null);
    else taskName = AG.storage.get('timerTaskName', null);
    await channel();
    if (state.endAt) {
      return AG.notify.show({
        id: 'timer', channel: 'countdown', ongoing: true, category: 'progress', visibility: 'public', smallIcon: 'notify-icon.png',
        color: m.color, title: taskName ? `${m.label} · ${taskName}` : m.label, body: `Ends at ${at(state.endAt)}`,
        countdown: state.endAt,
        actions: [{ id: 'pause', title: 'Pause', open: !quiet() }, { id: 'skip', title: 'Skip', open: !quiet() }],
      }).catch(() => {});
    }
    if (state.remaining != null) {
      return AG.notify.show({
        id: 'timer', channel: 'countdown', ongoing: true, category: 'status', visibility: 'public', smallIcon: 'notify-icon.png',
        color: m.color, title: taskName ? `${m.label} · ${taskName} · paused` : `${m.label} · paused`, display: fmt(state.remaining), body: 'Tap Resume to continue',
        actions: [{ id: 'resume', title: 'Resume', open: !quiet() }, { id: 'stop', title: 'Stop', open: !quiet() }],
      }).catch(() => {});
    }
    return AG.notify.dismiss('timer').catch(() => {});
  }

  // the end-of-phase alert: a native reminder (fires with the app closed or the phone asleep)
  function scheduleEnd(state) {
    const m = MODES[state.mode] || MODES.focus;
    const body = state.mode === 'focus' ? 'Focus session done. Time for a break ☕' : 'Break is over. Back to focus 🎯';
    return AG.notify.schedule({ id: 'phase-end', title: `${m.label} finished`, body, color: m.color, category: 'alarm', delay: Math.max(1000, state.endAt - Date.now()) });
  }

  function nextMode(state) {
    const st = settings();
    if (state.mode !== 'focus') return 'focus';
    state.round = (state.round || 0) + 1;
    return state.round % st.longEvery === 0 ? 'long' : 'short';
  }

  /** A notification button, handled on the stored state (works from the background script too). */
  async function apply(action) {
    const state = AG.storage.get('timer', null);
    if (!state) return null;
    if (action === 'pause' && state.endAt) {
      state.remaining = Math.max(0, state.endAt - Date.now()); state.endAt = null;
      await AG.notify.cancel('phase-end').catch(() => {});
    } else if (action === 'resume' && state.remaining != null) {
      state.endAt = Date.now() + state.remaining; state.remaining = null;
      await scheduleEnd(state).catch(() => {});
    } else if (action === 'skip') {
      state.mode = nextMode(state); state.endAt = null; state.remaining = null;
      await AG.notify.cancel('phase-end').catch(() => {});
    } else if (action === 'stop') {
      state.endAt = null; state.remaining = null;
      await AG.notify.cancel('phase-end').catch(() => {});
    } else return state;
    AG.storage.set('timer', state);
    await update(state);
    return state;
  }

  window.FocusNotify = { MODES, update, scheduleEnd, apply, nextMode };
})();
