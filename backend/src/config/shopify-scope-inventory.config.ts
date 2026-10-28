/**
 * Owner-supplied inventory. This is not evidence that a scope is valid for the
 * pinned Admin API version, declared in the released app version, or granted
 * to any store. Only explicitly verified entries may become requestable.
 */
export const SHOPIFY_SCOPE_INVENTORY_SOURCE = `
read_analytics,read_analytics_annotations,write_analytics_annotations,read_app_proxy,write_app_proxy,read_assigned_fulfillment_orders,write_assigned_fulfillment_orders,read_audit_events,read_customer_events,read_cart_transforms,write_cart_transforms,read_all_cart_transforms,read_validations,write_validations,read_cash_tracking,write_cash_tracking,read_channels,write_channels,read_checkout_kit_enhanced_buyer_events,read_checkout_and_accounts_configurations,write_checkout_and_accounts_configurations,read_checkout_branding_settings,write_checkout_branding_settings,write_checkouts,read_checkouts,read_companies,write_companies,read_custom_fulfillment_services,write_custom_fulfillment_services,read_custom_pixels,write_custom_pixels,read_customers,write_customers,read_customer_data_erasure,write_customer_data_erasure,read_customer_merge,write_customer_merge,read_delivery_customizations,write_delivery_customizations,read_price_rules,write_price_rules,read_discounts,write_discounts,read_discovery,write_discovery,write_draft_orders,read_draft_orders,read_files,write_files,read_fulfillment_constraint_rules,write_fulfillment_constraint_rules,read_fulfillments,write_fulfillments,read_gift_card_transactions,write_gift_card_transactions,read_gift_cards,write_gift_cards,write_inventory,read_inventory,read_inventory_purchase_orders,write_inventory_shipments,read_inventory_shipments,write_inventory_shipments_received_items,read_inventory_shipments_received_items,write_inventory_transfers,read_inventory_transfers,read_legal_policies,write_legal_policies,read_delivery_option_generators,write_delivery_option_generators,read_locales,write_locales,write_locations,read_locations,read_marketing_integrated_campaigns,write_marketing_integrated_campaigns,write_marketing_events,read_marketing_events,read_markets,write_markets,read_markets_home,write_markets_home,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders,read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects,read_online_store_navigation,write_online_store_navigation,read_online_store_pages,write_online_store_pages,write_order_edits,read_order_edits,read_orders,write_orders,write_packing_slip_templates,read_packing_slip_templates,read_payment_notifications,read_payment_terms,write_payment_terms,read_payment_customizations,write_payment_customizations,read_privacy_settings,write_privacy_settings,read_product_feeds,write_product_feeds,read_product_listings,write_product_listings,read_products,write_products,read_publications,write_publications,read_purchase_options,write_purchase_options,write_reports,read_reports,read_resource_feedbacks,write_resource_feedbacks,read_returns,write_returns,read_rollouts,read_script_tags,write_script_tags,read_shopify_payments_provider_accounts_sensitive,read_shipping,write_shipping,read_shopify_payments_accounts,read_shopify_payments_payouts,read_shopify_payments_bank_accounts,read_shopify_payments_disputes,write_shopify_payments_disputes,read_content,write_content,read_store_credit_account_transactions,write_store_credit_account_transactions,read_store_credit_accounts,write_theme_code,read_themes,write_themes,read_third_party_fulfillment_orders,write_third_party_fulfillment_orders,read_translations,write_translations,read_pixels,write_pixels,customer_read_companies,customer_write_companies,customer_write_customers,customer_read_customers,customer_read_draft_orders,customer_read_markets,customer_read_metaobjects,customer_read_orders,customer_write_orders,customer_read_store_credit_account_transactions,customer_read_store_credit_accounts,unauthenticated_write_bulk_operations,unauthenticated_read_bulk_operations,unauthenticated_read_bundles,unauthenticated_write_checkouts,unauthenticated_read_checkouts,unauthenticated_write_customers,unauthenticated_read_customers,unauthenticated_read_customer_tags,unauthenticated_read_metaobjects,unauthenticated_read_product_pickup_locations,unauthenticated_read_product_inventory,unauthenticated_read_product_listings,unauthenticated_read_product_tags,unauthenticated_read_selling_plans,unauthenticated_read_shop_pay_installments_pricing,unauthenticated_read_content,shop_app:oauth
`.trim();

