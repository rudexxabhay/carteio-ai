# Live Flowise Website Audit

Date: 2026-10-18 (UTC)

## Scope and method

This audit covers the public marketing website at `https://flowiseai.com/`, not the authenticated Flowise application. REA's browser target listing was restricted to the exact origin `https://flowiseai.com`; the selected page was `FAC3B401DA772B41FB0F7008F40F972A`, titled “Flowise - Build AI Agents, Visually”. The browser reported Chrome `155.0.8059.82`.

REA verification succeeded in two independent ways: passive page inspection (`inspect_web_page`) returned the DOM and accessibility tree, and `capture_web_screenshot` returned a PNG. A controlled REA scenario then reloaded the same homepage and clicked the observed `button[aria-controls]` at a 390×844 viewport, waited 250 ms, and captured URL, accessibility and screenshot. The scenario disconnected from (did not close) the external browser afterward. No authentication, unrelated pages, credentials, storage values, or form data were accessed.

Evidence IDs:

- Target discovery: `ev_86b0b8d57d67bdbf50814d3f223f25537ac34795dbd892c47d81f1c7a8473a8c`
- Passive DOM/accessibility page inspection: `ev_9076c86a0e89ef13610b6cb6c20b729a3ac3d21c2794cf0b687c322da61dfc6e`
- Desktop screenshot, 1920×794: `ev_5eec9ee35d3dc28cd29ab08f15453deca8cfd84d3c2744531c4119e683d8aba1` (PNG SHA-256 `bafb46f7aa87be15f56fc841aef70f2516ad5ed347ef2c3ba8451cbd0e887960`)
- Mobile-width scenario: `ev_7d29f1011f78d4640d76f78391e947a2c66a08839dd9d91caada884eeab0b492`
- Mobile screenshot SHA-256: `9670aef729944671b3aa00a7175b2f4e542557b2c4443e0ce21ac03c8bc5e885`

## Observed marketing experience

### Header and hero

- A full-width dark announcement strip sits above the page: “We're sunsetting Flowise.” with a “Learn more” link and close icon. This is what the live page displayed during this capture; it is time-sensitive.
- The dark header contains the Flowise mark with “A Workday Company”, a GitHub star control/counter, and navigation to Features, Case Studies, Pricing, Community, Webinars, Docs, and Get Started.
- The hero is centered on a near-black background. It uses the large two-line headline “Build AI Agents Visually”; “Visually” has a purple-to-blue gradient. A muted blue-gray subtitle describes an open-source agentic systems development platform. Primary Get Started and secondary GitHub pill buttons sit below.
- A large framed Agentic Workflow editor preview begins directly below the calls to action. The screenshot shows a dark dotted canvas with a compact toolbar, edit/save/settings controls, and brightly colored node controls. This is a product illustration embedded in the landing page; its actual workflow behavior was not exercised here.
- The page uses a restrained dark palette, white headings, muted blue-gray supporting copy, purple/blue gradients, rounded pill buttons, and a thin curved-line decoration in the hero's upper-right corner.

### Homepage sections and content inventory

The accessibility tree exposed these main page landmarks and headings, in document order: “Iterate, fast”; feature cards for Multi Agents, Chat Assistants, Human In the Loop, Execution Traces, API/SDK/Embed, and Production Scale; Customer Success Stories; Pricing; Community; Webinars; affiliate promotion; and Enterprise. Pricing includes Free, Pro and Starter headings. The footer exposes Terms of Service, Privacy Policy, social links, and the primary navigation links again.

The community area embeds social posts. The webinar area includes webinar cards and partner logos. The page also exposes carousel pagination buttons named “Go to slide 1” through “Go to slide 6”. The inspection found repeated “Learn More” and “Get Started” CTAs across content sections. These are accessibility/DOM observations; every destination and the whole-page visual ordering below the first screen were not individually exercised.

## Interaction and responsive capture

The mobile scenario completed both declared steps (`click` and wait) and remained at `https://flowiseai.com/`; no page errors were captured. At the 390×844 capture, the page showed only the logo/star area of the header, a cropped portion of the oversized hero title, and a cropped workflow preview. Navigation links and the clicked control's expanded menu were not visible in the resulting screenshot. This supports a bounded observation that this viewport did not present a clean mobile composition in this capture. It does not establish the site's behavior at other widths or explain the cause. The screenshot could not establish hover styling, animation timing, keyboard interactions, or whether the mobile navigation exposes off-screen content.

Desktop screenshot observation: the captured page at 1920×794 displayed the announcement, complete desktop nav, centered hero, calls to action, and top of the editor illustration. No scroll, hover, or carousel-slide action was included in that screenshot capture. Therefore animation, transitions, hover details, full lower-page geometry, and CTA destinations remain unverified.

## Coverage and limitations

- REA target discovery intentionally filtered to the Flowise website origin; it reported eight non-page targets excluded by that filter. No other target was selected.
- Passive inspection was attached after page load. Its capture had policy-filtered and attach-limited sections, including non-Flowise-origin resources and portions of network activity. It provides DOM/accessibility observations, not complete network or source coverage.
- The interaction scenario reports successful action completion, but the screenshot did not visually demonstrate an opened menu. Treat “click action completed” as verified and “menu opened” as unknown.
- This was a public, unauthenticated marketing page audit. No dashboard, login, builder, API, or workflow execution behavior is established by this report; those require source-level and/or separately authorized application evidence.
- Evidence is a point-in-time observation. The sunset banner and star count may change.

## Reconstruction implications

For a CARTEIO-branded marketing page inspired by the observed composition, prioritize the dark global shell, compact announcement strip, desktop navigation, oversized gradient-accent hero, two distinct CTA treatments, and a prominent builder preview. Treat lower sections as a long-form marketing page containing capabilities, customer stories, pricing tiers, community/social proof, webinars, enterprise and footer links. At small widths, measure and validate actual layout and menu behavior rather than assuming the captured Flowise page is responsive: this capture visibly clipped key content.

