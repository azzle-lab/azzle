# TypeSafe MCP

TypeSafe documents an HTTP API and an agent skill, rather than a hosted MCP
endpoint. This project provides a local MCP bridge for the documented
`POST https://api.typesafe.ai/v1/systemone` endpoint.

Set the key in the environment before starting the MCP client:

```bash
export TYPESAFE_API_KEY="..."
```

The bridge exposes `typesafe_system_one`, which accepts TypeSafe `state`,
`model`, and `questions` fields and returns the typed Jev response.

Official references:

- https://docs.typesafe.ai/introduction.md
- https://docs.typesafe.ai/introduction/quickstart.md
- https://docs.typesafe.ai/agent-skill.md

For the official skill, use:

```bash
npx skills add typesafe-ai/skills --skill typesafe-ai
```