export type ShopifyScopeApiFamily = 'ADMIN_API' | 'CUSTOMER_ACCOUNT_API' | 'STOREFRONT_API' | 'SPECIAL_OR_UNSUPPORTED';
export type ShopifyScopeAccess = 'READ' | 'WRITE' | 'OTHER';
export type ShopifyScopeRisk = 'STANDARD' | 'SENSITIVE' | 'PROTECTED' | 'UNKNOWN';

export type ShopifyScopeInventoryEntry = Readonly<{
  handle: string;
  apiFamily: ShopifyScopeApiFamily;
  access: ShopifyScopeAccess;
  risk: ShopifyScopeRisk;
  verification: 'DOCUMENTED_IN_2026_10' | 'UNVERIFIED_FOR_CONFIGURED_API_VERSION';
  resourceDescription: string | null;
  executable: false;
}>;

const specialHandles = new Set(['shop_app:oauth']);
const documentedResourceByStem: Readonly<Record<string, string>> = Object.freeze({
  analytics_annotations: 'AnalyticsAnnotation records', app_proxy: 'App proxy configuration', assigned_fulfillment_orders: 'FulfillmentOrder records assigned to the app',
  cart_transforms: 'CartTransform records', cash_tracking: 'Cash drawers and cash tracking sessions', checkout_and_accounts_configurations: 'Checkout and customer-account configuration', checkout_branding_settings: 'Checkout branding settings',
  companies: 'B2B Company records', content: 'Articles, blogs, comments and pages', customer_data_erasure: 'Customer data erasure request mutations', customer_merge: 'Customer merge records and requests', customers: 'Customer records',
  delivery_customizations: 'DeliveryCustomization records', discounts: 'Discount records', draft_orders: 'DraftOrder records', files: 'Shopify files and media', fulfillment_constraint_rules: 'Fulfillment constraint rules', fulfillments: 'Fulfillment services',
  gift_card_transactions: 'Gift card transaction records', gift_cards: 'GiftCard records', inventory: 'InventoryItem and InventoryLevel records', inventory_shipments: 'Inventory shipments and line items', inventory_shipments_received_items: 'Received items on inventory shipments', inventory_transfers: 'Inventory transfers and line items',
  legal_policies: 'Shop policies', locales: 'Shop locales', locations: 'Store locations', marketing_events: 'MarketingEvent and MarketingActivity records', markets: 'Markets', metaobject_definitions: 'Metaobject definitions', metaobjects: 'Metaobjects',
  online_store_navigation: 'URL redirects', online_store_pages: 'Articles, blogs, comments and pages', order_edits: 'CalculatedOrder records', orders: 'Orders, fulfillments, transactions and delivery carrier services', payment_customizations: 'Payment customizations', payment_terms: 'Payment terms and schedules', price_rules: 'PriceRule records',
  products: 'Products, variants, collections and product feedback', product_listings: 'Product feeds and channel listing fields', purchase_options: 'Purchase options for products and selling plans', publications: 'Product/collection publication records', channels: 'Publication and sales-channel fields', reports: 'ShopifyQL reports and analytics targets', resource_feedbacks: 'Product and discount resource feedback', returns: 'Returns and reverse-logistics records', rollouts: 'Rollouts and rollout treatments', script_tags: 'ScriptTag records', shipping: 'Delivery carrier services',
  shopify_payments_accounts: 'Shopify Payments account and payout schedule', shopify_payments_payouts: 'Shopify Payments payouts and balance transactions', shopify_payments_bank_accounts: 'Shopify Payments bank accounts', shopify_payments_disputes: 'Shopify Payments disputes', store_credit_account_transactions: 'Store credit transaction records', store_credit_accounts: 'Store credit accounts', themes: 'Online Store themes', translations: 'Translations and translatable resources', validations: 'Validation records', pixels: 'Web Pixel and Server Pixel records', customer_events: 'Customer event data',
  checkouts: 'Storefront Cart records', customer_tags: 'Customer tags', product_inventory: 'Available product and variant inventory', product_pickup_locations: 'Pickup locations and store availability', product_tags: 'Product tags', selling_plans: 'Selling plan data on products', shop_pay_installments_pricing: 'Shop Pay installment pricing',
  companies_account: 'Customer-owned Company records', customers_account: 'Customer Account API customer records', draft_orders_account: 'Customer Account API draft orders', markets_account: 'Customer Account API markets', metaobjects_account: 'Customer Account API metaobjects', orders_account: 'Customer-owned orders', store_credit_account_transactions_account: 'Customer-owned store credit transactions', store_credit_accounts_account: 'Customer-owned store credit accounts',
});
const documentedScopeHandles2026_10 = new Set([
  'read_analytics_annotations', 'write_analytics_annotations', 'write_app_proxy',
  'read_assigned_fulfillment_orders', 'write_assigned_fulfillment_orders', 'read_merchant_managed_fulfillment_orders', 'write_merchant_managed_fulfillment_orders', 'read_third_party_fulfillment_orders', 'write_third_party_fulfillment_orders',
  'read_cart_transforms', 'write_cart_transforms', 'read_cash_tracking', 'write_cash_tracking',
  'read_checkout_and_accounts_configurations', 'write_checkout_and_accounts_configurations', 'read_checkout_branding_settings', 'write_checkout_branding_settings',
  'read_companies', 'write_companies', 'read_content', 'write_content', 'read_online_store_pages',
  'read_customer_data_erasure', 'write_customer_data_erasure', 'read_customer_merge', 'write_customer_merge', 'read_customers', 'write_customers',
  'read_delivery_customizations', 'write_delivery_customizations', 'read_discounts', 'write_discounts', 'read_draft_orders', 'write_draft_orders',
  'read_files', 'write_files', 'read_fulfillment_constraint_rules', 'write_fulfillment_constraint_rules', 'read_fulfillments', 'write_fulfillments',
  'read_gift_card_transactions', 'write_gift_card_transactions', 'read_gift_cards', 'write_gift_cards', 'read_inventory', 'write_inventory',
  'read_inventory_shipments', 'write_inventory_shipments', 'read_inventory_shipments_received_items', 'write_inventory_shipments_received_items', 'read_inventory_transfers', 'write_inventory_transfers',
  'read_legal_policies', 'write_legal_policies', 'read_locales', 'write_locales', 'read_locations', 'write_locations',
  'read_marketing_events', 'write_marketing_events', 'read_markets', 'write_markets', 'read_metaobject_definitions', 'write_metaobject_definitions', 'read_metaobjects', 'write_metaobjects', 'read_channels', 'write_channels',
  'read_online_store_navigation', 'write_online_store_navigation', 'write_online_store_pages', 'read_order_edits', 'write_order_edits',
  'read_orders', 'write_orders', 'read_payment_customizations', 'write_payment_customizations', 'read_price_rules', 'write_price_rules',
  'read_products', 'write_products', 'read_product_listings', 'read_purchase_options', 'write_purchase_options', 'read_publications', 'write_publications', 'read_reports', 'write_reports', 'read_resource_feedbacks', 'write_resource_feedbacks',
  'read_returns', 'write_returns', 'read_rollouts', 'read_script_tags', 'write_script_tags', 'read_shipping', 'write_shipping',
  'read_shopify_payments_accounts', 'read_shopify_payments_payouts', 'read_shopify_payments_bank_accounts', 'read_shopify_payments_disputes',
  'read_store_credit_account_transactions', 'write_store_credit_account_transactions', 'read_store_credit_accounts', 'read_themes', 'write_themes', 'read_translations', 'write_translations', 'read_validations', 'write_validations', 'read_pixels', 'write_pixels', 'read_customer_events',
  'customer_read_companies', 'customer_write_companies', 'customer_read_customers', 'customer_write_customers', 'customer_read_draft_orders', 'customer_read_markets', 'customer_read_metaobjects', 'customer_read_orders', 'customer_write_orders', 'customer_read_store_credit_account_transactions', 'customer_read_store_credit_accounts',
  'unauthenticated_read_checkouts', 'unauthenticated_write_checkouts', 'unauthenticated_read_content', 'unauthenticated_read_customer_tags', 'unauthenticated_read_customers', 'unauthenticated_write_customers', 'unauthenticated_read_metaobjects', 'unauthenticated_read_product_inventory', 'unauthenticated_read_product_listings', 'unauthenticated_read_product_pickup_locations', 'unauthenticated_read_product_tags', 'unauthenticated_read_selling_plans', 'unauthenticated_read_shop_pay_installments_pricing',
]);
const knownProtectedHandles = new Set([
  'read_assigned_fulfillment_orders', 'read_merchant_managed_fulfillment_orders',
  'read_third_party_fulfillment_orders', 'read_orders', 'write_orders', 'read_fulfillments', 'read_returns', 'read_draft_orders', 'read_order_edits', 'read_checkouts', 'write_checkouts', 'read_checkout_kit_enhanced_buyer_events',
  'read_customers', 'write_customers', 'read_customer_events', 'read_customer_data_erasure',
  'write_customer_data_erasure', 'read_customer_merge', 'write_customer_merge',
  'customer_read_companies', 'customer_write_companies', 'customer_read_customers', 'customer_write_customers',
  'customer_read_draft_orders', 'customer_read_orders', 'customer_write_orders',
  'customer_read_store_credit_account_transactions', 'customer_read_store_credit_accounts',
  'unauthenticated_read_customers', 'unauthenticated_write_customers', 'unauthenticated_read_customer_tags',
]);
const knownSensitiveHandles = new Set([
  'read_analytics', 'read_analytics_annotations', 'write_analytics_annotations', 'read_audit_events', 'read_payment_notifications', 'read_payment_terms', 'write_payment_terms',
  'read_cash_tracking', 'write_cash_tracking', 'read_companies', 'write_companies', 'read_inventory_purchase_orders',
  'read_inventory_shipments', 'write_inventory_shipments', 'read_inventory_shipments_received_items',
  'write_inventory_shipments_received_items', 'read_inventory_transfers', 'write_inventory_transfers',
  'read_marketing_events', 'write_marketing_events', 'read_marketing_integrated_campaigns',
  'write_marketing_integrated_campaigns', 'read_shopify_payments_accounts', 'read_shopify_payments_payouts',
  'read_shopify_payments_provider_accounts_sensitive', 'read_shopify_payments_bank_accounts', 'read_shopify_payments_disputes', 'read_reports', 'write_reports',
  'read_store_credit_account_transactions', 'write_store_credit_account_transactions',
  'read_store_credit_accounts',
]);

