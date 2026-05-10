'use strict';

/* ============================================================
   UTILITIES
============================================================ */
const uid       = () => Math.random().toString(36).slice(2, 10);
const lerp      = (a, b, t) => a + (b - a) * t;
const clamp     = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const easeInOut = t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

function makeSVGEl(tag, attrs = {}, text) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text != null) el.textContent = text;
  return el;
}

/* ============================================================
   CONSTANTS
============================================================ */
const STORAGE_KEY = 'stageFormation_v1';

/* ─── Walk (animation) duration for scene[idx] ─── */
function sceneAnimDurMs(idx) {
  const p = State.p;
  return p.scenes[idx]?.animDurationMs ?? p.settings.animDurationMs;
}
const PADDING     = 48;   // px around stage at zoom=1

const TYPES = {
  child:   { widthM: 0.40, heightM: 1.30, shape: 'circle', label: 'Child'   },
  adult:   { widthM: 0.50, heightM: 1.75, shape: 'circle', label: 'Adult'   },
  teacher: { widthM: 0.55, heightM: 1.75, shape: 'rect',   label: 'Teacher' },
};

const PRESET_COLORS = [
  '#e74c3c','#e67e22','#f1c40f','#2ecc71',
  '#1abc9c','#3498db','#9b59b6','#e91e63',
  '#ff5722','#00bcd4','#8bc34a','#795548',
];

/* ============================================================
   STATE
============================================================ */
const State = (() => {
  let _p = null;
  const _undo = [];
  const _redo = [];

  function _makeDefault() {
    return {
      stageDimensions: { width: 10, depth: 6 },
      backgroundImage: null,
      performers: [],
      scenes: [{ id: uid(), name: 'Scene 1', positions: {}, note: '', startTime: 0, animDurationMs: 3000 }],
      currentSceneIndex: 0,
      settings: {
        gridVisible:    true,
        snapToGrid:     false,
        gridSize:       1,
        animDurationMs: 3000,
      },
    };
  }

  function _snap() { return JSON.parse(JSON.stringify(_p)); }

  return {
    get p() { return _p; },
    set p(v) { _p = v; },

    init() {
      _p = Persistence.load() || _makeDefault();
    },

    pushUndo() {
      _undo.push(_snap());
      if (_undo.length > 60) _undo.shift();
      _redo.length = 0;
    },

    undo() {
      if (!_undo.length) return;
      _redo.push(_snap());
      _p = _undo.pop();
      Persistence.save();
      Renderer.render();
      UI.syncAll();
    },

    redo() {
      if (!_redo.length) return;
      _undo.push(_snap());
      _p = _redo.pop();
      Persistence.save();
      Renderer.render();
      UI.syncAll();
    },

    canUndo() { return _undo.length > 0; },
    canRedo()  { return _redo.length > 0; },
  };
})();

/* ============================================================
   TRANSFORM  — world (meters) ↔ screen (SVG pixels)
============================================================ */
const Transform = (() => {
  let _tx       = PADDING;  // stage origin X in SVG pixels
  let _ty       = PADDING;  // stage origin Y in SVG pixels
  let _scale    = 80;       // current px / m
  let _fitScale = 80;       // scale that fits stage to window

  function _svgEl()   { return document.getElementById('stage-svg'); }
  function _svgRect() { return _svgEl().getBoundingClientRect(); }

  function fitToWindow() {
    const r  = _svgRect();
    const W  = r.width  || 900;
    const H  = r.height || 600;
    const p  = State.p;
    const sw = p.stageDimensions.width;
    const sd = p.stageDimensions.depth;
    _fitScale = Math.min((W - 2 * PADDING) / sw, (H - 2 * PADDING) / sd);
    _scale    = _fitScale;
    _tx       = (W - sw * _scale) / 2;
    _ty       = (H - sd * _scale) / 2;
    Renderer.render();
    UI.syncZoomLabel();
  }

  function zoomAt(factor, cx, cy) {
    const ns = clamp(_scale * factor, 4, 6000);
    const f  = ns / _scale;
    _tx      = cx - (cx - _tx) * f;
    _ty      = cy - (cy - _ty) * f;
    _scale   = ns;
    Renderer.render();
    UI.syncZoomLabel();
  }

  function pan(dx, dy) {
    _tx += dx;
    _ty += dy;
    Renderer.render();
  }

  const worldToScreen = (x, y) => ({ x: _tx + x * _scale, y: _ty + y * _scale });
  const screenToWorld = (sx, sy) => ({ x: (sx - _tx) / _scale, y: (sy - _ty) / _scale });
  const getTransform  = ()  => `translate(${_tx.toFixed(2)},${_ty.toFixed(2)}) scale(${_scale.toFixed(4)})`;
  const getScale      = ()  => _scale;
  const getZoomPct    = ()  => `${Math.round((_scale / _fitScale) * 100)}%`;

  return { fitToWindow, zoomAt, pan, worldToScreen, screenToWorld, getTransform, getScale, getZoomPct };
})();

/* ============================================================
   RENDERER  — all SVG drawing
============================================================ */
const Renderer = (() => {

  /* ── full redraw ── */
  function render() {
    const p  = State.p;
    const sw = p.stageDimensions.width;
    const sd = p.stageDimensions.depth;

    document.getElementById('viewport').setAttribute('transform', Transform.getTransform());

    /* background */
    const bgEl  = document.getElementById('stage-bg');
    const floor = document.getElementById('stage-floor');
    if (p.backgroundImage) {
      bgEl.setAttribute('href',   p.backgroundImage);
      bgEl.setAttribute('width',  sw);
      bgEl.setAttribute('height', sd);
      bgEl.style.display  = '';
      floor.style.display = 'none';
    } else {
      bgEl.style.display  = 'none';
      floor.setAttribute('width',  sw);
      floor.setAttribute('height', sd);
      floor.style.display = '';
    }

    /* border */
    const border = document.getElementById('stage-border');
    border.setAttribute('width',  sw);
    border.setAttribute('height', sd);

    _renderFrontBack();
    renderGrid();
    renderPerformers();
    renderRuler();
    MeasureTool.renderLayer();
  }

  /* ── FRONT / BACK labels ── */
  function _renderFrontBack() {
    const p   = State.p;
    const sw  = p.stageDimensions.width;
    const sd  = p.stageDimensions.depth;
    const sc  = Transform.getScale();
    const fs  = 9 / sc;
    const col = 'rgba(255,255,255,0.2)';
    const g   = document.getElementById('front-back-labels');
    g.innerHTML = '';
    const mkLabel = (x, y, txt) => g.appendChild(makeSVGEl('text',
      { x, y, 'font-size': fs, fill: col, 'text-anchor': 'middle', 'pointer-events': 'none', 'dominant-baseline': 'middle' }, txt));
    mkLabel(sw / 2, -fs * 1.4, 'BACK');
    mkLabel(sw / 2, sd + fs * 1.4, 'FRONT');
  }

  /* ── GRID ── */
  function renderGrid() {
    const p     = State.p;
    const layer = document.getElementById('grid-layer');
    layer.innerHTML = '';
    if (!p.settings.gridVisible) return;

    const sw = p.stageDimensions.width;
    const sd = p.stageDimensions.depth;
    const gs = p.settings.gridSize;
    const sc = Transform.getScale();
    const fs = 9 / sc;
    const lc = 'rgba(255,255,255,0.09)';
    const tc = 'rgba(255,255,255,0.25)';

    for (let x = gs; x < sw - 0.001; x += gs) {
      layer.appendChild(makeSVGEl('line',
        { x1: x, y1: 0, x2: x, y2: sd, stroke: lc, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }));
      layer.appendChild(makeSVGEl('text',
        { x: x, y: sd - fs * 0.3, 'font-size': fs, fill: tc, 'text-anchor': 'middle', 'dominant-baseline': 'auto', 'pointer-events': 'none' },
        `${x}m`));
    }
    for (let y = gs; y < sd - 0.001; y += gs) {
      layer.appendChild(makeSVGEl('line',
        { x1: 0, y1: y, x2: sw, y2: y, stroke: lc, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }));
      layer.appendChild(makeSVGEl('text',
        { x: fs * 0.3, y: y, 'font-size': fs, fill: tc, 'text-anchor': 'start', 'dominant-baseline': 'middle', 'pointer-events': 'none' },
        `${y}m`));
    }
  }

  /* ── PERFORMERS ── */
  function renderPerformers(animPositions) {
    const p     = State.p;
    const layer = document.getElementById('performers-layer');
    layer.innerHTML = '';

    const scene = p.scenes[p.currentSceneIndex];
    if (!scene) return;

    const positions = animPositions || scene.positions;
    const sc        = Transform.getScale();
    const fs        = 12 / sc;
    const selId     = UI.selectedId;

    for (const perf of p.performers) {
      const pos = positions[perf.id];
      if (!pos || pos.visible === false) continue;

      const ti = TYPES[perf.type] || TYPES.child;
      const r  = ti.widthM / 2;
      const cx = pos.x;
      const cy = pos.y;

      const g = makeSVGEl('g', { 'data-id': perf.id, class: 'performer-group', style: 'cursor:grab' });

      /* selection ring */
      if (perf.id === selId) {
        g.appendChild(makeSVGEl('circle', {
          cx, cy, r: r + 5 / sc,
          fill: 'none', stroke: 'rgba(255,255,255,0.85)',
          'stroke-width': 2, 'vector-effect': 'non-scaling-stroke',
          'stroke-dasharray': `${8 / sc} ${4 / sc}`,
        }));
      }

      /* body */
      if (ti.shape === 'rect') {
        g.appendChild(makeSVGEl('rect', {
          x: cx - r, y: cy - r, width: ti.widthM, height: ti.widthM, rx: 0.06,
          fill: perf.color, stroke: 'rgba(255,255,255,0.75)',
          'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke',
          filter: 'url(#perf-glow)',
        }));
      } else {
        g.appendChild(makeSVGEl('circle', {
          cx, cy, r,
          fill: perf.color, stroke: 'rgba(255,255,255,0.75)',
          'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke',
          filter: 'url(#perf-glow)',
        }));
      }

      /* name label with text-stroke for readability */
      const lbl = makeSVGEl('text', {
        x: cx, y: cy + r + fs * 0.2,
        'font-size': fs, fill: '#fff',
        'text-anchor': 'middle', 'dominant-baseline': 'hanging',
        'paint-order': 'stroke',
        stroke: 'rgba(0,0,0,0.75)', 'stroke-width': fs * 0.3, 'stroke-linejoin': 'round',
        'pointer-events': 'none',
      }, perf.name);
      g.appendChild(lbl);

      layer.appendChild(g);
    }
  }

  /* ── RULER ── */
  function renderRuler() {
    const layer = document.getElementById('ruler-layer');
    layer.innerHTML = '';
    const sd  = State.p.stageDimensions.depth;
    const sc  = Transform.getScale();
    const fs  = 9 / sc;
    const th  = 4 / sc;
    const by  = sd + 10 / sc;
    const col = 'rgba(255,255,255,0.45)';

    layer.appendChild(makeSVGEl('line',
      { x1: 0, y1: by, x2: 1, y2: by, stroke: col, 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }));
    for (const x of [0, 1]) {
      layer.appendChild(makeSVGEl('line',
        { x1: x, y1: by - th, x2: x, y2: by + th, stroke: col, 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }));
    }
    layer.appendChild(makeSVGEl('text',
      { x: 0.5, y: by + th + fs * 0.2, 'font-size': fs, fill: col, 'text-anchor': 'middle', 'dominant-baseline': 'hanging', 'pointer-events': 'none' },
      '1 m'));
  }

  /* ── MOVEMENT PATHS (shown during animation preview) ── */
  function renderPaths(fromPos, toPos) {
    const layer = document.getElementById('paths-layer');
    layer.innerHTML = '';
    const sc = Transform.getScale();

    for (const perf of State.p.performers) {
      const fr = fromPos[perf.id];
      const to = toPos[perf.id];
      if (!fr || !to) continue;

      const dx  = to.x - fr.x;
      const dy  = to.y - fr.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.05) continue;

      layer.appendChild(makeSVGEl('line', {
        x1: fr.x, y1: fr.y, x2: to.x, y2: to.y,
        stroke: perf.color, 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke',
        'stroke-dasharray': `${10 / sc} ${5 / sc}`, opacity: 0.55,
      }));

      /* arrow head */
      const nx  = dx / len;
      const ny  = dy / len;
      const as  = 8 / sc;
      const bx  = to.x - nx * as;
      const by  = to.y - ny * as;
      const px  = -ny * as * 0.5;
      const py  =  nx * as * 0.5;
      layer.appendChild(makeSVGEl('polygon', {
        points: `${to.x},${to.y} ${bx + px},${by + py} ${bx - px},${by - py}`,
        fill: perf.color, opacity: 0.65,
      }));
    }
  }

  function clearPaths() { document.getElementById('paths-layer').innerHTML = ''; }

  return { render, renderGrid, renderPerformers, renderRuler, renderPaths, clearPaths };
})();

