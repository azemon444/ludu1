'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 4321;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ludo-payments-'));
const PAYMENT_ENV = {
  PAYMENT_CHECKOUT_URL: 'https://pay.example.test/checkout',
  PAYMENT_SETTLE_SECRET: 'settle_secret',
};

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

async function startApp(extraEnv) {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR,
      PUBLIC_BASE_URL: BASE,
      PAYMENT_CHECKOUT_URL: '',
      PAYMENT_SETTLE_SECRET: '',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (data) => process.stderr.write(data));
  await waitForServer();
  return server;
}

function stopApp(server) {
  return new Promise((resolve) => {
    if (server.exitCode !== null) return resolve();
    server.once('exit', resolve);
    server.kill('SIGKILL');
  });
}

async function main() {
  let server = await startApp({ PAYMENT_CHECKOUT_URL: PAYMENT_ENV.PAYMENT_CHECKOUT_URL });

  try {
    {
      const { response, body } = await api('/health');
      assert.equal(response.status, 200);
      assert.equal(body.payments, false);
    }

    {
      const { response, body } = await api('/api/store');
      assert.equal(response.status, 200);
      assert.equal(body.configured, false);
      assert.equal(body.nonRedeemable, true);
      assert.equal(body.packs.length, 4);
    }

    {
      const { response } = await api('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: 'payer1', name: 'Payer', packId: 'coins_300' }),
      });
      assert.equal(response.status, 503);
    }

    {
      const page = await fetch(`${BASE}/payment.html?order=missing`);
      assert.equal(page.status, 200);
      const html = await page.text();
      assert.match(html, /\/api\/payments\/status/);
      assert.match(html, /Order not found/);
    }
  } finally {
    await stopApp(server);
  }

  server = await startApp(PAYMENT_ENV);

  try {
    {
      const { body } = await api('/health');
      assert.equal(body.payments, true);
    }

    {
      const { body } = await api('/api/store');
      assert.equal(body.configured, true);
    }

    {
      const { response } = await api('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: 'payer1', name: 'Payer', packId: 'missing' }),
      });
      assert.equal(response.status, 400);
    }

    const checkout = await api('/api/payments/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'payer1', name: 'Payer', packId: 'coins_300' }),
    });
    assert.equal(checkout.response.status, 200);
    assert.ok(checkout.body.orderId);

    const paymentUrl = new URL(checkout.body.paymentUrl);
    assert.equal(`${paymentUrl.origin}${paymentUrl.pathname}`, 'https://pay.example.test/checkout');
    assert.equal(paymentUrl.searchParams.get('order'), checkout.body.orderId);
    assert.equal(paymentUrl.searchParams.get('amount'), '120');
    assert.equal(paymentUrl.searchParams.get('currency'), 'BDT');
    assert.equal(paymentUrl.searchParams.get('coins'), '300');
    assert.equal(paymentUrl.searchParams.get('name'), 'Payer');
    assert.match(paymentUrl.searchParams.get('redirect'), /\/payment\.html\?order=/);
    assert.match(paymentUrl.searchParams.get('callback'), /\/api\/payments\/settle$/);

    {
      const { body } = await api(`/api/payments/status?order=${checkout.body.orderId}`);
      assert.equal(body.status, 'pending');
      assert.equal(body.coins, 300);
    }

    const settleBody = JSON.stringify({ orderId: checkout.body.orderId, amount: 120, transactionId: 'TXN1', method: 'test' });

    {
      const { response } = await api('/api/payments/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: settleBody,
      });
      assert.equal(response.status, 401);
    }

    {
      const { response } = await api('/api/payments/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-payment-secret': 'wrong' },
        body: settleBody,
      });
      assert.equal(response.status, 401);
    }

    {
      const { response } = await api('/api/payments/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-payment-secret': PAYMENT_ENV.PAYMENT_SETTLE_SECRET },
        body: JSON.stringify({ orderId: checkout.body.orderId, amount: 999 }),
      });
      assert.equal(response.status, 400);
      const wallet = await api('/api/wallet/payer1');
      assert.equal(wallet.body.coins, 0);
    }

    {
      const { response, body } = await api('/api/payments/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-payment-secret': PAYMENT_ENV.PAYMENT_SETTLE_SECRET },
        body: settleBody,
      });
      assert.equal(response.status, 200);
      assert.equal(body.status, 'paid');
    }

    {
      const { body } = await api('/api/wallet/payer1');
      assert.equal(body.coins, 300);
      assert.equal(body.supporter, true);
    }

    {
      const { body } = await api(`/api/payments/status?order=${checkout.body.orderId}`);
      assert.equal(body.status, 'paid');
    }

    {
      const { response, body } = await api('/api/payments/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-payment-secret': PAYMENT_ENV.PAYMENT_SETTLE_SECRET },
        body: settleBody,
      });
      assert.equal(response.status, 200);
      assert.equal(body.status, 'paid');
      const wallet = await api('/api/wallet/payer1');
      assert.equal(wallet.body.coins, 300);
    }

    {
      const { response } = await api('/api/payments/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-payment-secret': PAYMENT_ENV.PAYMENT_SETTLE_SECRET },
        body: JSON.stringify({ orderId: 'missing', amount: 120 }),
      });
      assert.equal(response.status, 404);
    }
  } finally {
    await stopApp(server);
  }

  server = await startApp(PAYMENT_ENV);

  try {
    const { body } = await api('/api/wallet/payer1');
    assert.equal(body.coins, 300);
    assert.equal(body.supporter, true);
    const status = await api('/api/payments/status?order=missing');
    assert.equal(status.response.status, 404);
    console.log('payments ok: provider shell, wallet, checkout URL, settle auth, idempotency, persistence');
  } finally {
    await stopApp(server);
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  process.exit(1);
});
