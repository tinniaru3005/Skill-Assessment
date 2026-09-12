import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Send, Key, MapPin, BedDouble, Bath, Ruler } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Navbar from '../components/common/Navbar';
import Footer from '../components/common/Footer';
import { useSEO } from '../hooks/useSEO';
import { aiAPI, apiKeyStorage } from '../services/api';
import AIApiKeyModal from '../components/ai-hub/AIApiKeyModal';

type ChatRole = 'user' | 'assistant' | 'system';

/** Compact property listing attached to an assistant reply - mirrors the backend's toChatPropertyCard(). */
interface ChatPropertyCard {
  id: string;
  title: string;
  location: string;
  price: number;
  beds: number;
  baths: number;
  sqm: number;
  type: string;
  availability: string;
  image?: string;
}

interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Only set on a "system" (error) message - the user text that failed, so it can be retried. */
  retryText?: string;
  /** Matching listings for an assistant reply to a property-search turn, if any. */
  properties?: ChatPropertyCard[];
}

const WELCOME_MESSAGE: ChatMessage = {
  role: 'assistant',
  content: "Hi! I'm your AI real estate assistant. Ask me to find a property, or ask any question about the market.",
};

/** Starter prompts shown before the user has sent their first message, to help them get going. */
const SUGGESTED_PROMPTS = [
  'Find me a 2-bedroom apartment under $2,000/month',
  "What's a fair price for a 3-bed house in this area?",
  'Show me properties currently for sale',
  'What should I know before renting my first apartment?',
];

/**
 * Turn an axios error from POST /api/ai/chat into a short, user-facing
 * message, and flag whether it's a missing/invalid API key error (in which
 * case we pop the same AIApiKeyModal the AI Hub uses).
 */
function describeChatError(err: any): { message: string; isKeyError: boolean } {
  const status = err?.response?.status;
  const serverMsg = err?.response?.data?.message || '';
  const serverCode = err?.response?.data?.error || '';

  if (status === 403 || serverCode === 'KEYS_REQUIRED' || serverCode === 'KEYS_INVALID') {
    return {
      message: serverMsg || 'Your API keys are missing or invalid. Please add your GitHub Models and Firecrawl keys.',
      isKeyError: true,
    };
  }
  if (status === 429 || serverCode === 'AI_RATE_LIMITED' || serverCode === 'RATE_LIMIT_EXCEEDED') {
    return {
      message: serverMsg || "You've hit the chat rate limit. Please wait a bit before sending another message.",
      isKeyError: false,
    };
  }
  if (status === 504 || serverCode === 'AI_TIMEOUT') {
    return { message: serverMsg || 'The AI took too long to respond. Please try again.', isKeyError: false };
  }
  if (status === 400 || serverCode === 'INVALID_REQUEST') {
    return { message: serverMsg || 'That message could not be sent. Please try rephrasing it.', isKeyError: false };
  }
  return { message: serverMsg || 'Something went wrong. Please try again.', isKeyError: false };
}

