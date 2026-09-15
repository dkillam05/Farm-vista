# Core JavaScript

Core contains application infrastructure rather than FarmVista feature logic.

- `firebase/` — Firebase configuration/data bootstrap
- `shell/` — shell/startup/application bootstrap
- `theme/` — theme and early theme boot
- `version/` — version/update infrastructure

Feature-specific code should not be placed in Core merely because several pages use it.
