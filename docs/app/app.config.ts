export default defineAppConfig({
  ui: {
    colors: {
      primary: 'green',
      neutral: 'slate',
    },
    footer: {
      slots: {
        root: 'border-t border-default',
        left: 'text-sm text-muted',
      },
    },
  },
  seo: {
    siteName: 'Nuxt Realtime',
  },
  header: {
    title: '',
    to: '/',
    logo: {
      alt: '',
      light: '',
      dark: '',
    },
    search: true,
    colorMode: true,
    links: [{
      'icon': 'i-simple-icons-github',
      'to': 'https://github.com/daanvangeloven/nuxt-realtime',
      'target': '_blank',
      'aria-label': 'GitHub',
    }],
  },
  footer: {
    credits: `Built with Nuxt • © ${new Date().getFullYear()}`,
    colorMode: false,
    links: [{
      'icon': 'i-simple-icons-discord',
      'to': 'https://discord.gg/xP3sJstSus',
      'target': '_blank',
      'aria-label': 'Nuxt Realtime on Discord',
    }, {
      'icon': 'i-simple-icons-github',
      'to': 'https://github.com/daanvangeloven/nuxt-realtime',
      'target': '_blank',
      'aria-label': 'Nuxt Realtime on GitHub',
    }],
  },
  toc: {
    title: 'Table of Contents',
    bottom: {
      title: 'Community',
      edit: 'https://github.com/daanvangeloven/nuxt-realtime/edit/master/docs/content',
      links: [{
        icon: 'i-lucide-star',
        label: 'Star on GitHub',
        to: 'https://github.com/daanvangeloven/nuxt-realtime',
        target: '_blank',
      }, {
        icon: 'i-simple-icons-npm',
        label: 'View on npm',
        to: 'https://www.npmjs.com/package/nuxt-realtime',
        target: '_blank',
      }],
    },
  },
})
