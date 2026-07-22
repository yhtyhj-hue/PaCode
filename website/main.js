/**
 * 滚动进入时点亮对比条；changelog 条目轻量入场
 */
(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const bars = document.querySelectorAll('.bars[data-animate]');
  const changelog = document.querySelectorAll('.changelog > li');

  if (reduced || !('IntersectionObserver' in window)) {
    bars.forEach((el) => el.classList.add('is-in'));
    changelog.forEach((el) => el.classList.add('is-in'));
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
    { threshold: 0.28 }
  );

  bars.forEach((el) => io.observe(el));
  changelog.forEach((el) => io.observe(el));
})();