/* ============================================================
   ANIMATOR
============================================================ */
const Animator = (() => {
  let _rafId     = null;
  let _startTime = null;
  let _fromPos   = null;
  let _toPos     = null;
  let _animPos   = null;
  let _playing   = false;

  function play() {
    const p       = State.p;
    const nextIdx = p.currentSceneIndex + 1;
    if (nextIdx >= p.scenes.length) {
      alert('No next scene to transition to.\nAdd another scene first.');
      return;
    }
    _fromPos  = JSON.parse(JSON.stringify(p.scenes[p.currentSceneIndex].positions));
    _toPos    = JSON.parse(JSON.stringify(p.scenes[nextIdx].positions));
    _animPos  = JSON.parse(JSON.stringify(_fromPos));
    _playing  = true;
    _startTime = null;

    Renderer.renderPaths(_fromPos, _toPos);
    document.getElementById('btn-play').classList.add('hidden');
    document.getElementById('btn-stop').classList.remove('hidden');
    _rafId = requestAnimationFrame(_tick);
  }

  function _tick(ts) {
    if (_startTime === null) _startTime = ts;
    const p       = State.p;
    const elapsed  = ts - _startTime;
    const durMs    = sceneAnimDurMs(p.currentSceneIndex);
    const t        = easeInOut(Math.min(elapsed / durMs, 1));

    for (const perf of p.performers) {
      const fr = _fromPos[perf.id];
      const to = _toPos[perf.id];
      if (fr && to) {
        _animPos[perf.id] = { x: lerp(fr.x, to.x, t), y: lerp(fr.y, to.y, t), visible: true };
      } else if (fr) {
        _animPos[perf.id] = { ...fr };
      }
    }
    Renderer.renderPerformers(_animPos);

    if (elapsed < durMs) {
      _rafId = requestAnimationFrame(_tick);
    } else {
      _finish();
    }
  }

  function _finish() {
    _cleanup();
    const p = State.p;
    p.currentSceneIndex = Math.min(p.currentSceneIndex + 1, p.scenes.length - 1);
    Persistence.save();
    UI.syncAll();
    Renderer.render();
  }

  function stop() {
    if (!_playing) return;
    _cleanup();
    Renderer.render();
  }

  function _cleanup() {
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    _playing   = false;
    _animPos   = null;
    _startTime = null;
    Renderer.clearPaths();
    document.getElementById('btn-play').classList.remove('hidden');
    document.getElementById('btn-stop').classList.add('hidden');
  }

  return {
    get isPlaying() { return _playing; },
    play, stop,
  };
})();

/* ============================================================
   DRAG & DROP  — pointer events + pinch zoom
============================================================ */
const DragDrop = (() => {
  let _svg      = null;
  let _drag     = null;   // { perfId, startSX, startSY, origX, origY }
  let _pan      = null;   // { lastX, lastY }
  let _spaceKey = false;

  /* multi-touch tracking for pinch zoom */
  const _ptrs     = new Map();  // pointerId → {clientX, clientY}
  let _lastPinch  = null;

  function init() {
    _svg = document.getElementById('stage-svg');
    _svg.addEventListener('pointerdown',  _onDown);
    _svg.addEventListener('pointermove',  _onMove);
    _svg.addEventListener('pointerup',    _onUp);
    _svg.addEventListener('pointercancel',_onUp);
    _svg.addEventListener('wheel', _onWheel, { passive: false });

    document.addEventListener('keydown', e => {
      if (e.code === 'Space' && document.activeElement === document.body) {
        e.preventDefault();
        _spaceKey = true;
        if (!_drag) _svg.style.cursor = 'grab';
      }
    });
    document.addEventListener('keyup', e => {
      if (e.code === 'Space') { _spaceKey = false; if (!_pan) _svg.style.cursor = ''; }
    });
  }

  function _pt(e) {
    const r = _svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function _pinchDist() {
    const pts = [..._ptrs.values()];
    if (pts.length < 2) return null;
    const dx = pts[0].clientX - pts[1].clientX;
    const dy = pts[0].clientY - pts[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function _pinchCenter() {
    const pts = [..._ptrs.values()];
    const r   = _svg.getBoundingClientRect();
    return {
      x: (pts[0].clientX + pts[1].clientX) / 2 - r.left,
      y: (pts[0].clientY + pts[1].clientY) / 2 - r.top,
    };
  }

  function _onDown(e) {
    if (Animator.isPlaying) return;
    _ptrs.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });

    /* pinch start */
    if (_ptrs.size === 2) {
      _drag = _pan = null;
      _lastPinch = _pinchDist();
      _svg.setPointerCapture(e.pointerId);
      return;
    }

    /* measure click */
    if (MeasureTool.active) {
      MeasureTool.handleClick(_pt(e));
      return;
    }

    /* pan: middle mouse or space+left */
    if (e.button === 1 || (e.button === 0 && _spaceKey)) {
      e.preventDefault();
      _pan = { lastX: e.clientX, lastY: e.clientY };
      _svg.style.cursor = 'grabbing';
      _svg.setPointerCapture(e.pointerId);
      return;
    }

    if (e.button !== 0) return;

    /* find performer group */
    let el = e.target;
    let perfEl = null;
    while (el && el !== _svg) {
      if (el.classList && el.classList.contains('performer-group')) { perfEl = el; break; }
      el = el.parentElement;
    }

    if (perfEl) {
      const perfId = perfEl.getAttribute('data-id');
      const scene  = State.p.scenes[State.p.currentSceneIndex];
      const pos    = scene.positions[perfId];
      if (!pos) return;
      UI.selectPerformer(perfId);
      const sp = _pt(e);
      _drag = { perfId, startSX: sp.x, startSY: sp.y, origX: pos.x, origY: pos.y };
      _svg.style.cursor = 'grabbing';
      _svg.setPointerCapture(e.pointerId);
      e.preventDefault();
    } else {
      UI.selectPerformer(null);
    }
  }

  function _onMove(e) {
    _ptrs.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });

    /* pinch zoom */
    if (_ptrs.size >= 2 && _lastPinch !== null) {
      const d = _pinchDist();
      if (d) { Transform.zoomAt(d / _lastPinch, _pinchCenter().x, _pinchCenter().y); _lastPinch = d; }
      return;
    }

    const sp    = _pt(e);
    const world = Transform.screenToWorld(sp.x, sp.y);
    const p     = State.p;

    /* coordinate display */
    const el = document.getElementById('stage-coords');
    if (el) el.textContent =
      `x: ${clamp(world.x, 0, p.stageDimensions.width).toFixed(1)} m   ` +
      `y: ${clamp(world.y, 0, p.stageDimensions.depth).toFixed(1)} m`;

    if (_pan) {
      Transform.pan(e.clientX - _pan.lastX, e.clientY - _pan.lastY);
      _pan.lastX = e.clientX;
      _pan.lastY = e.clientY;
      return;
    }

    if (!_drag) return;

    const sc   = Transform.getScale();
    const perf = p.performers.find(pf => pf.id === _drag.perfId);
    const ti   = TYPES[perf?.type] || TYPES.child;
    const r    = ti.widthM / 2;

    let nx = _drag.origX + (sp.x - _drag.startSX) / sc;
    let ny = _drag.origY + (sp.y - _drag.startSY) / sc;
    nx = clamp(nx, r, p.stageDimensions.width  - r);
    ny = clamp(ny, r, p.stageDimensions.depth  - r);

    if (p.settings.snapToGrid) {
      const gs = p.settings.gridSize;
      nx = Math.round(nx / gs) * gs;
      ny = Math.round(ny / gs) * gs;
    }

    const pos = p.scenes[p.currentSceneIndex].positions[_drag.perfId];
    pos.x = nx;
    pos.y = ny;
    Renderer.renderPerformers();
    UI.syncSelectedPos();
  }

  function _onUp(e) {
    _ptrs.delete(e.pointerId);
    if (_ptrs.size < 2) _lastPinch = null;

    if (_pan) {
      _pan = null;
      _svg.style.cursor = _spaceKey ? 'grab' : '';
      return;
    }
    if (_drag) {
      State.pushUndo();
      Persistence.save();
      _drag = null;
      _svg.style.cursor = '';
    }
  }

  function _onWheel(e) {
    e.preventDefault();
    const sp = _pt(e);
    Transform.zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, sp.x, sp.y);
  }

  return { init };
})();

