export default defineApi(async () => ({
  sent: await pushSend({ title: 'wherdr', body: 'Les notifications fonctionnent ✓', bodyEn: 'Notifications are working ✓', tag: 'test', url: '/' }, undefined, true),
}))
