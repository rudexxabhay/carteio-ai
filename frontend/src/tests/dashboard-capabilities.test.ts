import { describe, expect, it } from 'vitest';
import { businessProfile, resolveBusinessType, supportedBusinessTypes } from '../pages/dashboard/dashboard-capabilities';

describe('workspace dashboard business profile resolution', () => {
  it.each([
    ['ECOMMERCE', 'ECOMMERCE'],
    ['E-commerce', 'ECOMMERCE'],
    ['HEALTHCARE', 'HEALTHCARE'],
    ['landing-page', 'LANDING_PAGE'],
    ['service business', 'SERVICE_BUSINESS'],
    ['GENERAL_BUSINESS', 'GENERAL_BUSINESS'],
    [null, 'GENERAL_BUSINESS'],
    ['unrecognized legacy value', 'GENERAL_BUSINESS'],
  ])('resolves %s to a supported dashboard profile', (input, expected) => {
    expect(resolveBusinessType(input)).toBe(expected);
  });

  it('only exposes the five supported business classifications as selectable values', () => {
    expect(supportedBusinessTypes.map(({ value }) => value)).toEqual([
      'ECOMMERCE', 'HEALTHCARE', 'LANDING_PAGE', 'SERVICE_BUSINESS', 'GENERAL_BUSINESS',
    ]);
  });

  it('keeps profile copy honest about capabilities that require real data', () => {
    expect(businessProfile('HEALTHCARE').focus).toContain('not available');
    expect(businessProfile('LANDING_PAGE').focus).toContain('require verified tracking');
    expect(businessProfile('ECOMMERCE').focus).toContain('real records');
  });
});