/* ============================================================
   SCENE MANAGER
============================================================ */
const SceneManager = (() => {

  function switchTo(index) {
    const p = State.p;
    if (index < 0 || index >= p.scenes.length) return;
    p.currentSceneIndex = index;
    Renderer.render();
    UI.syncAll();
    Persistence.save();
  }

  function addScene() {
    const p    = State.p;
    State.pushUndo();
    const last         = p.scenes[p.scenes.length - 1];
    // Append after the last scene's walk completes — otherwise the new
    // scene's startTime can fall inside the previous transition window.
    const lastWalkSec  = (last.animDurationMs ?? p.settings.animDurationMs) / 1000;
    const newStartTime = last.startTime + lastWalkSec;
    p.scenes.push({
      id: uid(),
      name: `Scene ${p.scenes.length + 1}`,
      positions: JSON.parse(JSON.stringify(p.scenes[p.currentSceneIndex].positions)),
      note: '',
      startTime: newStartTime,
      animDurationMs: p.settings.animDurationMs,
    });
    p.currentSceneIndex = p.scenes.length - 1;
    Persistence.save();
    UI.syncAll();
    Renderer.render();
    MusicPlayer.renderTimeline();
  }

  function duplicateScene() {
    const p   = State.p;
    State.pushUndo();
    const cur = p.scenes[p.currentSceneIndex];
    const nextIdx  = p.currentSceneIndex + 1;
    const nextStart = nextIdx < p.scenes.length
      ? p.scenes[nextIdx].startTime
      : cur.startTime + p.settings.animDurationMs / 1000;
    const dupStart = (cur.startTime + nextStart) / 2; // midpoint
    const dup = {
      id: uid(), name: cur.name + ' (copy)',
      positions: JSON.parse(JSON.stringify(cur.positions)),
      note: cur.note ?? '',
      startTime: dupStart,
      animDurationMs: p.settings.animDurationMs,
    };
    p.scenes.splice(nextIdx, 0, dup);
    p.currentSceneIndex = nextIdx;
    Persistence.save();
    UI.syncAll();
    Renderer.render();
    MusicPlayer.renderTimeline();
  }

  function deleteScene() {
    const p = State.p;
    if (p.scenes.length <= 1) return;
    State.pushUndo();
    p.scenes.splice(p.currentSceneIndex, 1);
    p.currentSceneIndex = clamp(p.currentSceneIndex, 0, p.scenes.length - 1);
    // Preserve every remaining scene's startTime — the user may have aligned
    // them to specific music beats. Only enforce the invariant that the first
    // scene starts at 0.
    p.scenes[0].startTime = 0;
    Persistence.save();
    UI.syncAll();
    Renderer.render();
    MusicPlayer.renderTimeline();
  }

  function renameScene(name) {
    if (!name?.trim()) return;
    State.pushUndo();
    State.p.scenes[State.p.currentSceneIndex].name = name.trim();
    Persistence.save();
    UI.syncSceneSelect();
  }

  function ensurePerformerPositions(perfId) {
    const p  = State.p;
    const ti = TYPES[p.performers.find(pf => pf.id === perfId)?.type] || TYPES.child;
    const r  = ti.widthM / 2;
    const sw = p.stageDimensions.width;
    const sd = p.stageDimensions.depth;
    for (const scene of p.scenes) {
      if (!scene.positions[perfId]) {
        scene.positions[perfId] = {
          x: clamp(sw / 2 + (Math.random() - 0.5) * Math.min(sw, sd) * 0.5, r, sw - r),
          y: clamp(sd / 2 + (Math.random() - 0.5) * Math.min(sw, sd) * 0.3, r, sd - r),
          visible: true,
        };
      }
    }
  }

  function removePerformerPositions(perfId) {
    for (const scene of State.p.scenes) delete scene.positions[perfId];
  }

  return { switchTo, addScene, duplicateScene, deleteScene, renameScene, ensurePerformerPositions, removePerformerPositions };
})();

/* ============================================================
   PERSISTENCE
============================================================ */
const Persistence = (() => {
  let _t = null;

  function save() {
    clearTimeout(_t);
    _t = setTimeout(() => {
      try {
        const p  = State.p;
        const bg = p.backgroundImage;
        p.backgroundImage = null;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
        p.backgroundImage = bg;
        if (bg) {
          try { localStorage.setItem(STORAGE_KEY + '_bg', bg); } catch (_) {}
        } else {
          localStorage.removeItem(STORAGE_KEY + '_bg');
        }
      } catch (e) {
        console.warn('localStorage save failed:', e);
      }
    }, 600);
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      /* migration defaults */
      if (!p.settings)                        p.settings = {};
      if (p.settings.animDurationMs == null)  p.settings.animDurationMs = 3000;
      if (p.settings.gridVisible    == null)  p.settings.gridVisible    = true;
      if (p.settings.snapToGrid     == null)  p.settings.snapToGrid     = false;
      if (p.settings.gridSize       == null)  p.settings.gridSize       = 1;
      // Migrate per-scene timing fields
      if (Array.isArray(p.scenes)) {
        let t = 0;
        for (const s of p.scenes) {
          if (s.animDurationMs == null) s.animDurationMs = p.settings.animDurationMs;
          if (s.startTime      == null) s.startTime      = t;
          t += s.animDurationMs / 1000;
          if (s.note           == null) s.note           = '';
        }
      }
      const bg = localStorage.getItem(STORAGE_KEY + '_bg');
      if (bg) p.backgroundImage = bg;
      return p;
    } catch (_) { return null; }
  }

  function clearAll() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY + '_bg');
  }

  return { save, load, clearAll };
})();

/* ============================================================
   EXPORTER  — offscreen Canvas → PNG
============================================================ */
const Exporter = (() => {

  function exportPNG() {
    const p   = State.p;
    const sw  = p.stageDimensions.width;
    const sd  = p.stageDimensions.depth;
    const PPM = Math.min(100, Math.floor(2000 / Math.max(sw, sd))); // px/m, max 2000px edge
    const W   = Math.round(sw * PPM);
    const H   = Math.round(sd * PPM);

    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx   = canvas.getContext('2d');
    const scene = p.scenes[p.currentSceneIndex];

    function draw(bg) {
      /* background */
      if (bg) {
        ctx.drawImage(bg, 0, 0, W, H);
      } else {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#1c1c3a');
        g.addColorStop(1, '#272748');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }

      /* grid */
      if (p.settings.gridVisible) {
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth   = 1;
        for (let x = p.settings.gridSize * PPM; x < W; x += p.settings.gridSize * PPM) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        }
        for (let y = p.settings.gridSize * PPM; y < H; y += p.settings.gridSize * PPM) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
      }

      /* performers */
      ctx.textAlign = 'center';
      for (const perf of p.performers) {
        const pos = scene.positions[perf.id];
        if (!pos || pos.visible === false) continue;
        const ti = TYPES[perf.type] || TYPES.child;
        const cx = pos.x * PPM;
        const cy = pos.y * PPM;
        const r  = (ti.widthM / 2) * PPM;

        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur  = 8;
        ctx.fillStyle   = perf.color;

        if (ti.shape === 'rect') {
          ctx.beginPath();
          ctx.roundRect ? ctx.roundRect(cx - r, cy - r, r * 2, r * 2, 4) : ctx.rect(cx - r, cy - r, r * 2, r * 2);
          ctx.fill();
          ctx.shadowBlur  = 0;
          ctx.strokeStyle = 'rgba(255,255,255,0.75)';
          ctx.lineWidth   = 1.5;
          ctx.stroke();
        } else {
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur  = 0;
          ctx.strokeStyle = 'rgba(255,255,255,0.75)';
          ctx.lineWidth   = 1.5;
          ctx.stroke();
        }
        ctx.shadowBlur = 0;

        /* name */
        const lfs = Math.max(9, r * 0.85);
        ctx.font        = `bold ${lfs}px sans-serif`;
        ctx.fillStyle   = '#fff';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur  = 4;
        ctx.fillText(perf.name, cx, cy + r + lfs + 2);
        ctx.shadowBlur = 0;
      }

      /* stage border */
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth   = 2;
      ctx.strokeRect(1, 1, W - 2, H - 2);

      /* 1m ruler */
      const rx  = 16;
      const ry  = H - 16;
      const rln = PPM;
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.moveTo(rx, ry); ctx.lineTo(rx + rln, ry);
      ctx.moveTo(rx, ry - 5); ctx.lineTo(rx, ry + 5);
      ctx.moveTo(rx + rln, ry - 5); ctx.lineTo(rx + rln, ry + 5);
      ctx.stroke();
      ctx.fillStyle   = 'rgba(255,255,255,0.65)';
      ctx.font        = '11px sans-serif';
      ctx.textAlign   = 'center';
      ctx.fillText('1 m', rx + rln / 2, ry - 8);

      /* scene label */
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font      = '13px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(scene.name, 10, 18);

      /* stage dims */
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font      = '11px sans-serif';
      ctx.fillText(`${sw} m × ${sd} m`, 10, H - 8);

      /* download */
      const a   = document.createElement('a');
      const nm  = scene.name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
      a.download = `stage-${nm}.png`;
      a.href     = canvas.toDataURL('image/png');
      a.click();
    }

    if (p.backgroundImage) {
      const img  = new Image();
      img.onload = () => draw(img);
      img.onerror = () => draw(null);
      img.src    = p.backgroundImage;
    } else {
      draw(null);
    }
  }

  return { exportPNG };
})();

