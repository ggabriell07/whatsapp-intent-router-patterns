# WhatsApp Intent Router Patterns

Arquitetura prática para roteamento de intenção em bots de WhatsApp com fluxos críticos, regras determinísticas, estado conversacional, fallback restrito, Supabase, n8n e LLM.

Este repositório documenta um padrão de construção aplicado em um bot financeiro comportamental, onde certas mensagens do usuário precisam cair no fluxo correto com alta previsibilidade.

O objetivo não é criar apenas um chatbot que responde bem. O objetivo é construir um sistema conversacional orientado a fluxo, onde cada intenção importante abre uma jornada específica.

---

## Visão geral

Em muitos bots com IA, a mensagem do usuário é enviada diretamente para um modelo de linguagem. Isso funciona para perguntas abertas, mas pode falhar quando o produto depende de fluxos estruturados.

**Exemplo:**

```text
Posso gastar 300 reais em roupas?
```

Essa mensagem não deve virar uma conversa genérica sobre finanças. Ela precisa abrir um fluxo específico de decisão de compra.

Outro exemplo:

```text
Gastei 45 reais no almoço
```

Essa mensagem não deve receber uma explicação. Ela precisa abrir ou executar um fluxo de registro de gasto.

O padrão deste repositório resolve esse problema com uma camada de roteamento antes da resposta final.

---

## Problema resolvido

O problema inicial era comum em bots com LLM:

```
Usuário envia uma intenção clara
→ Sistema chama IA para classificar ou responder
→ IA interpreta de forma genérica
→ Mensagem cai no fluxo geral
→ Fluxo correto não abre
→ Produto perde precisão
```

Isso gera uma experiência ruim porque o usuário pediu uma ação, mas recebeu uma conversa.

**Falha típica:**

```
Usuário:
Posso gastar 300 reais em roupas?

Resposta incorreta:
Você pode refletir sobre seus objetivos financeiros e pensar se essa compra faz sentido...
```

**Resposta correta:**

```
Sistema abre o fluxo de decisão de compra
→ Pergunta se é necessidade ou impulso
→ Analisa impacto
→ Aplica pausa comportamental
→ Registra decisão final
```

---

## Stack

```
n8n · WhatsApp · Evolution API · Supabase · PostgreSQL
JavaScript · JSONB · LLM orchestration · Portuguese NLP · Conversational state
```

---

## Conceito principal

> **Nem toda mensagem precisa de IA para ser entendida.**

Algumas intenções são tão importantes para o produto que devem ser detectadas por regras explícitas.

Exemplos de intenções canônicas:

```
Posso comprar um tênis de 300 reais?   → decisão de compra
Gastei 25 reais no café                → registro de gasto
Recebi 4500 reais de salário           → registro de receita
Painel / Score / Resumo / Ajuda        → comandos diretos
```

Essas mensagens não devem competir com um fluxo geral. Elas precisam ser roteadas diretamente.

---

## Arquitetura geral

```
Mensagem recebida
    ↓
Normalização do texto
    ↓
Verificação de estado conversacional
    ↓
Roteador determinístico
    ↓
Classificador assistido por IA (se necessário)
    ↓
Roteador de fluxo
    ↓
Fluxo específico  ──ou──  Fallback restrito
```

---

## Ordem de prioridade

A ordem de prioridade é um dos pontos mais importantes. Ela evita conflitos entre intenções similares.

| Prioridade | Intenção |
|:---:|---|
| 1 | Fluxo aberto no estado conversacional |
| 2 | Decisão de compra futura |
| 3 | Registro de gasto já ocorrido |
| 4 | Registro de receita |
| 5 | Consulta de gastos |
| 6 | Correção ou exclusão de gastos |
| 7 | Contas a pagar |
| 8 | Recorrências |
| 9 | Painel, score, resumo e perfil |
| 10 | Assinatura, premium e pagamento |
| 11 | Ajuda |
| 12 | Fallback geral restrito |

**Exemplo de conflito resolvido pela ordem:**

```
Gastei 300 reais em roupa, será que fiz besteira?
```

