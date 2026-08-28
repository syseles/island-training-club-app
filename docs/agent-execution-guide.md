# Agent Execution Guide

This guide explains how inline and subagent execution work in Pi, why a session may show activity from different models, and when subagents are useful. It is informational only and does not restrict model selection.

## Parent and child agents

The interactive Pi session is the parent agent. Its current provider, model, and reasoning level are visible to shell tools through:

```sh
printf 'provider=%s\nmodel=%s\nreasoning=%s\n' \
  "$PI_PROVIDER" "$PI_MODEL" "$PI_REASONING_LEVEL"
```

A parent can also launch a separate non-interactive Pi process:

```sh
pi -p --model provider/model --thinking level ...
```

That process is a child agent, or subagent. A child can use a different model and reasoning level without changing the parent. Activity from the child may therefore look like the parent “flipped” models when the parent itself never changed.

## Inline execution

With inline execution, the parent performs the work directly.

- Tasks usually run in order.
- No child Pi process is created.
- Work uses the parent’s current model and reasoning level.
- The full conversation remains available throughout implementation.

Inline execution is simplest for small tasks and situations where continuity matters more than context isolation or independent review.

## Subagent execution

With subagent execution, the parent coordinates focused child agents for implementation, testing, debugging, or review.

- Each child receives a smaller, task-specific context.
- Normal subagent-driven implementation is sequential to avoid conflicting edits.
- Genuinely independent tasks can be run in parallel by a parallel-agent workflow.
- Separate reviewers can inspect work without sharing the implementer’s assumptions.

Subagent execution does not automatically mean tasks run at the same time. Parallelism depends on the workflow and whether the tasks are independent.

## How subagent models are selected

The project’s subagent-driven workflow can choose models according to the role and complexity of each task:

- mechanical, tightly specified work may use a faster model;
- integration or debugging may use a standard model;
- architecture and final review may use a more capable model;
- difficult fix-loop retries may escalate to a stronger model.

The workflow explicitly supplies each child’s model and reasoning level. This is why logs can contain GPT-5.4, GPT-5.5, or another model while the parent remains on GPT-5.6 Sol. This is expected behavior, not necessarily an automatic provider fallback.

Reasoning levels can also differ between children. A controller may select higher reasoning for reviews or complex fixes and lower reasoning for mechanical work.

## Benefits of subagents

- **Focused context:** each child sees only the material needed for its task.
- **Independent review:** a reviewer can catch issues the implementer missed.
- **Context management:** large workflows do not place every implementation detail in the parent conversation.
- **Recovery:** separate reports, commits, and progress records make individual tasks easier to retry.
- **Specialization:** implementation and review can use prompts and models suited to their roles.
- **Parallelism:** truly independent work can sometimes finish sooner when run concurrently.
- **Potential efficiency:** smaller models can handle mechanical tasks while stronger models are reserved for judgment-heavy work.

## Trade-offs

- More processes and API calls may increase total cost.
- Every child needs context and test setup.
- Orchestration is more complex than inline execution.
- Parallel children can create conflicting edits unless their work is isolated.
- Different child models and reasoning levels can be surprising when reading provider logs.
- A child may misinterpret an instruction independently of the parent.

## Choosing a mode

Use inline execution when:

- the task is small or tightly connected;
- maintaining one continuous context is important;
- you want the simplest execution path;
- an independent review is unnecessary.

Use subagents when:

- a plan has several well-defined tasks;
- isolated context will improve focus;
- independent implementation review is valuable;
- the work benefits from specialized models or prompts;
- independent tasks can safely run in parallel.

When Pi offers “Subagent-Driven” and “Inline Execution,” the first option delegates implementation and review to children; the second keeps the work in the current parent session.

## Requesting a specific behavior

To keep all work in the parent:

> Execute this entirely inline in the current parent session. Do not launch subagents or nested Pi processes.

To allow the normal subagent workflow:

> Use subagent-driven execution and select suitable child models according to the workflow and task complexity.

To investigate unexpected model activity, compare the parent session’s `model_change` and `thinking_level_change` events with nested `pi -p --model ... --thinking ...` commands. Parent metadata and child-process activity are separate evidence.