/* ============================================================
   PROJECT I/O  — JSON export & import
============================================================ */
const ProjectIO = (() => {

  /* ── EXPORT ── */
  function exportJSON() {
    const p  = State.p;

    // Deep-copy and strip background image (user backs it up separately)
    const data = JSON.parse(JSON.stringify(p));
    data.backgroundImage = null;
    data._exportedAt     = new Date().toISOString();
    data._version        = 1;

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.download = `stage-formation-${date}.json`;
    a.href     = url;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ── VALIDATE ── */
  function _validate(p) {
    const errs = [];
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      return ['文件内容不是有效的 JSON 对象 (Not a valid JSON object)'];
    }

    if (!p.stageDimensions || typeof p.stageDimensions.width  !== 'number'
                           || typeof p.stageDimensions.depth  !== 'number') {
      errs.push('缺少 stageDimensions.width / depth (Missing stage dimensions)');
    }
    if (!Array.isArray(p.performers)) {
      errs.push('缺少 performers 数组 (Missing performers array)');
    }
    if (!Array.isArray(p.scenes) || p.scenes.length === 0) {
      errs.push('缺少 scenes 数组或为空 (Missing or empty scenes array)');
    } else {
      p.scenes.forEach((s, i) => {
        const label = `Scene[${i}] "${s.name ?? ''}"`;
        if (typeof s.id   !== 'string') errs.push(`${label}: 缺少 id`);
        if (typeof s.name !== 'string') errs.push(`${label}: 缺少 name`);
        if (!s.positions || typeof s.positions !== 'object') {
          errs.push(`${label}: 缺少 positions 对象`);
        }
      });
    }
    if (Array.isArray(p.performers)) {
      p.performers.forEach((pf, i) => {
        if (typeof pf.id    !== 'string') errs.push(`Performer[${i}]: 缺少 id`);
        if (typeof pf.name  !== 'string') errs.push(`Performer[${i}]: 缺少 name`);
        if (typeof pf.color !== 'string') errs.push(`Performer[${i}]: 缺少 color`);
      });
    }
    return errs;
  }

  /* ── IMPORT ── */
  function importFromFile(file) {
    const reader = new FileReader();
    reader.onload = ev => {
      let parsed;
      // --- Parse ---
      try {
        parsed = JSON.parse(ev.target.result);
      } catch (e) {
        _showError('JSON 解析失败 (Parse error)', [e.message]);
        return;
      }

      // --- Validate ---
      const errs = _validate(parsed);
      if (errs.length) {
        _showError('文件格式有误 (Invalid format)', errs);
        return;
      }

      // --- Migrate / fill defaults ---
      if (!parsed.settings)                       parsed.settings = {};
      if (parsed.settings.animDurationMs == null) parsed.settings.animDurationMs = 3000;
      if (parsed.settings.gridVisible    == null) parsed.settings.gridVisible    = true;
      if (parsed.settings.snapToGrid     == null) parsed.settings.snapToGrid     = false;
      if (parsed.settings.gridSize       == null) parsed.settings.gridSize       = 1;
      parsed.backgroundImage = null;    // never imported
      parsed.currentSceneIndex = clamp(parsed.currentSceneIndex ?? 0, 0, parsed.scenes.length - 1);

      // Ensure every scene has a note field
      for (const s of parsed.scenes) { if (s.note == null) s.note = ''; }

      // Ensure every performer has widthM/heightM
      for (const pf of parsed.performers) {
        const ti  = TYPES[pf.type] || TYPES.child;
        if (pf.widthM  == null) pf.widthM  = ti.widthM;
        if (pf.heightM == null) pf.heightM = ti.heightM;
        if (!pf.type) pf.type = 'child';
      }

      // --- Load ---
      State.pushUndo();
      State.p = parsed;
      Persistence.save();
      Transform.fitToWindow();   // also calls Renderer.render()
      UI.syncAll();

      _showSuccess(`已导入：${parsed.scenes.length} 个场景，${parsed.performers.length} 名演员`);
    };

    reader.onerror = () => _showError('文件读取失败 (File read error)', [reader.error?.message ?? '']);
    reader.readAsText(file);
  }

  /* ── FEEDBACK HELPERS ── */
  function _showError(title, lines) {
    alert(`⚠️ ${title}\n\n${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}`);
  }

  function _showSuccess(msg) {
    // Brief status banner inside stage area
    const banner     = document.createElement('div');
    banner.className = 'io-toast io-toast-ok';
    banner.textContent = '✓ ' + msg;
    document.getElementById('stage-area').appendChild(banner);
    setTimeout(() => banner.remove(), 2800);
  }

  return { exportJSON, importFromFile };
})();

/* ============================================================
   MEASURE TOOL
============================================================ */
const MeasureTool = (() => {
  let _active = false;
  let _pts    = [];  // world coords

  function toggle() {
    _active = !_active;
    _pts    = [];
    document.getElementById('measure-layer').innerHTML = '';
    document.getElementById('stage-svg').style.cursor = _active ? 'crosshair' : '';
    document.getElementById('measure-result').textContent =
      _active ? 'Click two points on stage' : 'Enable 📐 then click two points';
  }

  function handleClick(svgPt) {
    const w = Transform.screenToWorld(svgPt.x, svgPt.y);
    if (_pts.length >= 2) _pts = [];
    _pts.push({ x: w.x, y: w.y });
    renderLayer();
    if (_pts.length === 2) {
      const dx   = _pts[1].x - _pts[0].x;
      const dy   = _pts[1].y - _pts[0].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      document.getElementById('measure-result').textContent = `Distance: ${dist.toFixed(2)} m`;
    } else {
      document.getElementById('measure-result').textContent = 'Click second point…';
    }
  }

  /* measure-layer is inside viewport → world coordinates */
  function renderLayer() {
    const layer = document.getElementById('measure-layer');
    layer.innerHTML = '';
    if (!_active || !_pts.length) return;

    const sc  = Transform.getScale();
    const r   = 5  / sc;
    const sw  = 2  / sc;

    for (const pt of _pts) {
      layer.appendChild(makeSVGEl('circle', {
        cx: pt.x, cy: pt.y, r,
        fill: '#f1c40f', stroke: '#fff', 'stroke-width': sw,
        'vector-effect': 'non-scaling-stroke',
      }));
    }

    if (_pts.length >= 2) {
      layer.appendChild(makeSVGEl('line', {
        x1: _pts[0].x, y1: _pts[0].y, x2: _pts[1].x, y2: _pts[1].y,
        stroke: '#f1c40f', 'stroke-width': sw, 'vector-effect': 'non-scaling-stroke',
        'stroke-dasharray': `${8 / sc} ${4 / sc}`,
      }));

      const mx  = (_pts[0].x + _pts[1].x) / 2;
      const my  = (_pts[0].y + _pts[1].y) / 2;
      const dx  = _pts[1].x - _pts[0].x;
      const dy  = _pts[1].y - _pts[0].y;
      const d   = Math.sqrt(dx * dx + dy * dy);
      const fs  = 11 / sc;
      layer.appendChild(makeSVGEl('text', {
        x: mx, y: my - 4 / sc, 'font-size': fs,
        fill: '#f1c40f', 'text-anchor': 'middle', 'dominant-baseline': 'auto',
        'paint-order': 'stroke', stroke: 'rgba(0,0,0,0.7)',
        'stroke-width': fs * 0.3, 'stroke-linejoin': 'round', 'pointer-events': 'none',
      }, `${d.toFixed(2)} m`));
    }
  }

  return { get active() { return _active; }, toggle, handleClick, renderLayer };
})();

