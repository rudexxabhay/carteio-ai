import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../app/providers/ThemeProvider';
import { ThemeSwitcher } from '../components/common/ThemeSwitcher';
import { THEME_STORAGE_KEY } from '../config/themes';

function renderSwitcher() {
  return render(<ThemeProvider><ThemeSwitcher /></ThemeProvider>);
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.dataset.theme = '';
});
afterEach(() => cleanup());

describe('landing theme picker', () => {
  it('uses Ocean Blue by default and falls back when stored theme is invalid', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'neon-dark');
    renderSwitcher();
    expect(document.documentElement.dataset.theme).toBe('ocean-blue');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Theme' }));
    expect(screen.getAllByRole('radio')).toHaveLength(6);
    expect(screen.getByRole('radio', { name: /Ocean Blue/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('changes the theme from the keyboard and updates the page immediately', async () => {
    const user = userEvent.setup();
    renderSwitcher();
    await user.click(screen.getByRole('button', { name: 'Theme' }));
    await user.keyboard('{ArrowRight}');
    expect(document.documentElement.dataset.theme).toBe('royal-purple');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('royal-purple');
    expect(screen.getByRole('radio', { name: /Royal Purple/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('persists the selected theme after remounting', async () => {
    const user = userEvent.setup();
    const firstRender = renderSwitcher();
    await user.click(screen.getByRole('button', { name: 'Theme' }));
    await user.click(screen.getByRole('radio', { name: /Emerald/ }));
    expect(document.documentElement.dataset.theme).toBe('emerald');
    firstRender.unmount();

    renderSwitcher();
    await user.click(screen.getByRole('button', { name: 'Theme' }));
    expect(screen.getByRole('radio', { name: /Emerald/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('returns focus to the trigger when the picker is dismissed with Escape', async () => {
    const user = userEvent.setup();
    renderSwitcher();
    const trigger = screen.getByRole('button', { name: 'Theme' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('dialog', { name: 'Choose a color theme' })).not.toBeInTheDocument();
  });
});
