# Carteio Business Data API v1

The same read-only contract works for MERN, PHP and Next.js services and the included WordPress plugin. Configure a connector base URL, product path, content path and a bearer token. All endpoints use HTTPS and return JSON. The connector worker uses bounded pages of up to 100 items, follows opaque cursors, retries transient failures with backoff, and normalizes products into commerce tables. Content updates/deletions become tenant-scoped Knowledge Text sources and use the existing indexing worker.

## Routes

- `GET /<productsPath>?limit=100&cursor=<opaque>&updatedAfter=<ISO-8601>` returns a page of products and product tombstones.
- `GET /<contentPath>?limit=100&cursor=<opaque>&updatedAfter=<ISO-8601>` returns public pages, policies, FAQs, services and content tombstones.
- Both require `Authorization: Bearer <token>` and `Accept: application/json`.

Envelope:

```json
{
  "contractVersion": "1.0",
  "items": [],
  "nextCursor": null,
  "complete": true,
  "updatedThrough": "2026-10-15T12:00:00.000Z",
  "deletedIds": []
}
```

When `complete` is false, `nextCursor` must be a non-empty string. Each response contains at most 100 total records including tombstones. `updatedThrough` is committed as the incremental checkpoint only on the final page. Tombstones are stable provider IDs and can be repeated safely.

A product item has stable `id`, `name`, optional `description`, `sku`, `category`, ISO `updatedAt`, HTTPS `url`/`imageUrl`, ISO currency code, decimal string `price`, integer `inventory`, `availability`, `status`, and `variants`. Each variant has stable `id`, `title`, optional `sku`, `currency`, decimal string `price`, integer `inventory`, `availability`, and `status`. `variantsComplete: true` is required; incomplete nested variants are rejected so stale variants are not silently retained.

A content item has stable `id`, `title`, plain text `content`, optional `category`, same-site HTTPS `url`, language tag and ISO `updatedAt`. Use category values such as `faq`, `about`, `contact`, `service`, `privacy-policy`, `shipping-policy`, `refund-policy`, and `terms`. Do not include authenticated pages, customer/order records, credentials or personal data.

The reserved customer-authorized order operation is `POST /orders/lookup` with `{ "orderReference": "…", "customerProof": "…" }`. A provider may support it only when it independently validates a short-lived, order-bound proof issued by that provider for the authenticated customer. A valid response is limited to `{ "orderReference", "status", "fulfillmentStatus", "tracking": [{ "carrier", "trackingNumber", "trackingUrl" }], "updatedAt" }`; it must omit customer identity/address/payment data. The Carteio app does not call this route or issue a `customerProof`, so order lookup is unavailable in the current widget integration.

## Sync lifecycle and AI visibility

Each connector belongs to one organization and receives an encrypted connector credential. Only a verified, connected connector can queue `PRODUCTS` or `CONTENT` sync. Products and variants remain structured commerce records. Content is stored as internal-restricted Knowledge Text, deduplicated by connector and source ID, indexed through the existing Knowledge worker, and updated by source version. Tombstones archive records and prevent them from being retrieved. Owners must explicitly assign imported sources to an active Knowledge Base/assistant and change visibility when they intend public widget retrieval. Website crawler sources still require their existing DNS verification and crawl-policy checks.

The generic connector API accepts `PRODUCTS` and `CONTENT`. It does not sync orders or customer records. The provider contract reserves `POST /orders/lookup` for a customer-authorized operation that must prove order ownership at the provider. Carteio does not call that operation: the current widget has no verified customer-to-order ownership credential. Never return an order from a bearer-only catalog request.

## MERN (Express) example

```ts
import { timingSafeEqual } from 'node:crypto';
const token = process.env.CARTEIO_SYNC_TOKEN!;
const auth = (req, res, next) => {
  const supplied = req.get('authorization') ?? '';
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? next() : res.sendStatus(401);
};
const page = (items, cursor) => ({ contractVersion: '1.0', items, nextCursor: cursor, complete: cursor == null, updatedThrough: new Date().toISOString(), deletedIds: [] });
app.get('/carteio/v1/products', auth, async (req, res) => {
  const result = await Product.find({ published: true, ...(req.query.updatedAfter ? { updatedAt: { $gte: new Date(String(req.query.updatedAfter)) } } : {}) }).sort({ _id: 1 }).limit(100).lean();
  // Production implementation must encode/decode a stable cursor and return complete/nextCursor from the actual page boundary.
  res.json(page(result.map((p) => ({ id: String(p._id), name: p.name, description: p.description, category: p.category, price: p.price == null ? null : String(p.price), currency: p.currency, inventory: p.inventory ?? null, availability: p.inventory > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK', updatedAt: p.updatedAt.toISOString(), variants: (p.variants ?? []).map((v) => ({ id: String(v._id), title: v.title, sku: v.sku, price: v.price == null ? null : String(v.price), inventory: v.inventory ?? null })), variantsComplete: true })), null));
});
app.get('/carteio/v1/content', auth, async (_req, res) => res.json(page(await PublicBusinessPage.find({ published: true }).limit(100).lean(), null)));
```

