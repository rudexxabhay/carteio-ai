import { describe, expect, it } from 'vitest';
import { safeInternalDestination } from '../services/auth/safe-redirect';

describe('post-login redirect validation', () => {
  it('preserves internal destinations and rejects open redirects', () => {
    expect(safeInternalDestination('/dashboard/settings?tab=profile', 'https://ai.carteio.in')).toBe('/dashboard/settings?tab=profile');
    expect(safeInternalDestination('//attacker.example/path', 'https://ai.carteio.in')).toBe('/dashboard');
    expect(safeInternalDestination('https://attacker.example/path', 'https://ai.carteio.in')).toBe('/dashboard');
    expect(safeInternalDestination('/\\\\attacker.example', 'https://ai.carteio.in')).toBe('/dashboard');
  });
});
