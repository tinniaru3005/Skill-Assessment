import { config } from "../config/config.js";
import ModelClient, { isUnexpected } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";
import { registry } from "../utils/circuitBreaker.js";
import logger from "../utils/logger.js";
import { createSseStream } from "@azure/core-sse";
import { createHash } from "node:crypto";

const PRIMARY_MODEL = "gpt-4.1-mini";
const FALLBACK_MODEL = "gpt-4.1-nano";

// Request timeout for GitHub Models calls (30 seconds)
const AI_TIMEOUT_MS = 30_000;

const SYSTEM_PROMPT = `You are a concise real estate expert assistant.
Rules:
- Always respond with valid JSON matching the requested schema.
- Use INR currency (Lakhs/Crores) for all prices.
- Keep analysis factual and data-driven — no speculation.
- Never include markdown, code fences, or extra text outside the JSON.`;

const CHAT_SYSTEM_PROMPT = `You are a friendly, knowledgeable real estate assistant for this platform.
Rules:
- Help users search for properties, understand listings, and get market insights.
- Reply in plain conversational text (markdown formatting like **bold**, bullet lists, and headings is fine).
- Use INR currency (Lakhs/Crores) when discussing prices.
- Be concise: prefer a few short paragraphs or a short list over long essays.
- If you don't have enough information to answer precisely, say so and ask a clarifying question rather than guessing.
- Never fabricate specific property listings, prices, or availability that were not provided to you in context.`;

// Max number of prior turns (user+assistant messages) kept when building
// the chat completion request, to bound token usage and cost per request.
const MAX_HISTORY_TURNS = 20;