export function normalizeShopifyScopeInventory(source = SHOPIFY_SCOPE_INVENTORY_SOURCE, apiVersion = process.env.SHOPIFY_API_VERSION ?? '2026-10'): {
  entries: ShopifyScopeInventoryEntry[];
  duplicates: string[];
  malformed: string[];
} {
  const input = source.split(/[\s,]+/).map((handle) => handle.trim()).filter(Boolean);
  const seen = new Set<string>(), duplicates: string[] = [], malformed: string[] = [];
  const entries: ShopifyScopeInventoryEntry[] = [];
  for (const handle of input) {
    if (seen.has(handle)) { duplicates.push(handle); continue; }
    seen.add(handle);
    if (!/^(?:[a-z][a-z0-9_]{0,127}|shop_app:oauth)$/.test(handle)) { malformed.push(handle); continue; }
    const apiFamily: ShopifyScopeApiFamily = specialHandles.has(handle) ? 'SPECIAL_OR_UNSUPPORTED'
      : handle.startsWith('customer_') ? 'CUSTOMER_ACCOUNT_API'
        : handle.startsWith('unauthenticated_') ? 'STOREFRONT_API' : 'ADMIN_API';
    const access: ShopifyScopeAccess = handle.startsWith('read_') || handle.startsWith('customer_read_') || handle.startsWith('unauthenticated_read_') ? 'READ'
      : handle.startsWith('write_') || handle.startsWith('customer_write_') || handle.startsWith('unauthenticated_write_') ? 'WRITE'
        : 'OTHER';
    const documentedForVersion = apiVersion === '2026-10' && documentedScopeHandles2026_10.has(handle);
    const stem = handle.startsWith('customer_')
      ? handle.replace(/^customer_(?:read|write)_/, '')
      : handle.startsWith('unauthenticated_')
        ? handle.replace(/^unauthenticated_(?:read|write)_/, '')
        : handle.replace(/^(?:read|write)_/, '');
    const accountResource = apiFamily === 'CUSTOMER_ACCOUNT_API' ? documentedResourceByStem[`${stem}_account`] : undefined;
    const resourceDescription = documentedForVersion ? accountResource ?? documentedResourceByStem[stem] ?? null : null;
    const risk: ShopifyScopeRisk = specialHandles.has(handle) ? 'UNKNOWN'
      : apiFamily === 'CUSTOMER_ACCOUNT_API' || knownProtectedHandles.has(handle) ? 'PROTECTED'
        : apiFamily === 'STOREFRONT_API' && /customers|customer_tags/.test(handle) ? 'PROTECTED'
        : knownSensitiveHandles.has(handle) ? 'SENSITIVE'
          : documentedForVersion ? 'STANDARD' : 'UNKNOWN';
    entries.push({ handle, apiFamily, access, risk, verification: documentedForVersion ? 'DOCUMENTED_IN_2026_10' : 'UNVERIFIED_FOR_CONFIGURED_API_VERSION', resourceDescription, executable: false });
  }
  return { entries, duplicates, malformed };
}

