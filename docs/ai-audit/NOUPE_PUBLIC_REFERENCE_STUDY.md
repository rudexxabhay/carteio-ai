# Noupe Public Reference Study — Carteio AI

**Date:** 18 October 2026  
**Scope:** public `https://www.noupe.com/` page, publicly delivered DOM/assets, REA CLI capability verification, and Carteio source review. No login, sign-up, form submission, account creation, private endpoint, credential, paid API, live crawl, build, test, server, or Carteio source modification was performed.

## 1. Executive conclusion

Noupe’s public experience presents a notably simple merchant proposition: provide a website URL, get an embedded AI assistant quickly, augment it with documents/Q&A, customize it, and receive conversations in an inbox. This is a **visible product promise**, not evidence of its private crawler, models, prompts, vector store, data schema, or tool architecture.

Carteio already has much of the secure plumbing Noupe’s visible experience implies: a controlled crawler, website/FAQ/text knowledge sources, assistant assignment, hybrid lexical/optional-vector retrieval, widget sessions, product catalog synchronization, multilingual interpretation, and conversation persistence. Its major practical gap is not “add an LLM.” It is turning those backend capabilities into a reliably ready knowledge experience: structured facts, clear readiness/coverage diagnostics, claim-level grounding, typed commerce queries and coherent widget/product-card presentation.

## 2. Investigation record and evidence boundaries

| Item | Result | Classification |
|---|---|---|
| REA registration | `rea-agents@6.5.0 doctor --client codex --format json` reports Codex registration healthy and REA skill aligned. | Confirmed |
| Active REA MCP tools | This chat’s live tool inventory did not expose `mcp__rea` tools after restart. | Confirmed limitation |
| REA website capability | REA CLI schema confirms `capture-browser-scenario` needs a CDP target or may launch a temporary browser; a bounded, no-action capture was attempted but returned no usable evidence envelope. | Confirmed limitation; no inference from the empty run |
| Public Noupe page | Direct public browser/DOM observation of `https://www.noupe.com/`; page title: “Free AI Chatbot Builder: Create AI Chatbots in minutes.” | Confirmed |
| Public static structure | Observed Jotform-hosted static CSS/assets, browser-delivered chatbot-styled landing-demo DOM, Cookiebot and Google tag scripts. | Confirmed |
| Private Noupe backend | Not accessed or inferred as fact. | Unknown by design |

