# G003 evidence — mobile/responsive + keyboard accessibility (real browser)

## Mobile viewport 390x844 (fresh emulation)

```
JS measurement: document.documentElement.scrollWidth <= window.innerWidth
→ "NO horizontal overflow"          (on / and /demo)
nav links reachable: 15
Demo role lenses navigation present on mobile demo
```

## Keyboard walk (1280x800, real Tab presses)

```
stop 1: A | Skip to main content | focusVisible:yes
stop 2: A | Home        | focusVisible:yes
stop 3: A | Cases       | focusVisible:yes
stop 4: A | Bodies      | focusVisible:yes
stop 5: A | Research    | focusVisible:yes
stop 6: A | Marketplace | focusVisible:yes
stop 7: A | Operations  | focusVisible:yes
stop 8: A | Settings    | focusVisible:yes
```

Sane Tab order (skip-link first, then primary navigation), visible focus treatment on every
stop. The B017 real-browser suite independently asserts "the keyboard can reach real
interactive elements with a visible focus treatment" (G001 fresh run).