/** This set is confirmed in Shopify's official 2026-10 scope reference; it does not imply Carteio implementation or grant. */
export const SHOPIFY_DOCUMENTED_ADMIN_READ_SCOPES_2026_10 = Object.freeze(
  [...documentedScopeHandles2026_10].filter((handle) => handle.startsWith('read_')),
);
export const isShopifyAdminOAuthScope = (handle: string) =>
  /^(?:read|write)_[a-z0-9_]+$/.test(handle) && !handle.startsWith('customer_') && !handle.startsWith('unauthenticated_');

export function getShopifyConfiguredOAuthScopes(upgradeCandidates: readonly string[] = []): { legacy: string[]; upgrade: string[]; combined: string[] } {
  const legacy = (process.env.SHOPIFY_SCOPES ?? 'read_products,read_inventory,read_orders')
    .split(',').map((handle) => handle.trim()).filter(Boolean);
  const upgrade = validateShopifyAdminReadScopeCandidates(upgradeCandidates);
  return { legacy, upgrade, combined: [...new Set([...legacy, ...upgrade])] };
}

export function validateShopifyAdminReadScopeCandidates(candidates: readonly string[]): string[] {
  const inventory = new Map(normalizeShopifyScopeInventory().entries.map((entry) => [entry.handle, entry]));
  if (new Set(candidates).size !== candidates.length || candidates.some((handle) =>
    !inventory.has(handle) || !SHOPIFY_DOCUMENTED_ADMIN_READ_SCOPES_2026_10.includes(handle as typeof SHOPIFY_DOCUMENTED_ADMIN_READ_SCOPES_2026_10[number]) ||
    inventory.get(handle)?.apiFamily !== 'ADMIN_API' || inventory.get(handle)?.access !== 'READ' ||
    inventory.get(handle)?.risk !== 'STANDARD' || inventory.get(handle)?.verification !== 'DOCUMENTED_IN_2026_10')) {
    throw new Error('SHOPIFY_SCOPE_UPGRADE_CANDIDATE_INVALID');
  }
  return [...candidates];
}
