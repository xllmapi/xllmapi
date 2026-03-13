#include <arpa/inet.h>
#include <csignal>
#include <mbedtls/gcm.h>
#include <mbedtls/sha256.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

import mcpplibs.llmapi;
import std;

namespace {

using namespace mcpplibs::llmapi;

std::atomic<int> activeRequests_ { 0 };
std::atomic<unsigned long long> totalRequests_ { 0 };
std::atomic<unsigned long long> rejectedRequests_ { 0 };
std::atomic<unsigned long long> retryAttempts_ { 0 };
std::atomic<unsigned long long> circuitOpenRejections_ { 0 };

struct CircuitState {
    int consecutiveFailures { 0 };
    std::chrono::steady_clock::time_point openUntil {};
};

std::mutex circuitMutex_;
std::unordered_map<std::string, CircuitState> circuitStates_;

int max_concurrent_requests_() {
    auto value = std::getenv("XLLMAPI_CORE_MAX_CONCURRENT_REQUESTS");
    if (value == nullptr) {
        return 32;
    }

    try {
        return std::max(1, std::stoi(value));
    } catch (...) {
        return 32;
    }
}

int max_retry_attempts_() {
    auto value = std::getenv("XLLMAPI_CORE_MAX_RETRIES");
    if (value == nullptr) {
        return 1;
    }

    try {
        return std::max(0, std::stoi(value));
    } catch (...) {
        return 1;
    }
}

int retry_backoff_ms_() {
    auto value = std::getenv("XLLMAPI_CORE_RETRY_BACKOFF_MS");
    if (value == nullptr) {
        return 250;
    }

    try {
        return std::max(10, std::stoi(value));
    } catch (...) {
        return 250;
    }
}

int circuit_failure_threshold_() {
    auto value = std::getenv("XLLMAPI_CORE_CIRCUIT_FAILURE_THRESHOLD");
    if (value == nullptr) {
        return 3;
    }

    try {
        return std::max(1, std::stoi(value));
    } catch (...) {
        return 3;
    }
}

int circuit_open_ms_() {
    auto value = std::getenv("XLLMAPI_CORE_CIRCUIT_OPEN_MS");
    if (value == nullptr) {
        return 30'000;
    }

    try {
        return std::max(1000, std::stoi(value));
    } catch (...) {
        return 30'000;
    }
}

struct HttpRequest {
    std::string method;
    std::string path;
    std::string body;
};

struct ProviderExecutionConfig {
    std::string requestId;
    std::string logicalModel;
    std::string offeringId;
    std::string providerType;
    std::string realModel;
    std::string apiKeyEnvName;
    std::string encryptedSecret;
    std::string baseUrl;
    std::vector<Message> messages;
    ChatParams params;
};

struct ProviderExecutionResult {
    ChatResponse chatResponse;
    std::string providerName;
    long long providerLatencyMs { 0 };
};

std::string trim_(std::string value) {
    auto is_space = [](unsigned char ch) {
        return std::isspace(ch) != 0;
    };

    while (!value.empty() && is_space(value.front())) {
        value.erase(value.begin());
    }
    while (!value.empty() && is_space(value.back())) {
        value.pop_back();
    }
    return value;
}

std::string lowercase_(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

std::string make_http_response_(int statusCode, std::string_view statusText, std::string body) {
    return std::format(
        "HTTP/1.1 {} {}\r\n"
        "Content-Type: application/json; charset=utf-8\r\n"
        "Content-Length: {}\r\n"
        "Connection: close\r\n"
        "\r\n"
        "{}",
        statusCode,
        statusText,
        body.size(),
        body
    );
}

void send_all_(int clientFd, std::string_view text) {
    auto bytesLeft = text.size();
    auto cursor = text.data();

    while (bytesLeft > 0) {
        auto sent = ::send(clientFd, cursor, bytesLeft, MSG_NOSIGNAL);
        if (sent <= 0) {
            break;
        }
        cursor += sent;
        bytesLeft -= static_cast<std::size_t>(sent);
    }
}

void send_sse_event_(int clientFd, std::string_view eventName, const Json& payload) {
    auto body = std::format("event: {}\ndata: {}\n\n", eventName, payload.dump());
    send_all_(clientFd, body);
}

std::vector<unsigned char> hex_to_bytes_(std::string_view hex) {
    if (hex.size() % 2 != 0) {
        throw std::runtime_error("invalid hex length");
    }

    auto parse_nibble = [](char ch) -> unsigned char {
        if (ch >= '0' && ch <= '9') {
            return static_cast<unsigned char>(ch - '0');
        }
        if (ch >= 'a' && ch <= 'f') {
            return static_cast<unsigned char>(10 + ch - 'a');
        }
        if (ch >= 'A' && ch <= 'F') {
            return static_cast<unsigned char>(10 + ch - 'A');
        }
        throw std::runtime_error("invalid hex character");
    };

    std::vector<unsigned char> bytes;
    bytes.reserve(hex.size() / 2);
    for (std::size_t i = 0; i < hex.size(); i += 2) {
        auto high = parse_nibble(hex[i]);
        auto low = parse_nibble(hex[i + 1]);
        bytes.push_back(static_cast<unsigned char>((high << 4) | low));
    }
    return bytes;
}

std::string decrypt_secret_(std::string_view encryptedSecret) {
    auto payload = Json::parse(encryptedSecret.begin(), encryptedSecret.end());
    auto envMode = std::getenv("XLLMAPI_ENV");
    auto secretKey = std::getenv("XLLMAPI_SECRET_KEY");
    auto isProduction = envMode != nullptr && std::string_view(envMode) == "production";
    if (isProduction && (secretKey == nullptr || std::string_view(secretKey).empty())) {
        throw std::runtime_error("XLLMAPI_SECRET_KEY is required when XLLMAPI_ENV=production");
    }

    auto passphrase = std::string(secretKey != nullptr && std::string_view(secretKey).size() > 0
        ? secretKey
        : "xllmapi-dev-secret-key");

    std::array<unsigned char, 32> key {};
    if (mbedtls_sha256(
            reinterpret_cast<const unsigned char*>(passphrase.data()),
            passphrase.size(),
            key.data(),
            0
        ) != 0) {
        throw std::runtime_error("failed to derive secret key");
    }

    auto iv = hex_to_bytes_(payload.at("iv").get<std::string>());
    auto tag = hex_to_bytes_(payload.at("tag").get<std::string>());
    auto ciphertext = hex_to_bytes_(payload.at("ciphertext").get<std::string>());

    std::vector<unsigned char> plaintext(ciphertext.size());
    mbedtls_gcm_context context;
    mbedtls_gcm_init(&context);

    if (mbedtls_gcm_setkey(&context, MBEDTLS_CIPHER_ID_AES, key.data(), 256) != 0) {
        mbedtls_gcm_free(&context);
        throw std::runtime_error("failed to initialize AES-GCM");
    }

    auto decryptResult = mbedtls_gcm_auth_decrypt(
        &context,
        ciphertext.size(),
        iv.data(),
        iv.size(),
        nullptr,
        0,
        tag.data(),
        tag.size(),
        ciphertext.data(),
        plaintext.data()
    );
    mbedtls_gcm_free(&context);

    if (decryptResult != 0) {
        throw std::runtime_error("failed to decrypt provider secret");
    }

    return std::string(plaintext.begin(), plaintext.end());
}

std::string resolve_api_key_(const ProviderExecutionConfig& config) {
    if (!config.encryptedSecret.empty()) {
        return decrypt_secret_(config.encryptedSecret);
    }

    if (!config.apiKeyEnvName.empty()) {
        auto apiKey = std::getenv(config.apiKeyEnvName.c_str());
        if (apiKey != nullptr && std::string_view(apiKey).size() > 0) {
            return std::string(apiKey);
        }
        throw std::runtime_error(std::format("environment variable {} is not set", config.apiKeyEnvName));
    }

    throw std::runtime_error("provider secret is missing");
}

std::optional<HttpRequest> parse_http_request_(std::string_view rawRequest) {
    auto headerEnd = rawRequest.find("\r\n\r\n");
    if (headerEnd == std::string_view::npos) {
        return std::nullopt;
    }

    auto headerBlock = rawRequest.substr(0, headerEnd);
    auto body = rawRequest.substr(headerEnd + 4);

    auto firstLineEnd = headerBlock.find("\r\n");
    auto requestLine = headerBlock.substr(0, firstLineEnd);

    std::istringstream requestLineStream { std::string(requestLine) };
    HttpRequest request {};
    requestLineStream >> request.method >> request.path;
    request.body = std::string(body);

    if (request.method.empty() || request.path.empty()) {
        return std::nullopt;
    }
    return request;
}

std::string read_http_request_(int clientFd) {
    std::string request;
    std::array<char, 4096> buffer {};

    while (true) {
        auto bytesRead = ::recv(clientFd, buffer.data(), buffer.size(), 0);
        if (bytesRead <= 0) {
            break;
        }

        request.append(buffer.data(), static_cast<std::size_t>(bytesRead));

        auto headerEnd = request.find("\r\n\r\n");
        if (headerEnd == std::string::npos) {
            continue;
        }

        // Case-insensitive search for Content-Length header
        auto contentLengthPos = std::string::npos;
        for (std::size_t i = 0; i + 15 <= headerEnd; ++i) {
            if ((request[i] == 'C' || request[i] == 'c') &&
                lowercase_(request.substr(i, 15)) == "content-length:") {
                contentLengthPos = i;
                break;
            }
        }
        if (contentLengthPos == std::string::npos) {
            break;
        }

        auto lineEnd = request.find("\r\n", contentLengthPos);
        auto lengthText = trim_(request.substr(
            contentLengthPos + 15,
            lineEnd - contentLengthPos - 15
        ));
        auto contentLength = static_cast<std::size_t>(std::stoul(lengthText));
        auto bodySize = request.size() - (headerEnd + 4);

        if (bodySize >= contentLength) {
            break;
        }
    }

    return request;
}

std::string make_health_response_() {
    Json response;
    response["ok"] = true;
    response["service"] = "core-router-executor";
    response["activeRequests"] = activeRequests_.load();
    response["totalRequests"] = totalRequests_.load();
    response["rejectedRequests"] = rejectedRequests_.load();
    response["retryAttempts"] = retryAttempts_.load();
    response["circuitOpenRejections"] = circuitOpenRejections_.load();
    response["maxConcurrentRequests"] = max_concurrent_requests_();
    response["maxRetries"] = max_retry_attempts_();
    response["circuitFailureThreshold"] = circuit_failure_threshold_();
    response["circuitOpenMs"] = circuit_open_ms_();
    return response.dump(2);
}

bool is_retryable_error_(std::string_view message) {
    auto text = lowercase_(std::string(message));
    return text.contains("timeout")
        || text.contains("timed out")
        || text.contains("connection")
        || text.contains("tempor")
        || text.contains("try again")
        || text.contains("429")
        || text.contains("rate limit")
        || text.contains("5xx")
        || text.contains("server error")
        || text.contains("unavailable")
        || text.contains("reset by peer");
}

bool is_circuit_open_(std::string_view offeringId) {
    auto now = std::chrono::steady_clock::now();
    std::lock_guard lock { circuitMutex_ };
    auto it = circuitStates_.find(std::string(offeringId));
    if (it == circuitStates_.end()) {
        return false;
    }

    if (it->second.openUntil == std::chrono::steady_clock::time_point {}) {
        return false;
    }

    if (it->second.openUntil <= now) {
        it->second.openUntil = {};
        it->second.consecutiveFailures = 0;
        return false;
    }

    return true;
}

void mark_execution_success_(std::string_view offeringId) {
    std::lock_guard lock { circuitMutex_ };
    auto& state = circuitStates_[std::string(offeringId)];
    state.consecutiveFailures = 0;
    state.openUntil = {};
}

void mark_execution_failure_(std::string_view offeringId) {
    auto now = std::chrono::steady_clock::now();
    std::lock_guard lock { circuitMutex_ };
    auto& state = circuitStates_[std::string(offeringId)];
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= circuit_failure_threshold_()) {
        state.openUntil = now + std::chrono::milliseconds(circuit_open_ms_());
    }
}

void sleep_for_retry_(int attemptIndex) {
    auto baseDelay = retry_backoff_ms_();
    auto multiplier = 1LL << std::min(attemptIndex, 5);
    std::this_thread::sleep_for(std::chrono::milliseconds(baseDelay * multiplier));
}

std::string join_errors_(const std::vector<std::string>& errors) {
    if (errors.empty()) {
        return "no candidates";
    }

    auto joined = errors.front();
    for (std::size_t index = 1; index < errors.size(); ++index) {
        joined += "; ";
        joined += errors[index];
    }
    return joined;
}

std::vector<Message> parse_messages_(const Json& root) {
    std::vector<Message> messages;
    if (!root.contains("requestPayload") || !root["requestPayload"].contains("messages")) {
        return messages;
    }

    for (const auto& item : root["requestPayload"]["messages"]) {
        auto role = item.value("role", "user");
        auto content = item.value("content", "");
        if (role == "system") {
            messages.push_back(Message::system(content));
        } else if (role == "assistant") {
            messages.push_back(Message::assistant(content));
        } else {
            messages.push_back(Message::user(content));
        }
    }
    return messages;
}

ChatParams parse_chat_params_(const Json& root) {
    ChatParams params;
    if (!root.contains("requestPayload")) {
        return params;
    }

    const auto& payload = root["requestPayload"];
    if (payload.contains("temperature") && !payload["temperature"].is_null()) {
        params.temperature = payload["temperature"].get<double>();
    }
    if (payload.contains("maxTokens") && !payload["maxTokens"].is_null()) {
        params.maxTokens = payload["maxTokens"].get<int>();
    }
    return params;
}

ProviderExecutionResult execute_provider_once_(
    const ProviderExecutionConfig& config,
    std::function<void(std::string_view)> onChunk = {}
) {
    auto apiKey = resolve_api_key_(config);
    auto started = std::chrono::steady_clock::now();

    ChatResponse chatResponse;
    std::string providerName;

    if (config.providerType == "anthropic") {
        auto provider = Anthropic(AnthropicConfig {
            .apiKey = apiKey,
            .baseUrl = config.baseUrl.empty() ? "https://api.anthropic.com/v1" : config.baseUrl,
            .model = config.realModel,
            .defaultMaxTokens = config.params.maxTokens.value_or(4096),
        });
        providerName = std::string(provider.name());
        if (onChunk) {
            chatResponse = provider.chat_stream(config.messages, config.params, [&](std::string_view chunk) {
                onChunk(chunk);
            });
        } else {
            chatResponse = provider.chat(config.messages, config.params);
        }
    } else {
        auto provider = OpenAI(Config {
            .apiKey = apiKey,
            .baseUrl = config.baseUrl.empty() ? "https://api.openai.com/v1" : config.baseUrl,
            .model = config.realModel,
        });
        providerName = std::string(provider.name());
        if (onChunk) {
            chatResponse = provider.chat_stream(config.messages, config.params, [&](std::string_view chunk) {
                onChunk(chunk);
            });
        } else {
            chatResponse = provider.chat(config.messages, config.params);
        }
    }

    auto finished = std::chrono::steady_clock::now();
    auto providerLatencyMs = std::chrono::duration_cast<std::chrono::milliseconds>(finished - started).count();
    return ProviderExecutionResult {
        .chatResponse = std::move(chatResponse),
        .providerName = std::move(providerName),
        .providerLatencyMs = providerLatencyMs,
    };
}

ProviderExecutionResult execute_provider_with_retries_(
    const ProviderExecutionConfig& config,
    std::function<void(std::string_view)> onChunk = {}
) {
    std::string lastError = "provider execution failed";
    auto maxRetries = max_retry_attempts_();

    for (int attempt = 0; attempt <= maxRetries; ++attempt) {
        if (is_circuit_open_(config.offeringId)) {
            circuitOpenRejections_.fetch_add(1);
            throw std::runtime_error(std::format("offering {} circuit is open", config.offeringId));
        }

        auto streamedAnyChunk = false;
        auto guardedChunk = [&](std::string_view chunk) {
            streamedAnyChunk = true;
            if (onChunk) {
                onChunk(chunk);
            }
        };

        try {
            auto result = execute_provider_once_(config, onChunk ? std::function<void(std::string_view)>(guardedChunk) : std::function<void(std::string_view)> {});
            mark_execution_success_(config.offeringId);
            return result;
        } catch (const std::exception& error) {
            lastError = error.what();
            mark_execution_failure_(config.offeringId);

            auto shouldRetry = attempt < maxRetries && !streamedAnyChunk && is_retryable_error_(error.what());
            if (!shouldRetry) {
                break;
            }

            retryAttempts_.fetch_add(1);
            sleep_for_retry_(attempt);
        }
    }

    throw std::runtime_error(lastError);
}

std::vector<ProviderExecutionConfig> parse_execution_candidates_(const Json& root) {
    auto requestId = root.value("requestId", "req_unknown");
    auto logicalModel = root.value("logicalModel", "gpt-4o-mini");
    if (!root.contains("candidateOfferings") || root["candidateOfferings"].empty()) {
        throw std::runtime_error("candidateOfferings is empty");
    }

    auto messages = parse_messages_(root);
    if (messages.empty()) {
        throw std::runtime_error("messages is empty");
    }

    auto params = parse_chat_params_(root);
    std::vector<ProviderExecutionConfig> configs;
    configs.reserve(root["candidateOfferings"].size());

    for (const auto& offering : root["candidateOfferings"]) {
        auto offeringId = offering.value("offeringId", "offering_unknown");
        auto providerType = offering.value("providerType", "");
        auto realModel = offering.value("realModel", "");
        auto apiKeyEnvName = offering.value("apiKeyEnvName", "");
        auto encryptedSecret = offering.value("encryptedSecret", "");
        auto baseUrl = offering.value("baseUrl", "");

        if (providerType.empty() || realModel.empty()) {
            throw std::runtime_error("provider configuration is incomplete");
        }

        configs.push_back(ProviderExecutionConfig {
            .requestId = requestId,
            .logicalModel = logicalModel,
            .offeringId = offeringId,
            .providerType = providerType,
            .realModel = realModel,
            .apiKeyEnvName = apiKeyEnvName,
            .encryptedSecret = encryptedSecret,
            .baseUrl = baseUrl,
            .messages = messages,
            .params = params,
        });
    }

    return configs;
}

Json execute_provider_chat_(const Json& root) {
    auto configs = parse_execution_candidates_(root);
    std::vector<std::string> errors;

    for (std::size_t index = 0; index < configs.size(); ++index) {
        const auto& config = configs[index];
        try {
            auto result = execute_provider_with_retries_(config);
            Json response;
            response["requestId"] = config.requestId;
            response["executionId"] = "exec_" + config.requestId;
            response["chosenOfferingId"] = config.offeringId;
            response["fallbackUsed"] = index > 0;
            response["provider"] = result.providerName;
            response["realModel"] = config.realModel;
            response["outputText"] = result.chatResponse.text();
            response["usage"] = {
                {"inputTokens", result.chatResponse.usage.inputTokens},
                {"outputTokens", result.chatResponse.usage.outputTokens},
                {"totalTokens", result.chatResponse.usage.totalTokens},
            };
            response["timing"] = {
                {"routeMs", 1},
                {"providerLatencyMs", result.providerLatencyMs},
                {"totalMs", result.providerLatencyMs + 1},
            };
            response["logicalModel"] = config.logicalModel;
            return response;
        } catch (const std::exception& error) {
            errors.push_back(std::format("{}: {}", config.offeringId, error.what()));
        }
    }

    throw std::runtime_error(std::format("all candidate offerings failed: {}", join_errors_(errors)));
}

std::string make_chat_response_(std::string_view requestBody) {
    auto requestJson = Json::parse(requestBody.begin(), requestBody.end());
    return execute_provider_chat_(requestJson).dump(2);
}

void handle_stream_request_(int clientFd, std::string_view requestBody) {
    auto requestJson = Json::parse(requestBody.begin(), requestBody.end());
    auto configs = parse_execution_candidates_(requestJson);

    send_all_(
        clientFd,
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: text/event-stream; charset=utf-8\r\n"
        "Cache-Control: no-cache\r\n"
        "Connection: close\r\n"
        "\r\n"
    );

    std::vector<std::string> errors;

    for (std::size_t index = 0; index < configs.size(); ++index) {
        const auto& config = configs[index];
        auto sentMeta = false;

        auto emitMeta = [&]() {
            if (sentMeta) {
                return;
            }

            Json meta {
                {"requestId", config.requestId},
                {"executionId", "exec_" + config.requestId},
                {"chosenOfferingId", config.offeringId},
            };
            send_sse_event_(clientFd, "meta", meta);
            sentMeta = true;
        };

        try {
            auto result = execute_provider_with_retries_(config, [&](std::string_view chunk) {
                emitMeta();
                Json payload { {"delta", std::string(chunk)} };
                send_sse_event_(clientFd, "chunk", payload);
            });

            emitMeta();
            Json completed {
                {"requestId", config.requestId},
                {"executionId", "exec_" + config.requestId},
                {"chosenOfferingId", config.offeringId},
                {"fallbackUsed", index > 0},
                {"provider", result.providerName},
                {"realModel", config.realModel},
                {"usage", {
                    {"inputTokens", result.chatResponse.usage.inputTokens},
                    {"outputTokens", result.chatResponse.usage.outputTokens},
                    {"totalTokens", result.chatResponse.usage.totalTokens},
                }},
                {"timing", {
                    {"routeMs", 1},
                    {"providerLatencyMs", result.providerLatencyMs},
                    {"totalMs", result.providerLatencyMs + 1},
                }},
            };
            send_sse_event_(clientFd, "completed", completed);
            return;
        } catch (const std::exception& error) {
            if (sentMeta) {
                throw;
            }
            errors.push_back(std::format("{}: {}", config.offeringId, error.what()));
        }
    }

    throw std::runtime_error(std::format("all candidate offerings failed: {}", join_errors_(errors)));
}

std::string route_request_(const HttpRequest& request) {
    if (request.method == "GET" && request.path == "/healthz") {
        return make_http_response_(200, "OK", make_health_response_());
    }

    if (request.method == "GET" && request.path == "/metrics") {
        return make_http_response_(200, "OK", make_health_response_());
    }

    if (request.method == "POST" && request.path == "/internal/core/route-execute/chat") {
        try {
            return make_http_response_(200, "OK", make_chat_response_(request.body));
        } catch (const std::exception& error) {
            Json response;
            response["error"] = {
                {"message", error.what()},
            };
            return make_http_response_(500, "Internal Server Error", response.dump(2));
        }
    }

    return make_http_response_(
        404,
        "Not Found",
        R"({
  "error": {
    "message": "not found"
  }
})"
    );
}

