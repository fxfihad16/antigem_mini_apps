// Focus's background script: the timer notification's buttons (Pause, Skip, Resume, Stop) work with the app
// closed. Agent Hina runs this in an invisible page when one is pressed.
const shared = new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = '/timer-notify.js';
  s.onload = resolve; s.onerror = () => reject(new Error('timer-notify.js did not load'));
  document.head.append(s);
});

Hina.background.on('notification', async (task) => {
  await shared;
  const e = task.data || {};
  if (e.id === 'timer') await FocusNotify.apply(e.action);
});
