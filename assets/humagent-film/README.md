# Demo video source

This is the editable source of the v12 film and the README GIF.
The film runs for 27.515 seconds at 1920 × 1080 and 30 FPS.
The interface is an authored demonstration, so application changes do not update it automatically.

## Source map

| File | Edit here |
| --- | --- |
| `index.html` | Scene timing, audio timing, volume, and canvas size |
| `compositions/chat.html` | Agent icon, opening response, and user command |
| `compositions/review.html` | Demo page, review controls, cursor, camera, and applied changes |
| `compositions/terminal.html` | Feedback transition and displayed JSON |
| `compositions/titles.html` | Captions and caption timing |
| `compositions/endcard.html` | Wordmark and installation command |
| `assets/` | Selected music, effects, and caption font |

The displayed JSON intentionally uses simplified `selector` fields.
It is not an API fixture.
Captions appear as complete lines, with no typing animation.
The opening agent response types silently.
Music starts at zero, and the selected poster color also changes the page accents.

Asset sources and license notices are in the [root README](../../README.md#video-asset-notices).
The application package excludes this directory.

Editing and rendering require HyperFrames 0.9.56.
