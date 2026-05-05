/**
 * rain.js
 * Canvas-based animated rain effect layered over the CSS background.
 * Used when the "Rain" wallpaper mode is selected.
 */
const Rain = (() => {
  'use strict';

  let canvas  = null;
  let ctx     = null;
  let drops   = [];
  let raf     = null;
  const COUNT = 140;

  function start() {
    stop();
    const host = document.getElementById('rain-canvas-host');
    if (!host) return;

    canvas           = document.createElement('canvas');
    canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    host.appendChild(canvas);

    ctx = canvas.getContext('2d');
    _resize();
    window.addEventListener('resize', _resize);
    _init();
    _frame();
  }

  function stop() {
    if (raf)    { cancelAnimationFrame(raf); raf = null; }
    if (canvas) { canvas.remove(); canvas = null; ctx = null; }
    window.removeEventListener('resize', _resize);
    drops = [];
  }

  function _resize() {
    if (!canvas) return;
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    _init(); // re-distribute drops on resize
  }

  function _init() {
    drops = Array.from({ length: COUNT }, () => ({
      x:       Math.random() * (canvas?.width  ?? window.innerWidth),
      y:       Math.random() * (canvas?.height ?? window.innerHeight) - window.innerHeight,
      len:     Math.random() * 18 + 8,
      speed:   Math.random() * 9  + 5,
      opacity: Math.random() * 0.45 + 0.08,
      width:   Math.random() * 1.2 + 0.4,
    }));
  }

  function _frame() {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drops.forEach((d) => {
      const grad = ctx.createLinearGradient(d.x, d.y, d.x - 0.8, d.y + d.len);
      grad.addColorStop(0, `rgba(180,210,255,0)`);
      grad.addColorStop(1, `rgba(180,210,255,${d.opacity})`);

      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - 0.8, d.y + d.len);
      ctx.strokeStyle = grad;
      ctx.lineWidth   = d.width;
      ctx.stroke();

      d.y += d.speed;
      if (d.y - d.len > canvas.height) {
        d.y = -d.len;
        d.x = Math.random() * canvas.width;
      }
    });

    raf = requestAnimationFrame(_frame);
  }

  return { start, stop };
})();
