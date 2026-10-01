export default defineAppConfig({
  ui: {
    colors: {
      primary: 'indigo',
      neutral: 'slate',
    },
    // Same square surface and same colors as the cards and windows.
    toast: {
      slots: {
        root: 'hw-toast',
        title: 'hw-toast-title',
        icon: 'hw-toast-icon',
        description: 'hw-toast-desc',
      },
    },
  },
})
