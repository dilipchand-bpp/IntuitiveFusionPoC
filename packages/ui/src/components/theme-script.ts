export const THEME_STORAGE_KEY = 'if-theme';

/**
 * Script body to inline in <head> so the stored theme applies before first paint (no flash). Server-safe.
 * Dark is the default: with nothing stored (or storage blocked) the page is dark, whatever the operating system prefers.
 */
export const THEME_INIT_SCRIPT = `var d=document.documentElement;try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');d.setAttribute('data-theme',t==='light'?'light':'dark')}catch(e){d.setAttribute('data-theme','dark')}`;
