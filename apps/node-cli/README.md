# @xllmapi/node (node-cli)

Distributed model node CLI — connects to xllmapi platform via WebSocket, executes LLM requests locally.

## Usage
```bash
# Interactive mode
xllmapi-node

# Command line mode
xllmapi-node --token ntok_xxx --provider deepseek --api-key sk-xxx
```

## Built-in Providers
DeepSeek, Kimi/Moonshot, Kimi Coding, MiniMax, OpenAI, Anthropic, Ollama

## Dependencies
- `@xllmapi/shared-types` (node protocol types)
- `@xllmapi/logger`
- `ws`
