/**
 * Narrow high-risk check for routes that have an unresolved personal/live
 * requirement. This is a veto layer, not a general factual-entailment engine.
 */
const personalLookupClaim = /\b(?:i|we)\s+(?:checked|looked\s+up|verified|confirmed|found|fetched|retrieved|queried|accessed)\s+(?:your|the)\s+(?:order|shipment|booking|refund|payment|account|appointment|balance|transaction)\b|\b(?:your|my)\s+(?:order|shipment|booking|refund|payment|account|appointment|balance|transaction)\b[\s\S]{0,140}\b(?:(?:is|was|has\s+been|will\s+be|should\s+be|expected\s+to)\s+(?:approved|processed|processing|delivered|confirmed|cancelled|canceled|scheduled|located|complete|completed|pending|paid|received|delayed|dispatched|shipped|credited|refunded|arriving|arriving)|(?:should\s+arrive|expected\s+to\s+arrive|arrived|arrives|approved|processed|processing|delivered|confirmed|cancelled|canceled|scheduled|located|complete|completed|pending|paid|received|delayed|dispatched|shipped|credited|refunded))\b|\b(?:order|shipment|booking|refund|payment|account|appointment)\s*(?:#|id\s*)?[A-Z0-9-]{4,32}[\s\S]{0,100}\b(?:is|was|has\s+been|will\s+be|should\s+be|expected\s+to|approved|processed|processing|delivered|confirmed|scheduled|located|arrive|pending|paid|received|delayed|dispatched|shipped|credited|refunded)\b|(?:आपका|आपकी|मेरा|मेरी).{0,80}(?:ऑर्डर|शिपमेंट|बुकिंग|रिफंड|भुगतान|खाता|अपॉइंटमेंट).{0,100}(?:हो गया|हो गई|मिल गया|मिल जाएगी|आ जाएगा|पहुंचेगा|स्वीकृत|प्रोसेस|कन्फर्म|डिलीवर|लंबित)/iu;

export function containsUnsupportedPersonalStatusClaim(response: string): boolean {
  return personalLookupClaim.test(response);
}

export type LiveRecordLimitationFailureReason =
  | 'empty_limitation_response' | 'limitation_response_too_long'
  | 'citation_marker_in_limitation_response' | 'url_in_limitation_response'
  | 'unsupported_personal_status_claim';

/** Safe, content-free reason for rejecting a generated no-live-record reply. */
export function liveRecordLimitationFailureReason(response: string): LiveRecordLimitationFailureReason | null {
  if (!response.trim()) return 'empty_limitation_response';
  if (response.length > 700) return 'limitation_response_too_long';
  if (/\[(?:S|C)\d+\]/u.test(response)) return 'citation_marker_in_limitation_response';
  if (/https?:\/\//u.test(response)) return 'url_in_limitation_response';
  if (containsUnsupportedPersonalStatusClaim(response)) return 'unsupported_personal_status_claim';
  return null;
}

