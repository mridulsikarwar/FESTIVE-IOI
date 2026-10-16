// Theme Switcher (Dark / Light Mode)
(function() {
  function applyTheme(theme) {
    if (theme === 'light') {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    }
    
    // Update all theme toggle icons & attributes on page
    const icons = document.querySelectorAll('.themeToggleIcon');
    icons.forEach(icon => {
      icon.className = 'themeToggleIcon ph ' + (theme === 'light' ? 'ph-moon' : 'ph-sun') + ' text-sm';
    });

    const btns = document.querySelectorAll('.themeToggleBtn');
    btns.forEach(btn => {
      const label = theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode';
      btn.setAttribute('title', label);
      btn.setAttribute('aria-label', label);
    });
  }

  function initTheme() {
    const saved = localStorage.getItem('festive_theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = saved || (prefersDark ? 'dark' : 'dark');
    applyTheme(initialTheme);

    document.querySelectorAll('.themeToggleBtn').forEach(btn => {
      // Avoid duplicate event listener
      if (btn.dataset.themeBound) return;
      btn.dataset.themeBound = 'true';
      btn.addEventListener('click', () => {
        const isLight = document.documentElement.classList.contains('light');
        const nextTheme = isLight ? 'dark' : 'light';
        localStorage.setItem('festive_theme', nextTheme);
        applyTheme(nextTheme);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
  } else {
    initTheme();
  }
})();
