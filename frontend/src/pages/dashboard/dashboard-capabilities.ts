export type DashboardCapabilityId = 'ai_assistants' | 'knowledge_management' | 'ai_training' | 'chat_playground' | 'public_widget' | 'real_chat_analytics' | 'ecommerce_orders' | 'logistics_trips' | 'saas_customer_data';
export interface DashboardCapability {
  id: DashboardCapabilityId;
  label: string;
  supported: boolean;
  enabled: boolean;
  integrationRequired: boolean;
}

export const supportedBusinessTypes = [
  { value: 'ECOMMERCE', label: 'E-commerce' },
  { value: 'HEALTHCARE', label: 'Healthcare' },
  { value: 'LANDING_PAGE', label: 'Landing page / website' },
  { value: 'SERVICE_BUSINESS', label: 'Service business' },
  { value: 'GENERAL_BUSINESS', label: 'General business' },
] as const;

export type BusinessType = typeof supportedBusinessTypes[number]['value'];

export function resolveBusinessType(value: string | null | undefined): BusinessType {
  const normalized = value?.trim().toLocaleLowerCase().replace(/[\s-]+/g, '_') || '';
  if (['ecommerce', 'e_commerce', 'commerce', 'retail'].includes(normalized)) return 'ECOMMERCE';
  if (['healthcare', 'health', 'clinic', 'medical'].includes(normalized)) return 'HEALTHCARE';
  if (['landing_page', 'landingpage', 'website', 'marketing_website'].includes(normalized)) return 'LANDING_PAGE';
  if (['service_business', 'services', 'professional_services', 'professional'].includes(normalized)) return 'SERVICE_BUSINESS';
  return 'GENERAL_BUSINESS';
}

const businessProfiles: Record<BusinessType, { label: string; context: string; focus: string }> = {
  ECOMMERCE: { label: 'E-commerce', context: 'Review authorized catalog and order data alongside your AI setup.', focus: 'Commerce figures appear only when an integration has synchronized real records.' },
  HEALTHCARE: { label: 'Healthcare', context: 'Manage general service information and assistant readiness with privacy in mind.', focus: 'Patient records and appointment data are not available in this dashboard.' },
  LANDING_PAGE: { label: 'Landing page & website', context: 'Review website profile details and the AI content you have configured.', focus: 'Website traffic and lead metrics require verified tracking or lead records.' },
  SERVICE_BUSINESS: { label: 'Service business', context: 'Prepare service guidance and assistants for your workspace.', focus: 'Booking and request metrics appear when a supported operational source is connected.' },
  GENERAL_BUSINESS: { label: 'General business', context: 'Manage your assistants, shared knowledge and workspace readiness.', focus: 'Connect an authorized data source to see business metrics here.' },
};

// Platform support/enabled state is explicit. Industry preferences never enable a capability.
export const dashboardCapabilities: readonly DashboardCapability[] = [
  { id: 'ai_assistants', label: 'AI Assistants', supported: true, enabled: true, integrationRequired: false },
  { id: 'knowledge_management', label: 'Knowledge Base', supported: true, enabled: true, integrationRequired: false },
  { id: 'ai_training', label: 'AI Training', supported: true, enabled: true, integrationRequired: false },
  { id: 'chat_playground', label: 'Playground', supported: true, enabled: true, integrationRequired: false },
  { id: 'public_widget', label: 'Public chat widget', supported: false, enabled: false, integrationRequired: false },
  { id: 'real_chat_analytics', label: 'Chat analytics', supported: false, enabled: false, integrationRequired: false },
  { id: 'ecommerce_orders', label: 'Orders', supported: false, enabled: false, integrationRequired: true },
  { id: 'logistics_trips', label: 'Trips', supported: false, enabled: false, integrationRequired: true },
  { id: 'saas_customer_data', label: 'Customer activity', supported: false, enabled: false, integrationRequired: true },
];

export function businessProfile(value: string | null | undefined) {
  return businessProfiles[resolveBusinessType(value)];
}

export const enabledDashboardCapabilities = dashboardCapabilities.filter((capability) => capability.supported && capability.enabled);
