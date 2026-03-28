# Stellar Memory — OpenWebUI Filter Pipeline

This pipeline integrates [Stellar Memory](https://github.com/sangjun0000/stellar-memory-core) with OpenWebUI. Before each request is sent to the LLM, it searches your local memory store for relevant context and prepends the results to the system prompt. After each LLM response, it optionally saves the reply as a new memory so your knowledge base grows automatically over time.

## Installation

1. Start the Stellar Memory API:
   ```
   npx stellar-memory api
   ```
2. In OpenWebUI, go to **Admin Panel → Pipelines**.
3. Click **Install from URL** and enter the raw URL of `stellar_memory_pipeline.py`, or click **Upload** and select the file directly.
4. Once installed, open the pipeline settings and set `STM_URL` to your Stellar Memory API address.

## Configuration

| Valve | Default | Description |
|-------|---------|-------------|
| `STM_URL` | `http://localhost:21547` | Base URL of the Stellar Memory REST API |
| `STM_PROJECT` | *(empty)* | Project namespace to read/write memories. Empty value uses `"default"` |
| `RECALL_LIMIT` | `5` | Maximum number of memories injected into the system prompt per request |
| `AUTO_REMEMBER` | `true` | When enabled, LLM responses longer than 100 characters are automatically saved as `observation` memories |

## Troubleshooting

**"STM not reachable" / no memories injected**

- Verify the API is running: `npx stellar-memory api`
- Check that `STM_URL` in the pipeline settings matches the address and port where the API is listening (default: `http://localhost:21547`).
- Confirm the API responds: `curl http://localhost:21547/api/health`
- If OpenWebUI runs inside Docker, `localhost` resolves to the container, not the host. Use `host.docker.internal` (Docker Desktop) or the host's LAN IP instead.
