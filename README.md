# Stage Formation Planner

[中文版](README-cn.md) | **[▶ Live Demo](https://xpanflow.github.io/stage-planner/)**

![Stage Formation Planner](doc/ScreenShot.png)

A pure-frontend single-page application for creating, editing, and animating stage formations for children's performances.

## Features

- **Real-world stage dimensions** — define width and depth in meters; all positions stored in meters
- **Background image** — upload PNG / JPG / WEBP stage photo; auto-fit to canvas
- **Performer management** — add named performers with color and type (Child / Adult / Teacher)
- **Proportional rendering** — performer sizes scale correctly with stage dimensions and zoom
- **Drag & drop** — smooth dragging constrained to stage bounds; optional snap-to-grid
- **Multiple scenes** — create, rename, duplicate, and delete scenes; each stores independent positions
- **Animated transitions** — play eased transitions between scenes with movement path preview; per-scene transition duration
- **Music sync** — load a local MP3; scenes are mapped to the music timeline with a visual progress bar and scene markers; playback auto-switches the active scene; click or drag the bar to seek
- **Scene timing** — each scene has a configurable start time and transition duration; adding music auto-distributes scenes evenly across the track
- **Zoom & pan** — mouse wheel zoom, pinch zoom (touch), middle-mouse / Space+drag pan
- **Measurement tool** — click two points to display real-world distance in meters
- **Scale ruler** — 1 m reference bar always visible on stage
- **Scene notes** — freetext notes panel per scene (PowerPoint-style, at the bottom of the stage area); auto-saved, preserved on duplicate, included in all exports
- **JSON export / import** — save the project as a formatted `.json` file (background excluded); import validates structure and reports errors in detail
- **ZIP bundle export / import** — save the full project including music and background image as a single `.zip` file; import restores all assets automatically
- **Read-only preview sharing** — share a `?load=<url>` link (JSON) or `?bundle=<url>` link (ZIP with music) that loads a remote project in preview mode without touching local data
- **New project** — one-click reset with confirmation prompt
- **Export PNG** — exports current scene with background, performers, grid, and ruler
- **Undo / Redo** — full history (up to 60 steps)
- **Auto-save** — all data saved to `localStorage`; restored on reload
- **Fullscreen mode** — one-click fullscreen

## Quick Start

```bash
# Open directly in browser
open index.html

# Or serve locally (any static server)
npx serve .
python3 -m http.server 8080
```

Or open the **[live demo on GitHub Pages](https://xpanflow.github.io/stage-formation/)** directly — no installation needed.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Y` | Redo |
| `F` | Fit stage to window |
| `G` | Toggle grid |
| `Space + drag` | Pan stage |
| `Delete / Backspace` | Delete selected performer |
| `Escape` | Deselect / exit measure mode |

## Workflow

1. Set **stage dimensions** (right sidebar) — e.g. 10 m wide × 6 m deep
2. Optionally **upload a background** stage photo
3. **Add performers** with the _+ Add_ button (left sidebar)
4. **Drag performers** onto the stage to set starting positions (Scene 1)
5. **Add more scenes** — positions are copied as a starting point; rearrange for each scene
6. Load an **MP3** with the _♪ Load_ button in the music panel — scenes are auto-distributed across the track
7. Fine-tune each scene's **Start** time and **Duration** in the right sidebar Animation section
8. Add **scene notes** in the bottom panel to document choreography ideas
9. Press **▶ Play** to preview the animated transition, or use the music timeline to jump to any point
10. **↓ ZIP** to save the full bundle (project + music + background); **↓ JSON** for a lightweight backup; **↓ PNG** for each scene image

## Read-Only Preview Sharing

Share a project with anyone as a view-only link — no account required.

Two formats are supported:

| Format | URL parameter | Includes music |
|--------|--------------|---------------|
| JSON export (no audio) | `?load=<url>` | ✗ |
| ZIP bundle (full) | `?bundle=<url>` | ✓ |

### JSON sharing (`?load=`)

1. Export with **↓ JSON** → saves a `.json` file (background image not included)
2. Upload the JSON to a publicly accessible URL (e.g. Cloudflare R2 public bucket, GitHub Gist raw, etc.)
3. Share the link:

```
https://xpanflow.github.io/stage-formation/?load=https://cdn.example.com/my-show.json
```

### ZIP bundle sharing (`?bundle=`) — includes music

1. Export with **↓ ZIP** → saves a `.zip` bundle (project + music + background)
2. Upload the ZIP to a publicly accessible URL
3. Share the link:

```
https://xpanflow.github.io/stage-formation/?bundle=https://cdn.example.com/my-show.zip
```

The recipient opens the link; the project and music load automatically in **preview mode** (read-only, local storage is not overwritten). They can optionally click **"Save locally"** to import it into their own workspace.

> **CORS note:** the file host must allow `GET` requests from `https://xpanflow.github.io`. For Cloudflare R2, add an `AllowedOrigins` CORS rule to the bucket.

## GitHub Pages Deployment

Push the repository to GitHub and enable Pages from the `main` branch root. No build step required.

## Stack

- HTML5 / CSS3 / vanilla JavaScript (ES2020)
- SVG rendering with world-coordinate transform groups
- HTML5 `<audio>` API for music playback and sync
- [JSZip](https://stuk.github.io/jszip/) (CDN) for ZIP bundle export / import
- No frameworks, no build tools, no backend
