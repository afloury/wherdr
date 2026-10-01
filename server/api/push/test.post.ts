export default defineApi(async () => ({
  sent: await pushSend({ title: 'wherdr', body: 'Notifications are working ✓', bodyFr: 'Les notifications fonctionnent ✓', tag: 'test', url: '/' }, undefined, true),
}))
