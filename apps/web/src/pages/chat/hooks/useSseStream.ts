export interface StreamCompletedEvent {
  requestId: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  timing?: { totalMs: number; routeMs?: number; providerLatencyMs?: number };
}

export async function streamResponse(
  response: Response,
  onDelta: (text: string) => void,
  onCompleted: (event: StreamCompletedEvent) => void,
  onError: (error: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!response.body) {
    onError("No response body");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        // Track SSE event type
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
          continue;
        }

        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") continue;

        try {
          const parsed = JSON.parse(payload);

          if (currentEvent === "completed") {
            onCompleted(parsed);
            currentEvent = "";
            continue;
          }

          if (currentEvent === "error") {
            onError(parsed.error ?? parsed.message ?? "Provider error");
            currentEvent = "";
            continue;
          }

          // Support both core-router format {"delta":"..."} and OpenAI format
          const delta = parsed.delta ?? parsed.choices?.[0]?.delta?.content;
          if (delta) {
            onDelta(delta);
          }
          currentEvent = "";
        } catch {
          // skip malformed lines
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) return;
    onError(err instanceof Error ? err.message : "Stream error");
  } finally {
    try { reader.cancel(); } catch { /* ignore */ }
  }
}
