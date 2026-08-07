---
title: Nuxt Realtime 0.2.1
description: Security patches and small fixes.
date: 2026-08-07
category: Release
tags: [release]
authors:
  - name: Daan van Geloven
    avatar:
      src: https://github.com/daanvangeloven.png
    to: https://github.com/daanvangeloven
---

Small patch release, no new features.

## Fixes

- Security: pinned patched versions of `brace-expansion` after compromised versions were published to npm.
- Fixed a lint tooling regression (`eslint`/`minimatch` breakage) caused by the override above.
- Allowed images from GitHub for blog post avatars.
