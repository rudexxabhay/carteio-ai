import { ServiceUnavailableException } from '@nestjs/common';
import { validateShopifyAdminReadScopeCandidates } from './shopify-scope-inventory.config';

/**
 * Explicit, reviewable upgrade allow-list. Populate only after comparing handles
 * with the released Shopify Dev Dashboard app version. Shopify does not expose
 * that declaration to this standalone authorization-code backend at runtime.
 * Empty by default: existing connections cannot silently request more scopes.
 */
export const SHOPIFY_SCOPE_UPGRADE_SCOPES: readonly string[] = Object.freeze([]);

export function getShopifyScopeUpgradeScopes(): string[] {
  try { return validateShopifyAdminReadScopeCandidates(SHOPIFY_SCOPE_UPGRADE_SCOPES); }
  catch { throw new ServiceUnavailableException('Shopify scope-upgrade configuration must contain unique, documented, non-sensitive Admin API read scope handles.'); }
}
