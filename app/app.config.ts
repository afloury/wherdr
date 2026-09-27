export default defineAppConfig({
  ui: {
    colors: {
      primary: 'indigo',
      neutral: 'slate',
    },
    // Même surface carrée et mêmes couleurs que les cartes et les fenêtres.
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
