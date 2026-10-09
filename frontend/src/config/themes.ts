export const THEME_STORAGE_KEY = 'carteio-color-theme';

export const themes = [
  { id: 'ocean-blue', name: 'Ocean Blue', primary: '#245DFF', secondary: '#0EA5C9' },
  { id: 'royal-purple', name: 'Royal Purple', primary: '#7054E8', secondary: '#9A6BEB' },
  { id: 'emerald', name: 'Emerald', primary: '#078A68', secondary: '#20A89A' },
  { id: 'sunset-coral', name: 'Sunset Coral', primary: '#CF4D43', secondary: '#E58443' },
  { id: 'rose-pink', name: 'Rose Pink', primary: '#C6317C', secondary: '#9C56C7' },
  { id: 'midnight-indigo', name: 'Midnight Indigo', primary: '#4F46C8', secondary: '#6576E8' },
] as const;

export type ThemeId = (typeof themes)[number]['id'];

export function isThemeId(value: string | null): value is ThemeId {
  return themes.some((theme) => theme.id === value);
}

export function getInitialTheme(): ThemeId {
  try {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeId(savedTheme) ? savedTheme : 'ocean-blue';
  } catch {
    return 'ocean-blue';
  }
}