/* ============================================================
   UI  — DOM event wiring + sync helpers
============================================================ */
const UI = (() => {
  let _selId = null;

  /* ─────── INIT ─────── */
  function init() {
    State.init();
    DragDrop.init();
    _bindToolbar();
    _bindSidebar();
    _bindModal();
    _bindKeyboard();
    _bindResize();
    syncAll();
    requestAnimationFrame(() => Transform.fitToWindow());
  }

  /* ─────── TOOLBAR BINDINGS ─────── */
  function _bindToolbar() {
    _on('scene-select',    'change',  e => { if (!Animator.isPlaying) SceneManager.switchTo(+e.target.value); });
    _on('btn-add-scene',   'click',   ()  => { if (!Animator.isPlaying) SceneManager.addScene(); });
    _on('btn-rename-scene','click',   ()  => {
      if (Animator.isPlaying) return;
      const p   = State.p;
      const cur = p.scenes[p.currentSceneIndex];
      const n   = prompt('Scene name:', cur.name);
      if (n !== null) SceneManager.renameScene(n);
    });
    _on('btn-dup-scene',   'click',   ()  => { if (!Animator.isPlaying) SceneManager.duplicateScene(); });
    _on('btn-del-scene',   'click',   ()  => {
      if (Animator.isPlaying) return;
      if (State.p.scenes.length <= 1) { alert('Cannot delete the last scene.'); return; }
      if (confirm(`Delete "${State.p.scenes[State.p.currentSceneIndex].name}"?`)) SceneManager.deleteScene();
    });

    _on('btn-play', 'click', () => Animator.play());
    _on('btn-stop', 'click', () => Animator.stop());

    _on('btn-zoom-in',  'click', () => _zoomCenter(1.25));
    _on('btn-zoom-out', 'click', () => _zoomCenter(0.8));
    _on('btn-zoom-fit', 'click', () => Transform.fitToWindow());

    _on('btn-grid', 'click', () => {
      State.p.settings.gridVisible = !State.p.settings.gridVisible;
      _syncToggle('btn-grid', State.p.settings.gridVisible);
      Renderer.render(); Persistence.save();
    });
    _on('btn-snap', 'click', () => {
      State.p.settings.snapToGrid = !State.p.settings.snapToGrid;
      _syncToggle('btn-snap', State.p.settings.snapToGrid);
      Persistence.save();
    });
    _on('btn-measure', 'click', () => {
      MeasureTool.toggle();
      _syncToggle('btn-measure', MeasureTool.active);
    });

    _on('btn-undo', 'click', () => State.undo());
    _on('btn-redo', 'click', () => State.redo());

    _on('btn-new-project', 'click', () => {
      if (Animator.isPlaying) return;
      const ok = confirm(
        '新建项目 / New Project\n\n' +
        '这将清除所有演员和场景数据，无法撤销。\n' +
        'This will delete all performers and scenes. This cannot be undone.\n\n' +
        '建议先点"取消"，用 ↓ Export 保存当前项目。\n' +
        'Tip: click Cancel first and use ↓ Export to save your work.'
      );
      if (!ok) return;
      MusicPlayer.unload();   // free blob URL, clear waveform & filename
      Persistence.clearAll();
      State.p = null;
      State.init();          // re-loads from localStorage (gets default since we just cleared)
      Transform.fitToWindow();
      UI.syncAll();
    });

    _on('btn-export-json', 'click', () => ProjectIO.exportJSON());
    _on('btn-import-json', 'click', () => document.getElementById('json-file-input').click());
    _on('json-file-input', 'change', e => {
      const file = e.target.files[0];
      if (file) ProjectIO.importFromFile(file);
      e.target.value = '';
    });

    _on('btn-export-zip', 'click', () => ProjectBundle.exportZip());
    _on('btn-import-zip', 'click', () => document.getElementById('zip-file-input').click());
    _on('zip-file-input', 'change', e => {
      const file = e.target.files[0];
      if (file) ProjectBundle.importZip(file);
      e.target.value = '';
    });

    _on('btn-export', 'click', () => Exporter.exportPNG());
    _on('btn-fullscreen', 'click', () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
      else document.exitFullscreen();
    });
  }

  /* ─────── SIDEBAR BINDINGS ─────── */
  function _bindSidebar() {
    _on('btn-add-performer', 'click', _showModal);

    _on('stage-width', 'change', e => {
      const v = parseFloat(e.target.value);
      if (v > 0 && v !== State.p.stageDimensions.width) {
        State.pushUndo();
        State.p.stageDimensions.width = v;
        Transform.fitToWindow();
        Persistence.save();
      }
    });
    _on('stage-depth', 'change', e => {
      const v = parseFloat(e.target.value);
      if (v > 0 && v !== State.p.stageDimensions.depth) {
        State.pushUndo();
        State.p.stageDimensions.depth = v;
        Transform.fitToWindow();
        Persistence.save();
      }
    });

    _on('btn-upload-bg', 'click', () => document.getElementById('bg-file-input').click());
    _on('bg-file-input', 'change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const fr = new FileReader();
      fr.onload = ev => {
        State.pushUndo();
        State.p.backgroundImage = ev.target.result;
        Renderer.render();
        Persistence.save();
      };
      fr.readAsDataURL(file);
      e.target.value = '';
    });
    _on('btn-clear-bg', 'click', () => {
      if (!State.p.backgroundImage) return;
      State.pushUndo();
      State.p.backgroundImage = null;
      Renderer.render();
      Persistence.save();
    });

    _on('scene-walk-dur', 'change', e => {
      const v = parseFloat(e.target.value);
      if (!(v > 0)) return;
      const p     = State.p;
      const scene = p.scenes[p.currentSceneIndex];
      if (!scene) return;
      const newMs = v * 1000;
      if (scene.animDurationMs === newMs) return;
      State.pushUndo();
      scene.animDurationMs = newMs;
      Persistence.save();
      MusicPlayer.renderTimeline();
    });

    _on('scene-start-time', 'change', e => {
      const v = parseFloat(e.target.value);
      if (isNaN(v) || v < 0) return;
      const p     = State.p;
      const idx   = p.currentSceneIndex;
      const scene = p.scenes[idx];
      if (!scene || idx === 0) return; // Scene 1 always at 0
      // Clamp: must be > previous scene's startTime
      const minT = p.scenes[idx - 1]?.startTime ?? 0;
      const clamped = Math.max(minT + 0.1, v);
      if (clamped === scene.startTime) return;
      State.pushUndo();
      scene.startTime = clamped;
      Persistence.save();
      _syncStageInputs();
      MusicPlayer.renderTimeline();
    });

    /* scene note — save on every keystroke (debounced via Persistence) */
    _on('scene-note', 'input', e => {
      const p = State.p;
      const scene = p.scenes[p.currentSceneIndex];
      if (scene) { scene.note = e.target.value; Persistence.save(); }
    });

    /* selected performer fields */
    _on('sel-name', 'change', e => {
      if (!_selId) return;
      const p = State.p;
      const perf = p.performers.find(pf => pf.id === _selId);
      if (!perf) return;
      const trimmed = e.target.value.trim();
      if (!trimmed) { e.target.value = perf.name; return; }
      State.pushUndo();
      perf.name = trimmed;
      Renderer.renderPerformers(); syncPerformerList(); Persistence.save();
    });
    _on('sel-color', 'input', e => {
      if (!_selId) return;
      const perf = State.p.performers.find(pf => pf.id === _selId);
      if (perf) { perf.color = e.target.value; Renderer.renderPerformers(); syncPerformerList(); }
    });
    _on('sel-color', 'change', () => { if (_selId) { State.pushUndo(); Persistence.save(); } });
    _on('sel-type', 'change', e => {
      if (!_selId) return;
      State.pushUndo();
      const perf = State.p.performers.find(pf => pf.id === _selId);
      if (perf) {
        perf.type   = e.target.value;
        const ti    = TYPES[perf.type];
        perf.widthM = ti.widthM; perf.heightM = ti.heightM;
        Renderer.render(); Persistence.save();
      }
    });
    _on('sel-visible', 'change', e => {
      if (!_selId) return;
      State.pushUndo();
      const p   = State.p;
      const pos = p.scenes[p.currentSceneIndex].positions[_selId];
      if (pos) { pos.visible = e.target.checked; Renderer.renderPerformers(); Persistence.save(); }
    });
    _on('sel-x', 'change', e => {
      if (!_selId) return;
      State.pushUndo();
      const p    = State.p;
      const perf = p.performers.find(pf => pf.id === _selId);
      const pos  = p.scenes[p.currentSceneIndex].positions[_selId];
      if (pos && perf) {
        const r = (TYPES[perf.type] || TYPES.child).widthM / 2;
        pos.x   = clamp(+e.target.value || 0, r, p.stageDimensions.width - r);
        Renderer.renderPerformers(); Persistence.save();
      }
    });
    _on('sel-y', 'change', e => {
      if (!_selId) return;
      State.pushUndo();
      const p    = State.p;
      const perf = p.performers.find(pf => pf.id === _selId);
      const pos  = p.scenes[p.currentSceneIndex].positions[_selId];
      if (pos && perf) {
        const r = (TYPES[perf.type] || TYPES.child).widthM / 2;
        pos.y   = clamp(+e.target.value || 0, r, p.stageDimensions.depth - r);
        Renderer.renderPerformers(); Persistence.save();
      }
    });
    _on('btn-delete-selected', 'click', () => {
      if (!_selId) return;
      if (!confirm('Delete this performer from all scenes?')) return;
      State.pushUndo();
      State.p.performers = State.p.performers.filter(pf => pf.id !== _selId);
      SceneManager.removePerformerPositions(_selId);
      selectPerformer(null);
      Renderer.render(); syncPerformerList(); Persistence.save();
    });
  }

  /* ─────── MODAL BINDINGS ─────── */
  function _bindModal() {
    const presetBox = document.getElementById('color-presets');
    for (const color of PRESET_COLORS) {
      const dot = document.createElement('div');
      dot.className = 'color-preset';
      dot.style.background = color;
      dot.title = color;
      dot.addEventListener('click', () => { document.getElementById('new-color').value = color; });
      presetBox.appendChild(dot);
    }
    _on('btn-modal-cancel', 'click', _hideModal);
    _on('btn-modal-ok',     'click', _confirmAdd);
    document.getElementById('modal-overlay').addEventListener('click', e => {
      if (e.target.id === 'modal-overlay') _hideModal();
    });
    _on('new-name', 'keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); _confirmAdd(); }
      if (e.key === 'Escape') _hideModal();
    });
  }

  /* ─────── KEYBOARD ─────── */
  function _bindKeyboard() {
    document.addEventListener('keydown', e => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') { e.preventDefault(); State.undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); State.redo(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && _selId) {
        e.preventDefault(); document.getElementById('btn-delete-selected').click();
      }
      if (e.key === 'f') Transform.fitToWindow();
      if (e.key === 'g') document.getElementById('btn-grid').click();
      if (e.key === 'Escape') {
        selectPerformer(null);
        if (MeasureTool.active) { MeasureTool.toggle(); _syncToggle('btn-measure', false); }
      }
    });
  }

  /* ─────── RESIZE ─────── */
  function _bindResize() {
    let timer;
    const handler = () => { clearTimeout(timer); timer = setTimeout(() => Transform.fitToWindow(), 80); };
    if (window.ResizeObserver) {
      new ResizeObserver(handler).observe(document.getElementById('stage-area'));
    } else {
      window.addEventListener('resize', handler);
    }
  }

  /* ─────── MODAL LOGIC ─────── */
  function _showModal() {
    const p    = State.p;
    const used = new Set(p.performers.map(pf => pf.color));
    const next = PRESET_COLORS.find(c => !used.has(c)) || PRESET_COLORS[p.performers.length % PRESET_COLORS.length];
    document.getElementById('new-color').value = next;
    document.getElementById('new-name').value  = '';
    document.getElementById('new-type').value  = 'child';
    document.getElementById('new-name').classList.remove('error');
    document.getElementById('modal-overlay').classList.remove('hidden');
    setTimeout(() => document.getElementById('new-name').focus(), 40);
  }

  function _hideModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
  }

  function _confirmAdd() {
    const nameEl = document.getElementById('new-name');
    const name   = nameEl.value.trim();
    if (!name) { nameEl.classList.add('error'); nameEl.focus(); return; }
    nameEl.classList.remove('error');

    const color = document.getElementById('new-color').value;
    const type  = document.getElementById('new-type').value;
    const ti    = TYPES[type];
    const id    = uid();

    State.pushUndo();
    State.p.performers.push({ id, name, color, type, widthM: ti.widthM, heightM: ti.heightM });
    SceneManager.ensurePerformerPositions(id);
    _hideModal();
    Renderer.render();
    syncPerformerList();
    selectPerformer(id);
    Persistence.save();
  }

  /* ─────── PUBLIC HELPERS ─────── */
  function selectPerformer(id) {
    _selId = id;
    _syncSelectedSection();
    Renderer.renderPerformers();
    syncPerformerList();
  }

  function syncSceneSelect() {
    const p   = State.p;
    const sel = document.getElementById('scene-select');
    sel.innerHTML = '';
    p.scenes.forEach((s, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = s.name;
      sel.appendChild(opt);
    });
    sel.value = p.currentSceneIndex;
  }

  function syncPerformerList() {
    const ul = document.getElementById('performer-list');
    ul.innerHTML = '';
    for (const perf of State.p.performers) {
      const li   = document.createElement('li');
      li.className = 'performer-item' + (perf.id === _selId ? ' selected' : '');

      const ti   = TYPES[perf.type] || TYPES.child;
      const dot  = document.createElement('div');
      dot.className = 'performer-dot' + (ti.shape === 'rect' ? ' square' : '');
      dot.style.background = perf.color;

      const nm   = document.createElement('span');
      nm.className = 'performer-name';
      nm.textContent = perf.name;

      const bdg  = document.createElement('span');
      bdg.className = 'performer-type-badge';
      bdg.textContent = { child: '', adult: 'A', teacher: 'T' }[perf.type] ?? '';

      li.append(dot, nm, bdg);
      li.addEventListener('click', () => selectPerformer(perf.id));
      ul.appendChild(li);
    }
  }

  function syncZoomLabel() {
    document.getElementById('zoom-label').textContent = Transform.getZoomPct();
  }

  function syncSelectedPos() {
    if (!_selId) return;
    const pos = State.p.scenes[State.p.currentSceneIndex].positions[_selId];
    if (!pos) return;
    document.getElementById('sel-x').value = pos.x.toFixed(2);
    document.getElementById('sel-y').value = pos.y.toFixed(2);
  }

  function syncSceneNote() {
    const p     = State.p;
    const scene = p.scenes[p.currentSceneIndex];
    if (!scene) return;
    document.getElementById('scene-note').value         = scene.note ?? '';
    document.getElementById('notes-scene-label').textContent = scene.name;
  }

  function syncAll() {
    syncSceneSelect();
    syncPerformerList();
    _syncSelectedSection();
    _syncStageInputs();
    syncSceneNote();
    _syncToggle('btn-grid',    State.p.settings.gridVisible);
    _syncToggle('btn-snap',    State.p.settings.snapToGrid);
    _syncToggle('btn-measure', MeasureTool.active);
    MusicPlayer.renderTimeline();
  }

  /* Lightweight sync for music-driven scene changes — only touches widgets
     that depend on the current scene index. Avoids rebuilding the performer
     list / scene marker DOM every transition (which would steal focus and
     cause flicker during playback). */
  function syncCurrentScene() {
    const sel = document.getElementById('scene-select');
    if (sel) sel.value = State.p.currentSceneIndex;
    syncSceneNote();
    _syncStageInputs();
    syncSelectedPos();
  }

  /* ─────── PRIVATE SYNC ─────── */
  function _syncSelectedSection() {
    const sec = document.getElementById('selected-section');
    if (!_selId) { sec.style.display = 'none'; return; }
    const p    = State.p;
    const perf = p.performers.find(pf => pf.id === _selId);
    if (!perf) { sec.style.display = 'none'; return; }
    sec.style.display = '';
    const pos  = p.scenes[p.currentSceneIndex].positions[_selId] || { x: 0, y: 0, visible: true };
    document.getElementById('sel-name').value    = perf.name;
    document.getElementById('sel-color').value   = perf.color;
    document.getElementById('sel-type').value    = perf.type;
    document.getElementById('sel-visible').checked = pos.visible !== false;
    document.getElementById('sel-x').value       = pos.x.toFixed(2);
    document.getElementById('sel-y').value       = pos.y.toFixed(2);
  }

  function _syncStageInputs() {
    const p     = State.p;
    const idx   = p.currentSceneIndex;
    const scene = p.scenes[idx];
    document.getElementById('stage-width').value = p.stageDimensions.width;
    document.getElementById('stage-depth').value = p.stageDimensions.depth;

    const stEl = document.getElementById('scene-start-time');
    stEl.value    = (scene?.startTime ?? 0).toFixed(1);
    stEl.disabled = (idx === 0);
    stEl.title    = idx === 0 ? 'Scene 1 always starts at 0' : 'Music time when walking starts (seconds)';

    const walkEl = document.getElementById('scene-walk-dur');
    if (walkEl) walkEl.value = (sceneAnimDurMs(idx) / 1000).toFixed(1);
  }

  function _syncToggle(id, active) {
    document.getElementById(id).classList.toggle('active', !!active);
  }

  function _zoomCenter(factor) {
    const r = document.getElementById('stage-svg').getBoundingClientRect();
    Transform.zoomAt(factor, r.width / 2, r.height / 2);
  }

  function _on(id, event, handler) {
    document.getElementById(id)?.addEventListener(event, handler);
  }

  return {
    init,
    syncAll, syncCurrentScene, syncSceneSelect, syncPerformerList, syncSceneNote, syncZoomLabel, syncSelectedPos,
    selectPerformer,
    get selectedId() { return _selId; },
  };
})();

