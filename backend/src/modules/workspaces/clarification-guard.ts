import type { MultilingualSemanticInterpretation, SemanticIntent } from './multilingual-semantics';
import type { ConversationContinuityAct } from './conversation-intent';

export type ClarificationReason = 'AMBIGUOUS_INTENT' | 'MISSING_REQUIRED_ENTITY' | 'AMBIGUOUS_REFERENCE' | 'EXPIRED_REFERENCE_CONTEXT' | 'UNSAFE_REFERENCE' | 'INSUFFICIENT_BUSINESS_CONTEXT' | 'MULTIPLE_POSSIBLE_TARGETS' | 'UNSUPPORTED_INFORMATION_NEED' | 'UNCERTAIN_LANGUAGE_INTERPRETATION' | 'CONTRADICTORY_SIGNALS';
export type ClarificationDecision = Readonly<{ required: boolean; reason?: ClarificationReason }>;

const activeCategories = (semantic: MultilingualSemanticInterpretation) => semantic.intents
  .filter((intent) => intent.polarity === 'AFFIRMATIVE' || intent.polarity === 'UNCERTAIN')
  .map((intent) => intent.category);

export function decideClarification(semantic: MultilingualSemanticInterpretation | null, legacyIntent?: string, resolvedReference = false, continuityAct: ConversationContinuityAct = 'UNKNOWN'): ClarificationDecision {
  if (!semantic) return { required: true, reason: 'UNCERTAIN_LANGUAGE_INTERPRETATION' };
  if (continuityAct === 'CONTRADICTION') return { required: true, reason: 'CONTRADICTORY_SIGNALS' };
  if (semantic.uncertainty === 'UNKNOWN' && (legacyIntent === 'unknown' || (activeCategories(semantic).includes('UNKNOWN') && !['business', 'capability'].includes(legacyIntent ?? '')))) return { required: true, reason: 'UNCERTAIN_LANGUAGE_INTERPRETATION' };
  if (semantic.uncertainty !== 'UNKNOWN' && semantic.intents.some((intent) => intent.polarity === 'UNCERTAIN')) return { required: true, reason: 'CONTRADICTORY_SIGNALS' };
  if (semantic.uncertainty === 'AMBIGUOUS' || semantic.informationNeed === 'AMBIGUOUS') {
    const intents = activeCategories(semantic);
    if ((intents.includes('PAYMENT_INQUIRY') && intents.includes('REFUND_INQUIRY')) || intents.includes('PAYMENT_INQUIRY')) return { required: true, reason: 'AMBIGUOUS_INTENT' };
    if (intents.includes('FOLLOW_UP')) return { required: true, reason: 'AMBIGUOUS_REFERENCE' };
    if (intents.includes('AVAILABILITY_INQUIRY') && !semantic.entities.some((entity) => entity.type === 'PRODUCT_NAME')) return { required: true, reason: 'MISSING_REQUIRED_ENTITY' };
    if (intents.includes('BOOKING_INQUIRY') && !semantic.entities.some((entity) => entity.type === 'BOOKING_REFERENCE')) return { required: true, reason: 'MISSING_REQUIRED_ENTITY' };
    if (semantic.uncertainty === 'AMBIGUOUS' || semantic.clarificationRequired) return { required: true, reason: 'AMBIGUOUS_INTENT' };
  }
  if (semantic.clarificationRequired && semantic.uncertainty !== 'UNKNOWN') return { required: true, reason: 'AMBIGUOUS_INTENT' };
  const intents: readonly SemanticIntent[] = activeCategories(semantic);
  if (intents.includes('FOLLOW_UP') && !resolvedReference) return { required: true, reason: 'AMBIGUOUS_REFERENCE' };
  return { required: false };
}