A mensagem contém reflexão, mas a ação principal é um gasto já ocorrido.

Rota correta:

```json
{
  "intent": "register_expense",
  "flow": "expense_registration",
  "reason": "mensagem indica gasto passado com valor e item"
}
```

```
Estou pensando em gastar 300 reais em roupa, será que vale?
```

A mensagem indica decisão futura.

Rota correta:

```json
{
  "intent": "purchase_check",
  "flow": "purchase_decision",
  "reason": "mensagem indica compra futura com dúvida, valor e item"
}
```

---

## Estado conversacional

Antes de classificar uma nova mensagem, o sistema verifica se existe um fluxo em andamento.

```json
{
  "current_flow": "purchase_decision",
  "flow_step": 2,
  "flow_data": {
    "amount": 300,
    "item": "roupas"
  }
}
```

Se o usuário responder `preciso` — essa mensagem sozinha não possui intenção clara. Mas dentro do fluxo de decisão de compra, ela é uma resposta válida para a pergunta anterior.

**Regra:**

```
Se existe fluxo aberto → continuar o fluxo antes de tentar classificar nova intenção.
```

---

## Roteador determinístico

O roteador determinístico é uma camada de regras que identifica intenções críticas sem depender do LLM.

Ele usa:

1. Normalização de texto
2. Detecção de palavras e expressões
3. Sinais de tempo verbal
4. Presença de valor monetário
5. Presença de item ou categoria
6. Sinais de dúvida
7. Sinais de impulso ou emoção
8. Sinais negativos para evitar falso positivo

### Normalização de texto

```js
function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[?!.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
```

**Entrada:** `Será que eu devo comprar uma jaqueta de R$ 300?`
**Normalizado:** `sera que eu devo comprar uma jaqueta de r$ 300`

### Extração de valor monetário

```js
function extractMoneyAmount(text) {
  const source = String(text || '').toLowerCase()

  const match = source.match(
    /(?:r\$?\s*)?(\d{1,3}(?:\.\d{3})*|\d+)(?:[,.](\d{1,2}))?\s*(?:reais|real|rs|brl)?/i
  )

  if (!match) return null

  const integer = String(match[1] || '').replace(/\./g, '')
  const decimal = match[2] ? '.' + match[2] : ''
  const value = Number(integer + decimal)

  if (!Number.isFinite(value) || value <= 0) return null

  return value
}
```

Formatos aceitos: `300 reais` · `R$ 300` · `300,50` · `1.200 reais`

### Extração simples de item

```js
function extractSimpleItem(text) {
  let source = normalizeText(text)

  source = source
    .replace(/\b(posso|devo|vale a pena|sera que|quero|queria|estou pensando em)\b/g, ' ')
    .replace(/\b(comprar|gastar|levar|pegar|pedir)\b/g, ' ')
    .replace(/(?:r\$?\s*)?\d+(?:[.,]\d{1,2})?\s*(?:reais|real|rs|brl)?/g, ' ')
    .replace(/\b(em|com|de|por|um|uma|uns|umas|no|na|nos|nas)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return source.slice(0, 80)
}
```

**Entrada:** `Posso gastar 300 reais em roupas?`
**Resultado:** `roupas`

---

## Intenção 1 — Decisão de compra futura

Exemplos diretos:

```
posso comprar / posso gastar / devo comprar / devo gastar
vale a pena comprar / será que compro / compro ou não
me ajuda a decidir se compro / analisa essa compra
```

Exemplos naturais:

```
Estou pensando em comprar uma jaqueta de 300 reais
Vi uma promoção e fiquei tentado
Quero comprar, mas não sei se faz sentido agora
Bateu vontade de comprar
Acho que mereço comprar esse item
```

**Sistema de pontuação:**

| Sinal | Pontos |
|---|:---:|
| Intenção futura | +5 |
| Verbo de compra ou gasto | +5 |
| Valor monetário | +4 |
| Item detectado | +3 |
| Dúvida | +3 |
| Emoção ou impulso | +2 |
| Compra já realizada | -10 |

