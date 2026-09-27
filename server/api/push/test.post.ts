export default defineApi(async () => ({
  sent: await pushSend({ title: 'herdr-web', body: 'Les notifications fonctionnent ✓', bodyEn: 'Notifications are working ✓', tag: 'test', url: '/' }),
}))
