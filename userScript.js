/*
 * Cinemana Remote — TizenBrew site-modification module
 * Makes the normal Cinemana website (https://cinemana.shabakaty.cc) usable
 * with a Samsung TV remote:
 *   - arrows move a visible focus ring between clickable things (spatial nav)
 *   - carousels slide automatically when you move past their edge
 *   - OK clicks; text fields open the TV keyboard
 *   - BACK closes dialogs / leaves fullscreen / goes to the previous page
 *   - on the video: OK = play/pause (first OK = fullscreen), ←/→ = seek
 *   - Play/Pause/Stop/FF/Rewind keys control the player anywhere
 * Tenon — Abdullah Ali.
 */
(function () {
  'use strict';
  if (window.__cinemanaRemote) return;
  window.__cinemanaRemote = true;
  window.__cr = { cur: function () { return current; }, log: [] };

  var K = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, ESC: 27,
            PLAYPAUSE: 10252, PLAY: 415, PAUSE: 19, STOP: 413, FF: 417, RW: 412 };
  var SEEK_SMALL = 10, SEEK_BIG = 30;

  /* ----------------------------------------------------------- helpers */

  var VW = function () { return window.innerWidth; };
  var VH = function () { return window.innerHeight; };

  function rectOf(el) { return el.getBoundingClientRect(); }
  function center(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  function isShown(el, r) {
    if (r.width < 6 || r.height < 6) return false;
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    // something else covering it entirely (e.g. behind a dialog)?
    var c = center(r);
    if (c.x >= 0 && c.x < VW() && c.y >= 0 && c.y < VH()) {
      var top = document.elementFromPoint(c.x, c.y);
      if (top && top !== el && !el.contains(top) && !top.contains(el) && !isOurs(top)) {
        // allow if the covering element is itself inside the same clickable tile
        var ov = overlayRoot();
        if (ov && !ov.contains(el)) return false;
      }
    }
    return true;
  }

  function isOurs(el) { return el && el.id && el.id.indexOf('cr-') === 0; }

  // Angular Material dialogs/menus live in .cdk-overlay-container; when one is
  // open, only its content is navigable.
  function overlayRoot() {
    var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) return fsEl;
    var panes = document.querySelectorAll('.cdk-overlay-container .cdk-overlay-pane, .mat-dialog-container, [role=dialog]');
    for (var i = panes.length - 1; i >= 0; i--) {
      var r = rectOf(panes[i]);
      if (r.width > 20 && r.height > 20) return panes[i];
    }
    return null;
  }

  var SELECTOR = 'a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=menuitem], [role=tab], [role=option], [tabindex]:not([tabindex="-1"]), mat-option, .mat-tab-label, .vjs-control, .video-js';

  function isClickable(el) {
    if (el.matches && el.matches(SELECTOR)) return true;
    var cs = getComputedStyle(el);
    if (cs.cursor !== 'pointer') return false;
    // only the outermost pointer element of a group counts
    var p = el.parentElement;
    return !(p && getComputedStyle(p).cursor === 'pointer');
  }

  // candidates: clickable, visible, not disabled; may be slightly off-screen
  // horizontally (carousel items) but we mark those as offscreen.
  function candidates() {
    var root = overlayRoot() || document.body;
    var all = root.querySelectorAll('*');
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (isOurs(el) || el.disabled) continue;
      if (el.matches && el.matches('.vjs-time-control, .vjs-time-control *, .vjs-live-control')) continue;
      if (el.closest && el.closest('#cr-hud')) continue;
      var r = rectOf(el);
      if (r.bottom < -VH() * 2 || r.top > VH() * 3) continue;       // far away vertically
      if (r.width < 6 || r.height < 6) continue;
      if (!isClickable(el)) continue;
      // skip a clickable that contains exactly one other clickable (use the inner one)
      var cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      var off = r.right < 0 || r.left > VW();
      out.push({ el: el, r: r, off: off });
    }
    // de-duplicate nested clickables: a poster tile is ONE stop for the
    // remote, even if it contains its own little buttons. Large containers
    // (hero banner, page sections) don't swallow their children.
    var maxTile = VW() * VH() * 0.25;
    return out.filter(function (c) {
      for (var j = 0; j < out.length; j++) {
        var o = out[j];
        if (o !== c && o.el.contains(c.el) && o.r.width * o.r.height < maxTile) return false;
      }
      return true;
    });
  }

  /* ------------------------------------------------------- focus ring */

  var ring = document.createElement('div');
  ring.id = 'cr-ring';
  ring.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:4px solid #ff2d55;' +
    'border-radius:10px;box-shadow:0 0 0 3px rgba(0,0,0,.55),0 0 24px rgba(255,45,85,.75);' +
    'transition:all .12s ease-out;display:none';
  var toastEl = document.createElement('div');
  toastEl.id = 'cr-toast';
  toastEl.style.cssText = 'position:fixed;z-index:2147483647;left:50%;bottom:60px;transform:translateX(-50%);' +
    'background:rgba(15,15,22,.92);color:#fff;font:600 26px/1.3 Tahoma,Arial,sans-serif;padding:16px 34px;' +
    'border-radius:40px;opacity:0;transition:opacity .2s;pointer-events:none;white-space:nowrap';
  function mount() {
    var host = document.fullscreenElement || document.webkitFullscreenElement || document.documentElement;
    if (ring.parentNode !== host) host.appendChild(ring);
    if (toastEl.parentNode !== host) host.appendChild(toastEl);
  }
  var toastTimer;
  function toast(msg, ms) {
    mount(); toastEl.textContent = msg; toastEl.style.opacity = '1';
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.style.opacity = '0'; }, ms || 1500);
  }

  var current = null, lastPoint = { x: VW() * 0.8, y: VH() * 0.3 };

  function drawRing() {
    mount();
    if (!current || !document.contains(current)) { ring.style.display = 'none'; return; }
    if ((document.fullscreenElement || document.webkitFullscreenElement) && current.classList.contains('video-js')) { ring.style.display = 'none'; return; }
    var r = rectOf(current);
    if (r.width === 0) { ring.style.display = 'none'; return; }
    ring.style.display = 'block';
    ring.style.left = (r.left - 5) + 'px'; ring.style.top = (r.top - 5) + 'px';
    ring.style.width = (r.width + 2) + 'px'; ring.style.height = (r.height + 2) + 'px';
  }
  (function loop() { drawRing(); requestAnimationFrame(loop); })();

  function hover(el) {
    var r = rectOf(el), c = center(r);
    var t = document.elementFromPoint(Math.min(Math.max(c.x, 1), VW() - 1), Math.min(Math.max(c.y, 1), VH() - 1)) || el;
    ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove'].forEach(function (type) {
      try {
        var E = type.indexOf('pointer') === 0 && window.PointerEvent ? PointerEvent : MouseEvent;
        t.dispatchEvent(new E(type, { bubbles: type.indexOf('enter') < 0, cancelable: true, clientX: c.x, clientY: c.y, view: window }));
      } catch (e) {}
    });
  }
  function unhover(el) {
    try { el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false })); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); } catch (e) {}
  }

  function setFocus(el, opts) {
    if (!el) return;
    if (current && current !== el) unhover(current);
    current = el;
    mount();
    var r = rectOf(el);
    // keep the focused thing comfortably on screen (vertical scrolling)
    if (!(opts && opts.noScroll) && (r.top < 70 || r.bottom > VH() - 40)) {
      try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }); }
      catch (e) { el.scrollIntoView(false); }
    }
    r = rectOf(el);
    lastPoint = center(r);
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) { /* focus only on OK */ }
    else { try { el.focus({ preventScroll: true }); } catch (e) {} }
    drawRing();
  }

  // Angular often re-renders a button (same place, new element). Pick the
  // element now sitting where our focus was, so focus is never "lost".
  function reacquire() {
    if (current && document.contains(current)) return current;
    var list = candidates(), bestC = null, d = 60;
    for (var i = 0; i < list.length; i++) {
      var cc = center(list[i].r), dd = Math.abs(cc.x - lastPoint.x) + Math.abs(cc.y - lastPoint.y);
      if (dd < d) { d = dd; bestC = list[i]; }
    }
    if (bestC) { current = bestC.el; drawRing(); }
    return bestC ? bestC.el : null;
  }

  /* --------------------------------------------------- spatial search */

  function score(dir, from, to) {
    var a = from, b = to;
    var ac = center(a), bc = center(b);
    var primary, ortho;
    if (dir === 'left') { if (b.right > a.left + 2 && bc.x >= ac.x - 2) return -1; primary = a.left - b.right; ortho = overlapGap(a.top, a.bottom, b.top, b.bottom); }
    if (dir === 'right') { if (b.left < a.right - 2 && bc.x <= ac.x + 2) return -1; primary = b.left - a.right; ortho = overlapGap(a.top, a.bottom, b.top, b.bottom); }
    if (dir === 'up') { if (b.bottom > a.top + 2 && bc.y >= ac.y - 2) return -1; primary = a.top - b.bottom; ortho = overlapGap(a.left, a.right, b.left, b.right); }
    if (dir === 'down') { if (b.top < a.bottom - 2 && bc.y <= ac.y + 2) return -1; primary = b.top - a.bottom; ortho = overlapGap(a.left, a.right, b.left, b.right); }
    primary = Math.max(primary, 0);
    // strongly prefer things in the same row/column
    return primary + ortho * (ortho > 0 ? 4 : 0) + (ortho > 0 ? 300 : 0);
  }
  function overlapGap(a1, a2, b1, b2) { // 0 when ranges overlap, otherwise the gap
    if (b2 < a1) return a1 - b2;
    if (b1 > a2) return b1 - a2;
    return 0;
  }

  function best(dir, list, fromRect) {
    var bestC = null, bestS = Infinity;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.el === current) continue;
      var s = score(dir, fromRect, c.r);
      if (s >= 0 && s < bestS) { bestS = s; bestC = c; }
    }
    return bestC;
  }

  function carouselOf(el) {
    return el && el.closest ? el.closest('.ngucarousel, .keen-slider, .big-carousel-container, [class*=carousel], [class*=slider]') : null;
  }

  // find the carousel's own arrow that moves content towards `dir`
  function carouselArrow(car, dir) {
    if (!car) return null;
    var host = car.closest('.ngucarousel') || car.closest('[class*=carousel]') || car;
    var scope = host.parentElement || host;
    var arrows = scope.querySelectorAll('button.leftRs, button.rightRs, .arrow, [class*=arrow], [class*=next], [class*=prev]');
    var hr = rectOf(host), pick = null, bestX = dir === 'left' ? Infinity : -Infinity;
    for (var i = 0; i < arrows.length; i++) {
      var r = rectOf(arrows[i]);
      if (r.width === 0 || r.bottom < hr.top - 20 || r.top > hr.bottom + 20) continue;
      var cx = r.left + r.width / 2;
      if (dir === 'left' && cx < bestX) { bestX = cx; pick = arrows[i]; }
      if (dir === 'right' && cx > bestX) { bestX = cx; pick = arrows[i]; }
    }
    if (!pick) return null;
    var pc = rectOf(pick).left + rectOf(pick).width / 2;
    if (dir === 'left' && pc > hr.left + hr.width / 2) return null;
    if (dir === 'right' && pc < hr.left + hr.width / 2) return null;
    return pick;
  }

  // the main action of a page gets the focus first
  var PRIMARY = ['.video-js', 'button.watch-button', '.watch-button', 'button[class*=watch]'];
  function primaryTarget(list) {
    for (var i = 0; i < PRIMARY.length; i++) {
      for (var j = 0; j < list.length; j++) {
        var c = list[j];
        if (!c.off && c.r.top >= 0 && c.r.bottom <= VH() && c.el.matches(PRIMARY[i])) return c;
      }
    }
    return null;
  }

  var busy = false;
  function move(dir, initial) {
    if (busy) return;
    var list = candidates();
    if (initial) { var pt = primaryTarget(list); if (pt) { setFocus(pt.el, { noScroll: true }); return true; } }
    if (current && !document.contains(current)) reacquire();
    if (!current || !document.contains(current)) {
      // (re)start from the element nearest to where we were
      var near = null, d = Infinity;
      list.forEach(function (c) {
        if (c.off) return;
        var cc = center(c.r), dd = Math.abs(cc.x - lastPoint.x) + Math.abs(cc.y - lastPoint.y);
        if (dd < d) { d = dd; near = c; }
      });
      if (near) setFocus(near.el);
      return !!near;
    }
    var from = rectOf(current);
    var onScreen = list.filter(function (c) { return !c.off; });
    var target = best(dir, onScreen, from);

    if ((dir === 'left' || dir === 'right')) {
      // moving inside a carousel row past its visible edge → slide the carousel
      var car = carouselOf(current);
      var sameRow = function (c) { return c && overlapGap(from.top, from.bottom, c.r.top, c.r.bottom) === 0; };
      var offInRow = list.filter(function (c) { return c.off && carouselOf(c.el) === car && sameRow(c) && score(dir, from, c.r) >= 0; });
      if (car && (!target || !sameRow(target) || carouselOf(target.el) !== car) && offInRow.length) {
        var arrow = carouselArrow(car, dir);
        busy = true;
        if (arrow) activate(arrow, true);
        else { try { offInRow[0].el.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (e) {} }
        setTimeout(function () {
          busy = false;
          var l2 = candidates().filter(function (c) { return !c.off; });
          var t2 = best(dir, l2, rectOf(current));
          if (t2 && overlapGap(rectOf(current).top, rectOf(current).bottom, t2.r.top, t2.r.bottom) === 0) setFocus(t2.el, { noScroll: true });
        }, 450);
        return true;
      }
    }

    if (target) { setFocus(target.el); return true; }
    if (inFullscreen()) return false;

    // nothing further that way: scroll the page to reveal more (lazy rows)
    if (dir === 'down' || dir === 'up') {
      scrollPage(dir === 'down' ? 1 : -1);
      setTimeout(function () {
        var t3 = best(dir, candidates().filter(function (c) { return !c.off; }), rectOf(current));
        if (t3) setFocus(t3.el);
      }, 350);
    }
  }

  function scrollPage(sign) {
    var amount = VH() * 0.6 * sign;
    // scroll the innermost scrollable ancestor of the current element, else the window
    var el = current;
    while (el && el !== document.body) {
      var cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 5) { el.scrollBy({ top: amount, behavior: 'smooth' }); return; }
      el = el.parentElement;
    }
    window.scrollBy({ top: amount, behavior: 'smooth' });
  }

  /* --------------------------------------------------------- activate */

  function activate(el, quiet) {
    if (!el) return;
    if (/^(INPUT|TEXTAREA)$/.test(el.tagName) && !/^(checkbox|radio|button|submit)$/i.test(el.type)) {
      el.focus(); try { el.click(); } catch (e) {} return; // TV keyboard opens
    }
    if (el.tagName === 'SELECT') { el.focus(); return; }
    // Cinemana poster tiles: the element that actually opens the title is the
    // mask over the poster (or the title text), not the tile itself.
    var inner = el.querySelector && (el.querySelector('.video-image-mask') || el.querySelector('.title-container'));
    if (inner) { inner.click(); flash(quiet); return; }
    var r = rectOf(el), c = center(r);
    var x = Math.min(Math.max(c.x, 1), VW() - 1), y = Math.min(Math.max(c.y, 1), VH() - 1);
    var t = document.elementFromPoint(x, y);
    if (!t || !(el === t || el.contains(t) || t.contains(el))) t = el;
    var o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, view: window };
    var seq = [['pointerover', 0], ['mouseover', 0], ['pointerenter', 0], ['mouseenter', 0], ['pointermove', 0], ['mousemove', 0],
               ['pointerdown', 1], ['mousedown', 1], ['pointerup', 0], ['mouseup', 0]];
    seq.forEach(function (s) {
      try {
        var E = s[0].indexOf('pointer') === 0 && window.PointerEvent ? PointerEvent : MouseEvent;
        var init = Object.assign({}, o, { buttons: s[1], pointerType: 'mouse', isPrimary: true, pointerId: 1 });
        t.dispatchEvent(new E(s[0], init));
      } catch (e) {}
    });
    try { t.click(); } catch (e) { t.dispatchEvent(new MouseEvent('click', o)); }
    flash(quiet);
  }
  function flash(quiet) {
    if (quiet) return;
    ring.style.borderColor = '#ffffff';
    setTimeout(function () { ring.style.borderColor = '#ff2d55'; }, 150);
  }

  /* ----------------------------------------------------------- player */

  function vjsPlayer() {
    try { if (window.videojs) { var ps = window.videojs.getPlayers ? window.videojs.getPlayers() : null; for (var k in ps) if (ps[k]) return ps[k]; } } catch (e) {}
    return null;
  }
  function videoEl() { return document.querySelector('video'); }
  function inFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement || (vjsPlayer() && vjsPlayer().isFullscreen && vjsPlayer().isFullscreen())); }
  function focusIsVideo() { return current && (current.classList.contains('video-js') || (current.closest && current.closest('.video-js') && current.classList.contains('vjs-tech'))); }

  function togglePlay() {
    var p = vjsPlayer(), v = videoEl();
    if (p) { p.paused() ? p.play() : p.pause(); }
    else if (v) { v.paused ? v.play() : v.pause(); }
    toast(isPaused() ? '❚❚' : '▶', 700);
  }
  function isPaused() { var p = vjsPlayer(), v = videoEl(); return p ? p.paused() : (v ? v.paused : true); }
  function seek(sec) {
    var p = vjsPlayer(), v = videoEl();
    try {
      var t = (p ? p.currentTime() : v.currentTime) + sec;
      var d = p ? p.duration() : v.duration;
      t = Math.max(0, d ? Math.min(t, d - 1) : t);
      p ? p.currentTime(t) : (v.currentTime = t);
      if (p && p.userActive) p.userActive(true);
      toast((sec > 0 ? '⏩ +' : '⏪ ') + sec + 's  ' + fmt(t) + (d ? ' / ' + fmt(d) : ''), 1100);
    } catch (e) {}
  }
  function fmt(s) { s = Math.floor(s); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x; }
  function keepControls() { var p = vjsPlayer(); try { if (p && p.userActive) p.userActive(true); } catch (e) {} }
  function videoMode() { var box = document.querySelector('.video-js'); if (box) { current = box; drawRing(); } }
  function controlMode() {
    keepControls();
    setTimeout(function () {
      var b = document.querySelector('.vjs-control-bar .vjs-play-control') || document.querySelector('.vjs-control-bar .vjs-control');
      if (b) setFocus(b, { noScroll: true });
    }, 60);
  }
  function enterFullscreen() {
    var p = vjsPlayer();
    try { if (p && p.requestFullscreen) { p.requestFullscreen(); return; } } catch (e) {}
    var box = document.querySelector('.video-js') || videoEl();
    try { (box.requestFullscreen || box.webkitRequestFullscreen).call(box); } catch (e) {}
  }
  function exitFullscreen() {
    var p = vjsPlayer();
    try { if (p && p.isFullscreen && p.isFullscreen()) { p.exitFullscreen(); return; } } catch (e) {}
    try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) {}
  }

  /* ------------------------------------------------------------- back */

  function closeOverlay() {
    var ov = overlayRoot();
    if (!ov) return false;
    // Escape is what Material dialogs/menus listen to
    ['keydown', 'keyup'].forEach(function (type) {
      var e = new KeyboardEvent(type, { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
      try { Object.defineProperty(e, 'keyCode', { get: function () { return 27; } }); } catch (x) {}
      document.activeElement && document.activeElement.dispatchEvent(e);
      document.dispatchEvent(e);
    });
    setTimeout(function () {
      if (overlayRoot()) { var bd = document.querySelector('.cdk-overlay-backdrop'); if (bd) activate(bd, true); }
    }, 120);
    return true;
  }

  var lastBack = 0;
  function back() {
    var ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName)) { ae.blur(); return; }
    if (inFullscreen()) { exitFullscreen(); return; }
    if (closeOverlay()) return;
    var path = location.pathname;
    if (path === '/' || path === '/home' || path === '/landing') {
      var now = Date.now();
      if (now - lastBack < 2000) { try { tizen.application.getCurrentApplication().exit(); } catch (e) { history.back(); } return; }
      lastBack = now; toast('اضغط رجوع مرة أخرى للخروج'); return;
    }
    history.back();
  }

  /* ------------------------------------------------------------- keys */

  document.addEventListener('keydown', function (e) {
    var c = e.keyCode;
    var ae = document.activeElement;
    var typing = ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName) && !/^(checkbox|radio)$/i.test(ae.type);

    // global media keys
    if (c === K.PLAYPAUSE || c === K.PLAY || c === K.PAUSE || c === K.STOP || c === K.FF || c === K.RW) {
      if (!videoEl()) return;
      e.preventDefault(); e.stopPropagation();
      if (c === K.PLAYPAUSE) togglePlay();
      else if (c === K.PLAY) { if (isPaused()) togglePlay(); }
      else if (c === K.PAUSE) { if (!isPaused()) togglePlay(); }
      else if (c === K.STOP) { if (!isPaused()) togglePlay(); exitFullscreen(); }
      else if (c === K.FF) seek(SEEK_BIG);
      else if (c === K.RW) seek(-SEEK_SMALL);
      return;
    }

    if (c === K.BACK || (c === K.ESC && !typing)) { e.preventDefault(); e.stopPropagation(); back(); return; }

    // while the TV keyboard/text field is active, let arrows edit text
    // except UP/DOWN which leave the field
    if (typing) {
      if (c === K.UP || c === K.DOWN) { ae.blur(); e.preventDefault(); move(c === K.UP ? 'up' : 'down'); }
      else if (c === K.ENTER) { /* submit naturally */ }
      return;
    }

    // ---- player ----
    var fs = inFullscreen();
    var inBar = fs && current && current.closest && current.closest('.vjs-control-bar, .vjs-menu, .vjs-menu-content');
    var stop = function () { e.preventDefault(); e.stopPropagation(); };
    if (inBar) {                                     // moving around the player's own buttons
      keepControls();
      if (c === K.ENTER) { stop(); activate(current, true); keepControls(); return; }
      if ((c === K.LEFT || c === K.RIGHT) && current.closest('.vjs-progress-control')) { stop(); seek(c === K.RIGHT ? SEEK_BIG : -SEEK_BIG); return; }
      var d2 = c === K.LEFT ? 'left' : c === K.RIGHT ? 'right' : c === K.UP ? 'up' : c === K.DOWN ? 'down' : null;
      if (d2) { stop(); if (!move(d2) && d2 === 'up') videoMode(); return; }
    } else if (fs || focusIsVideo()) {               // the picture itself
      if (c === K.ENTER) { stop(); if (!fs) { enterFullscreen(); if (isPaused()) togglePlay(); } else togglePlay(); return; }
      if (c === K.LEFT || c === K.RIGHT) { stop(); seek(c === K.RIGHT ? SEEK_SMALL : -SEEK_SMALL); return; }
      if (fs && c === K.DOWN) { stop(); controlMode(); return; }
      if (fs && c === K.UP) { stop(); keepControls(); return; }
    }

    var dir = c === K.LEFT ? 'left' : c === K.RIGHT ? 'right' : c === K.UP ? 'up' : c === K.DOWN ? 'down' : null;
    if (dir) { e.preventDefault(); e.stopPropagation(); move(dir); return; }
    if (c === K.ENTER) {
      if (!reacquire()) { e.preventDefault(); move('down', true); return; }
      e.preventDefault(); e.stopPropagation();
      if (current.classList.contains('video-js')) { enterFullscreen(); if (isPaused()) togglePlay(); return; }
      activate(current);
    }
  }, true);

  // After a page change, wait for the page's main action (player / watch
  // button) to appear and focus it; fall back to the nearest item.
  var initTimer = null;
  function initialFocus() {
    clearInterval(initTimer);
    var tries = 0;
    initTimer = setInterval(function () {
      tries++;
      if (current && document.contains(current)) { clearInterval(initTimer); return; }
      var pt = primaryTarget(candidates());
      if (pt) { setFocus(pt.el, { noScroll: true }); clearInterval(initTimer); return; }
      if (tries >= 14) { clearInterval(initTimer); if (!current) move('down'); }
    }, 300);
  }

  /* ------------------------------------------ site-specific preparation */

  // The site sends TV browsers to its old TV page or to a "choose" page.
  // Remember "web" for a year so it stays on the normal site.
  try {
    var yearAhead = new Date(Date.now() + 365 * 864e5).toISOString();
    var cur = JSON.parse(localStorage.getItem('redirectTo') || 'null');
    if (!cur || cur.to !== 'web') localStorage.setItem('redirectTo', JSON.stringify({ to: 'web', valid: yearAhead }));
  } catch (e) {}

  function routeTo(path) {
    try { history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate', { state: {} })); } catch (e) { location.href = path; }
  }
  // On TVs the site always sends you to its sign-in page (/landing) when it
  // starts. Right after the app opens, go straight to the home page instead;
  // signing in is still available from the header button on the home page.
  var startedAt = Date.now();
  function fixStartPage() {
    var p = location.pathname;
    if (/^\/(redirect|CTV)/i.test(p)) { routeTo('/home'); return; }
    if (p === '/landing' && Date.now() - startedAt < 15000) routeTo('/home');
  }
  setTimeout(fixStartPage, 800);
  setTimeout(fixStartPage, 2500);

  // When the page changes (Angular route), drop the stale focus and start again
  var lastPath = location.pathname + location.search;
  setInterval(function () {
    if (location.pathname + location.search !== lastPath) {
      lastPath = location.pathname + location.search;
      current = null;
      lastPoint = { x: VW() * 0.6, y: VH() * 0.45 }; // fallback: middle of the content
      initialFocus();
      fixStartPage();
    }
    if (current && !document.contains(current)) { current = null; reacquire(); }
  }, 400);

  // TizenBrew registers keys from package.json; register again in case
  try {
    ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind']
      .forEach(function (k) { try { tizen.tvinputdevice.registerKey(k); } catch (e) {} });
  } catch (e) {}

  // keep the screen awake while a video plays
  function screenSaver(on) {
    try { var ac = webapis.appcommon; ac.setScreenSaver(on ? ac.AppCommonScreenSaverState.SCREEN_SAVER_ON : ac.AppCommonScreenSaverState.SCREEN_SAVER_OFF); } catch (e) {}
  }
  document.addEventListener('playing', function () {
    screenSaver(false);
    window.__cr.log.push('playing ' + Date.now());
    // when a video starts, put the focus on the player so OK = fullscreen
    var box = document.querySelector('.video-js');
    if (box && !inFullscreen() && !(current && current.closest && current.closest('.video-js'))) {
      setTimeout(function () { setFocus(box, { noScroll: false }); }, 300);
    }
  }, true);
  document.addEventListener('pause', function () { screenSaver(true); }, true);

  // first focus once the page has content
  initialFocus();
  toast('Cinemana — التحكم بالريموت جاهز', 2000);
})();
