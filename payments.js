'use strict';

const crypto = require('node:crypto');

const CHECKOUT_URL = (process.env.PAYMENT_CHECKOUT_URL || '').trim();
const SETTLE_SECRET = process.env.PAYMENT_SETTLE_SECRET || '';

function configured() {
  return Boolean(CHECKOUT_URL && SETTLE_SECRET);
}

function settleConfigured() {
  return Boolean(SETTLE_SECRET);
}

function buildCheckoutUrl(order, base) {
  const url = new URL(CHECKOUT_URL);
  const redirect = `${base}/payment.html?order=${encodeURIComponent(order.orderId)}`;
  url.searchParams.set('order', order.orderId);
  url.searchParams.set('amount', String(order.amount));
  url.searchParams.set('currency', 'BDT');
  url.searchParams.set('coins', String(order.coins));
  url.searchParams.set('name', order.name);
  url.searchParams.set('redirect', redirect);
  url.searchParams.set('cancel', `${redirect}&cancelled=1`);
  url.searchParams.set('callback', `${base}/api/payments/settle`);
  return url.toString();
}

function authorizeSettle(req) {
  if (!SETTLE_SECRET) return false;
  const provided = Buffer.from(String(req.get('x-payment-secret') || ''));
  const expected = Buffer.from(SETTLE_SECRET);
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

module.exports = {
  configured,
  settleConfigured,
  buildCheckoutUrl,
  authorizeSettle,
};
