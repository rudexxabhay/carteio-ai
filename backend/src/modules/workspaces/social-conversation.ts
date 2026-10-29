import { isValidatedConversationalContinuation } from './multilingual-semantics';
import type { MultilingualSemanticInterpretation, SocialClassification } from './multilingual-semantics';

export { SOCIAL_CLASSIFICATIONS } from './multilingual-semantics';
export type { SocialClassification } from './multilingual-semantics';
export type SafeSocialCategory = Extract<SocialClassification, 'GREETING' | 'WELLBEING_EXCHANGE' | 'ACKNOWLEDGMENT' | 'GRATITUDE' | 'FAREWELL'>;
export type SocialGuardDecision = 'SAFE_SOCIAL_RESPONSE' | 'CONTINUE_BUSINESS_PIPELINE' | 'CLARIFICATION_REQUIRED' | 'EXISTING_SAFETY_HANDLING';
export type SocialReplyLanguage = 'English' | 'Hindi' | 'Hinglish';

const safeCategories = new Set<SocialClassification>(['GREETING', 'WELLBEING_EXCHANGE', 'ACKNOWLEDGMENT', 'GRATITUDE', 'FAREWELL']);
export function isSafeSocialCategory(value: SocialClassification): value is SafeSocialCategory {
  return safeCategories.has(value);
}
const matchingIntent: Readonly<Record<SafeSocialCategory, string>> = {
  GREETING: 'GREETING',
  WELLBEING_EXCHANGE: 'WELLBEING_EXCHANGE',
  ACKNOWLEDGMENT: 'ACKNOWLEDGMENT',
  GRATITUDE: 'GRATITUDE',
  FAREWELL: 'FAREWELL',
};
// A compact defense-in-depth deny signal for common direct extraction/instruction attacks.
// This is never used to classify a message as social; it can only veto the social shortcut.
const unsafeSocialInstruction = /(?:\b(?:ignore|disregard|override|forget)\b.{0,48}\b(?:system|developer|previous|prior|safety|security)\b.{0,32}\b(?:instruction|prompt|rule|policy)s?\b|\b(?:reveal|show|print|disclose|share|dump)\b.{0,48}\b(?:system|developer|hidden|private|personal|customer|other users?)\b.{0,32}\b(?:prompt|instruction|data|information|record|details?)\b|\b(?:private|customer|personal)\s+(?:customer\s+)?(?:data|information|records?)\b|(?:नियम|निर्देश|सिस्टम).{0,32}(?:अनदेखा|बदल|भूल).{0,32}(?:दिखा|बताओ|दो)|(?:निजी|ग्राहक).{0,24}(?:जानकारी|डेटा|रिकॉर्ड).{0,24}(?:दिखा|बताओ|दो))/iu;

