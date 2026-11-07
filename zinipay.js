'use strict';

const API_KEY = process.env.ZINIPAY_API_KEY || '';
const BASE_URL = (process.env.ZINIPAY_BASE_URL || 'https://api.zinipay.com').replace(/\/+$/, '');

function configured() {
  return Boolean(API_KEY);
}

async function request(path, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'zini-api-key': API_KEY,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { message: text };
    }
    if (!response.ok) {
      throw new Error(body.message || `ZiniPay request failed (${response.status})`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function extractInvoiceId(body) {
  if (body.invoice_id) return String(body.invoice_id);
  if (body.invoiceId) return String(body.invoiceId);
  if (body.val_id) return String(body.val_id);
  const paymentUrl = body.payment_url || body.paymentUrl;
  if (paymentUrl) {
    try {
      const parts = new URL(paymentUrl).pathname.split('/').filter(Boolean);
      return parts[parts.length - 1] || null;
    } catch {
      return null;
    }
  }
  return null;
}

async function createInvoice({ amount, name, metadata, redirectUrl, cancelUrl, webhookUrl }) {
  const body = await request('/v1/payment/create', {
    cus_name: name,
    amount,
    metadata,
    redirect_url: redirectUrl,
    cancel_url: cancelUrl,
    webhook_url: webhookUrl,
  });
  if (!body.status || !body.payment_url) {
    throw new Error(body.message || 'ZiniPay did not return a payment URL');
  }
  const invoiceId = extractInvoiceId(body);
  if (!invoiceId) {
    throw new Error('ZiniPay did not return an invoice ID');
  }
  return {
    paymentUrl: body.payment_url,
    invoiceId,
  };
}

async function verifyInvoice(invoiceId) {
  const body = await request('/v1/payment/verify', { invoice_id: invoiceId });
  return {
    status: String(body.status || '').toUpperCase(),
    amount: Number(body.amount),
    transactionId: body.transaction_id || body.transactionId || body.trxID || body.trxId || null,
    method: body.payment_method || body.provider || null,
    message: body.message || '',
  };
}

module.exports = {
  configured,
  createInvoice,
  verifyInvoice,
};
