import axios from 'axios';

// API Base URL - uses env variable or falls back to localhost
// Exported (not just used internally) because the streaming chat helper
// below talks to the backend via fetch() directly, rather than through the
// shared axios instance, so it needs the same base URL.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL
  ? `${import.meta.env.VITE_API_BASE_URL}/api`
  : 'http://localhost:4000/api';

// Create axios instance
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ── Request interceptor: attach auth token ──────────────────
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('REChain_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ── Response interceptor: auto-logout on 401 ────────────────
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('REChain_token');
      // Optionally redirect to login
      // window.location.href = '/signin';
    }
    return Promise.reject(error);
  }
);

// ═══════════════════════════════════════════════════════════
// API Endpoints — aligned with backend routes
// ═══════════════════════════════════════════════════════════

// User Authentication
// Backend register expects { name, email, password }
// We transform fullName → name here so the UI can keep using fullName
export const userAPI = {
  register: (data: { fullName: string; email: string; phone: string; password: string }) =>
    apiClient.post('/users/register', {
      name: data.fullName,
      email: data.email,
      password: data.password,
    }),

  login: (data: { email: string; password: string }) =>
    apiClient.post('/users/login', data),

  forgotPassword: (email: string) =>
    apiClient.post('/users/forgot', { email }),

  resetPassword: (token: string, password: string) =>
    apiClient.post(`/users/reset/${token}`, { password }),

  verifyEmail: (token: string) =>
    apiClient.get(`/users/verify/${token}`),

  getProfile: () =>
    apiClient.get('/users/me'),
};

// Properties (CRUD — admin-managed listings)
export const propertiesAPI = {
  getAll: () =>
    apiClient.get('/products/list'),

  getById: (id: string) =>
    apiClient.get(`/products/single/${id}`),
};

