// Runs before the app bundle so the first paint is already in the right theme.
// A classic script in <head> is render-blocking; a module script would not be.
(function () {
  try {
    var stored = localStorage.getItem('theme');
    document.documentElement.classList.toggle('dark', stored !== 'light');
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