The sample shows field mapping only; implement real opaque pagination and return `complete: false` with `nextCursor` for larger data sets.

## PHP example

```php
$router->get('/carteio/v1/products', function ($request) use ($token, $db) {
    if (!hash_equals('Bearer ' . $token, $request->header('Authorization', ''))) return response()->json([], 401);
    $rows = $db->table('products')->where('published', true)->orderBy('id')->limit(100)->get();
    return response()->json(['contractVersion'=>'1.0','items'=>$rows->map(fn($p)=>[
        'id'=>(string)$p->id, 'name'=>$p->name, 'description'=>$p->description,
        'category'=>$p->category, 'price'=>$p->price === null ? null : (string)$p->price,
        'currency'=>$p->currency, 'inventory'=>$p->inventory, 'availability'=>$p->inventory > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK',
        'updatedAt'=>gmdate('c', strtotime($p->updated_at)), 'variants'=>[], 'variantsComplete'=>true,
    ]), 'nextCursor'=>null, 'complete'=>true, 'updatedThrough'=>gmdate('c'), 'deletedIds'=>[]]);
});
```

Use the framework's constant-time secret comparison and parameterized database access. Add a matching content route with published public-only text.

## Next.js example

```ts
// app/carteio/v1/products/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
export async function GET(request: NextRequest) {
  const expected = process.env.CARTEIO_SYNC_TOKEN;
  const supplied = Buffer.from(request.headers.get('authorization') ?? '');
  const token = Buffer.from(`Bearer ${expected ?? ''}`);
  if (!expected || supplied.length !== token.length || !timingSafeEqual(supplied, token)) return NextResponse.json({}, { status: 401 });
  const items = await loadPublishedProducts({ cursor: request.nextUrl.searchParams.get('cursor'), updatedAfter: request.nextUrl.searchParams.get('updatedAfter'), limit: 100 });
  return NextResponse.json({ contractVersion: '1.0', items: items.rows, nextCursor: items.nextCursor, complete: items.nextCursor === null, updatedThrough: items.updatedThrough, deletedIds: items.deletedIds });
}
```

Keep the route server-only, use a high-entropy secret from a secret manager, and never expose it through `NEXT_PUBLIC_*`.

## WordPress

Install `integrations/wordpress/carteio-business-data.php` as a plugin. It exposes `GET /wp-json/carteio/v1/products` and `/wp-json/carteio/v1/content`. Generate a bearer token from **Settings → Carteio Business Data** and copy it once into the Carteio connector credential; rotating the token revokes the previous one. Public published pages/posts and published WooCommerce products are included. Products return variants, prices, stock and product categories when WooCommerce is active. Customer/order endpoints are intentionally absent.

## Static sites and widget

For static HTML, add the approved domain in Knowledge, complete the existing DNS TXT challenge, then queue/schedule the bounded robots-aware crawl. Sitemap discovery and same-host crawl constraints reuse Phase 16A; no backend API or plugin is required. Website pages must be in an active assistant Knowledge Base with allowed visibility before the widget can retrieve them.

The current backend setup sequence uses the authenticated workspace routes `POST /api/v1/workspaces/:slug/knowledge/website` with `{ "sourceUrl", "name", "visibility": "INTERNAL_RESTRICTED" }`, `POST /api/v1/workspaces/:slug/knowledge/:sourceId/website/verification-challenge`, publish the returned TXT record at the requested DNS name, `POST /api/v1/workspaces/:slug/knowledge/:sourceId/website/verify`, then `POST /api/v1/workspaces/:slug/knowledge/:sourceId/website/sync`. Check `GET /api/v1/workspaces/:slug/knowledge/:sourceId/processing` and `/website` for indexing and crawl status. Assign the resulting source to the desired active Knowledge Base/assistant before public widget retrieval.

The Phase 13 widget is technology-independent. In Dashboard → Widget / Installation, set assistant, branding and approved origins, then add the provided asynchronous script to a shared site template: WordPress theme/footer or site-wide script plugin, MERN/PHP/Next.js layout, or static HTML before `</body>`. Its short-lived origin-bound session is separate from connector credentials. Never place a connector token in the browser.
