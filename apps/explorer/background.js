// Explorer's background script: Agent Hina runs it in an invisible page (app closed), every hour once the
// "hn-digest" task is on. Tells you when Hacker News has a new #1 story.
Hina.background.on('hn-digest', async (task) => {
  const [topId] = await (await fetch('https://hacker-news.firebaseio.com/v0/topstories.json')).json();
  if (!topId) return;
  if (localStorage.getItem('hn.top') === String(topId)) return; // already told / already seen in the app
  const story = await (await fetch(`https://hacker-news.firebaseio.com/v0/item/${topId}.json`)).json();
  localStorage.setItem('hn.top', String(topId));
  await Hina.notify.show({
    title: 'New #1 on Hacker News',
    body: `${story.title} (${story.score} points, ${story.descendants ?? 0} comments)`,
    tag: 'hn-digest',
  });
  console.log(`hn-digest (${task.reason}): #1 is now ${topId}`);
});