```js
function detectPurchaseCheck(text, rawText) {
  const hasMoney = extractMoneyAmount(rawText) !== null
  const item = extractSimpleItem(rawText)

  let score = 0

  const futureDecisionSignal =
    /\b(posso|devo|deveria|vale a pena|sera que|acho que|talvez|nao sei se|estou pensando|quero|queria)\b/.test(text)

  const buyVerbSignal =
    /\b(comprar|gastar|levar|pegar|pedir|adquirir|promocao|oferta|desconto)\b/.test(text)

  const doubtSignal =
    /\b(duvida|vale|boa ideia|faz sentido|melhor esperar|adiar|compro ou nao|gasto ou nao)\b/.test(text)

  const emotionSignal =
    /\b(ansioso|ansiedade|estressado|cansado|triste|recompensa|mereco|impulso|tentado|vontade)\b/.test(text)

  const pastExpenseSignal =
    /\b(gastei|paguei|comprei|acabei comprando|foi|deu|saiu|custou)\b/.test(text)

  if (futureDecisionSignal) score += 5
  if (buyVerbSignal) score += 5
  if (hasMoney) score += 4
  if (item) score += 3
  if (doubtSignal) score += 3
  if (emotionSignal) score += 2
  if (pastExpenseSignal) score -= 10

  if (score >= 8) {
    return {
      matched: true,
      intent: 'purchase_check',
      flow: 'purchase_decision',
      confidence: 0.93,
      amount_hint: extractMoneyAmount(rawText),
      item_hint: item,
      score
    }
  }

  return { matched: false, score }
}
```

**Saída para** `Posso gastar 300 reais em roupas?`:

```json
{
  "matched": true,
  "intent": "purchase_check",
  "flow": "purchase_decision",
  "confidence": 0.99,
  "amount_hint": 300,
  "item_hint": "roupas",
  "router_version": "deterministic_v50"
}
```

---

## Intenção 2 — Registro de gasto

```
gastei 50 reais no café
paguei 120 no mercado
comprei roupa por 300
deu 45 no almoço
saiu 70 no uber
registra 35 no lanche
anota 60 em gasolina
```

**Regra principal:** Se a mensagem indica que o gasto já aconteceu → registro de gasto, não decisão de compra.

```js
function detectExpenseRegistration(text, rawText) {
  const hasMoney = extractMoneyAmount(rawText) !== null

  const pastExpenseSignal =
    /\b(gastei|paguei|comprei|acabei comprando|acabei gastando|fiz uma compra|foi|deu|saiu|custou|usei o cartao|passou no cartao|debitaram)\b/.test(text)

  if (pastExpenseSignal && hasMoney) {
    return {
      matched: true,
      intent: 'register_expense',
      flow: 'expense_registration',
      confidence: 0.99,
      amount_hint: extractMoneyAmount(rawText),
      item_hint: extractSimpleItem(rawText)
    }
  }

  return { matched: false }
}
```

---

## Intenção 3 — Registro de receita

```
recebi 4500 reais de salário
caiu meu pagamento
entrou pix de 300
ganhei 1200 de freelance
recebi reembolso / caiu bônus
```

```js
function detectIncomeRegistration(text, rawText) {
  const hasMoney = extractMoneyAmount(rawText) !== null

  const incomeSignal =
    /\b(recebi|ganhei|entrou|caiu|depositaram|salario|renda|freela|freelance|bonus|comissao|reembolso|pix recebido)\b/.test(text)

  if (incomeSignal && hasMoney) {
    return {
      matched: true,
      intent: 'register_income',
      flow: 'income_registration',
      confidence: 0.99,
      amount_hint: extractMoneyAmount(rawText)
    }
  }

  return { matched: false }
}
```

---

## Intenção 4 — Painel, score, resumo e perfil

Comandos curtos e diretos são tratados sem LLM.

