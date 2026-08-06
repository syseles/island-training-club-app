# Agent Execution Policy

This project treats the provider, model, and reasoning level selected in the parent Pi session as the source of truth. The policy does not hard-code a particular model: whichever model the user selects for the parent must also be used by any child agents unless the user explicitly approves an exception.

## Why this policy exists

A parent Pi session can remain on one model while launching nested Pi processes with commands such as:

```sh
pi -p --model another-provider/another-model --thinking high ...
```

Those child processes can appear to be a model “flip,” even though the parent never changed. Some agent workflows intentionally select different models for implementation, review, retries, or cost optimization. This repository does not permit that automatic model routing.

## Execution modes

### Inline execution

The parent agent performs the work directly in the current session.

- Tasks normally run in order.
- No child Pi process is created.
- The current parent model and reasoning level are used automatically.
- This mode is simplest when model consistency and shared context matter most.

### Subagent execution

The parent coordinates focused child agents for implementation or review.

- A fresh child can receive a smaller, isolated context.
- Normal subagent-driven implementation is sequential unless independent parallel work is explicitly appropriate.
- Independent reviewers can catch mistakes the implementer missed.
- Child processes add orchestration, API calls, context setup, and possible cost.

Subagents may be used, but they must inherit the parent’s exact selection.

## Required inheritance

Before dispatching a child, inspect the current session values:

```sh
printf 'provider=%s\nmodel=%s\nreasoning=%s\n' \
  "$PI_PROVIDER" "$PI_MODEL" "$PI_REASONING_LEVEL"
```

Pass those values explicitly to the child:

```sh
pi -p \
  --model "$PI_PROVIDER/$PI_MODEL" \
  --thinking "$PI_REASONING_LEVEL" \
  ...
```

This applies to every child role, including:

- implementers;
- task and final reviewers;
- debugging agents;
- retry and recovery agents;
- fix-loop agents;
- parallel agents.

Task complexity, cost, speed, or a workflow’s preferred model tiers do not override this policy. If a different model would materially help, the parent must explain why and obtain explicit user approval before launching it.

If `PI_PROVIDER`, `PI_MODEL`, or `PI_REASONING_LEVEL` is unavailable, do not guess. Execute inline or ask the user.

## Prompts to use

### Parent-only execution

> Execute this entirely in the current parent session. Do not launch subagents or nested Pi processes. Keep the provider, model, and reasoning level currently selected in the parent.

### Subagents with parent selection

> You may use subagents, but every child must use the parent session’s exact provider, model, and reasoning level. Pass `PI_PROVIDER`, `PI_MODEL`, and `PI_REASONING_LEVEL` explicitly. Do not select another model for complexity, reviews, retries, speed, or cost without my approval.

## Benefits and trade-offs of subagents

Benefits:

- focused context for each task;
- independent implementation reviews;
- less pressure on the parent’s context window;
- task-specific reports, commits, and recovery points;
- possible parallel execution for genuinely independent work.

Trade-offs:

- more processes and API calls;
- repeated context and test setup;
- greater orchestration complexity;
- conflicting edits if parallel work is poorly isolated;
- apparent model changes if inheritance is not enforced.

Use inline execution for simplicity. Use subagents when isolation or independent review provides enough value to justify the extra coordination, while preserving the parent’s selected model and reasoning level.