export function clarificationReply(reason: ClarificationReason, language: 'English' | 'Hindi' | 'Hinglish' | null): string {
  const english: Record<ClarificationReason, string> = {
    AMBIGUOUS_INTENT: 'Are you asking about general payment or refund information, or a specific transaction?',
    MISSING_REQUIRED_ENTITY: 'Which product or booking are you referring to?',
    AMBIGUOUS_REFERENCE: 'Which item or request are you referring to?',
    EXPIRED_REFERENCE_CONTEXT: 'I can’t safely tell which earlier request you mean. Could you name the topic again?',
    UNSAFE_REFERENCE: 'I can’t use an item mentioned only in an earlier assistant reply as proof. Please restate the question without private account details.',
    INSUFFICIENT_BUSINESS_CONTEXT: 'Could you clarify what business information you need?',
    MULTIPLE_POSSIBLE_TARGETS: 'Which one should I help with?',
    UNSUPPORTED_INFORMATION_NEED: 'Could you clarify whether you need general information or a current personal status?',
    UNCERTAIN_LANGUAGE_INTERPRETATION: 'Could you rephrase what you need help with?',
    CONTRADICTORY_SIGNALS: 'I’m not sure whether you want to proceed or avoid that action. Which do you mean?',
  };
  const hinglish: Record<ClarificationReason, string> = {
    AMBIGUOUS_INTENT: 'Aap general payment ya refund information pooch rahe hain, ya kisi specific transaction ke baare mein?',
    MISSING_REQUIRED_ENTITY: 'Aap kis product ya booking ki baat kar rahe hain?',
    AMBIGUOUS_REFERENCE: 'Aap kis cheez ya request ki baat kar rahe hain?',
    EXPIRED_REFERENCE_CONTEXT: 'Mujhe pehle wali request ka context nahi mil raha. Topic dobara bata denge?',
    UNSAFE_REFERENCE: 'Pehle assistant reply mein aayi kisi detail ko main proof nahi maan sakta. Kripya private account details share kiye bina sawal dobara batayein.',
    INSUFFICIENT_BUSINESS_CONTEXT: 'Aapko business se judi kaunsi information chahiye, thoda clarify karenge?',
    MULTIPLE_POSSIBLE_TARGETS: 'Aap kis wale ke baare mein madad chahte hain?',
    UNSUPPORTED_INFORMATION_NEED: 'Aap general information chahte hain ya apna current status?',
    UNCERTAIN_LANGUAGE_INTERPRETATION: 'Aapko kis baat mein madad chahiye, thoda aur bata sakte hain?',
    CONTRADICTORY_SIGNALS: 'Mujhe clear nahi hai ki aap yeh action karna chahte hain ya nahi. Aapka matlab kya hai?',
  };
  const hindi: Record<ClarificationReason, string> = {
    AMBIGUOUS_INTENT: 'क्या आप सामान्य भुगतान या रिफंड की जानकारी पूछ रहे हैं, या किसी खास लेन-देन के बारे में?',
    MISSING_REQUIRED_ENTITY: 'आप किस उत्पाद या बुकिंग की बात कर रहे हैं?',
    AMBIGUOUS_REFERENCE: 'आप किस चीज़ या अनुरोध की बात कर रहे हैं?',
    EXPIRED_REFERENCE_CONTEXT: 'मुझे पहले के अनुरोध का संदर्भ सुरक्षित रूप से नहीं मिल रहा। कृपया विषय फिर से बताएं।',
    UNSAFE_REFERENCE: 'पहले सहायक के उत्तर में आई जानकारी को मैं प्रमाण नहीं मान सकता। निजी खाता विवरण साझा किए बिना सवाल दोबारा बताएं।',
    INSUFFICIENT_BUSINESS_CONTEXT: 'आपको व्यवसाय से जुड़ी कौन-सी जानकारी चाहिए?',
    MULTIPLE_POSSIBLE_TARGETS: 'आप इनमें से किसके बारे में सहायता चाहते हैं?',
    UNSUPPORTED_INFORMATION_NEED: 'क्या आप सामान्य जानकारी चाहते हैं या अपनी मौजूदा स्थिति?',
    UNCERTAIN_LANGUAGE_INTERPRETATION: 'आपको किस बात में मदद चाहिए? कृपया थोड़ा और स्पष्ट करें।',
    CONTRADICTORY_SIGNALS: 'मुझे स्पष्ट नहीं है कि आप यह काम करना चाहते हैं या नहीं। आपका क्या मतलब है?',
  };
  return (language === 'Hindi' ? hindi : language === 'Hinglish' ? hinglish : english)[reason];
}