export function decideSocialResponse(input: {
  classification: SocialClassification;
  semantic: MultilingualSemanticInterpretation | null;
  legacyIntent?: string;
  message: string;
}): Readonly<{ decision: SocialGuardDecision; reason: string }> {
  const { classification, semantic, message } = input;
  if (classification === 'BUSINESS_REQUEST_WITH_GREETING') return { decision: 'CONTINUE_BUSINESS_PIPELINE', reason: 'BUSINESS_REQUEST_PRESENT' };
  if (classification === 'AMBIGUOUS' || classification === 'UNKNOWN') return { decision: 'CONTINUE_BUSINESS_PIPELINE', reason: 'SOCIAL_CLASSIFICATION_UNCERTAIN' };
  const validatedContinuation = Boolean(semantic && classification === semantic.socialClassification && isValidatedConversationalContinuation(semantic));
  if (!safeCategories.has(classification) && !validatedContinuation) return { decision: 'CONTINUE_BUSINESS_PIPELINE', reason: 'NOT_A_PURE_SOCIAL_MESSAGE' };
  if (!semantic || semantic.uncertainty !== 'NONE' || semantic.clarificationRequired) return { decision: 'CONTINUE_BUSINESS_PIPELINE', reason: 'SEMANTIC_INTERPRETATION_UNCERTAIN' };
  if (unsafeSocialInstruction.test(message)) return { decision: 'EXISTING_SAFETY_HANDLING', reason: 'UNSAFE_SOCIAL_SHORTCUT_INPUT' };
  if (validatedContinuation) {
    return { decision: 'SAFE_SOCIAL_RESPONSE', reason: 'VALIDATED_PURE_SOCIAL_MESSAGE' };
  }
  const negativeAcknowledgment = classification === 'ACKNOWLEDGMENT'
    && semantic.intents.length === 1
    && semantic.intents[0]?.category === 'ACKNOWLEDGMENT'
    && semantic.intents[0]?.polarity === 'NEGATED';
  if (!semantic.intents.length || semantic.intents.some((intent) => (!safeCategories.has(intent.category as SocialClassification)
    || (intent.polarity !== 'AFFIRMATIVE' && intent.polarity !== 'NOT_APPLICABLE' && !(negativeAcknowledgment && intent.category === 'ACKNOWLEDGMENT'))))) {
    return { decision: 'CONTINUE_BUSINESS_PIPELINE', reason: 'SUBSTANTIVE_OR_NEGATED_INTENT_PRESENT' };
  }
  if (semantic.entities.length) return { decision: 'CONTINUE_BUSINESS_PIPELINE', reason: 'ENTITY_REQUIRES_NORMAL_ROUTING' };
  const category = classification as SafeSocialCategory;
  if (!semantic.intents.some((intent) => intent.category === matchingIntent[category])) return { decision: 'CONTINUE_BUSINESS_PIPELINE', reason: 'SOCIAL_CLASSIFICATION_CONTRADICTS_INTENT' };
  // The separately validated semantic act is authoritative for conversational
  // routing. The legacy intent is compatibility metadata and may retain a
  // prior-turn label; it never grants data access or a tool capability.
  return { decision: 'SAFE_SOCIAL_RESPONSE', reason: 'VALIDATED_PURE_SOCIAL_MESSAGE' };
}

