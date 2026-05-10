# Stage Formation Planner

[中文版](README-cn.md) | **[▶ Live Demo](https://xpanflow.github.io/stage-formation/)**

![Stage Formation Planner](doc/ScreenShot.png)

A pure-frontend single-page application for creating, editing, and animating stage formations for children's performances.

## Features

- **Real-world stage dimensions** — define width and depth in meters; all positions stored in meters
- **Background image** — upload PNG / JPG / WEBP stage photo; auto-fit to canvas
- **Performer management** — add named performers with color and type (Child / Adult / Teacher)
- **Proportional rendering** — performer sizes scale correctly with stage dimensions and zoom
- **Drag & drop** — smooth dragging constrained to stage bounds; optional snap-to-grid
- **Multiple scenes** — create, rename, duplicate, and delete scenes; each stores independent positions
- **Animated transitions** — play eased transitions between scenes with movement path preview
- **Zoom & pan** — mouse wheel zoom, pinch zoom (touch), middle-mouse / Space+drag pan
- **Measurement tool** — click two points to display real-world distance in meters
- **Scale ruler** — 1 m reference bar always visible on stage
- **Scene notes** — freetext notes panel per scene (PowerPoint-style, at the bottom of the stage area); auto-saved, preserved on duplicate, included in JSON export/import
- **JSON export / import** — save the full project as a formatted `.json` file (background image excluded); import validates structure and reports errors in detail
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
5. **Add a second scene** — positions are copied as a starting point
6. Rearrange performers for Scene 2
7. Add **scene notes** in the bottom panel to document your choreography ideas
8. Press **▶ Play** to preview the animated transition
9. **Export JSON** to save the project; **Export PNG** for each scene as needed

## Read-Only Preview Sharing

Share a project with anyone as a view-only link — no account required.

**How it works:**

1. Export your project with **↓ Export** → saves a `.json` file (background image not included)
2. Upload the JSON to a publicly accessible URL (e.g. Cloudflare R2 public bucket, GitHub Gist raw, etc.)
3. Append `?load=<json-url>` to the live demo URL and share it:

```
https://xpanflow.github.io/stage-formation/?load=https://pub-xxx.r2.dev/projects/my-show.json
```

The recipient opens the link, the project loads automatically in **preview mode** (read-only, local storage is not overwritten). They can optionally click **"Save locally"** to import it into their own workspace.

> **CORS note:** the JSON host must allow `GET` requests from `https://xpanflow.github.io`. For Cloudflare R2, add an `AllowedOrigins` CORS rule to the bucket.

## GitHub Pages Deployment

Push the repository to GitHub and enable Pages from the `main` branch root. No build step required.

## Stack

- HTML5 / CSS3 / vanilla JavaScript (ES2020)
- SVG rendering with world-coordinate transform groups
- No frameworks, no dependencies, no build tools
