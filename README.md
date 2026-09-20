# Deterministic-First Intent Router for Conversational AI

Executable reference implementation for **state-aware intent routing** in conversational AI systems.

The project demonstrates a production pattern used when important user actions must not depend entirely on probabilistic LLM classification.

Instead of sending every message directly to a model, the system applies:

1. conversation-state precedence
2. deterministic routing for canonical intents
3. restricted fallback for unresolved cases
4. optional LLM escalation only when ambiguity remains

## Why this pattern exists

A general-purpose chatbot can answer a message correctly while still failing the product.

For example:

```text
Can I spend R$300 on clothes?
```

In a decision product, this message should not receive generic financial advice. It should open a structured purchase-decision flow.

Similarly:

```text
I spent R$45 on lunch
```

should become a financial event, not a conversational answer.

The router therefore separates **language interpretation** from **product control flow**.

## Architecture

```text
Incoming message
      ↓
Conversation state
      ↓
Text normalization
      ↓
Deterministic router
  ├── purchase decision
  ├── expense registration
  ├── income registration
  └── direct commands
      ↓
Restricted fallback
      ↓
Optional LLM review
```

## Repository structure

```text
src/
  router.js

test/
  router.test.js

datasets/
  intent-cases.jsonl

.github/workflows/
  test.yml
```

## Run locally

Requires Node.js 20+.

```bash
npm test
```

The test suite covers:

- PT-BR text normalization
- BRL monetary extraction
- future purchase decisions
- completed expenses
- income registration
- conversation-state precedence
- restricted fallback

## Example

```javascript
const { routeMessage } = require('./src/router');

routeMessage('Será que devo comprar um tênis de R$ 300?');
```

Result:

```json
{
  "matched": true,
  "intent": "purchase_check",
  "flow": "purchase_decision",
  "score": 14,
  "amount_hint": 300,
  "source": "deterministic"
}
```

## Design principles

### State before classification

A message such as:

```text
preciso
```

has little meaning in isolation.

Inside an active purchase-decision flow, however, it may be a valid answer to the previous question.

Conversation state therefore has priority over isolated intent classification.

### Deterministic before probabilistic

Canonical product actions are better handled by explicit rules when they can be described reliably.

This provides:

- predictable routing
- lower inference cost
- lower latency
- easier regression testing
- clearer failure modes

### Restricted fallback

An unresolved message does not automatically become a generic chatbot response.

The router returns:

```json
{
  "intent": "unknown",
  "flow": "restricted_fallback",
  "requires_llm_review": true
}
```

A downstream system can then decide whether to ask for clarification, escalate to an LLM classifier or record the case for evaluation.

## Public dataset

`datasets/intent-cases.jsonl` contains synthetic PT-BR examples used as regression cases.

The dataset contains no production user data.

It is intentionally small today and will evolve into a larger evaluation dataset for comparing:

```text
rules-only
vs
LLM-only
vs
hybrid routing
```

## CI

GitHub Actions runs the Node test suite on changes to the router, tests or package configuration.

## Production context

This pattern originated from work on [Flectos](https://github.com/ggabriell07/flectos), a Behavioral Decision Intelligence product with structured conversational flows.

This repository is a **sanitized reference implementation**, not a direct export of the private production workflow.

## Engineering trade-offs

Deterministic routing should not be used for every language problem.

It works well for:

- high-value canonical intents
- commands
- state transitions
- product-critical actions

LLM-assisted interpretation remains useful for:

- ambiguous language
- long-form intent
- behavioral interpretation
- non-canonical phrasing

The engineering goal is not to remove LLMs. It is to use them where probabilistic interpretation creates actual value.

## Next steps

- expand the PT-BR evaluation dataset
- add precision, recall and F1 reporting
- benchmark deterministic vs LLM vs hybrid routing
- add structured ambiguity handling
- version routing rules
- add model-assisted fallback experiments
