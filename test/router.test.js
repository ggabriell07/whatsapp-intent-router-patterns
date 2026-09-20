const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeText,
  extractMoneyAmount,
  routeMessage,
} = require('../src/router');

test('normalizes informal Portuguese', () => {
  assert.equal(normalizeText('Será que eu compro?'), 'sera que eu compro');
});

test('extracts BRL values', () => {
  assert.equal(extractMoneyAmount('R$ 1.200,50'), 1200.5);
});

test('routes a future purchase decision', () => {
  assert.equal(
    routeMessage('Será que devo comprar um tênis de R$ 300?').flow,
    'purchase_decision'
  );
});

test('routes a completed expense', () => {
  assert.equal(
    routeMessage('Paguei R$ 45 no almoço').flow,
    'expense_registration'
  );
});

test('routes income', () => {
  assert.equal(
    routeMessage('Recebi R$ 4500 de salário').flow,
    'income_registration'
  );
});

test('conversation state has precedence', () => {
  assert.equal(
    routeMessage('preciso', { current_flow: 'purchase_decision' }).source,
    'conversation_state'
  );
});

test('unknown messages use restricted fallback', () => {
  assert.equal(
    routeMessage('me conte alguma coisa').flow,
    'restricted_fallback'
  );
});
