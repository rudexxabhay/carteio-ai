import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Palette } from 'lucide-react';
import { themes } from '../../config/themes';
import { useTheme } from '../../app/providers/ThemeProvider';

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = themes.findIndex((option) => option.id === theme);

  useEffect(() => {
    if (!isOpen) return;
    optionRefs.current[activeIndex]?.focus();
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePress);
  }, [activeIndex, isOpen]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % themes.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index + themes.length - 1) % themes.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = themes.length - 1;
    if (nextIndex !== undefined) {
      event.preventDefault();
      const nextTheme = themes[nextIndex];
      if (nextTheme) {
        setTheme(nextTheme.id);
        optionRefs.current[nextIndex]?.focus();
      }
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    }
  }

  return (
    <div className="theme-switcher" ref={rootRef}>
      <button
        className="theme-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? 'theme-picker' : undefined}
        onClick={() => setIsOpen((open) => !open)}
        ref={triggerRef}
      >
        <Palette size={16} aria-hidden="true" />
        <span>Theme</span>
      </button>
      {isOpen && (
        <div className="theme-popover" id="theme-picker" role="dialog" aria-label="Choose a color theme">
          <div className="theme-popover-heading">
            <div>
              <strong>Color theme</strong>
              <span>Choose your Carteio accent</span>
            </div>
            <span className="theme-light-only">LIGHT</span>
          </div>
          <div className="theme-options" role="radiogroup" aria-label="Color themes">
            {themes.map((option, index) => {
              const selected = option.id === theme;
              return (
                <button
                  className={`theme-option${selected ? ' is-selected' : ''}`}
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  ref={(node) => { optionRefs.current[index] = node; }}
                  onClick={() => setTheme(option.id)}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                >
                  <span className="theme-swatches" aria-hidden="true">
                    <i style={{ backgroundColor: option.primary }} />
                    <i style={{ backgroundColor: option.secondary }} />
                  </span>
                  <span>{option.name}</span>
                  {selected && <Check className="theme-check" size={15} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          <p className="theme-popover-note">Light themes · saved on this device</p>
        </div>
      )}
    </div>
  );
}