/* ============================================================
   NOTES PANEL  — resize + collapse
============================================================ */
const NotesPanel = (() => {
  const MIN_H    = 32;   // header-only (collapsed)
  const DEFAULT_H = 120;
  let _panel, _handle, _collapsed = false;
  let _dragStartY = 0, _dragStartH = 0;

  function init() {
    _panel  = document.getElementById('notes-panel');
    _handle = document.getElementById('notes-resize-handle');

    /* drag-to-resize */
    _handle.addEventListener('pointerdown', e => {
      e.preventDefault();
      _dragStartY = e.clientY;
      _dragStartH = _panel.offsetHeight;
      _handle.setPointerCapture(e.pointerId);
    });
    _handle.addEventListener('pointermove', e => {
      if (!e.buttons) return;
      const delta  = _dragStartY - e.clientY;   // drag up = grow
      const newH   = clamp(_dragStartH + delta, MIN_H, window.innerHeight * 0.55);
      _panel.style.height = newH + 'px';
      if (newH <= MIN_H + 4) _setCollapsed(true);
      else _setCollapsed(false);
    });

    /* toggle button */
    document.getElementById('btn-notes-toggle').addEventListener('click', () => {
      if (_collapsed) {
        _setCollapsed(false);
        _panel.style.height = DEFAULT_H + 'px';
      } else {
        _setCollapsed(true);
      }
    });
  }

  function _setCollapsed(yes) {
    _collapsed = yes;
    _panel.classList.toggle('collapsed', yes);
  }

  return { init };
})();

