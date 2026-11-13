# Vendored front-end libraries

All files here are served **locally** by the hub. Nothing is fetched from a
CDN at runtime, so every visual feature keeps working on an offline farm LAN
and on a Raspberry Pi 4.

| File | Version | Licence | Use |
|---|---|---|---|
| `three.min.js` | r149 | MIT | 3D globe, satellite model, atmosphere shell |
| `gsap.min.js` | 3.12.5 | GreenSock standard "no charge" licence | page-load choreography, reveals, counters, SVG draw-on |
| `ScrollTrigger.min.js` | 3.12.5 | GreenSock standard "no charge" licence | scroll-linked reveals (GSAP plugin) |
| `tsparticles.slim.bundle.min.js` | 3.7.1 | MIT | hero particle field with cursor repulsion |
| `vanilla-tilt.min.js` | 1.8.1 | MIT | pointer-driven 3D tilt on cards |
| `fonts/archivo-latin.woff2` | variable 400–900 | SIL Open Font License 1.1 | display type |
| `fonts/publicsans-latin.woff2` | variable 400–700 | SIL Open Font License 1.1 | body type |

Sources: npm packages via jsDelivr and Google Fonts (woff2 subset downloaded
once at build time). The fonts are the latin subsets only, which is what the
interface uses.

Reduced motion: every GSAP timeline, ScrollTrigger, particle motion and tilt
effect is disabled (or reduced to its meaning-preserving end state) when the
visitor's system requests `prefers-reduced-motion: reduce`.