bool try_handle_special_request_(int clientFd, const HttpRequest& request) {
    if (request.method == "POST" && request.path == "/internal/core/route-execute/chat-stream") {
        try {
            handle_stream_request_(clientFd, request.body);
        } catch (const std::exception& error) {
            try {
                send_all_(
                    clientFd,
                    "HTTP/1.1 200 OK\r\n"
                    "Content-Type: text/event-stream; charset=utf-8\r\n"
                    "Cache-Control: no-cache\r\n"
                    "Connection: close\r\n"
                    "\r\n"
                );
                auto message = std::string(error.what());
                // sanitize non-ASCII bytes to avoid JSON UTF-8 errors
                for (auto& ch : message) {
                    if (static_cast<unsigned char>(ch) > 127) {
                        ch = '?';
                    }
                }
                Json payload { {"message", message} };
                send_sse_event_(clientFd, "error", payload);
            } catch (...) {
                // prevent double-fault from crashing the process
            }
        }
        return true;
    }

    return false;
}

int create_server_socket_(int port) {
    auto serverFd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (serverFd < 0) {
        throw std::runtime_error("failed to create socket");
    }

    int reuseAddress = 1;
    ::setsockopt(serverFd, SOL_SOCKET, SO_REUSEADDR, &reuseAddress, sizeof(reuseAddress));

    sockaddr_in serverAddress {};
    serverAddress.sin_family = AF_INET;
    serverAddress.sin_addr.s_addr = htonl(INADDR_ANY);
    serverAddress.sin_port = htons(static_cast<uint16_t>(port));

    if (::bind(serverFd, reinterpret_cast<sockaddr*>(&serverAddress), sizeof(serverAddress)) < 0) {
        ::close(serverFd);
        throw std::runtime_error("failed to bind socket");
    }

    if (::listen(serverFd, 16) < 0) {
        ::close(serverFd);
        throw std::runtime_error("failed to listen on socket");
    }

    return serverFd;
}

