/** Strip <think>...</think> blocks from assistant messages before sending to LLM.
 *  Handles both closed tags and unclosed tags (streaming artifacts in DB). */
export function stripThinking(content: string): string {
  return content
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/g, '')
    .trim();
}
