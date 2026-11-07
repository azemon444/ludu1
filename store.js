'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PACKS = [
  { id: 'coins_100', coins: 100, amount: 50, label: 'Starter' },
  { id: 'coins_300', coins: 300, amount: 120, label: 'Popular', bonus: '+20%' },
  { id: 'coins_700', coins: 700, amount: 250, label: 'Value', bonus: '+40%' },
  { id: 'coins_1500', coins: 1500, amount: 500, label: 'Mega', bonus: '+50%' },
];
const PACK_BY_ID = new Map(PACKS.map((pack) => [pack.id, pack]));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');

const data = {
  wallets: {},
  orders: {},
  transactions: [],
};

load();

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    data.wallets = parsed.wallets || {};
    data.orders = parsed.orders || {};
    data.transactions = Array.isArray(parsed.transactions) ? parsed.transactions : [];
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Could not load payment store: ${error.message}`);
    }
  }
}

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${DB_FILE}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, DB_FILE);
}

function cleanId(value) {
  return String(value || '').trim().slice(0, 64);
}

function getPack(packId) {
  return PACK_BY_ID.get(String(packId || '')) || null;
}

function publicPacks() {
  return PACKS.map((pack) => ({
    id: pack.id,
    coins: pack.coins,
    amount: pack.amount,
    label: pack.label,
    bonus: pack.bonus || null,
  }));
}

function getWallet(playerId) {
  const id = cleanId(playerId);
  const wallet = data.wallets[id];
  return {
    playerId: id,
    coins: wallet ? Number(wallet.coins) || 0 : 0,
    supporter: !!(wallet && wallet.supporter),
  };
}

function createOrder({ playerId, name, packId }) {
  const id = cleanId(playerId);
  const pack = getPack(packId);
  if (!id || !pack) return null;

  const now = new Date().toISOString();
  const order = {
    orderId: crypto.randomUUID(),
    playerId: id,
    name: String(name || 'Player').slice(0, 16),
    packId: pack.id,
    coins: pack.coins,
    amount: pack.amount,
    status: 'pending',
    paymentUrl: null,
    transactionId: null,
    method: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    paidAt: null,
  };
  data.orders[order.orderId] = order;
  persist();
  return order;
}

function attachPaymentUrl(orderId, paymentUrl) {
  const order = data.orders[orderId];
  if (!order) return null;
  order.paymentUrl = paymentUrl || null;
  order.updatedAt = new Date().toISOString();
  persist();
  return order;
}

function markPaid(orderId, { transactionId, method } = {}) {
  const order = data.orders[orderId];
  if (!order) return { ok: false, reason: 'not_found' };
  if (order.status === 'paid') return { ok: true, already: true, order };

  const wallet = data.wallets[order.playerId] || {
    coins: 0,
    supporter: false,
    createdAt: new Date().toISOString(),
  };

  order.status = 'paid';
  order.transactionId = transactionId || null;
  order.method = method || null;
  order.paidAt = new Date().toISOString();
  order.updatedAt = order.paidAt;
  order.error = null;

  wallet.coins = (Number(wallet.coins) || 0) + order.coins;
  wallet.supporter = true;
  wallet.updatedAt = order.paidAt;
  data.wallets[order.playerId] = wallet;

  data.transactions.push({
    orderId: order.orderId,
    playerId: order.playerId,
    packId: order.packId,
    coins: order.coins,
    amount: order.amount,
    transactionId: order.transactionId,
    method: order.method,
    createdAt: order.paidAt,
  });

  persist();
  return { ok: true, order, wallet: getWallet(order.playerId) };
}

function markFailed(orderId, reason) {
  const order = data.orders[orderId];
  if (!order || order.status === 'paid') return order || null;
  order.status = 'failed';
  order.error = String(reason || 'Payment failed').slice(0, 200);
  order.updatedAt = new Date().toISOString();
  persist();
  return order;
}

function getOrder(orderId) {
  return data.orders[String(orderId || '')] || null;
}

module.exports = {
  publicPacks,
  getPack,
  getWallet,
  createOrder,
  attachPaymentUrl,
  markPaid,
  markFailed,
  getOrder,
};
