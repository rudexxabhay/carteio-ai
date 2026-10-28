import { widgetSourceIndicator } from './widget-source-indicator';

describe('widgetSourceIndicator', () => {
  it('labels generated answers without evidence as AI generated', () => {
    expect(widgetSourceIndicator('MODEL_GENERATED', [])).toEqual({ generationType: 'AI_GENERATED', evidenceSources: [] });
  });
  it('classifies cited Knowledge Base and public website evidence only', () => {
    expect(widgetSourceIndicator('MODEL_GENERATED', [
      { type: 'FAQ', cited: 'true', sourceAuthority: 'MERCHANT_KNOWLEDGE' },
      { type: 'WEBSITE', cited: 'true', sourceAuthority: 'PUBLIC_WEBSITE' },
      { type: 'COMMERCE_PRODUCT', cited: 'false' },
    ])).toEqual({ generationType: 'AI_GENERATED', evidenceSources: ['KNOWLEDGE_BASE', 'WEBSITE'] });
  });
  it('classifies Shopify catalog and Shopify API policy evidence', () => {
    expect(widgetSourceIndicator('MODEL_GENERATED', [
      { type: 'COMMERCE_PRODUCT', cited: 'true' },
      { type: 'FAQ', cited: 'true', sourceAuthority: 'SHOPIFY_API_POLICY' },
    ])).toEqual({ generationType: 'AI_GENERATED', evidenceSources: ['SHOPIFY'] });
  });
  it('uses a deterministic system label only for known system origins', () => {
    expect(widgetSourceIndicator('DETERMINISTIC_POLICY', [])).toEqual({ generationType: 'SYSTEM_GENERATED', evidenceSources: [] });
    expect(widgetSourceIndicator(undefined, undefined, 'SYSTEM')).toEqual({ generationType: 'SYSTEM_GENERATED', evidenceSources: [] });
    expect(widgetSourceIndicator(undefined, [])).toBeUndefined();
  });
  it('ignores uncited references and is safe for historical reloads', () => {
    const persisted = [{ type: 'COMMERCE_PRODUCT', cited: 'false' }, { type: 'WEBSITE', cited: 'true' }, { type: 'FAQ' }];
    expect(widgetSourceIndicator('MODEL_GENERATED', persisted)).toEqual({ generationType: 'AI_GENERATED', evidenceSources: ['WEBSITE'] });
    expect(widgetSourceIndicator(undefined, undefined)).toBeUndefined();
  });
});
