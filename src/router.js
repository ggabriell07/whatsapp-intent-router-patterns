function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[?!,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMoneyAmount(value) {
  const source = String(value || '').toLowerCase();
  const match = source.match(
    /(?:r\$?\s*)?(\d{1,3}(?:\.\d{3})*|\d+)(?:[,.](\d{1,2}))?\s*(?:reais|real|rs|brl)?/i
  );

  if (!match) return null;

  const integer = String(match[1] || '').replace(/\./g, '');
  const decimal = match[2] ? '.' + match[2] : '';
  const amount = Number(integer + decimal);

  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function detectPurchaseDecision(text, rawText) {
  const future = /\b(posso|devo|deveria|vale a pena|sera que|talvez|nao sei se|estou pensando|quero|queria)\b/.test(text);
  const purchase = /\b(comprar|gastar|levar|pegar|pedir|adquirir|promocao|oferta|desconto)\b/.test(text);
  const past = /\b(gastei|paguei|comprei|acabei comprando|acabei gastando|custou)\b/.test(text);
  const amount = extractMoneyAmount(rawText);

  let score = 0;
  if (future) score += 5;
  if (purchase) score += 5;
  if (amount !== null) score += 4;
  if (past) score -= 10;

  return score >= 8
    ? {
        matched: true,
        intent: 'purchase_check',
        flow: 'purchase_decision',
        score,
        amount_hint: amount,
      }
    : { matched: false, score };
}

function detectExpense(text, rawText) {
  const past = /\b(gastei|paguei|comprei|acabei comprando|acabei gastando|fiz uma compra|custou|usei o cartao|passou no cartao|debitaram)\b/.test(text);
  const amount = extractMoneyAmount(rawText);

  return past && amount !== null
    ? {
        matched: true,
        intent: 'register_expense',
        flow: 'expense_registration',
        amount_hint: amount,
      }
    : { matched: false };
}

function detectIncome(text, rawText) {
  const income = /\b(recebi|ganhei|entrou|caiu|depositaram|salario|renda|freela|freelance|bonus|comissao|reembolso|pix recebido)\b/.test(text);
  const amount = extractMoneyAmount(rawText);

  return income && amount !== null
    ? {
        matched: true,
        intent: 'register_income',
        flow: 'income_registration',
        amount_hint: amount,
      }
    : { matched: false };
}

function detectCommand(text) {
  const commands = new Map([
    ['painel', ['dashboard', 'dashboard']],
    ['dashboard', ['dashboard', 'dashboard']],
    ['score', ['score', 'score']],
    ['resumo', ['summary', 'summary']],
    ['relatorio', ['summary', 'summary']],
    ['perfil', ['behavior_profile', 'behavior_profile']],
    ['ajuda', ['help', 'help']],
    ['menu', ['help', 'help']],
  ]);

  const hit = commands.get(text);
  return hit
    ? { matched: true, intent: hit[0], flow: hit[1] }
    : { matched: false };
}

function routeMessage(rawText, state = {}) {
  if (state.current_flow) {
    return {
      intent: 'continue_flow',
      flow: state.current_flow,
      source: 'conversation_state',
    };
  }

  const text = normalizeText(rawText);

  for (const detector of [detectPurchaseDecision, detectExpense, detectIncome]) {
    const result = detector(text, rawText);
    if (result.matched) return { ...result, source: 'deterministic' };
  }

  const command = detectCommand(text);
  if (command.matched) return { ...command, source: 'deterministic' };

  return {
    intent: 'unknown',
    flow: 'restricted_fallback',
    source: 'fallback',
    requires_llm_review: true,
  };
}

module.exports = {
  normalizeText,
  extractMoneyAmount,
  routeMessage,
};
