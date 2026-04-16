---
title: "SIA Proto"
slug: "sia-proto"
summary: "Local-first system monitoring agent with event analysis, CLI, and optional Ollama integration."
category: "other"
tags: ["system-monitoring", "rust", "cli", "sqlite", "agent"]
stack: ["Rust", "Tokio", "SQLite", "sqlx", "clap", "systemd", "Ollama"]
repoUrl: "https://github.com/Leptons1618/sia-proto"
status: "wip"
year: 2024
highlights:
  - "Runs as a background Linux agent with CPU/memory monitoring and event generation."
  - "Exposes a Unix-socket JSON-RPC interface with a dedicated CLI for status and event inspection."
  - "Stores telemetry/events in SQLite and optionally enriches insights via local Ollama models."
---

Project metadata entry.
