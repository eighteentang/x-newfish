(function initBoardPosition(global) {
  'use strict';

  const clamp = (value, max = 1) => Math.min(max, Math.max(0, value));
  const ratio = (value, fallback) => Number.isFinite(value) ? clamp(value) : fallback;

  function attach(board, { handle, toggle, body, save }) {
    let position = null;
    let dock = { edge: 'right', y: 0.25 };
    let collapsed = false;
    let received = {};
    let initialized = false;
    let drag = null;
    let suppressClickUntil = 0;

    const viewport = () => ({ width: Math.max(1, global.innerWidth), height: Math.max(1, global.innerHeight) });
    const limits = () => {
      const { width, height } = viewport();
      return { x: Math.max(0, width - board.offsetWidth), y: Math.max(0, height - board.offsetHeight) };
    };
    const setPixels = (x, y) => {
      const limit = limits();
      board.style.left = `${clamp(x, limit.x)}px`;
      board.style.top = `${clamp(y, limit.y)}px`;
      board.style.right = 'auto';
    };
    const currentPosition = () => {
      const rect = board.getBoundingClientRect();
      const limit = limits();
      return { x: limit.x ? clamp(rect.left / limit.x) : 0, y: limit.y ? clamp(rect.top / limit.y) : 0 };
    };
    function paint() {
      board.classList.toggle('xa-board-collapsed', collapsed);
      body.hidden = collapsed;
      toggle.textContent = collapsed ? (dock.edge === 'left' ? '›' : '‹') : '收起';
      toggle.title = collapsed ? '展开榜单（可上下拖动）' : '收起到屏幕边缘';
      toggle.setAttribute('aria-label', collapsed ? '展开榜单' : '收起榜单');
      toggle.setAttribute('aria-expanded', String(!collapsed));
      const limit = limits();
      if (collapsed) setPixels(dock.edge === 'left' ? 0 : limit.x, dock.y * limit.y);
      else if (position) setPixels(position.x * limit.x, position.y * limit.y);
      else setPixels(Math.max(0, limit.x - 14), Math.min(88, limit.y));
    }
    const persist = () => save({
      leaderboardPosition: position,
      leaderboardDock: { ...dock },
      leaderboardCollapsed: collapsed
    });

    function finish(event, cancel = false) {
      if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.id)) return;
      const active = drag;
      drag = null;
      if (active.moved) {
        if (active.target === toggle) suppressClickUntil = Date.now() + 500;
        if (!cancel) {
          if (collapsed) dock.y = currentPosition().y;
          else position = currentPosition();
          persist();
        }
      }
      board.classList.remove('xa-board-dragging');
      if (active.target.hasPointerCapture?.(active.id)) active.target.releasePointerCapture(active.id);
      paint();
    }

    function start(event) {
      if (drag || event.button !== 0 || event.isPrimary === false) return;
      const target = event.target;
      if (collapsed ? !toggle.contains(target) : target.closest('button,select,a,input,textarea,[contenteditable="true"]')) return;
      const rect = board.getBoundingClientRect();
      // Keep a docked button's click target on the button after capture ends.
      drag = { id: event.pointerId, target: collapsed ? toggle : event.currentTarget, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
      try { drag.target.setPointerCapture(event.pointerId); } catch (_) { drag = null; }
    }
    function move(event) {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && (collapsed ? Math.abs(dy) : Math.hypot(dx, dy)) < 5) return;
      drag.moved = true;
      event.preventDefault();
      board.classList.add('xa-board-dragging');
      setPixels(collapsed ? drag.left : drag.left + dx, drag.top + dy);
    }
    handle.addEventListener('pointerdown', start);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', (event) => finish(event));
    handle.addEventListener('pointercancel', (event) => finish(event, true));
    handle.addEventListener('lostpointercapture', (event) => finish(event, true));
    global.addEventListener('blur', () => finish(null, true));
    global.addEventListener('resize', () => {
      if (drag) finish(null, true);
      paint();
    });
    toggle.addEventListener('click', (event) => {
      if (Date.now() < suppressClickUntil && event.detail !== 0) {
        event.preventDefault();
        return;
      }
      if (!collapsed) {
        const rect = board.getBoundingClientRect();
        position = currentPosition();
        const { width, height } = viewport();
        dock = { edge: rect.left + rect.width / 2 < width / 2 ? 'left' : 'right', y: height > 36 ? clamp(rect.top / (height - 36)) : 0 };
      }
      collapsed = !collapsed;
      paint();
      persist();
    });
    // Content updates can change the panel height without a window resize.
    if (global.ResizeObserver) new global.ResizeObserver(() => { if (!drag) paint(); }).observe(board);

    return {
      update(settings) {
        const next = {
          position: JSON.stringify(settings.leaderboardPosition ?? null),
          dock: JSON.stringify(settings.leaderboardDock ?? null),
          collapsed: Boolean(settings.leaderboardCollapsed)
        };
        if (drag) return;
        if (!initialized || next.position !== received.position) {
          const value = settings.leaderboardPosition;
          position = value && Number.isFinite(value.x) && Number.isFinite(value.y) ? { x: ratio(value.x, 1), y: ratio(value.y, 0) } : null;
        }
        if (!initialized || next.dock !== received.dock) {
          const value = settings.leaderboardDock;
          dock = { edge: value?.edge === 'left' ? 'left' : 'right', y: ratio(value?.y, 0.25) };
        }
        if (!initialized || next.collapsed !== received.collapsed) collapsed = next.collapsed;
        received = next;
        initialized = true;
        paint();
      },
      reset() {
        finish(null, true);
        position = null;
        dock = { edge: 'right', y: 0.25 };
        collapsed = false;
        paint();
        persist();
      }
    };
  }

  global.XA_BOARD_POSITION = { attach };
})(typeof globalThis !== 'undefined' ? globalThis : this);
