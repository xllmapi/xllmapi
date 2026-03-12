import { Footer } from "@/components/layout/Footer";
import { CopyButton } from "@/components/ui/CopyButton";
import { useLocale } from "@/hooks/useLocale";

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative rounded-[var(--radius-card)] bg-bg-0 border border-line overflow-hidden">
      <div className="absolute top-3 right-3 z-10">
        <CopyButton text={code} />
      </div>
      <div className="p-5 overflow-x-auto">
        <pre className="font-mono text-sm text-text-primary leading-relaxed">{code}</pre>
      </div>
    </div>
  );
}

const CODE_QUICK_START = `# Set your API base URL and key
export OPENAI_API_BASE=https://your-instance.example.com/v1
export OPENAI_API_KEY=your-api-key

# List available models
curl $OPENAI_API_BASE/network/models \\
  -H "Authorization: Bearer $OPENAI_API_KEY"`;

const CODE_CHAT = `curl $OPENAI_API_BASE/chat/completions \\
  -H "Authorization: Bearer $OPENAI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "deepseek-chat",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ],
    "stream": true
  }'`;

const CODE_MESSAGES = `curl https://your-instance.example.com/v1/messages \\
  -H "x-api-key: your-api-key" \\
  -H "Content-Type: application/json" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'`;

const CODE_PYTHON = `from openai import OpenAI

client = OpenAI(
    base_url="https://your-instance.example.com/v1",
    api_key="your-api-key",
)

response = client.chat.completions.create(
    model="deepseek-chat",
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True,
)

for chunk in response:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")`;

export function DocsPage() {
  const { t } = useLocale();

  return (
    <div className="min-h-screen flex flex-col">
      <div className="mx-auto max-w-3xl px-6 pt-24 pb-16 flex-1">
        <h1 className="text-3xl font-bold mb-10 tracking-tight">{t("docs.title")}</h1>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4 tracking-tight">{t("docs.quickStart")}</h2>
          <p className="text-text-secondary mb-4 leading-relaxed">
            {t("docs.quickStartDesc")}
          </p>
          <CodeBlock code={CODE_QUICK_START} />
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4 tracking-tight">{t("docs.chatCompletions")}</h2>
          <CodeBlock code={CODE_CHAT} />
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4 tracking-tight">{t("docs.messages")}</h2>
          <CodeBlock code={CODE_MESSAGES} />
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4 tracking-tight">{t("docs.pythonExample")}</h2>
          <CodeBlock code={CODE_PYTHON} />
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4 tracking-tight">{t("docs.auth")}</h2>
          <p className="text-text-secondary leading-relaxed">
            {t("docs.authDesc")}
          </p>
        </section>
      </div>

      <Footer />
    </div>
  );
}
