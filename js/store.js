// Persists settings, recent files and notification state in localStorage.
const Store = (() => {
  const KEY = 'cropcloud.v1';
  const MAX_RECENTS = 24;

  const defaults = () => ({
    settings: {
      theme: 'dark',          // 'dark' | 'light' | 'system'
      accent: 'violet',
      density: 'comfortable', // 'comfortable' | 'compact'
      reduceMotion: false,
      name: '',
      startView: 'home',
      showPlanned: false,
    },
    settingsVersion: 2,
    recents: [],
    readNotifications: [],
    fileView: 'grid',
    fileSort: 'recent',
  });

  const listeners = new Set();
  let state = load();

  function load() {
    const base = defaults();
    try {
      const saved = JSON.parse(localStorage.getItem(KEY)) || {};
      const merged = { ...base, ...saved, settings: { ...base.settings, ...saved.settings } };
      // 0.2.0 hides planned apps by default, including for people who had the old default.
      if ((saved.settingsVersion || 1) < 2) merged.settings.showPlanned = false;
      merged.settingsVersion = 2;
      return merged;
    } catch {
      return base;
    }
  }

  function save() {
    // Thumbnails can fill the quota; drop the oldest recents until it fits.
    for (;;) {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
        return;
      } catch (err) {
        if (!state.recents.length) return console.warn('Could not save settings', err);
        state.recents.pop();
      }
    }
  }

  function emit(key) {
    listeners.forEach((fn) => fn(key));
  }

  return {
    get: (key) => state[key],
    setting: (key) => state.settings[key],

    set(key, value) {
      state[key] = value;
      save();
      emit(key);
    },

    setSetting(key, value) {
      state.settings = { ...state.settings, [key]: value };
      save();
      emit('settings');
    },

    addRecent(file) {
      const rest = state.recents.filter((f) => f.id !== file.id);
      state.recents = [file, ...rest].slice(0, MAX_RECENTS);
      save();
      emit('recents');
    },

    removeRecent(id) {
      state.recents = state.recents.filter((f) => f.id !== id);
      save();
      emit('recents');
    },

    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    usageBytes() {
      try {
        return (localStorage.getItem(KEY) || '').length * 2;
      } catch {
        return 0;
      }
    },
  };
})();
