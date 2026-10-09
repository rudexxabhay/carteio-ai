import { Meta } from '../../components/common/Meta';
import { HeroSection } from './sections/HeroSection';
import { WhatAndProblemsSection } from './sections/WhatAndProblemsSection';
import { WorkflowSection } from './sections/WorkflowSection';
import { CapabilitiesAndConnectionsSection } from './sections/CapabilitiesAndConnectionsSection';
import { InstallAndPermissionsSection } from './sections/InstallAndPermissionsSection';
import { UseCasesAndTrustSection } from './sections/UseCasesAndTrustSection';
import { CustomizationAndHelpSection } from './sections/CustomizationAndHelpSection';

export function LandingPage() {
  return <div className="landing-page">
    <Meta title="One AI Platform. Every Business Connection." description="Carteio AI is being built to connect helpful AI assistants with business knowledge, applications, and owner-controlled permissions." path="/" />
    <HeroSection />
    <div className="landing-proof-band"><div className="landing-container"><span>BUILT FOR BUSINESS CONTEXT</span><i/><span>PLANNED FOR CONTROLLED CONNECTIONS</span><i/><span>HONEST ABOUT WHAT’S AVAILABLE</span></div></div>
    <WhatAndProblemsSection />
    <WorkflowSection />
    <CapabilitiesAndConnectionsSection />
    <InstallAndPermissionsSection />
    <UseCasesAndTrustSection />
    <CustomizationAndHelpSection />
  </div>;
}
