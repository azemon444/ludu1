'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_PORT = 4321;
const MOCK_PORT = 4322;
const BASE = `http://localhost:${APP_PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ludo-payments-'));

const invoices = new Map();
let invoiceSeq = 0;

const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    const send = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if (req.url === '/v1/payment/create') {
      invoiceSeq += 1;
      const invoiceId = `INV${invoiceSeq}`;
      invoices.set(invoiceId, { amount: body.amount, status: 'PENDING' });
      return send(200, {
        status: true,
        message: 'Invoice created successfully.',
        payment_url: `https://secure.zinipay.com/payment/${invoiceId}`,
      });
    }

    if (req.url === '/v1/payment/verify') {
      const invoice = invoices.get(body.invoice_id);
      if (!invoice) return send(404, { message: 'Transaction not found' });
      return send(200, {
        amount: invoice.amount,
        invoice_id: body.invoice_id,
        payment_method: 'bkash',
        transaction_id: `TXN${body.invoice_id}`,
        status: invoice.status,
      });
    }

    return send(404, { message: 'Not found' });
  });
});

async function api(pathname, options) {
  const response = await fetch(`${BASE}${pathname}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return;
    } catch {
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Server did not start');
}

async function main() {
  await new Promise((resolve) => mock.listen(MOCK_PORT, resolve));

  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      DATA_DIR,
      PUBLIC_BASE_URL: BASE,
      ZINIPAY_BASE_URL: `http://localhost:${MOCK_PORT}`,
      ZINIPAY_API_KEY: 'test_key',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (data) => process.stderr.write(data));

  try {
    await waitForServer();

    {
      const { response, body } = await api('/health');
      assert.equal(response.status, 200);
      assert.equal(body.payments, true);
    }

    {
      const { response, body } = await api('/api/store');
      assert.equal(response.status, 200);
      assert.equal(body.configured, true);
      assert.equal(body.nonRedeemable, true);
      assert.equal(body.packs.length, 4);
    }

    {
      const page = await fetch(`${BASE}/payment.html?order=INV1`);
      assert.equal(page.status, 200);
      const html = await page.text();
      assert.match(html, /\/api\/payments\/status/);
      assert.match(html, /Back to game/);
    }

    {
      const { body } = await api('/api/wallet/payer1');
      assert.equal(body.coins, 0);
      assert.equal(body.supporter, false);
    }

    const checkout = await api('/api/payments/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'payer1', name: 'Payer', packId: 'coins_300' }),
    });
    assert.equal(checkout.response.status, 200);
    assert.ok(checkout.body.orderId);
    assert.match(checkout.body.paymentUrl, /\/payment\/INV1$/);
    const invoiceId = checkout.body.paymentUrl.split('/').pop();

    {
      const { body } = await api(`/api/payments/status?order=${checkout.body.orderId}`);
      assert.equal(body.status, 'pending');
    }

    invoices.get(invoiceId).status = 'COMPLETED';

    {
      const { body } = await api(`/api/payments/status?order=${checkout.body.orderId}`);
      assert.equal(body.status, 'paid');
      assert.equal(body.coins, 300);
    }

    {
      const { body } = await api('/api/wallet/payer1');
      assert.equal(body.coins, 300);
      assert.equal(body.supporter, true);
    }

    {
      const { body } = await api(`/api/payments/status?order=${checkout.body.orderId}`);
      assert.equal(body.status, 'paid');
      const wallet = await api('/api/wallet/payer1');
      assert.equal(wallet.body.coins, 300);
    }

    {
      const { response, body } = await api('/api/zinipay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: invoiceId, status: 'true' }),
      });
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      const wallet = await api('/api/wallet/payer1');
      assert.equal(wallet.body.coins, 300);
    }

    {
      const { response } = await api('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: 'payer1', name: 'Payer', packId: 'missing' }),
      });
      assert.equal(response.status, 400);
    }

    const failedCheckout = await api('/api/payments/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'payer1', name: 'Payer', packId: 'coins_100' }),
    });
    const failedInvoice = failedCheckout.body.paymentUrl.split('/').pop();
    invoices.get(failedInvoice).status = 'FAILED';

    {
      const { body } = await api(`/api/payments/status?order=${failedCheckout.body.orderId}`);
      assert.equal(body.status, 'failed');
      const wallet = await api('/api/wallet/payer1');
      assert.equal(wallet.body.coins, 300);
    }

    const mismatchCheckout = await api('/api/payments/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'payer2', name: 'Payer 2', packId: 'coins_700' }),
    });
    const mismatchInvoice = mismatchCheckout.body.paymentUrl.split('/').pop();
    invoices.get(mismatchInvoice).status = 'COMPLETED';
    invoices.get(mismatchInvoice).amount = 999;

    {
      const { body } = await api(`/api/payments/status?order=${mismatchCheckout.body.orderId}`);
      assert.equal(body.status, 'failed');
      const wallet = await api('/api/wallet/payer2');
      assert.equal(wallet.body.coins, 0);
    }

    console.log('payments ok: store, checkout, verification, idempotency, webhook, failures, amount checks');
  } finally {
    server.kill('SIGKILL');
    await new Promise((resolve) => mock.close(resolve));
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
