// Preview-only silence; never changes the player's saved audio preferences.
export const silentPreview = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('silent') === '1';
