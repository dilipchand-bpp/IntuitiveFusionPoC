export const THEME_STORAGE_KEY = 'if-theme';

/** Script body to inline in <head> so the stored theme applies before first paint (no flash). Server-safe. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;
