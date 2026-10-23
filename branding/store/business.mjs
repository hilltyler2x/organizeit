// Phone screenshots of receipts, order confirmations, invoices and payment screens (all made up).
const page = (bg, body) => `<html><head><style>
*{box-sizing:border-box}body{margin:0;width:390px;height:844px;background:${bg};font-family:Inter,sans-serif;color:#111;display:flex;flex-direction:column;justify-content:center;padding:24px}
.card{background:#fff;border-radius:18px;padding:22px;box-shadow:0 2px 10px rgb(0 0 0/.06)}.muted{color:#6b7280}.row{display:flex;justify-content:space-between;margin:7px 0;font-size:15px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:15px;margin:0;font-weight:600}.big{font-size:42px;font-weight:700;letter-spacing:-.02em}hr{border:0;border-top:1px dashed #d1d5db;margin:14px 0}
.status{position:absolute;top:14px;left:28px;right:28px;display:flex;justify-content:space-between;font-weight:600;font-size:15px}
</style></head><body><div class="status"><span>9:41</span><span>●●● ▮</span></div>${body}</body></html>`;

const money = (n) => `$${n.toFixed(2)}`;

export function receipt({ store, items, date, tint = "#f3f4f6" }) {
  const sub = items.reduce((n, [, p]) => n + p, 0);
  const tax = sub * 0.0825;
  return page(tint, `<div class="card" style="font-family:'DejaVu Sans Mono',monospace">
<div style="text-align:center"><h1 style="font-family:Inter">${store}</h1><div class="muted" style="font-size:13px">${date} · Store #0412</div></div><hr>
${items.map(([n, p]) => `<div class="row"><span>${n}</span><span>${money(p)}</span></div>`).join("")}<hr>
<div class="row"><span>Subtotal</span><span>${money(sub)}</span></div><div class="row"><span>Tax</span><span>${money(tax)}</span></div>
<div class="row" style="font-weight:700;font-size:19px"><span>TOTAL</span><span>${money(sub + tax)}</span></div><hr>
<div class="muted" style="text-align:center;font-size:13px">VISA •••• 4821 · APPROVED<br>Thank you for shopping!</div></div>`);
}

export function order({ store, item, price, color, date }) {
  return page("#fff", `<div style="text-align:center">
<div style="width:64px;height:64px;border-radius:50%;background:${color};margin:0 auto 14px;display:grid;place-items:center;color:#fff;font-size:34px">✓</div>
<h1>Order confirmed</h1><div class="muted">Thanks! Your order from <b style="color:#111">${store}</b> is on its way.</div></div>
<div class="card" style="margin-top:20px;border:1px solid #e5e7eb;box-shadow:none">
<div class="row"><span class="muted">Order</span><span>#${Math.floor(price * 7919) % 900000 + 100000}</span></div>
<div class="row"><span class="muted">Placed</span><span>${date}</span></div><hr style="border-top-style:solid">
<div class="row"><span>${item}</span><span>${money(price)}</span></div><div class="row"><span class="muted">Shipping</span><span>${money(5.99)}</span></div>
<div class="row" style="font-weight:700;font-size:18px"><span>Total</span><span>${money(price + 5.99)}</span></div></div>
<div style="margin-top:18px;background:${color};color:#fff;text-align:center;border-radius:12px;padding:14px;font-weight:600">Track package</div>`);
}

export function invoice({ from, to, lines, number, date, color }) {
  const total = lines.reduce((n, [, q, p]) => n + q * p, 0);
  return page("#e5e7eb", `<div class="card" style="border-radius:6px;padding:26px">
<div style="display:flex;justify-content:space-between;align-items:start"><div><div style="font-size:30px;font-weight:800;color:${color}">INVOICE</div><div class="muted" style="font-size:13px">#${number} · ${date}</div></div>
<div style="width:40px;height:40px;border-radius:10px;background:${color}"></div></div>
<div style="display:flex;gap:20px;margin:18px 0;font-size:13px"><div><div class="muted">From</div><b>${from}</b></div><div><div class="muted">Bill to</div><b>${to}</b></div></div>
<div class="row muted" style="font-size:12px;border-bottom:1px solid #e5e7eb;padding-bottom:6px"><span>ITEM</span><span>QTY · AMOUNT</span></div>
${lines.map(([n, q, p]) => `<div class="row" style="font-size:14px"><span>${n}</span><span>${q} · ${money(q * p)}</span></div>`).join("")}
<div style="background:${color};color:#fff;border-radius:6px;padding:12px 14px;margin-top:14px;display:flex;justify-content:space-between;font-weight:700"><span>Amount due</span><span>${money(total)}</span></div></div>`);
}

export function payment({ to, amount, color, date, note }) {
  return page(color, `<div style="color:#fff;text-align:center">
<div style="width:84px;height:84px;border-radius:50%;background:rgb(255 255 255/.2);margin:0 auto 20px;display:grid;place-items:center;font-size:44px">✓</div>
<div style="font-size:19px;opacity:.85">Payment sent</div><div class="big" style="font-size:58px;margin:6px 0">${money(amount)}</div>
<div style="font-size:18px">to <b>${to}</b></div><div style="opacity:.75;margin-top:6px">${note} · ${date}</div></div>
<div style="margin-top:36px;background:#fff;color:${color};text-align:center;border-radius:14px;padding:15px;font-weight:700">Done</div>`);
}
