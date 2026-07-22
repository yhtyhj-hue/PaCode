/**
 * 滚动进入时点亮对比条；尊重 prefers-reduced-motion
 */
(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const bars = document.querySelectorAll('.bars[data-animate]');

  if (reduced || !('IntersectionObserver' in window)) {
    bars.forEach((el) => el.classList.add('is-in'));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.35 }
  );

  bars.forEach((el) => io.observe(el));
})();
