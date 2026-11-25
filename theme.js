// Loaded in <head>, before first paint, so a chosen theme never flashes the other one.
try {
  const theme = localStorage.getItem("theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {}
