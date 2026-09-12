import React, { useState } from 'react';
import { Send, Key } from 'lucide-react';
import Navbar from '../components/common/Navbar';
import Footer from '../components/common/Footer';
import { useSEO } from '../hooks/useSEO';
import { aiAPI, apiKeyStorage } from '../services/api';
import AIApiKeyModal from '../components/ai-hub/AIApiKeyModal';

type ChatRole = 'user' | 'assistant' | 'system';

interface ChatMessage {
  role: ChatRole;
  content: string;
}

const WELCOME_MESSAGE: ChatMessage = {
  role: 'assistant',
  content: "Hi! I'm your AI real estate assistant. Ask me to find a property, or ask any question about the market.",
};

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

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    // History sent to the backend excludes any local-only system messages
    // (error notices) - the backend only accepts user/assistant turns anyway.
    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
    setInput('');
    setSending(true);

    try {
      const response = await aiAPI.chat({ message: trimmed, history });
      const reply: string = response.data?.reply || "Sorry, I didn't get a response there. Please try again.";
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (err: any) {
      const { message, isKeyError } = describeChatError(err);
      setMessages((prev) => [...prev, { role: 'system', content: message }]);
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
              <ChatBubble key={i} role={m.role} content={m.content} />
            ))}
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

const ChatBubble: React.FC<{ role: ChatRole; content: string }> = ({ role, content }) => {
  if (role === 'system') {
    return (
      <div className="text-center">
        <span className="inline-block rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs text-red-600">
          {content}
        </span>
      </div>
    );
  }

  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
          isUser
            ? 'rounded-br-sm bg-primary text-white'
            : 'rounded-bl-sm border border-gray-200 bg-white text-gray-800'
        }`}
      >
        {content}
      </div>
    </div>
  );
};

export default AiChatPage;