void serve_forever_(int serverFd) {
    while (true) {
        sockaddr_in clientAddress {};
        socklen_t clientAddressSize = sizeof(clientAddress);
        auto clientFd = ::accept(serverFd, reinterpret_cast<sockaddr*>(&clientAddress), &clientAddressSize);
        if (clientFd < 0) {
            continue;
        }

        if (activeRequests_.load() >= max_concurrent_requests_()) {
            rejectedRequests_.fetch_add(1);
            auto response = make_http_response_(
                503,
                "Service Unavailable",
                R"({
  "error": {
    "message": "core concurrency limit reached"
  }
})"
            );
            ::send(clientFd, response.data(), response.size(), MSG_NOSIGNAL);
            ::close(clientFd);
            continue;
        }

        totalRequests_.fetch_add(1);
        activeRequests_.fetch_add(1);

        std::thread([clientFd]() {
            try {
                auto rawRequest = read_http_request_(clientFd);
                auto request = parse_http_request_(rawRequest);
                if (request.has_value() && try_handle_special_request_(clientFd, *request)) {
                    ::close(clientFd);
                    activeRequests_.fetch_sub(1);
                    return;
                }
                auto response = request.has_value()
                    ? route_request_(*request)
                    : make_http_response_(
                        400,
                        "Bad Request",
                        R"({
  "error": {
    "message": "bad request"
  }
})"
                    );

                ::send(clientFd, response.data(), response.size(), MSG_NOSIGNAL);
            } catch (...) {
                // prevent uncaught exceptions from calling std::terminate
            }
            ::close(clientFd);
            activeRequests_.fetch_sub(1);
        }).detach();
    }
}

} // namespace

int main() {
    std::signal(SIGPIPE, SIG_IGN);
    constexpr int port { 4001 };
    auto serverFd = create_server_socket_(port);
    std::println("core-router-executor listening on http://0.0.0.0:{}", port);
    serve_forever_(serverFd);
    ::close(serverFd);
    return 0;
}