```js
function detectDashboardCommands(text) {
  if (/^(painel|dashboard|abrir painel|meu painel|link do painel)$/.test(text)) {
    return { matched: true, intent: 'dashboard', flow: 'dashboard' }
  }

  if (/^(score|meu score|score comportamental|minha nota|pontuacao)$/.test(text)) {
    return { matched: true, intent: 'score', flow: 'score' }
  }

  if (/^(resumo|resumo diario|resumo diário|relatorio|relatório|fechamento do dia)$/.test(text)) {
    return { matched: true, intent: 'summary', flow: 'summary' }
  }

  if (/^(perfil|meu perfil|raio x|raio-x|perfil comportamental|meu comportamento)$/.test(text)) {
    return { matched: true, intent: 'behavior_profile', flow: 'behavior_profile' }
  }

  return { matched: false }
}
```

---

## Intenção 5 — Ajuda

Ajuda **não deve abrir por qualquer frase genérica**. Deve abrir apenas por comandos explícitos.

```
ajuda / menu / comandos / como funciona / como usar / o que posso pedir
```

```js
function detectHelp(text) {
  const exactTriggers = ['ajuda', '/ajuda', 'menu', '/menu', 'comandos', 'opcoes', 'opções']

  const questionTriggers = [
    'como funciona', 'como usar', 'o que posso pedir',
    'o que voce faz', 'o que você faz',
    'quais sao as opcoes', 'quais são as opções'
  ]

  if (exactTriggers.some(t => text === t) || questionTriggers.some(t => text === t)) {
    return { matched: true, intent: 'help', flow: 'help', mode: 'short' }
  }

  return { matched: false }
}
```

---

## Fallback geral restrito

Quando a mensagem não é classificada com segurança, o bot não improvisa. Ele orienta o usuário a reenviar em formato compatível.

**Exemplo de resposta ao usuário:**

```
Não consegui encaixar essa mensagem em um fluxo com segurança.

Para eu te ajudar melhor, envie em um destes formatos:

• "Posso comprar um tênis de 300 reais?"
• "Gastei 45 reais no almoço"
• "Recebi 4.500 reais de salário"
• "Resumo"
• "Score"
• "Painel"

Se essa mensagem deveria ter aberto um fluxo específico, registrei para ajuste.
```

**Dados internos:**

```json
{
  "flow": "general",
  "support_review_required": true,
  "fallback_reason": "unclassified_or_unsafe_general_route",
  "general_fallback_limited": true
}
```

### Por que restringir o fallback

Sem restrição, o LLM tenta ajudar demais. Isso cria três problemas:

1. O fluxo correto não é aberto.
2. A resposta fica menos previsível.
3. O produto vira um chatbot genérico.

**Regra aplicada:**

```
O LLM pode ajudar, mas não deve substituir fluxos estruturados.
```

---

## Variações de mensagem

Além do roteamento, foi criado um padrão de variações para evitar que o bot repita sempre a mesma frase.

**Modelo de dados:**

```
flow_key · block_key · scenario_key · variation_index · message_text · is_active
```

**Exemplo:**

```json
{
  "flow_key": "purchase_decision",
  "block_key": "block_1",
  "scenario_key": "default",
  "variation_index": 6,
  "message_text": "Vamos fazer uma pausa inteligente. Antes de pensar no valor, quero entender a origem dessa vontade."
}
```

**Estado por usuário:**

```
user_id · flow_key · block_key · scenario_key · last_variation_index
```

### Função de rodízio

```sql
select *
from get_next_bot_message_variation(
  user_id,
  'purchase_decision',
  'block_1',
  'default'
);
```

### Unwrap do retorno

Em alguns conectores n8n, o retorno vem dentro de um campo aninhado. É necessário fazer unwrap:

```js
function unwrapVariation(row) {
  const raw = row?.get_next_bot_message_variation ?? row?.variation ?? row

  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return {} }
  }

  return raw || {}
}
```

**Aplicação:**

```js
const row = $input.first().json || {}
const variation = unwrapVariation(row)
const original = $('Fluxo Posso Comprar').first().json || {}

const hasVariation = variation?.ok === true && Boolean(variation.message_text)

const finalMessage = hasVariation ? variation.message_text : original.reply

return [{
  json: {
    ...original,
    reply: finalMessage,
    variation_applied: hasVariation,
    variation_index: variation.variation_index || null
  }
}]
```

---

## Guardrails operacionais