Public evidence links: [Noupe landing page](https://www.noupe.com/), [REA repository](https://github.com/morluto/rea).

## 3. A. Confirmed Noupe frontend and behavioral observations

### Merchant-facing value proposition

The public page explicitly states that Noupe learns from public website content, can be created after entering a website URL, supports embedding, permits documents and Q&A as knowledge-base material, supports visual/chat-first-message customization, sends conversations to an inbox, and detects/replies in a visitor’s language. The accessible UI contains public **Login**, **Sign Up for Free**, **Google Sign Up**, and **email sign-up** controls, but no account workflow was entered or submitted.

| Observable surface | Evidence | Independent implication for Carteio |
|---|---|---|
| URL-led setup | Landing copy says “Just enter your website URL.” | Onboarding should explain discovery status and next action immediately after URL validation. |
| Website learning | Landing feature: public pages become an answer base. | Carteio needs visible page/category coverage, not only `READY`. |
| Manual knowledge | Landing feature: documents and Q&A. | Keep Carteio FAQ/text sources and make assignment/availability obvious. |
| Embed setup | Landing feature says copy/embed code, no-code setup. | Preserve Carteio widget configuration/install page. |
| Customization | Size, alignment, color, avatar and first message are advertised. | Carteio has appearance/greeting fields; ensure all render in the public widget. |
| Inbox | Landing advertises real-time conversation delivery. | Preserve Carteio support conversation/inbox pipeline. |
| Language | Landing claims automatic visitor-language response. | Measure rather than merely configure multilingual behavior. |

### Customer-facing demo

The landing page includes a **non-interactive visual demo** labeled “AI Assistant,” with example pizzeria responses. Public DOM inspection found `chatbot-container`, `chatbot-container-header`, body/content/scroll-area elements, but no public message input or send control in the demo. Therefore it demonstrates a chat visual treatment; it does **not** establish live customer-chat request/response behavior, citation behavior, product-card behavior, follow-up resolution, order-status behavior, or Hindi/Hinglish performance.

## 4. B. Public website / JavaScript architecture findings

### Confirmed frontend facts

- The delivered page includes Jotform CDN CSS under `cdn.jotfor.ms/s/noupe/...`, a declared `window.__jfrouter` object with `ACTIVE_APP: "noupe"`, `APP_PATH: "/noupe-proxy"`, and an asset path on the Jotform CDN.
- The page loads Cookiebot consent and Google tag/analytics resources in addition to Noupe/Jotform assets.
- The visible demo is rendered directly in the page DOM rather than being a third-party iframe customer widget.
- The public landing page has no visible HTML form for URL onboarding; sign-up/onboarding navigation appears application-handled rather than simple anchor/form markup.

### What these facts do **not** establish

They do not establish that Jotform hosts Noupe’s model, crawl, retrieval, merchant data, widget runtime, conversation API, or billing system. A CDN/static asset path and a client router name reveal only public frontend delivery details. No source-map or bundle decompilation conclusion is included because the REA runtime capture did not return retained evidence.

## 5. C. Non-determinable without authorized backend/account access

- Crawl scope, sitemap/robots rules, rendering engine, retry policy, deduplication and freshness policy.
- Embedding/LLM providers, prompts, RAG chunking, vector store, ranker, citations, grounding checks and hallucination controls.
- Merchant data model, tenant isolation implementation, storage retention, encryption and access controls.
- Actual onboarding fields after sign-up, generated widget snippet, authenticated API routes, hidden configuration, rate limits and billing.
- Whether product names/prices/images/collections arrive from web scraping, a commerce integration, merchant imports, or a mixed pipeline.
- Real multilingual quality, session duration, follow-up resolution, authenticated order-status policy or ticketing behavior.

No claim in this study reconstructs any of those private systems.

## 6. D. Carteio versus Noupe gap matrix

| Capability | Noupe public observation | Carteio implementation evidence | Gap / priority |
|---|---|---|---|
| Website onboarding | Public promise: enter URL; quick no-code result | Website source registration, verification, jobs and schedules in `knowledge-processing.service.ts:337–364` | **P1:** surface an explicit readiness/coverage journey rather than job internals. |
| Crawl safety/discovery | Public promise only | Same-host/robots/SSRF-safe bounded crawler; sitemap/link discovery in `website-crawler.ts:31–525` | Preserve safeguards; add category coverage and visible partial-state reasoning. |
| Knowledge extraction | Public promise: website answer base + docs/Q&A | Website page text + fixed chunks; FAQ/TEXT supported (`knowledge-processing.service.ts:801–855`, `887–1048`) | **P0/P1:** structured facts and section-aware chunks; current text chunks lose relations. |
| Products/prices/images/collections | Not demonstrable from landing demo | Normalized commerce product/variant tables and catalog read contracts; widget response currently returns text/sources | **P0/P2:** typed product card response contract and freshness authority. |
| Retrieval | Unknown | FTS + optional semantic vectors, source/tenant/assignment gating in `searchPreview` (`knowledge-processing.service.ts:~430–601`) | Improve fusion/rerank/aspect coverage; do not discard existing safety filters. |
| Source assignment | Knowledge-base messaging public | Effective source/base/assistant eligibility enforced | Preserve; show merchant why an assigned source is not chat-ready. |
| Agent/tools | Unknown | Server-gated native tools `search_business_knowledge` / `search_store_products`, budgets and validation (`conversation-orchestrator.service.ts:902–990`) | Add typed filter plans/live-commerce precedence, not unconstrained agent autonomy. |
| Session continuity | Unknown | Durable support/playground messages; bounded recent context and safe user-origin references (`conversation-orchestrator.service.ts:1133–1147`, `conversation-context.ts`) | **P1:** explicit product/filter/session state and safe summaries. |
| Product image cards | Not established | `CommerceProduct.imageUrl` exists; public widget return is message/sources, not a product-card contract (`widget.service.ts:151–155`) | **P1:** render cards from authorized catalog evidence only. |
| Source attribution | Not visible on landing demo | Source refs are persisted/validated and returned to widget (`conversation-orchestrator.service.ts:1005–1054`; `widget.service.ts:155`) | Preserve; make optional, readable citation labels. |
| Multilingual | Public promise only | LLM interpretation prompt expressly handles Hindi, romanized Hindi, Hinglish and language preference (`conversation-orchestrator.service.ts:487–490`) | Add a production gold-suite; do not claim parity without results. |
| Data readiness | Not visible publicly | `processingStatus`, semantic state, page/sync information exist, but dashboard readiness is largely source-level | **P0:** “why not ready?” / coverage / last-known-good diagnostics. |

## 7. E. Specific Carteio files requiring modification

These are proposed implementation locations, not edits made by this study.

| File | Required change |
|---|---|
| `backend/src/modules/workspaces/knowledge-processing.service.ts` | Emit/page category coverage; structured extraction pipeline; clear `READY_COMPLETE` vs `READY_PARTIAL`; per-source retrieval diagnostics. |
| `backend/src/modules/workspaces/website-crawler.ts` | Persist sitemap/link discovery manifest and cap reasons; improve heading/JSON-LD extraction metadata without weakening robots/SSRF controls. |
| `backend/src/modules/workspaces/knowledge-indexing.ts` | Replace only fixed character windows with heading/FAQ/product/variant-aware chunk strategies. |
| `backend/src/modules/workspaces/knowledge-context-builder.ts` | Add typed authority/freshness evidence and aspect-aware evidence allocation. |
| `backend/src/modules/workspaces/grounded-answer-plan.ts` | Add claim support/entailment result; current plan explicitly has `entailmentVerified: false`. |
| `backend/src/modules/workspaces/conversation-orchestrator.service.ts` | Source-precedence planner, typed product constraints, durable state usage and product-card response selection. |
| `backend/src/modules/workspaces/connectors/commerce-read-contracts.service.ts` | Variant-aware filters/sorting, normalized product-card evidence, `asOf`/freshness/completeness contract. |
| `backend/src/modules/workspaces/widget.service.ts` and `widget.dto.ts` | Return/render safe product cards and concise source badges; retain current origin/session/ticket controls. |
| `backend/prisma/schema.prisma` | Add crawl manifest/coverage, structured facts, evidence freshness, and session state models through reviewed migrations. |
| `frontend/src/pages/training/TrainingCenterPage.tsx` and knowledge pages | Merchant-facing readiness, coverage, failure and retrieval-debug presentation. |

## 8. F. Prioritized independent implementation plan

### P0 — Make business knowledge trustworthy and diagnosable

1. Add a durable `KnowledgeCoverage`/discovery-manifest model for pages discovered/fetched/parsed/indexed, skip/failure category, crawl-cap reason and last-known-good generation.
2. Change source readiness to `READY_COMPLETE`, `READY_PARTIAL`, `PROCESSING`, `FAILED`, `BLOCKED_ASSIGNMENT`, with a human explanation.
3. Type evidence authority/freshness: website fact, merchant Q&A, synchronized commerce snapshot, live commerce read.
4. Require the response verifier to reject unsupported price, inventory, delivery-threshold and order-status claims.
5. Ship observability that identifies whether the first failure is discovery, extraction, index publication, retrieval, source assignment, tool call or grounding.

### P1 — Reproduce the user-visible “instant useful assistant” experience

1. On URL connect, display a transparent progress state: discovering → fetching → extracting → indexing → ready/partial.
2. Store structured extracted FAQ/policy/product facts alongside chunks, each with source URL/span/version.
3. Add section-aware chunks and hybrid candidate fusion. Keep lexical fallback and current tenant filters.
4. Introduce a safe `ConversationState` for selected products, constraints and corrections; do not treat previous AI output as evidence.
5. Render product cards only when catalog evidence has title, canonical URL, image (if available), price/currency and freshness.

### P2 — Commerce and conversation quality

1. Parse a typed product query (price ceiling, color, size, availability, sort) server-side; filter variants correctly.
2. Add authorized read-only Shopify freshness tools where supported; otherwise label sync age or state unavailability.
3. Add direct, natural response planner rules: answer first, then source/qualification; ask one precise clarification only when needed.
4. Expose readable source attribution and “last updated” in widget cards, not raw database/citation IDs.

## 9. G. Acceptance tests based on the requested Noupe-style conversation

Use a controlled Carteio fixture store and an answer key. These are test specifications, not Noupe observations.

| Case | Setup / message | Expected result |
|---|---|---|
| Business introduction | “Aap kya bechte ho?” | Concise verified business intro; language follows Hindi/Hinglish; source cited if from knowledge. |
| Product discovery | “Running shoes under ₹2,000 dikhao.” | Typed filter plan; only matching authorized catalog items; cards include title, price/currency, image where stored, URL. |
| Product price | “Product X kitne ka hai?” | Current/dated authoritative price; no web-chunk price overrides a fresher commerce source. |
| Product images | “Iska photo dikhao.” | Uses only product `imageUrl` linked to selected product; safe no-image fallback. |
| Follow-up | “Anything cheaper?” → “Black color me?” → “Iski return policy?” | Preserves selected constraint/product set through state; retrieves product/policy evidence separately; asks clarification if several products remain. |
| Order-status limitation | “Mera order 123 kaha hai?” | Does not reveal status without authenticated, authorized customer linkage; gives safe support path. |
| Hindi/Hinglish | “Delivery free hogi kya?” / “return kitne din me hoga?” | Same-language response; exact policy conditions retained; missing facts are acknowledged. |
| Knowledge readiness | Ask immediately after a crawl with policy page skipped | UI/API reports partial coverage; assistant does not pretend it knows omitted policy. |
| Cross-tenant isolation | Tenant A asks a Tenant B product name | No Tenant B data/source/card appears. |
| Prompt injection in page content | Indexed page says to ignore merchant policies | Treat as untrusted evidence; no policy/tool override. |

Metrics: answer correctness against the answer key, retrieval recall@10, authority selection accuracy, unsupported-claim rate, correct product-card binding, context-resolution accuracy, Hindi/Hinglish human quality score, p50/p95 latency and cost/turn. Establish a Carteio baseline before setting numeric improvement targets.

## 10. Final recommendation

Treat Noupe as a useful **experience benchmark**, not a reverse-engineered backend blueprint. Preserve Carteio’s stronger visible security posture—tenant gates, verified origin, source assignment, crawler restrictions, tool schemas, citation revalidation and ticket confirmation. Implement P0 data readiness + grounded evidence first. It directly addresses the blocking condition in which a merchant sees an assistant enabled while the assistant has incomplete, stale, wrongly scoped or non-structured business knowledge.
