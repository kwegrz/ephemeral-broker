Overview

Ephemeral Pipe Broker is a cross-platform, in-memory IPC broker.
It provides a KV store and lease mechanism over named pipes (UNIX domain sockets on Linux/macOS, Windows Named Pipes on Windows).

⸻

Design Goals
	•	Ephemeral: state exists only while broker process runs.
	•	Zero external deps: built on Node core modules only.
	•	Secure defaults: TTL required, random pipe names, strict size limits.
	•	Cross-platform: consistent behavior on Mac/Linux/Windows.
	•	Extensible: plugin and middleware API without bloating core.

⸻

High-Level Flow

flowchart TD
  subgraph Broker
    A[Pipe Server] --> B[Request Parser]
    B --> C[Handlers]
    C --> D[Store: Map + LRU]
    B --> E[Plugins/Middleware]
  end

  Client -- JSON line --> A
  A -- JSON response --> Client

	1.	Broker starts → creates a random pipe path, listens for connections.
	2.	Client connects → sends newline-delimited JSON requests.
	3.	Middleware (auth, logging, validation) runs first.
	4.	Handlers (get, set, lease, etc.) execute.
	5.	Store is an in-memory Map with TTL + LRU eviction.
	6.	Response is written back as JSON.

⸻

Core Components
	•	Pipe Layer (net.createServer)
	•	UNIX socket or Named Pipe.
	•	Enforces request size caps.
	•	Request Handling
	•	Newline-delimited JSON.
	•	Middleware chain runs before handler.
	•	HMAC auth optional.
	•	Store
	•	Map of { key → { value, expires } }.
	•	TTL sweep + LRU eviction.
	•	Leases tracked separately by workerId.
	•	Lifecycle Management
	•	Idle timeout + heartbeat.
	•	Cleans up expired items and sockets.
	•	Shuts down gracefully on child exit or signals.
	•	Plugin System
	•	broker.register(name, handler) → add new actions.
	•	broker.on('provide', …) → lazy value providers (e.g., AWS STS).
	•	Middleware functions can inspect/modify requests.

⸻

Extensibility
	•	Plugins: packaged as NPM modules.
Example: @ephemeral-broker/aws-sts registers a provide handler to mint STS creds.
	•	Adapters: framework-specific sugar.
Example: @ephemeral-broker/wdio adds WDIO services/hooks.

⸻

Limitations
	•	Single host only: pipes don’t cross machines.
	•	Small payloads only: capped to KB-sized values.
	•	Ephemeral by design: broker state is not persisted.