/* ============================================================
   MUSIC PLAYER  — load MP3, play/pause/seek, sync timeline
============================================================ */
const MusicPlayer = (() => {
  let _audio       = null;
  let _file        = null;  // original File reference (needed for ZIP export)
  let _rafId       = null;
  let _peaks       = null;  // Float32Array of downsampled peak amplitudes
  let _waveRo      = null;  // ResizeObserver for canvas redraws
  let _decodeToken = 0;     // monotonically incremented; used to discard stale decodes

  function init() {
    _audio = document.getElementById('music-audio');
    _audio.addEventListener('ended', _onEnded);

    document.getElementById('btn-music-load').addEventListener('click', () => {
      document.getElementById('music-file-input').click();
    });
    document.getElementById('music-file-input').addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) load(f);
      e.target.value = '';
    });
    document.getElementById('btn-music-play').addEventListener('click', togglePlay);

    const tl = document.getElementById('music-timeline');
    tl.addEventListener('pointerdown', _onTimelineDown);

    // Redraw waveform whenever the track changes size
    const canvas = document.getElementById('music-waveform');
    _waveRo = new ResizeObserver(() => _drawWaveform());
    _waveRo.observe(tl);
  }

  function load(file) {
    if (_audio.src && _audio.src.startsWith('blob:')) URL.revokeObjectURL(_audio.src);
    _file = file;
    _audio.src = URL.createObjectURL(file);
    document.getElementById('music-filename').textContent = file.name;
    document.getElementById('btn-music-play').disabled = false;

    _audio.addEventListener('loadedmetadata', () => {
      _onMetadataLoaded();
    }, { once: true });

    // Decode full PCM for waveform (async, does not block playback)
    _peaks = null;
    _drawWaveform(); // clear old waveform immediately
    _decodeWaveform(file);
  }

  function unload() {
    if (!_audio) return;
    if (!_audio.paused) _audio.pause();
    cancelAnimationFrame(_rafId);
    if (_audio.src && _audio.src.startsWith('blob:')) URL.revokeObjectURL(_audio.src);
    _audio.removeAttribute('src');
    try { _audio.load(); } catch (_) {}
    _file  = null;
    _peaks = null;
    _decodeToken++; // invalidate any in-flight decode
    const fnEl   = document.getElementById('music-filename');
    const playEl = document.getElementById('btn-music-play');
    const timeEl = document.getElementById('music-time');
    if (fnEl)   fnEl.textContent   = 'No music loaded';
    if (playEl) { playEl.textContent = '▶'; playEl.disabled = true; }
    if (timeEl) timeEl.textContent = '0:00 / 0:00';
    _drawWaveform();
    renderTimeline();
  }

  async function _decodeWaveform(file) {
    const myToken = ++_decodeToken;
    try {
      const arrayBuf  = await file.arrayBuffer();
      if (myToken !== _decodeToken) return; // a newer load superseded us
      const actx      = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuf  = await actx.decodeAudioData(arrayBuf);
      actx.close();   // free resources immediately after decoding
      if (myToken !== _decodeToken) return;

      // Use the first channel; downsample to a fixed resolution
      const raw       = audioBuf.getChannelData(0);
      const buckets   = 800; // ~1 bucket per ~pixel at typical widths
      const blockSize = Math.floor(raw.length / buckets);
      const peaks     = new Float32Array(buckets);
      for (let i = 0; i < buckets; i++) {
        let max = 0;
        const off = i * blockSize;
        for (let j = 0; j < blockSize; j++) {
          const v = Math.abs(raw[off + j]);
          if (v > max) max = v;
        }
        peaks[i] = max;
      }
      if (myToken !== _decodeToken) return;
      _peaks = peaks;
      _drawWaveform();
    } catch (e) {
      console.warn('Waveform decode failed:', e);
    }
  }

  function _drawWaveform() {
    const canvas = document.getElementById('music-waveform');
    if (!canvas) return;
    const tl = document.getElementById('music-timeline');
    // Sync canvas pixel dimensions to its CSS dimensions
    const W = tl.clientWidth  || canvas.offsetWidth  || 400;
    const H = tl.clientHeight || canvas.offsetHeight || 40;
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    if (!_peaks || !_peaks.length) return;

    const mid     = H / 2;
    const buckets = _peaks.length;

    // Filled waveform bars (accent color, semi-transparent)
    ctx.fillStyle = 'rgba(74,158,255,0.45)';
    for (let i = 0; i < buckets; i++) {
      const x    = (i / buckets) * W;
      const barW = Math.max(1, W / buckets - 0.5);
      const barH = _peaks[i] * mid * 0.92;
      ctx.fillRect(x, mid - barH, barW, barH * 2);
    }

    // Subtle center line
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(W, mid);
    ctx.stroke();
  }

  function _onMetadataLoaded() {
    const dur    = _audio.duration;
    const p      = State.p;
    // If multiple scenes all sit at startTime=0, distribute them evenly
    const needsDistrib = p.scenes.length > 1 &&
      p.scenes.every(s => s.startTime === 0);
    if (needsDistrib) {
      State.pushUndo();
      const slot = dur / p.scenes.length;
      p.scenes.forEach((s, i) => {
        s.startTime = i * slot;  // startTime is the primary field
      });
      Persistence.save();
      UI.syncAll();
    }
    _updateTimeDisplay();
    renderTimeline();
  }

  function togglePlay() {
    if (!_audio.src) return;
    const btn = document.getElementById('btn-music-play');
    if (_audio.paused) {
      // play() returns a Promise that may reject under autoplay policies;
      // only flip the UI to "playing" once it actually resolves.
      const result = _audio.play();
      if (result && typeof result.then === 'function') {
        result.then(() => {
          btn.textContent = '⏸';
          _startRaf();
        }).catch(err => {
          console.warn('Audio play() rejected:', err);
          btn.textContent = '▶';
        });
      } else {
        btn.textContent = '⏸';
        _startRaf();
      }
    } else {
      _audio.pause();
      btn.textContent = '▶';
      cancelAnimationFrame(_rafId);
    }
  }

  function seekTo(sec) {
    if (!_audio || !_audio.duration) return;
    _audio.currentTime = clamp(sec, 0, _audio.duration);
    _updateProgress();
    _syncSceneFromTime(_audio.currentTime);
  }

  function _startRaf() {
    _rafId = requestAnimationFrame(_rafTick);
  }

  function _rafTick() {
    if (!_audio.paused) {
      _updateProgress();
      _syncSceneFromTime(_audio.currentTime);
      _rafId = requestAnimationFrame(_rafTick);
    }
  }

  function _updateProgress() {
    const dur = _audio.duration || 1;
    const pct = (_audio.currentTime / dur) * 100;
    document.getElementById('music-progress-fill').style.width  = pct + '%';
    document.getElementById('music-thumb').style.left           = pct + '%';
    _updateTimeDisplay();
  }

  function _updateTimeDisplay() {
    const cur = _audio ? _audio.currentTime || 0 : 0;
    const dur = _audio ? _audio.duration    || 0 : 0;
    document.getElementById('music-time').textContent = `${_fmt(cur)} / ${_fmt(dur)}`;
  }

  function _fmt(s) {
    const m   = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  function _syncSceneFromTime(t) {
    const p      = State.p;
    const scenes = p.scenes;

    // Find which scene block t falls in
    let idx = 0;
    for (let i = scenes.length - 1; i >= 0; i--) {
      if (t >= scenes[i].startTime) { idx = i; break; }
    }

    const prevIdx = p.currentSceneIndex;
    if (idx !== prevIdx) {
      p.currentSceneIndex = idx;
      UI.syncCurrentScene(); // light-weight: scene selector, notes, timing, selected pos
    }

    // Calculate how far into this scene's transition we are
    const scene    = scenes[idx];
    const offset   = t - scene.startTime;          // seconds since scene[idx] started
    const animSec  = sceneAnimDurMs(idx) / 1000;

    if (idx > 0 && offset < animSec) {
      // --- In-transition: lerp from scene[idx-1] to scene[idx] ---
      const lerpT  = easeInOut(clamp(offset / animSec, 0, 1));
      const fromPos = scenes[idx - 1].positions;
      const toPos   = scene.positions;
      const interp  = {};
      for (const perf of p.performers) {
        const fr = fromPos[perf.id];
        const to = toPos[perf.id];
        if (fr && to) {
          interp[perf.id] = {
            x: lerp(fr.x, to.x, lerpT),
            y: lerp(fr.y, to.y, lerpT),
            visible: true,
          };
        } else if (to) {
          interp[perf.id] = { ...to };
        }
      }
      Renderer.renderPerformers(interp);
    } else {
      // --- Static: show current scene positions ---
      Renderer.renderPerformers();
    }
  }

  function renderTimeline() {
    const markers = document.getElementById('music-markers');
    if (!markers) return;
    markers.innerHTML = '';
    const dur = _audio?.duration || 0;
    if (!dur) return;

    const scenes = State.p.scenes;
    scenes.forEach((s, i) => {
      if (i === 0) return; // first scene always at start, no marker needed
      const pct    = clamp((s.startTime / dur) * 100, 0, 100);
      const marker = document.createElement('div');
      marker.className  = 'music-scene-marker';
      marker.style.left = pct + '%';
      marker.title      = `${s.name}  @${_fmt(s.startTime)}`;

      const lbl = document.createElement('div');
      lbl.className   = 'music-scene-label';
      lbl.textContent = s.name;
      marker.appendChild(lbl);
      markers.appendChild(marker);
    });

    _updateProgress();
  }

  /* ── Timeline click / drag to seek ── */
  function _onTimelineDown(e) {
    e.preventDefault();
    _seekFromPointer(e);
    const onMove = ev => _seekFromPointer(ev);
    const onUp   = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup',   onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup',   onUp);
  }

  function _seekFromPointer(e) {
    const tl  = document.getElementById('music-timeline');
    const r   = tl.getBoundingClientRect();
    const pct = clamp((e.clientX - r.left) / r.width, 0, 1);
    seekTo(pct * (_audio?.duration || 0));
  }

  function _onEnded() {
    document.getElementById('btn-music-play').textContent = '▶';
    cancelAnimationFrame(_rafId);
    _updateProgress();
  }

  return {
    init, load, unload, seekTo, renderTimeline, togglePlay,
    get file()  { return _file; },
    get audio() { return _audio; },
  };
})();