const AiChatPage: React.FC = () => {
  useSEO({
    title: 'AI Chat Assistant',
    description: 'Chat with our AI real estate assistant to find properties, get market insights, and get your questions answered.',
  });

  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [keysReady, setKeysReady] = useState(apiKeyStorage.hasKeys());
  const [showKeyModal, setShowKeyModal] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the latest message (or the typing indicator) any time the
  // conversation changes - covers a new message, an error bubble, and the
  // typing indicator appearing/disappearing.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending]);

  const sendMessage = async (overrideText?: string) => {
    const trimmed = (overrideText ?? input).trim();
    if (!trimmed || sending) return;

    // History sent to the backend excludes any local-only system messages
    // (error notices) - the backend only accepts user/assistant turns anyway.
    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
    if (!overrideText) setInput('');
    setSending(true);

    try {
      const response = await aiAPI.chat({ message: trimmed, history });
      const reply: string = response.data?.reply || "Sorry, I didn't get a response there. Please try again.";
      const properties: ChatPropertyCard[] | undefined = response.data?.properties;
      setMessages((prev) => [...prev, { role: 'assistant', content: reply, properties }]);
    } catch (err: any) {
      const { message, isKeyError } = describeChatError(err);
      setMessages((prev) => [...prev, { role: 'system', content: message, retryText: trimmed }]);
      if (isKeyError) setShowKeyModal(true);
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="bg-white min-h-screen flex flex-col">
      <Navbar />

      <section className="flex-1 pt-28 pb-10 px-4 sm:px-6">
        <div className="max-w-[900px] mx-auto flex flex-col h-[calc(100vh-180px)] min-h-[480px]">
          <div className="mb-4">
            <h1 className="text-2xl font-bold text-gray-900">AI Chat Assistant</h1>
            <p className="text-sm text-gray-500 mt-1">
              Ask about properties, prices, or the market — I'm here to help.
            </p>
          </div>

          {!keysReady && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-gray-700">
              <span>Add your free GitHub Models &amp; Firecrawl API keys to start chatting.</span>
              <button
                type="button"
                onClick={() => setShowKeyModal(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
              >
                <Key className="size-3.5" />
                Add keys
              </button>
            </div>
          )}

          {/* Message list */}
          <div className="flex-1 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50/60 p-4 space-y-3">
            {messages.map((m, i) => (
              <ChatBubble
                key={i}
                role={m.role}
                content={m.content}
                properties={m.properties}
                onRetry={m.retryText ? () => sendMessage(m.retryText) : undefined}
              />
            ))}
            {messages.length === 1 && !sending && (
              <QuickSuggestions onSelect={(text) => sendMessage(text)} />
            )}
            {sending && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>

          {/* Input row */}
          <form onSubmit={handleSubmit} className="mt-4 flex items-end gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about properties, prices, or the market..."
              disabled={sending}
              className="flex-1 rounded-full border border-gray-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Send message"
              className="inline-flex items-center justify-center rounded-full bg-primary size-10 shrink-0 text-white transition-colors hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="size-4" />
            </button>
          </form>
        </div>
      </section>

      <Footer />

      <AIApiKeyModal
        isOpen={showKeyModal}
        onClose={() => setShowKeyModal(false)}
        onKeysChanged={() => setKeysReady(apiKeyStorage.hasKeys())}
      />
    </div>
  );
};

/** Row of clickable starter prompts, shown before the user sends their first message. */
const QuickSuggestions: React.FC<{ onSelect: (text: string) => void }> = ({ onSelect }) => (
  <div className="flex flex-wrap gap-2 pl-1">
    {SUGGESTED_PROMPTS.map((prompt) => (
      <button
        key={prompt}
        type="button"
        onClick={() => onSelect(prompt)}
        className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 transition-colors hover:border-primary hover:text-primary"
      >
        {prompt}
      </button>
    ))}
  </div>
);

/** Three-dot "AI is thinking" bubble, shown while a reply is in flight. */
const TypingIndicator: React.FC = () => (
  <div className="flex justify-start">
    <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm border border-gray-200 bg-white px-4 py-3">
      <span className="size-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-gray-400" />
    </div>
  </div>
);

const ChatBubble: React.FC<{
  role: ChatRole;
  content: string;
  properties?: ChatPropertyCard[];
  onRetry?: () => void;
}> = ({ role, content, properties, onRetry }) => {
  if (role === 'system') {
    return (
      <div className="flex flex-col items-center gap-1.5">
        <span className="inline-block rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs text-red-600">
          {content}
        </span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  const isUser = role === 'user';
  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
          isUser
            ? 'rounded-br-sm whitespace-pre-wrap bg-primary text-white'
            : 'rounded-bl-sm border border-gray-200 bg-white text-gray-800'
        }`}
      >
        {isUser ? content : <MarkdownContent content={content} />}
      </div>
      {!isUser && properties && properties.length > 0 && <PropertyResultCards properties={properties} />}
    </div>
  );
};

/** Horizontally-scrollable row of matching listings, shown under an assistant reply. */
const PropertyResultCards: React.FC<{ properties: ChatPropertyCard[] }> = ({ properties }) => (
  <div className="mt-2 flex max-w-[80%] gap-3 overflow-x-auto pb-1">
    {properties.map((property) => (
      <PropertyResultCard key={property.id} property={property} />
    ))}
  </div>
);

/** Compact, chat-friendly property card - links out to the full listing page. */
const PropertyResultCard: React.FC<{ property: ChatPropertyCard }> = ({ property }) => (
  <Link
    to={`/property/${property.id}`}
    className="block w-[220px] shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-white transition-shadow hover:shadow-md"
  >
    <div className="h-28 w-full bg-gray-100">
      {property.image ? (
        <img src={property.image} alt={property.title} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center text-gray-300">
          <MapPin className="size-6" />
        </div>
      )}
    </div>
    <div className="p-3">
      <p className="truncate text-sm font-semibold text-gray-900">{property.title}</p>
      <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-gray-500">
        <MapPin className="size-3 shrink-0" />
        {property.location}
      </p>
      <p className="mt-1.5 text-sm font-bold text-primary">
        ${Number(property.price || 0).toLocaleString()}
      </p>
      <div className="mt-1.5 flex items-center gap-2.5 text-[11px] text-gray-500">
        <span className="flex items-center gap-0.5">
          <BedDouble className="size-3" />
          {property.beds}
        </span>
        <span className="flex items-center gap-0.5">
          <Bath className="size-3" />
          {property.baths}
        </span>
        <span className="flex items-center gap-0.5">
          <Ruler className="size-3" />
          {property.sqm}
        </span>
      </div>
    </div>
  </Link>
);

/**
 * Renders an assistant reply as Markdown - bold/italic text, bullet and
 * numbered lists, links, inline/fenced code, blockquotes, and GFM tables -
 * using the site's own text styles rather than a Tailwind typography plugin
 * (not installed in this project). User and system messages are left as
 * plain text, since only AI-generated replies are expected to use Markdown.
 */
const MarkdownContent: React.FC<{ content: string }> = ({ content }) => (
  <div className="space-y-2 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 last:mb-0">{children}</p>,
        strong: ({ children }: { children?: React.ReactNode }) => (
          <strong className="font-semibold text-gray-900">{children}</strong>
        ),
        em: ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>,
        ul: ({ children }: { children?: React.ReactNode }) => (
          <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>
        ),
        ol: ({ children }: { children?: React.ReactNode }) => (
          <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>
        ),
        li: ({ children }: { children?: React.ReactNode }) => <li>{children}</li>,
        a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 hover:text-primary/80"
          >
            {children}
          </a>
        ),
        code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
          const isBlock = /language-/.test(className || '');
          if (isBlock) {
            return (
              <code className="block overflow-x-auto rounded-md bg-gray-900/90 px-3 py-2 text-xs text-gray-100">
                {children}
              </code>
            );
          }
          return (
            <code className="rounded bg-gray-100 px-1 py-0.5 text-[13px] text-gray-800">{children}</code>
          );
        },
        pre: ({ children }: { children?: React.ReactNode }) => (
          <pre className="mb-2 overflow-x-auto rounded-md last:mb-0">{children}</pre>
        ),
        blockquote: ({ children }: { children?: React.ReactNode }) => (
          <blockquote className="mb-2 border-l-2 border-gray-300 pl-3 italic text-gray-600 last:mb-0">
            {children}
          </blockquote>
        ),
        h1: ({ children }: { children?: React.ReactNode }) => (
          <h3 className="mb-1 text-base font-semibold text-gray-900">{children}</h3>
        ),
        h2: ({ children }: { children?: React.ReactNode }) => (
          <h3 className="mb-1 text-base font-semibold text-gray-900">{children}</h3>
        ),
        h3: ({ children }: { children?: React.ReactNode }) => (
          <h4 className="mb-1 text-sm font-semibold text-gray-900">{children}</h4>
        ),
        table: ({ children }: { children?: React.ReactNode }) => (
          <div className="mb-2 overflow-x-auto last:mb-0">
            <table className="w-full border-collapse text-xs">{children}</table>
          </div>
        ),
        thead: ({ children }: { children?: React.ReactNode }) => (
          <thead className="border-b border-gray-300">{children}</thead>
        ),
        th: ({ children }: { children?: React.ReactNode }) => (
          <th className="px-2 py-1 text-left font-semibold text-gray-700">{children}</th>
        ),
        td: ({ children }: { children?: React.ReactNode }) => (
          <td className="border-t border-gray-100 px-2 py-1">{children}</td>
        ),
        hr: () => <hr className="my-2 border-gray-200" />,
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
);

export default AiChatPage;