/** Exact whole-message shortcuts only; broad informal language uses the shared semantic stage. */
export function classifyDeterministicSocialMessage(message: string): Readonly<{ category: SafeSocialCategory; language: SocialReplyLanguage }> | null {
  const value = message.trim().replace(/^[\s.,!?¡¿]+|[\s.,!?¡¿]+$/gu, '').replace(/\s+/gu, ' ');
  const normalized = value.toLocaleLowerCase().replace(/[,.!?¡¿]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (/^(?:नमस्ते|नमस्कार|हाय|हैलो|हेलो)$/u.test(normalized)) return { category: 'GREETING', language: 'Hindi' };
  if (/^(?:कैसे हो|कैसे हैं|कैसी हो|क्या हाल है|क्या हाल-चाल है)(?:\s+(?:भाई|यार|दोस्त|जी))?$/u.test(normalized)) return { category: 'WELLBEING_EXCHANGE', language: 'Hindi' };
  if (/^(?:ठीक है|ठीक|समझ गया|समझ गई|समझ गया हूँ|समझ गई हूँ)$/u.test(normalized)) return { category: 'ACKNOWLEDGMENT', language: 'Hindi' };
  if (/^(?:धन्यवाद|शुक्रिया)$/u.test(normalized)) return { category: 'GRATITUDE', language: 'Hindi' };
  if (/^(?:अलविदा|फिर मिलेंगे)$/u.test(normalized)) return { category: 'FAREWELL', language: 'Hindi' };
  if (/^(?:namaste|namaskar|salaam|salam|assalamualaikum)$/u.test(normalized)) return { category: 'GREETING', language: 'Hinglish' };
  if (/^(?:kaise ho|kaise hain|kaisi ho|kya haal hai|kya haal chaal hai)(?:\s+(?:bhai|yaar|dost|ji))?$/u.test(normalized)) return { category: 'WELLBEING_EXCHANGE', language: 'Hinglish' };
  if (/^(?:thik hai|theek hai|samajh gaya|samajh gya|samajh gayi|samajh gyi|samajh gaya hoon|samajh gya hu)$/u.test(normalized)) return { category: 'ACKNOWLEDGMENT', language: 'Hinglish' };
  if (/^(?:shukriya|dhanyavaad)$/u.test(normalized)) return { category: 'GRATITUDE', language: 'Hinglish' };
  if (/^(?:alvida|phir milenge)$/u.test(normalized)) return { category: 'FAREWELL', language: 'Hinglish' };
  if (/^(?:(?:hello|hi|hey(?: there)?|good morning|good afternoon|good evening)(?: how are you)?|how are you(?: doing)?|how(?:'s|’s| is) it going|how are things|what's up|what’s up)$/u.test(normalized)) {
    return /^(?:how are you|how are you doing|how(?:'s|’s| is) it going|how are things|what's up|what’s up)$/u.test(normalized)
      ? { category: 'WELLBEING_EXCHANGE', language: 'English' }
      : { category: 'GREETING', language: 'English' };
  }
  if (/^(?:(?:ok|okay|got it|understood)\s+)?(?:bye|goodbye|good bye|see you|see you later|take care|good night)$/u.test(normalized)) return { category: 'FAREWELL', language: 'English' };
  if (/^(?:ok|okay|okey|okie|got it|understood)$/u.test(normalized)) return { category: 'ACKNOWLEDGMENT', language: 'English' };
  if (/^(?:thanks|thank you|thank you so much|thanks a lot)$/u.test(normalized)) return { category: 'GRATITUDE', language: 'English' };
  if (/^(?:bye|goodbye|good bye|see you|see you later|good night)$/u.test(normalized)) return { category: 'FAREWELL', language: 'English' };
  return null;
}

function normalizeLanguage(value: string | null | undefined): SocialReplyLanguage | null {
  const language = value?.trim().toLocaleLowerCase().replaceAll('_', '-');
  if (!language) return null;
  if (['english', 'en', 'en-us', 'en-gb'].includes(language)) return 'English';
  if (['hindi', 'hi', 'hi-in'].includes(language)) return 'Hindi';
  if (['hinglish', 'hi-latn', 'romanized hindi', 'romanised hindi', 'hindi and english', 'english and hindi', 'hindi/english', 'english/hindi', 'hindi-english', 'english-hindi'].includes(language)) return 'Hinglish';
  return null;
}

export function resolveSocialReplyLanguage(input: {
  requested?: string | null;
  assistantDefault?: string | null;
  detectedLanguage?: string | null;
  detectedScripts?: readonly string[];
  detectedMixed?: boolean;
}): SocialReplyLanguage | null {
  if (input.requested?.trim()) return normalizeLanguage(input.requested);
  const detected = normalizeLanguage(input.detectedLanguage);
  if (detected === 'Hindi' && input.detectedScripts?.some((script) => /devanagari/i.test(script))) return 'Hindi';
  if (detected === 'Hindi' || input.detectedMixed) return 'Hinglish';
  if (detected) return detected;
  if (input.assistantDefault && input.assistantDefault.toLowerCase() !== 'auto') return normalizeLanguage(input.assistantDefault);
  return null;
}

const responses: Readonly<Record<SafeSocialCategory, Readonly<Record<SocialReplyLanguage, string>>>> = {
  GREETING: {
    English: 'Hi! What can I help you with today?',
    Hindi: 'नमस्ते! बताइए, मैं आपकी कैसे मदद करूँ?',
    Hinglish: 'Namaste! Bataiye, main aapki kaise madad karun?',
  },
  WELLBEING_EXCHANGE: {
    English: "I'm doing well, thanks! What can I help you with?",
    Hindi: 'मैं बढ़िया हूँ, पूछने के लिए धन्यवाद! बताइए, मैं कैसे मदद करूँ?',
    Hinglish: 'Main badhiya hoon, poochhne ke liye shukriya! Bataiye, main kaise help karun?',
  },
  ACKNOWLEDGMENT: {
    English: 'Understood. Let me know if you need anything else.',
    Hindi: 'समझ गया। अगर आपको और मदद चाहिए, तो बताइए।',
    Hinglish: 'Samajh gaya. Aur kisi madad ki zaroorat ho, toh bataiye.',
  },
  GRATITUDE: {
    English: "You're welcome! Let me know how I can help.",
    Hindi: 'आपका स्वागत है! बताइए, मैं और कैसे मदद करूँ?',
    Hinglish: 'Aapka swagat hai! Bataiye, main aur kaise help karun?',
  },
  FAREWELL: {
    English: 'Bye! Take care. I’m here whenever you need help.',
    Hindi: 'अलविदा! अपना ध्यान रखिए। ज़रूरत हो तो फिर से पूछिए।',
    Hinglish: 'Alvida! Apna khayal rakhiye. Zaroorat ho toh phir poochhiye.',
  },
};

const acknowledgmentVariants: Readonly<Record<SocialReplyLanguage, readonly string[]>> = {
  English: ['Understood. Let me know if you need anything else.', 'Got it. I’m here if you have another question.'],
  Hindi: ['समझ गया। अगर आपको और मदद चाहिए, तो बताइए।', 'ठीक है। कोई और सवाल हो, तो पूछिए।'],
  Hinglish: ['Samajh gaya. Aur kisi madad ki zaroorat ho, toh bataiye.', 'Theek hai. Koi aur sawaal ho, toh poochhiye.'],
};

export function generateSafeSocialReply(category: SafeSocialCategory, language: SocialReplyLanguage, tone: string, configuredGreeting?: string | null, variationSeed = ''): string {
  if (category === 'GREETING' && language === 'English' && configuredGreeting?.trim() && isSafeConfiguredGreeting(configuredGreeting)) return configuredGreeting.trim();
  if (category === 'ACKNOWLEDGMENT') {
    const variants = acknowledgmentVariants[language];
    const index = [...variationSeed].reduce((sum, character) => (sum + (character.codePointAt(0) ?? 0)) % variants.length, 0);
    return variants[index] ?? variants[0] ?? responseFallback(language);
  }
  const response = responses[category][language];
  if (['formal', 'professional'].includes(tone.toLowerCase()) && category === 'GREETING' && language === 'English') return 'Hi! How can I help you today?';
  return response;
}

function responseFallback(language: SocialReplyLanguage): string {
  return language === 'Hindi' ? 'ठीक है।' : language === 'Hinglish' ? 'Theek hai.' : 'Understood.';
}

/** Server-known identity only; company location remains a grounded Knowledge question. */
export function generateSafeAssistantIdentityReply(language: SocialReplyLanguage): string {
  if (language === 'Hindi') return 'मैं इस व्यवसाय का AI सहायक हूँ, इसलिए मेरा कोई निजी घर या जन्मस्थान नहीं है। अगर आप कंपनी की जगह पूछ रहे हैं, तो मैं उसकी सार्वजनिक व्यावसायिक जानकारी के आधार पर मदद कर सकता हूँ।';
  if (language === 'Hinglish') return 'Main is business ka AI assistant hoon, isliye mera koi personal ghar ya birthplace nahi hai. Agar aap company ki location pooch rahe hain, toh main uski public business information ke basis par help kar sakta hoon.';
  return "I'm an AI assistant for this business, so I don't have a personal home or birthplace. If you mean the company's location, I can help using its public business information.";
}

function isSafeConfiguredGreeting(value: string): boolean {
  return value.length <= 120
    && !unsafeSocialInstruction.test(value)
    && !/\b(?:order|shipment|tracking|refund|payment|price|pricing|policy|available|availability|appointment|booking|account|delivery|guarantee|track)\b|(?:ऑर्डर|शिपमेंट|रिफंड|भुगतान|कीमत|नीति|बुकिंग|डिलीवरी)/iu.test(value);
}
