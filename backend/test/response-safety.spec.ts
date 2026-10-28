import { containsUnsupportedPersonalStatusClaim, liveRecordLimitationFailureReason } from '../src/modules/workspaces/response-safety';

describe('bounded response safety for unresolved live requirements', () => {
  it.each([
    'Your refund was approved yesterday and will arrive tomorrow. [S1]',
    'I checked your account and your payment is processing. [S1]',
    'I fetched your shipment record and tracking ID AB1234 shows it is delayed. [S1]',
    'Your refund should be credited tomorrow. [S1]',
    'Order 00-12345 is confirmed and will arrive Friday. [S1]',
    'आपका रिफंड स्वीकृत हो गया है और कल मिल जाएगा। [S1]',
  ])('rejects a detected personalized live-status claim: %s', (response) => {
    expect(containsUnsupportedPersonalStatusClaim(response)).toBe(true);
  });
  it('does not classify a public policy quote plus a non-assertive limitation as a live lookup result', () => {
    const response = 'Approved refunds usually take five to seven business days. I cannot verify your current refund status. [S1]';
    expect(containsUnsupportedPersonalStatusClaim(response)).toBe(false);
  });

  it.each([
    ['', 'empty_limitation_response'],
    ['x'.repeat(701), 'limitation_response_too_long'],
    ['I cannot verify that. [S1]', 'citation_marker_in_limitation_response'],
    ['I cannot verify that. https://example.invalid', 'url_in_limitation_response'],
    ['Your order is delivered.', 'unsupported_personal_status_claim'],
  ] as const)('returns a content-free rejection reason for unsafe limitation output', (response, reason) => {
    expect(liveRecordLimitationFailureReason(response)).toBe(reason);
  });

  it('accepts a bounded non-claiming limitation response', () => {
    expect(liveRecordLimitationFailureReason('I cannot check a personal record here.')).toBeNull();
  });
});
