import { useState } from "react";
import { Footer } from "@/components/layout/Footer";
import { CopyButton } from "@/components/ui/CopyButton";
import { useLocale } from "@/hooks/useLocale";

// Build-time replaceable via Vite define
const API_BASE = __XLLMAPI_API_BASE__;

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative rounded-[var(--radius-card)] bg-[#0d1117] border border-line overflow-hidden">
      <div className="absolute top-3 right-3 z-10">
        <CopyButton text={code} />
      </div>
      <div className="p-5 overflow-x-auto">
        <pre className="font-mono text-sm text-[#c9d1d9] leading-relaxed">{code}</pre>
      </div>
    </div>
  );
}

const SECTIONS = [
  {
    id: "quickstart",
    titleKey: "docs.quickStart",
  },
  {
    id: "openai",
    titleKey: "docs.chatCompletions",
  },
  {
    id: "anthropic",
    titleKey: "docs.messages",
  },
  {
    id: "xllmapi",
    titleKey: "docs.xllmapiUnified",
  },
  {
    id: "python",
    titleKey: "docs.pythonExample",
  },
  {
    id: "agents",
    titleKey: "docs.agents",
  },
  {
    id: "auth",
    titleKey: "docs.auth",
  },
];

export function DocsPage() {
  const { t } = useLocale();
  const [activeSection, setActiveSection] = useState("quickstart");

  const scrollTo = (id: string) => {
    setActiveSection(id);
    document.getElementById(`doc-${id}`)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex flex-1 pt-16">
        {/* Sidebar */}
        <aside className="hidden md:block w-[200px] shrink-0 border-r border-line sticky top-16 h-[calc(100vh-64px)] overflow-y-auto py-6 px-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary px-2 mb-3">
            {t("docs.title")}
          </p>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => scrollTo(s.id)}
              className={`block w-full text-left px-2 py-1.5 text-sm rounded-md cursor-pointer transition-colors border-none mb-0.5 ${
                activeSection === s.id
                  ? "bg-accent/10 text-accent font-medium"
                  : "bg-transparent text-text-secondary hover:text-text-primary"
              }`}
            >
              {t(s.titleKey)}
            </button>
          ))}
        </aside>

        {/* Content */}
        <main className="flex-1 max-w-3xl px-6 py-8 mx-auto">
          <h1 className="text-3xl font-bold mb-10 tracking-tight">{t("docs.title")}</h1>

          <section id="doc-quickstart" className="mb-12">
            <h2 className="text-xl font-semibold mb-4 tracking-tight">{t("docs.quickStart")}</h2>
            <p className="text-text-secondary mb-4 leading-relaxed">{t("docs.quickStartDesc")}</p>
            <CodeBlock code={`# Set your API base URL and key
export OPENAI_API_BASE=${API_BASE}/v1
export OPENAI_API_KEY=xk-your-api-key

# Test with curl
curl $OPENAI_API_BASE/chat/completions \\
  -H "Authorization: Bearer $OPENAI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "deepseek-chat", "messages": [{"role": "user", "content": "Hello!"}]}'`} />
          </section>

          <section id="doc-openai" className="mb-12">
            <h2 className="text-xl font-semibold mb-4 tracking-tight">{t("docs.chatCompletions")}</h2>
            <p className="text-text-secondary mb-4 leading-relaxed">OpenAI 兼容格式，支持 tools、tool_choice、stream 等全部参数。</p>
            <CodeBlock code={`curl ${API_BASE}/v1/chat/completions \\
  -H "Authorization: Bearer xk-your-api-key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "deepseek-chat",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ],
    "stream": true
  }'`} />
          </section>

          <section id="doc-anthropic" className="mb-12">
            <h2 className="text-xl font-semibold mb-4 tracking-tight">{t("docs.messages")}</h2>
            <p className="text-text-secondary mb-4 leading-relaxed">Anthropic 兼容格式，原生支持 thinking block。</p>
            <CodeBlock code={`curl ${API_BASE}/anthropic/v1/messages \\
  -H "x-api-key: xk-your-api-key" \\
  -H "Content-Type: application/json" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{
    "model": "MiniMax-M2.5",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'`} />
          </section>

          <section id="doc-xllmapi" className="mb-12">
            <h2 className="text-xl font-semibold mb-4 tracking-tight">{t("docs.xllmapiUnified")}</h2>
            <p className="text-text-secondary mb-4 leading-relaxed">xllmapi 统一格式，自动识别 OpenAI / Anthropic 请求格式，也支持 x-api-format header 显式指定。</p>
            <CodeBlock code={`# 自动识别为 OpenAI 格式
curl ${API_BASE}/xllmapi/v1/chat/completions \\
  -H "Authorization: Bearer xk-your-api-key" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "deepseek-chat", "messages": [{"role": "user", "content": "Hi"}]}'

# 自动识别为 Anthropic 格式
curl ${API_BASE}/xllmapi/v1/messages \\
  -H "x-api-key: xk-your-api-key" \\
  -H "Content-Type: application/json" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{"model": "MiniMax-M2.5", "max_tokens": 100, "messages": [{"role": "user", "content": "Hi"}]}'`} />
          </section>

          <section id="doc-python" className="mb-12">
            <h2 className="text-xl font-semibold mb-4 tracking-tight">{t("docs.pythonExample")}</h2>
            <CodeBlock code={`from openai import OpenAI

client = OpenAI(
    base_url="${API_BASE}/v1",
    api_key="xk-your-api-key",
)

response = client.chat.completions.create(
    model="deepseek-chat",
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True,
)

for chunk in response:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")`} />
          </section>

          <section id="doc-agents" className="mb-12">
            <h2 className="text-xl font-semibold mb-4 tracking-tight">{t("docs.agents")}</h2>
            <p className="text-text-secondary mb-4 leading-relaxed">主流 Agent 配置示例。</p>

            <h3 className="text-base font-semibold mb-2 mt-6">OpenCode</h3>
            <CodeBlock code={`// ~/.config/opencode/opencode.json
{
  "provider": {
    "xllmapi": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "${API_BASE}/v1",
        "apiKey": "<YOUR_API_KEY>"
      },
      "models": {
        "deepseek-chat": { "name": "DeepSeek" }
      }
    },
    "xllmapi-anthropic": {
      "npm": "@ai-sdk/anthropic",
      "options": {
        "baseURL": "${API_BASE}/anthropic",
        "apiKey": "<YOUR_API_KEY>"
      },
      "models": {
        "MiniMax-M2.5": { "name": "MiniMax" }
      }
    }
  }
}`} />

            <h3 className="text-base font-semibold mb-2 mt-6">Claude Code</h3>
            <CodeBlock code={`// ~/.claude/settings.json
{
  "env": {
    "ANTHROPIC_BASE_URL": "${API_BASE}",
    "ANTHROPIC_AUTH_TOKEN": "<YOUR_API_KEY>",
    "ANTHROPIC_MODEL": "MiniMax-M2.7",
    "ANTHROPIC_SMALL_FAST_MODEL": "MiniMax-M2.5",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "deepseek-chat"
  }
}`} />

            <h3 className="text-base font-semibold mb-2 mt-6">OpenClaw / 通用</h3>
            <CodeBlock code={`export OPENAI_API_BASE=${API_BASE}/v1
export OPENAI_API_KEY=xk-your-api-key`} />
          </section>

          <section id="doc-auth" className="mb-12">
            <h2 className="text-xl font-semibold mb-4 tracking-tight">{t("docs.auth")}</h2>
            <p className="text-text-secondary leading-relaxed">{t("docs.authDesc")}</p>
          </section>
        </main>
      </div>

      <Footer />
    </div>
  );
}

// TypeScript declaration for Vite define
declare const __XLLMAPI_API_BASE__: string;