// User-submitted property listings (require auth)
export const userListingsAPI = {
  create: (formData: FormData) =>
    apiClient.post('/user/properties', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  getMyListings: () =>
    apiClient.get('/user/properties'),

  update: (id: string, formData: FormData) =>
    apiClient.put(`/user/properties/${id}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  delete: (id: string) =>
    apiClient.delete(`/user/properties/${id}`),
};

// Appointments (supports guest + auth bookings)
export const appointmentsAPI = {
  schedule: (data: {
    propertyId: string;
    date: string;
    time: string;
    name: string;
    email: string;
    phone: string;
    message?: string;
  }) =>
    apiClient.post('/appointments/schedule', data),

  getByUser: () =>
    apiClient.get('/appointments/user'),

  cancel: (id: string, reason?: string) =>
    apiClient.put(`/appointments/cancel/${id}`, { cancelReason: reason }),
};

// AI-Powered Property Search
// Backend transforms the request via middleware at POST /api/ai/search
export const aiAPI = {
  search: (data: {
    city?: string;
    locality?: string;
    T?: string;
    possession?: string;
    includeNoBroker?: boolean;
    price?: { min: number; max: number };
    type?: string;
    category?: string;
  }) => {
    const githubKey    = localStorage.getItem('REChain_github_key');
    const firecrawlKey = localStorage.getItem('REChain_firecrawl_key');
    return apiClient.post('/ai/search', data, {
      headers: {
        ...(githubKey    && { 'X-Github-Key':    githubKey }),
        ...(firecrawlKey && { 'X-Firecrawl-Key': firecrawlKey }),
      },
    });
  },

  locationTrends: (city: string) => {
    const githubKey    = localStorage.getItem('REChain_github_key');
    const firecrawlKey = localStorage.getItem('REChain_firecrawl_key');
    return apiClient.get(`/locations/${encodeURIComponent(city)}/trends`, {
      headers: {
        ...(githubKey    && { 'X-Github-Key':    githubKey }),
        ...(firecrawlKey && { 'X-Firecrawl-Key': firecrawlKey }),
      },
    });
  },

  validateKeys: (keys?: { githubKey?: string; firecrawlKey?: string }) => {
    const githubKey = (keys?.githubKey ?? localStorage.getItem('REChain_github_key') ?? '').trim();
    const firecrawlKey = (keys?.firecrawlKey ?? localStorage.getItem('REChain_firecrawl_key') ?? '').trim();

    return apiClient.post('/ai/validate-keys', {}, {
      headers: {
        ...(githubKey && { 'X-Github-Key': githubKey }),
        ...(firecrawlKey && { 'X-Firecrawl-Key': firecrawlKey }),
      },
    });
  },

  // AI Chat Assistant
  // Backend: POST /api/ai/chat -> { success, reply, intent, properties, timestamp }
  chat: (data: {
    message: string;
    history?: { role: 'user' | 'assistant'; content: string }[];
    context?: Record<string, unknown>;
  }) => {
    const githubKey    = localStorage.getItem('REChain_github_key');
    const firecrawlKey = localStorage.getItem('REChain_firecrawl_key');
    return apiClient.post('/ai/chat', data, {
      headers: {
        ...(githubKey    && { 'X-Github-Key':    githubKey }),
        ...(firecrawlKey && { 'X-Firecrawl-Key': firecrawlKey }),
      },
    });
  },

  // AI Chat Assistant - streaming (SSE) variant.
  // Backend: POST /api/ai/chat/stream, emitting named SSE events:
  //   meta  -> { intent, properties }   (once, up front)
  //   delta -> { content }               (one per token chunk)
  //   done  -> {}                        (stream finished cleanly)
  //   error -> { message, error }        (AI failed - stream ends)
  //
  // Uses fetch() directly rather than the axios instance above: reading a
  // streamed response body needs a real ReadableStream reader, and the
  // request needs the same X-Github-Key/X-Firecrawl-Key headers as chat()
  // above, which rules out the browser's native EventSource (GET-only, no
  // custom headers, no request body).
  chatStream: async function* (data: {
    message: string;
    history?: { role: 'user' | 'assistant'; content: string }[];
    context?: Record<string, unknown>;
  }): AsyncGenerator<{ event: 'meta' | 'delta' | 'done' | 'error'; data: any }> {
    const githubKey    = localStorage.getItem('REChain_github_key');
    const firecrawlKey = localStorage.getItem('REChain_firecrawl_key');

    const response = await fetch(`${API_BASE_URL}/ai/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(githubKey    && { 'X-Github-Key':    githubKey }),
        ...(firecrawlKey && { 'X-Firecrawl-Key': firecrawlKey }),
      },
      body: JSON.stringify(data),
    });

    if (!response.ok || !response.body) {
      // The request was rejected before streaming even started (e.g. missing
      // keys, invalid body, rate limit) - the backend still replies with a
      // normal JSON error in that case. Shape the thrown error like an axios
      // error so the existing describeChatError() can classify it the same
      // way it does for the non-streaming call.
      let body: any = {};
      try {
        body = await response.json();
      } catch {
        // Non-JSON error body (e.g. a proxy/server error page) - fall through
        // with an empty body; describeChatError() falls back to a generic message.
      }
      const err: any = new Error(body?.message || `Chat stream request failed (${response.status})`);
      err.response = { status: response.status, data: body };
      throw err;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line. A frame can arrive split
      // across multiple reads, so only consume complete frames and keep
      // whatever's left in the buffer for the next chunk.
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (!frame.trim()) continue;

        let eventName = 'message';
        let dataLine = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLine += line.slice(5).trim();
        }
        if (!dataLine) continue;

        try {
          yield { event: eventName as 'meta' | 'delta' | 'done' | 'error', data: JSON.parse(dataLine) };
        } catch {
          // Malformed frame - skip it rather than breaking the whole stream.
        }
      }
    }
  },
};

// Helpers to read/write user API keys in localStorage
export const apiKeyStorage = {
  getGithubKey:    ()    => localStorage.getItem('REChain_github_key') || '',
  getFirecrawlKey: ()    => localStorage.getItem('REChain_firecrawl_key') || '',
  setGithubKey:    (key: string) => localStorage.setItem('REChain_github_key', key),
  setFirecrawlKey: (key: string) => localStorage.setItem('REChain_firecrawl_key', key),
  hasKeys: () => !!(localStorage.getItem('REChain_github_key') && localStorage.getItem('REChain_firecrawl_key')),
  clear: () => {
    localStorage.removeItem('REChain_github_key');
    localStorage.removeItem('REChain_firecrawl_key');
  },
};

// Contact Form
export const contactAPI = {
  submit: (data: { name: string; email: string; phone: string; message: string }) =>
    apiClient.post('/forms/submit', data),
};

export default apiClient;