/* ============================================================
   PROJECT BUNDLE  — ZIP export (JSON + music + background)
============================================================ */
const ProjectBundle = (() => {

  async function exportZip() {
    if (typeof JSZip === 'undefined') {
      alert('JSZip library not loaded. Please check your internet connection.');
      return;
    }
    const zip = new JSZip();
    const p   = State.p;

    // project.json — strip backgroundImage (stored separately)
    const data = JSON.parse(JSON.stringify(p));
    const bg   = data.backgroundImage;
    data.backgroundImage = null;
    data._exportedAt     = new Date().toISOString();
    data._version        = 2;
    zip.file('project.json', JSON.stringify(data, null, 2));

    // music file — use the stored File object directly
    const musicFile = MusicPlayer.file;
    if (musicFile) {
      const ext = musicFile.name.match(/\.[^.]+$/)?.[0] ?? '.mp3';
      zip.file('music' + ext, musicFile);
    }

    // background image — convert dataURL → Blob, preserving the original format
    if (bg) {
      const mime = bg.match(/^data:([^;]+);/)?.[1] ?? 'image/png';
      const sub  = mime.split('/')[1] ?? 'png';
      const ext  = sub === 'jpeg' ? 'jpg' : sub;
      zip.file('background.' + ext, _dataURLToBlob(bg));
    }

    const blob = await zip.generateAsync({ type: 'blob',
      compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const a    = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.download = `stage-formation-bundle-${date}.zip`;
    a.href     = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function importZip(file) {
    if (typeof JSZip === 'undefined') {
      alert('JSZip library not loaded.');
      return;
    }
    let zip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch (e) {
      alert(`ZIP 读取失败 (read error): ${e.message}`);
      return;
    }

    // project.json
    const jsonEntry = zip.file('project.json');
    if (!jsonEntry) { alert('ZIP 中未找到 project.json (project.json not found in ZIP)'); return; }

    let parsed;
    try {
      parsed = JSON.parse(await jsonEntry.async('text'));
    } catch (e) {
      alert(`project.json 解析失败 (parse error): ${e.message}`);
      return;
    }

    if (!Array.isArray(parsed.scenes) || !parsed.scenes.length || !Array.isArray(parsed.performers)) {
      alert('project.json 格式无效 (invalid format)');
      return;
    }

    // Migrate defaults
    _migrate(parsed);

    // Background image — accept any common bitmap format
    const bgEntry = Object.values(zip.files).find(f =>
      !f.dir && /^background\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name)
    );
    if (bgEntry) {
      const bgBlob = await bgEntry.async('blob');
      parsed.backgroundImage = await _blobToDataURL(bgBlob);
    } else {
      parsed.backgroundImage = null;
    }

    // Music — find any audio file
    const musicEntry = Object.values(zip.files).find(f =>
      !f.dir && /\.(mp3|ogg|wav|aac|m4a|flac)$/i.test(f.name)
    );
    let musicFile = null;
    if (musicEntry) {
      const musicBlob = await musicEntry.async('blob');
      musicFile = new File([musicBlob], musicEntry.name, { type: _audioMime(musicEntry.name) });
    }

    // Replace project state BEFORE loading music, so the async
    // `loadedmetadata` handler reads the imported scenes (not the old ones).
    State.pushUndo();
    State.p = parsed;
    Persistence.save();
    Transform.fitToWindow();
    UI.syncAll();

    if (musicFile) MusicPlayer.load(musicFile);

    // Show success toast
    const banner = document.createElement('div');
    banner.className   = 'io-toast io-toast-ok';
    banner.textContent = `✓ 已导入：${parsed.scenes.length} 个场景，${parsed.performers.length} 名演员` +
                         (musicEntry ? '，含音乐' : '');
    document.getElementById('stage-area').appendChild(banner);
    setTimeout(() => banner.remove(), 3000);
  }

  const _AUDIO_MIME = {
    mp3: 'audio/mpeg', ogg: 'audio/ogg',  wav: 'audio/wav',
    m4a: 'audio/mp4',  aac: 'audio/aac',  flac: 'audio/flac',
  };
  function _audioMime(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    return _AUDIO_MIME[ext] ?? 'audio/mpeg';
  }

  function _migrate(parsed) {
    if (!parsed.settings)                         parsed.settings = {};
    if (parsed.settings.animDurationMs == null)   parsed.settings.animDurationMs = 3000;
    if (parsed.settings.gridVisible    == null)   parsed.settings.gridVisible    = true;
    if (parsed.settings.snapToGrid     == null)   parsed.settings.snapToGrid     = false;
    if (parsed.settings.gridSize       == null)   parsed.settings.gridSize       = 1;
    parsed.currentSceneIndex = clamp(parsed.currentSceneIndex ?? 0, 0, parsed.scenes.length - 1);
    let t = 0;
    for (const s of parsed.scenes) {
      if (s.note           == null) s.note           = '';
      if (s.animDurationMs == null) s.animDurationMs = parsed.settings.animDurationMs;
      if (s.startTime      == null) { s.startTime    = t; }
      t += s.animDurationMs / 1000;
    }
    for (const pf of parsed.performers) {
      const ti = TYPES[pf.type] || TYPES.child;
      if (pf.widthM  == null) pf.widthM  = ti.widthM;
      if (pf.heightM == null) pf.heightM = ti.heightM;
      if (!pf.type)           pf.type    = 'child';
    }
  }

  function _dataURLToBlob(dataUrl) {
    const [header, data] = dataUrl.split(',');
    const mime           = header.match(/:(.*?);/)[1];
    const bytes          = atob(data);
    const arr            = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function _blobToDataURL(blob) {
    return new Promise(res => {
      const fr = new FileReader();
      fr.onload = e => res(e.target.result);
      fr.readAsDataURL(blob);
    });
  }

  return { exportZip, importZip };
})();

/* ============================================================
   SHARE LOADER  — ?load=<url> read-only preview
============================================================ */
const ShareLoader = (() => {
  let _previewMode = false;

  function init() {
    const params  = new URLSearchParams(window.location.search);
    const loadUrl = params.get('load');
    if (!loadUrl) return;

    // Ensure the URL has a protocol (guard against missing https://)
    const fullUrl = /^https?:\/\//i.test(loadUrl) ? loadUrl : 'https://' + loadUrl;
    _showBanner('loading', '⏳', '正在加载共享项目… Loading shared project…');
    _fetchAndLoad(fullUrl);
  }

  async function _fetchAndLoad(url) {
    let data;
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
      data = await resp.json();
    } catch (e) {
      _showBanner('error', '⚠️', `加载失败 Failed to load: ${e.message}`);
      return;
    }

    // Basic validation
    if (!data || !Array.isArray(data.scenes) || !data.scenes.length || !Array.isArray(data.performers)) {
      _showBanner('error', '⚠️', '文件格式无效 Invalid project file format');
      return;
    }

    // Migration / fill defaults (mirrors importFromFile)
    if (!data.settings)                         data.settings = {};
    if (data.settings.animDurationMs == null)   data.settings.animDurationMs = 3000;
    if (data.settings.gridVisible    == null)   data.settings.gridVisible    = true;
    if (data.settings.snapToGrid     == null)   data.settings.snapToGrid     = false;
    if (data.settings.gridSize       == null)   data.settings.gridSize       = 1;
    data.backgroundImage     = null;
    data.currentSceneIndex   = clamp(data.currentSceneIndex ?? 0, 0, data.scenes.length - 1);
    for (const s  of data.scenes)     { if (s.note   == null) s.note   = ''; }
    for (const pf of data.performers) {
      const ti = TYPES[pf.type] || TYPES.child;
      if (pf.widthM  == null) pf.widthM  = ti.widthM;
      if (pf.heightM == null) pf.heightM = ti.heightM;
      if (!pf.type)           pf.type    = 'child';
    }

    // Load into State — do NOT call Persistence.save() so local work is untouched
    State.p = data;
    _previewMode = true;
    Transform.fitToWindow();   // also renders
    UI.syncAll();

    const name = data._projectName ?? url.split('/').pop().replace(/\.json$/i, '');
    _showBanner(
      'preview',
      '👁',
      `只读预览模式 Preview · <strong>${_esc(name)}</strong> · ${data.scenes.length} 场景 scenes, ${data.performers.length} 演员 performers`,
      [
        { id: 'preview-save-btn',  label: '💾 保存到本地 Save locally' },
        { id: 'preview-exit-btn',  label: '✕ 退出 Exit' },
      ]
    );

    document.getElementById('preview-save-btn')?.addEventListener('click', () => {
      Persistence.save();
      _showBanner('ok', '✓', '已保存到本地 Saved to local storage — <a href="?" style="color:inherit;text-decoration:underline">退出预览 Exit preview →</a>');
      _previewMode = false;
    });
    document.getElementById('preview-exit-btn')?.addEventListener('click', () => {
      window.location.href = window.location.pathname;
    });
  }

  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function _showBanner(type, icon, html, actions = []) {
    const el = document.getElementById('share-banner');
    if (!el) return;
    el.className = `banner-${type}`;
    el.innerHTML =
      `<span class="banner-icon">${icon}</span>` +
      `<span class="banner-text">${html}</span>` +
      (actions.length
        ? `<span class="banner-actions">${actions.map(a =>
            `<button id="${a.id}" class="${a.id.replace('-btn','')}-btn">${a.label}</button>`
          ).join('')}</span>`
        : '');
  }

  return {
    init,
    get isPreview() { return _previewMode; },
  };
})();

/* ============================================================
   BOOTSTRAP
============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  UI.init();
  NotesPanel.init();
  MusicPlayer.init();
  ShareLoader.init();
});
