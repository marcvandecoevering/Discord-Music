(() => {
  const init = () => {
    const nav = document.querySelector('.navbar-fixed-top');
    if (!nav) return;
    const update = () => document.documentElement.style.setProperty('--mw-header-height', Math.ceil(nav.getBoundingClientRect().bottom) + 'px');
    new ResizeObserver(update).observe(nav);
    window.addEventListener('resize', update);
    update();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