Além do roteamento, proteções operacionais evitam erros em workflows automáticos.

**Problema comum em n8n:**

```
Node A cria phone e reply
Node B grava evento no banco → retorna apenas id
Node C tenta enviar WhatsApp usando phone e reply
→ phone e reply não existem mais → API retorna erro
```

**Solução:** o node de banco precisa retornar os campos necessários para o próximo node.

```sql
select
  inserted.id,
  input.user_id,
  input.phone,
  input.reply,
  'registered' as result_status
from input
join inserted on inserted.user_id = input.user_id
```

**Regras aplicadas:**

```
Se não existe phone válido → não chamar API de WhatsApp
Se não existe user_id válido → não inserir evento comportamental obrigatório
Se node de banco descarta campos necessários → preservar phone e reply para o próximo node
```

---

## Testes aplicados

| Entrada | Resultado esperado |
|---|---|
| `Posso gastar 300 reais em roupas?` | Fluxo `purchase_decision` |
| `Estou pensando em comprar uma jaqueta de 300 reais, mas não sei se faz sentido agora` | Fluxo `purchase_decision` |
| `Gastei 45 reais no almoço` | Fluxo `expense_registration` |
| `Recebi 4500 reais de salário` | Fluxo `income_registration` |
| `ajuda` | Fluxo `help` |
| `quero entender uma coisa aleatória sobre meu comportamento financeiro sem registrar nada` | Fallback restrito |

---

## Métricas recomendadas

```
Taxa de mensagens roteadas por regra determinística
Taxa de mensagens enviadas para LLM
Taxa de fallback geral
Taxa de erro por workflow
Taxa de conclusão por fluxo
Taxa de repetição de mensagem por usuário
```

---

## Estrutura sugerida do repositório

```
/docs
  architecture.md
  deterministic-router.md
  fallback-design.md
  conversation-state.md
  message-variations.md
  operational-guards.md

/examples
  purchase-check-examples.md
  expense-registration-examples.md
  income-registration-examples.md
  fallback-examples.md

/snippets
  normalize-text.js
  extract-money.js
  deterministic-router.js
  unwrap-variation.js
  restricted-fallback.js
```

---

## Possível evolução

1. Mover parte do roteador determinístico para antes da chamada de IA
2. Criar dashboard de mensagens não classificadas
3. Medir taxa de fallback por intenção
4. Usar testes automatizados para mensagens em português brasileiro
5. Criar matriz de regressão para evitar que ajustes quebrem rotas anteriores
6. Criar versionamento formal das regras de roteamento
7. Criar camada de confirmação para intenções ambíguas

---

## Princípios de design

1. Fluxos críticos não devem depender apenas de IA
2. Estado conversacional tem prioridade sobre a mensagem isolada
3. Regras determinísticas são melhores para intenções canônicas
4. LLM deve ser apoio, não controlador absoluto do fluxo
5. Fallback geral deve orientar, não improvisar
6. Ajuda precisa ser acionada por intenção explícita
7. Variações melhoram a experiência sem mudar a lógica
8. Logs operacionais devem alimentar melhorias no produto
9. Toda API externa deve receber payload validado
10. Workflows devem preservar campos necessários entre nodes

---

## O que não publicar

Este repositório documenta padrões técnicos, não dados sensíveis. Não incluir:

```
Tokens de API · URLs privadas · IDs reais de workflows
Telefones de usuários · Payloads reais com dados pessoais
Credenciais de banco · Headers de autenticação
Prints com dados sensíveis · Logs internos completos
```

---

## Resumo

Este padrão transforma um bot com LLM em um produto conversacional orientado a fluxo.

A IA continua útil, mas deixa de ser o único ponto de decisão. O roteador determinístico assume as intenções críticas. O estado conversacional mantém continuidade. O fallback restrito evita respostas genéricas. As variações melhoram a experiência. Os guardrails operacionais reduzem falhas em produção.

```
Mais precisão
Mais previsibilidade
Menos dependência de IA para casos óbvios
Melhor experiência no WhatsApp
Mais segurança operacional
```

---

## Licença

MIT
