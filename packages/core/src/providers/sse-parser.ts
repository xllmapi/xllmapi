export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Parse an SSE stream from a fetch Response body into events.
 * Handles buffer accumulation and \n\n boundary detection.
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) break;

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary === -1) break;

        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        let eventName = "message";
        const dataLines: string[] = [];

        for (const line of rawEvent.split("\n")) {
          if (line.startsWith("event:")) {
            eventName = line.slice("event:".length).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice("data:".length).trimStart());
          }
        }

        if (dataLines.length > 0) {
          yield { event: eventName, data: dataLines.join("\n") };
        }
      }
    }

    // Flush remaining decoder bytes
    const tail = decoder.decode();
    if (tail) {
      buffer += tail;
    }

    // Process any remaining event in buffer
    if (buffer.trim()) {
      let eventName = "message";
      const dataLines: string[] = [];
      for (const line of buffer.split("\n")) {
        if (line.startsWith("event:")) {
          eventName = line.slice("event:".length).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).trimStart());
        }
      }
      if (dataLines.length > 0) {
        yield { event: eventName, data: dataLines.join("\n") };
      }
    }
  } finally {
    reader.releaseLock();
  }
}
