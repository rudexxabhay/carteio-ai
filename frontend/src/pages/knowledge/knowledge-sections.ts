import type { KnowledgeSection } from '../../services/api/knowledge';

export const KNOWLEDGE_SECTION_CARDS: Array<{ id: KnowledgeSection; tab: string; title: string; description: string }> = [
  { id: 'BUSINESS_INTRODUCTION', tab: 'business-introduction', title: 'Business Introduction', description: 'Company overview, services, locations and public business details.' },
  { id: 'SHIPPING_DELIVERY', tab: 'shipping-delivery', title: 'Shipping & Delivery', description: 'Dispatch, delivery timelines, charges and tracking procedures.' },
  { id: 'RETURNS_REFUNDS', tab: 'returns-refunds', title: 'Returns & Refunds', description: 'Eligibility, return windows, exchanges and refund conditions.' },
  { id: 'PAYMENT_CANCELLATION', tab: 'payment-cancellation', title: 'Payment & Cancellation', description: 'Payment methods and general cancellation policies.' },
  { id: 'WARRANTY_SUPPORT_FAQS', tab: 'warranty-support-faqs', title: 'Warranty, Support & FAQs', description: 'Warranty terms, support contacts and common questions.' },
];

export const SHOPIFY_CATALOG_TAB = 'products-collections';