class AIService {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error('[AIService] API key is required — no fallback allowed.');
    }
    this.apiKey = apiKey;
    this.client = ModelClient(
      "https://models.inference.ai.azure.com",
      new AzureKeyCredential(this.apiKey)
    );

    // Circuit breakers are scoped per API key (a short, non-reversible hash -
    // never the raw key) rather than one shared pair for the whole process.
    // Without this, one caller's invalid or rate-limited key could trip the
    // breaker OPEN and make every *other* caller's requests fail immediately
    // too, even with a perfectly healthy key.
    const keyScope = createHash('sha256').update(this.apiKey).digest('hex').slice(0, 12);

    this.primaryCircuit = registry.getBreaker(`ai-primary:${keyScope}`, {
      failureThreshold: 3,
      timeout: 60000, // 1 minute
      name: `ai-${PRIMARY_MODEL}:${keyScope}`
    });

    this.fallbackCircuit = registry.getBreaker(`ai-fallback:${keyScope}`, {
      failureThreshold: 5,
      timeout: 120000, // 2 minutes for fallback
      name: `ai-${FALLBACK_MODEL}:${keyScope}`
    });
  }

  async validateApiKey() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await this.client.path('/chat/completions').post({
        body: {
          messages: [
            { role: 'system', content: 'Reply with OK only.' },
            { role: 'user', content: 'OK?' }
          ],
          model: FALLBACK_MODEL,
          temperature: 0,
          max_tokens: 8,
          top_p: 1
        },
        ...(controller.signal ? { signal: controller.signal } : {}),
      });

      if (isUnexpected(response)) {
        const errorMsg = response.body.error?.message || 'Unknown AI API error';
        throw new Error(`AI API error: ${errorMsg}`);
      }

      return { valid: true };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Generate text using GitHub Models with automatic fallback and circuit breaker protection.
   * Tries PRIMARY_MODEL first; falls back to FALLBACK_MODEL on rate-limit or error.
   */
  async generateText(prompt, systemPrompt = SYSTEM_PROMPT) {
    // Try primary model with circuit breaker
    try {
      const result = await this.primaryCircuit.execute(async () => {
        return await this._callModel(PRIMARY_MODEL, prompt, systemPrompt);
      });

      if (result) return result;
    } catch (error) {
      logger.warn('Primary circuit breaker triggered', { model: PRIMARY_MODEL, error: error.message });
    }

    // Fallback to nano model with circuit breaker
    try {
      logger.warn('Falling back to secondary model', { from: PRIMARY_MODEL, to: FALLBACK_MODEL });

      const fallbackResult = await this.fallbackCircuit.execute(async () => {
        return await this._callModel(FALLBACK_MODEL, prompt, systemPrompt);
      });

      if (fallbackResult) return fallbackResult;
    } catch (error) {
      logger.error('Fallback circuit breaker triggered', { model: FALLBACK_MODEL, error: error.message });
    }

    return JSON.stringify({ error: "AI service is temporarily unavailable. Please try again later." });
  }

  async _callModel(model, prompt, systemPrompt) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      logger.warn('AI model request timeout', { model, timeoutMs: AI_TIMEOUT_MS });
    }, AI_TIMEOUT_MS);

    try {
      logger.info('Calling AI model', { model });
      const startTime = Date.now();

      const response = await this.client.path("/chat/completions").post({
        body: {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt }
          ],
          model,
          temperature: 0.3,
          max_tokens: 4000,   // increased for 12 properties with Phase 3 fields (match_score, red_flags, etc.)
          top_p: 1
        },
        // Pass abort signal if the SDK supports it
        ...(controller.signal ? { signal: controller.signal } : {}),
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info('AI model responded', { model, elapsedSeconds: elapsed });

      if (isUnexpected(response)) {
        const errorMsg = response.body.error?.message || 'Unknown AI API error';
        logger.error('AI model error', { model, error: errorMsg });
        throw new Error(`AI API error: ${errorMsg}`);
      }

      return response.body.choices[0].message.content;
    } catch (error) {
      if (error.name === 'AbortError') {
        logger.error('AI model request aborted', { model, reason: 'timeout' });
        throw new Error(`AI request timeout after ${AI_TIMEOUT_MS / 1000}s`);
      } else {
        logger.error('AI model exception', { model, error: error.message });
        throw error;
      }
    } finally {
      clearTimeout(timer);
    }
  }


  // ── Data Preparation ──────────────────────────────────────────

  _preparePropertyData(properties, maxProperties = 20) {
    return properties.slice(0, maxProperties).map(p => ({
      building_name:     p.building_name,
      builder_name:      p.builder_name      || '',
      property_type:     p.property_type,
      bhk_config:        p.bhk_config        || '',
      location_address:  p.location_address,
      price:             p.price             || p.total_price || '',
      price_per_sqm:    p.price_per_sqm    || '',
      area_sqm:         p.carpet_area_sqm  || p.area_sqm  || '',
      possession_status: p.possession_status || '',
      rera_number:       p.rera_number       || '',
      parking:           p.parking           || '',
      floor_number:      p.floor_number      || '',
      nearby_landmarks:  Array.isArray(p.nearby_landmarks)
        ? p.nearby_landmarks.slice(0, 3).join(', ')
        : (p.nearby_landmarks || ''),
      amenities:         Array.isArray(p.amenities) ? p.amenities.slice(0, 5) : [],
      description:       p.description
        ? p.description.substring(0, 150) + (p.description.length > 150 ? '...' : '')
        : '',
    }));
  }

  _prepareLocationData(locations, maxLocations = 5) {
    return locations.slice(0, maxLocations);
  }

  // ── Analysis Methods ──────────────────────────────────────────

  async analyzeProperties(properties, { city, locality, bhk, minPrice, maxPrice, propertyType, propertyCategory }) {
    const preparedProperties = this._preparePropertyData(properties);

    const minNum   = parseFloat(minPrice) || 0;
    const maxNum   = parseFloat(maxPrice);
    const minLabel = minNum > 0
      ? (minNum < 1 ? `$${Math.round(minNum * 100)}L` : `$${minNum}Cr`)
      : null;
    const maxLabel = maxNum < 1
      ? `$${Math.round(maxNum * 100)}L`
      : `$${maxNum}Cr`;
    const budgetRange = minLabel ? `${minLabel}–${maxLabel}` : `up to ${maxLabel}`;

    const typeLabels = {
      'Flat': 'flat', 'House': 'independent house', 'Villa': 'villa',
      'Plot': 'plot', 'Penthouse': 'penthouse', 'Studio': 'studio apartment',
      'Commercial': 'commercial property',
    };
    const typeLabel = typeLabels[propertyType] || (propertyType || 'property').toLowerCase();

    const locationStr = locality ? `${locality}, ${city}` : city;

    const prompt = `You are an expert real estate advisor.
Rank these ${preparedProperties.length} ${typeLabel}s in ${locationStr} for a buyer with budget ${budgetRange}.

Properties:
${JSON.stringify(preparedProperties, null, 2)}

PRICE BENCHMARKS ($/sqm) FOR REFERENCE:

Rio de Janeiro:
- Premium (Leblon/Ipanema Beachfront): R$ 25,000-45,000/m²
- Mid-tier (Copacabana/Barra da Tijuca): R$ 8,000-15,000/m²
- Affordable (North Zone/Centro): R$ 5,000-8,000/m²

São Paulo:
- Premium (Jardim Europa/Vila Nova Conceição): R$ 20,000-35,000/m²
- Mid-tier (Pinheiros/Vila Mariana): R$ 8,000-12,000/m²
- Affordable (Peripheral Zones): R$ 5,000-8,000/m²

Brasília:
- Premium (Lago Sul): R$ 15,000-25,000/m².
- Mid-tier (Asa Sul/Asa Norte): R$ 7,000-10,000/m²
- Affordable (Satellite Cities - Guará/Taguatinga): R$ 4,000-7,000/m²

Curitiba :
- Premium (Batel/Água Verde): R$ 12,000-18,000/m²
- Mid-tier (Centro/Portão): R$ 6,000-9,000/m²
- Affordable (CIC/Sítio Cercado): R$ 4,000-6,000/m²

Balneário Camboriú:
- Premium (Oceanfront/Avenida Atlântica): R$ 35,000-60,000+/m²
- Mid-tier (Bairros/Nova Esperança): R$ 12,000-20,000/m²
- Affordable (Peripheral Areas): R$ 8,000-12,000/m²

Compare each property's price_per_sqm against these benchmarks.
Flag as "overpriced" if >20% above area average.
Flag as "good_deal" if >15% below area average.

Rank each property based on:
1. Price vs locality average (value for money) — use price_per_sqm and above benchmarks
2. Builder reputation — known builders (Godrej, Lodha, Prestige, Sobha, DLF, Tata, etc.) score higher; unknown builders are a risk
3. Possession status — Ready to Move > possession within 1 year > 2026 > 2027+
4. RERA registration — rera_number present means legally safe; missing is a red flag
5. Connectivity — metro station, school, hospital in nearby_landmarks scores higher
6. Premium amenities — Pool, Gym, Clubhouse, Sports facilities add significant value

For EACH property provide all of these fields:
- match_score: integer 0–100 (fit for buyer's stated criteria)
- one_line_insight: max 20 words, SPECIFIC — use real data e.g. "$8,200/sqm below SG Highway avg, RERA ✓, metro 600m"
- red_flags: array of objects with severity levels, e.g. [{"flag": "No RERA registration", "severity": "critical"}, {"flag": "Possession delayed to 2027", "severity": "medium"}, {"flag": "Unknown builder", "severity": "low"}] — empty array [] if none. Severity must be one of: "critical" | "medium" | "low"
- value_verdict: exactly one of "good_deal" | "fair" | "overpriced"
- investment_horizon: exactly one of "short_term" | "long_term" | "both"
- investment_reason: brief explanation (max 25 words) — e.g. "Ready possession + undervalued = quick resale potential" OR "Under construction in developing area = appreciation play"
- negotiation_tips: array of 1-2 specific negotiation strategies for this property, e.g. ["Offer $10L below asking due to delayed possession", "Leverage lack of RERA to negotiate 5% discount"]
- price_trend_context: one sentence about the area's recent price movement, e.g. "This locality appreciated 12% last year" or "Prices stable for 18 months"

Respond ONLY with this exact JSON (no markdown, no extra text):
{
  "overview": [
    {
      "name": "building name",
      "price": "price string",
      "area": "sqm string",
      "location": "address",
      "highlight": "one specific standout feature using actual data",
      "match_score": 85,
      "one_line_insight": "specific insight max 20 words",
      "red_flags": [{"flag": "concern text", "severity": "critical|medium|low"}],
      "value_verdict": "good_deal",
      "investment_horizon": "short_term",
      "investment_reason": "explanation max 25 words",
      "negotiation_tips": ["tip 1", "tip 2"],
      "price_trend_context": "area price trend in one sentence"
    }
  ],
  "best_value": {
    "name": "building name of top pick",
    "reason": "why it is the best value — reference price_per_sqm, possession, RERA, or connectivity"
  },
  "recommendations": [
    "actionable tip 1 for this specific search",
    "actionable tip 2",
    "actionable tip 3"
  ]
}`;

    return this.generateText(prompt);
  }

  async analyzeLocationTrends(locations, city) {
    const preparedLocations = this._prepareLocationData(locations);

    const prompt = `Analyze these real estate price trends for ${city}:

${JSON.stringify(preparedLocations)}

Respond ONLY with this JSON schema:
{
  "trends": [
    {
      "location": "area name",
      "price_per_sqm": 0,
      "yearly_change_pct": 0,
      "rental_yield_pct": 0,
      "outlook": "brief 1-line outlook"
    }
  ],
  "top_appreciation": {
    "location": "area with highest price growth",
    "reason": "why in 1 sentence"
  },
  "best_rental_yield": {
    "location": "area with best rental returns",
    "reason": "why in 1 sentence"
  },
  "investment_tips": [
    "tip 1",
    "tip 2",
    "tip 3"
  ]
}`;

    return this.generateText(prompt);
  }

  // ── Chat (conversational assistant) ───────────────────────────

  /**
   * Turn a free-form context object into a short system note the model
   * can use. Only whitelisted keys reach this point (see validateChatRequest).
   */
  _formatContextNote(context = {}) {
    const parts = [];
    if (context.city) parts.push(`City: ${context.city}`);
    if (context.locality) parts.push(`Locality: ${context.locality}`);
    if (context.propertyId) parts.push(`User is currently viewing property ID: ${context.propertyId}`);
    if (context.filters) parts.push(`Active search filters: ${JSON.stringify(context.filters)}`);

    if (Array.isArray(context.matchedProperties) && context.matchedProperties.length > 0) {
      const listingLines = context.matchedProperties
        .map((p, i) => `${i + 1}. ${p.title} - ${p.type}, ${p.beds} bed / ${p.baths} bath, ${p.sqm} sqm, ${p.location}, price ${p.price}, ${p.availability}`)
        .join('\n');
      parts.push(
        `These listings were just looked up from the live database for this message - use ONLY these when recommending properties, do not invent others:\n${listingLines}`
      );
    }

    return parts.length ? `Additional context for this conversation:\n${parts.join('\n')}` : '';
  }

  /**
   * Build the messages array for a chat completion: system prompt,
   * optional context note, trimmed history, then the new user message.
   */
  _buildChatMessages(message, history = [], context = {}) {
    const messages = [{ role: 'system', content: CHAT_SYSTEM_PROMPT }];

    const contextNote = this._formatContextNote(context);
    if (contextNote) {
      messages.push({ role: 'system', content: contextNote });
    }

    const trimmedHistory = history.slice(-MAX_HISTORY_TURNS);
    for (const turn of trimmedHistory) {
      messages.push({ role: turn.role, content: turn.content });
    }

    messages.push({ role: 'user', content: message });
    return messages;
  }

  /**
   * Multi-turn chat completion with the same primary/fallback + circuit
   * breaker protection as generateText(), but supporting a full message
   * history instead of a single prompt.
   */
  async chat(message, history = [], context = {}) {
    const messages = this._buildChatMessages(message, history, context);

    try {
      const result = await this.primaryCircuit.execute(async () => {
        return await this._callChatModel(PRIMARY_MODEL, messages);
      });
      if (result) return result;
    } catch (error) {
      logger.warn('Primary circuit breaker triggered (chat)', { model: PRIMARY_MODEL, error: error.message });
    }

    logger.warn('Falling back to secondary model (chat)', { from: PRIMARY_MODEL, to: FALLBACK_MODEL });
    const fallbackResult = await this.fallbackCircuit.execute(async () => {
      return await this._callChatModel(FALLBACK_MODEL, messages);
    });
    return fallbackResult;
  }

  async _callChatModel(model, messages) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      logger.warn('AI chat model request timeout', { model, timeoutMs: AI_TIMEOUT_MS });
    }, AI_TIMEOUT_MS);

    try {
      logger.info('Calling AI chat model', { model, messageCount: messages.length });
      const startTime = Date.now();

      const response = await this.client.path('/chat/completions').post({
        body: {
          messages,
          model,
          temperature: 0.4,
          max_tokens: 800,
          top_p: 1
        },
        ...(controller.signal ? { signal: controller.signal } : {}),
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info('AI chat model responded', { model, elapsedSeconds: elapsed });

      if (isUnexpected(response)) {
        const errorMsg = response.body.error?.message || 'Unknown AI API error';
        logger.error('AI chat model error', { model, error: errorMsg, status: response.status });
        const err = new Error(`AI API error: ${errorMsg}`);
        err.statusCode = Number(response.status) || undefined;
        throw err;
      }

      return response.body.choices[0].message.content;
    } catch (error) {
      if (error.name === 'AbortError') {
        logger.error('AI chat model request aborted', { model, reason: 'timeout' });
        throw new Error(`AI request timeout after ${AI_TIMEOUT_MS / 1000}s`);
      } else {
        logger.error('AI chat model exception', { model, error: error.message });
        throw error;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Open a streaming chat completion connection to a given model and return
   * the raw Node stream. Does not consume it - chatStream() does that.
   */
  async _openChatStream(model, messages) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      logger.warn('AI chat stream open timeout', { model, timeoutMs: AI_TIMEOUT_MS });
    }, AI_TIMEOUT_MS);

    try {
      logger.info('Opening AI chat stream', { model, messageCount: messages.length });

      const response = await this.client
        .path('/chat/completions')
        .post({
          body: {
            messages,
            model,
            temperature: 0.4,
            max_tokens: 800,
            top_p: 1,
            stream: true,
          },
          ...(controller.signal ? { signal: controller.signal } : {}),
        })
        .asNodeStream();

      if (response.status !== '200') {
        const err = new Error(`AI API error (stream): unexpected status ${response.status}`);
        err.statusCode = Number(response.status) || undefined;
        throw err;
      }
      if (!response.body) {
        throw new Error('AI stream response body is undefined');
      }

      return response.body;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`AI stream open timeout after ${AI_TIMEOUT_MS / 1000}s`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Multi-turn streaming chat completion. Yields plain text deltas as they
   * arrive. Falls back from PRIMARY_MODEL to FALLBACK_MODEL only if the
   * connection itself fails to open (auth error, model unavailable, etc.) -
   * once tokens have started streaming to the caller there is no clean way
   * to "restart" on a different model, so a mid-stream failure simply ends
   * the generator (the caller surfaces that as a stream error event).
   */
  async *chatStream(message, history = [], context = {}) {
    const messages = this._buildChatMessages(message, history, context);

    let model = PRIMARY_MODEL;
    let stream;
    try {
      stream = await this.primaryCircuit.execute(() => this._openChatStream(PRIMARY_MODEL, messages));
    } catch (error) {
      logger.warn('Primary circuit breaker triggered (chat stream)', { model: PRIMARY_MODEL, error: error.message });
      model = FALLBACK_MODEL;
      logger.warn('Falling back to secondary model (chat stream)', { from: PRIMARY_MODEL, to: FALLBACK_MODEL });
      stream = await this.fallbackCircuit.execute(() => this._openChatStream(FALLBACK_MODEL, messages));
    }

    logger.info('Streaming AI chat model', { model });

    for await (const event of createSseStream(stream)) {
      if (event.data === '[DONE]') break;

      let parsed;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        continue; // skip malformed/keep-alive frames rather than failing the whole stream
      }

      const delta = parsed?.choices?.[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}

/**
 * Factory — create an AIService with a caller-supplied API key.
 * The default-singleton export is intentionally removed:
 * server env-var keys MUST NOT be used as a fallback.
 */
export function createAIService(apiKey) {
  return new AIService(apiKey);
}