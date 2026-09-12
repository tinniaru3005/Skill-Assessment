/**
 * Lightweight, deterministic intent detection for the AI chat assistant.
 *
 * Deliberately rule-based rather than an extra AI call: it is instant, free,
 * and easy to explain/demo, and it only has to make a coarse binary call
 * ("does this message want property listings?") before the real language
 * understanding is left to the AI itself.
 */

const PROPERTY_TYPES = ['Flat', 'House', 'Villa', 'Plot', 'Penthouse', 'Studio', 'Commercial'];

// Verbs/nouns that signal the user wants to search or browse listings,
// as opposed to asking a general question.
const SEARCH_VERBS = /\b(find|show|search|looking for|look for|recommend|suggest|list|browse)\b/i;
const PROPERTY_NOUNS = /\b(propert(?:y|ies)|apartment|flat|house|villa|home|listing|plot|penthouse|studio)\b/i;

const BEDROOM_PATTERN = /(\d+)\s*[- ]?\s*(?:bhk|bed(?:room)?s?)\b/i;

// e.g. "under $50,000", "budget of 45 lakh", "up to 2 cr", "below 3000000"
const PRICE_PATTERN = /(?:under|below|less than|up to|budget(?: of)?)\s*\$?\s*([\d,.]+)\s*(lakh|lakhs|crore|crores|cr|k|thousand)?/i;

// "in <place>" / "near <place>", stopping at common trailing clauses
const LOCATION_PATTERN = /\b(?:in|near|around)\s+([a-z][a-z\s]{2,30}?)(?=\s*(?:,|\.|!|\?|$|\bunder\b|\bbelow\b|\bwith\b|\bfor\b|\bbudget\b|\bbhk\b|\bbedroom))/i;

function parsePrice(numStr, unit) {
  const num = parseFloat(numStr.replace(/,/g, ''));
  if (Number.isNaN(num)) return null;

  switch ((unit || '').toLowerCase()) {
    case 'lakh':
    case 'lakhs':
      return num * 100_000;
    case 'crore':
    case 'crores':
    case 'cr':
      return num * 10_000_000;
    case 'k':
    case 'thousand':
      return num * 1_000;
    default:
      return num;
  }
}

/**
 * @param {string} message - the sanitized user message
 * @returns {{ intent: 'property_search' | 'general', filters: object }}
 */
export function detectChatIntent(message) {
  const filters = {};

  const bedroomMatch = message.match(BEDROOM_PATTERN);
  if (bedroomMatch) {
    filters.beds = parseInt(bedroomMatch[1], 10);
  }

  const priceMatch = message.match(PRICE_PATTERN);
  if (priceMatch) {
    const maxPrice = parsePrice(priceMatch[1], priceMatch[2]);
    if (maxPrice) filters.maxPrice = maxPrice;
  }

  const typeMatch = PROPERTY_TYPES.find((t) => new RegExp(`\\b${t}\\b`, 'i').test(message));
  if (typeMatch) {
    filters.type = typeMatch;
  }

  const locationMatch = message.match(LOCATION_PATTERN);
  if (locationMatch) {
    filters.location = locationMatch[1].trim();
  }

  // A concrete structural filter (beds/price/type) is a strong enough
  // signal on its own. A bare location match ("...in India?") is not -
  // it still needs a search verb + property noun to count as search intent.
  const hasStrongFilters = filters.beds !== undefined || filters.maxPrice !== undefined || filters.type !== undefined;
  const looksLikeSearch = hasStrongFilters || (SEARCH_VERBS.test(message) && PROPERTY_NOUNS.test(message));

  return {
    intent: looksLikeSearch ? 'property_search' : 'general',
    filters,
  };
}
