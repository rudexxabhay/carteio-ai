# Google Gemini Playground troubleshooting

Carteio sends Gemini requests to `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` using the server-side `GEMINI_API_KEY`. The chat body uses the Gemini `generateContent` shape (`systemInstruction`, `contents`, and `generationConfig`). `READY_FOR_TESTING` means only that the configured provider, model syntax, and key presence pass local checks; it does not make a provider request or confirm project access.

For a failed request, correlate the server's `conversation_provider_failure` record by request ID. The log records the HTTP status and, when Google's JSON error body contains them, only the allowlisted `providerStatus` and `providerReason` enum fields. It deliberately omits Google's free-form message, customer transcript, API key, and response body.

- HTTP 404 / `NOT_FOUND`: check the exact model ID, API path/version, and whether the selected model is available to the Google AI Studio project associated with this key. A 404 alone does not prove a typo.
- HTTP 403 / `PERMISSION_DENIED`: check key restrictions, Gemini API enablement, and project access. The Playground response identifies a credential/access failure without returning Google's raw error.
- HTTP 400 / `INVALID_ARGUMENT`: check the request shape and settings; the sanitized provider response does not include user content.
- HTTP 429 or 5xx: treat as quota/rate limit or temporary provider availability as surfaced by the existing retry behavior.

`gemini-2.5-flash` is a valid model ID and is retained as the configured model. Google currently documents it as served, with access limited to users/projects that have actively used the 2.5 models. Verify access in Google AI Studio for the same project as the backend key before changing any model configuration. Carteio does not probe Gemini at startup and never changes the configured primary provider or enables fallback automatically.

## Manual ListModels diagnostic

The developer-only CLI lists only the configured model's resource name and `supportedGenerationMethods` as seen by the project behind `GEMINI_API_KEY`. It calls Google's official `GET https://generativelanguage.googleapis.com/v1beta/models` endpoint, uses `x-goog-api-key` as a header, follows bounded pagination, and never invokes content generation. It is not exposed by the application API.

From the backend directory, explicitly approve the live metadata request with:

```sh
pnpm run diagnose:gemini-models -- --confirm-live
```

Without the exact `--confirm-live` flag, the CLI sends no request. The only success output is a JSON array containing the configured model's `name` and `supportedGenerationMethods`; check whether the methods include `generateContent`. An empty array means that model name was not returned for the configured project. Failures show only a sanitized HTTP status or generic failure category, never Google's raw error body or credential.

This diagnostic is a metadata check, not proof that a full generation request will succeed. If the configured model appears and advertises `generateContent` yet Playground still returns 404, compare the actual deployment's API endpoint, key/project, model config, and correlated provider status. Keep the primary model unchanged unless the project owner deliberately decides otherwise.
