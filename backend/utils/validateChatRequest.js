/**
 * Validate and sanitize the body of POST /api/ai/chat.
 * Keeps the same "never trust the request" spirit as validateAIResponse.js -
 * this never throws, it always returns a { valid, ... } shape.
 */

const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_ITEMS = 20;
const MAX_HISTORY_CONTENT_LENGTH = 4000;
const ALLOWED_ROLES = ['user', 'assistant'];

// Only these context fields are forwarded to the AI - anything else in
// the request body's context object is silently dropped.
const ALLOWED_CONTEXT_KEYS = ['city', 'locality', 'propertyId', 'filters'];

/**
 * Strip ASCII control characters and trim. Does not HTML-escape, since this
 * text is sent to the LLM and rendered as markdown on the frontend, never
 * injected into HTML on the backend.
 */
function sanitizeText(value) {
  if (typeof value !== 'string') return '';
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code > 31 && code !== 127) out += value[i];
  }
  return out.trim();
}

/**
 * @param {object} body - req.body for POST /api/ai/chat
 * @returns {{ valid: true, data: { message: string, history: Array, context: object } } | { valid: false, error: string }}
 */
export function validateChatRequest(body = {}) {
  const message = sanitizeText(body?.message).slice(0, MAX_MESSAGE_LENGTH);

  if (!message) {
    return { valid: false, error: 'Message is required and cannot be empty.' };
  }

  let history = [];
  if (body?.history !== undefined) {
    if (!Array.isArray(body.history)) {
      return { valid: false, error: 'history must be an array of { role, content } messages.' };
    }
    history = body.history
      .filter((item) => item && ALLOWED_ROLES.includes(item.role) && typeof item.content === 'string')
      .slice(-MAX_HISTORY_ITEMS)
      .map((item) => ({
        role: item.role,
        content: sanitizeText(item.content).slice(0, MAX_HISTORY_CONTENT_LENGTH),
      }))
      .filter((item) => item.content.length > 0);
  }

  const context = {};
  if (body?.context !== undefined) {
    if (typeof body.context !== 'object' || body.context === null || Array.isArray(body.context)) {
      return { valid: false, error: 'context must be an object.' };
    }
    for (const key of ALLOWED_CONTEXT_KEYS) {
      if (body.context[key] !== undefined) {
        context[key] = body.context[key];
      }
    }
  }

  return { valid: true, data: { message, history, context } };
}
