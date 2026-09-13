import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

interface PositionSnapshot {
  participantId: string;
  participantName: string;
  allocatedQuota: number;
  verifiedEmission: number;
  netPosition: number;
  positionStatus: 'SURPLUS' | 'DEFICIT' | 'BALANCED';
  availableToSell: number;
  buyNeedRemaining: number;
  availableBuyNeed: number;
}

interface LimitOrder {
  orderId: string;
  participantId: string;
  side: 'BUY' | 'SELL';
  remainingQuantity: number;
  limitPrice: number;
  timeInForce: 'DAY' | 'GTC';
}

interface BookLevel {
  price: number;
  quantity: number;
  orderCount: number;
}

interface OrderBook {
  bids: BookLevel[];
  asks: BookLevel[];
  orders: { bids: LimitOrder[]; asks: LimitOrder[] };
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';
const number = new Intl.NumberFormat('id-ID');
const money = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${number.format(value)}`;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, init);
  const body = (await response.json()) as T & { message?: string };
  if (!response.ok) throw new Error(body.message ?? `API merespons ${response.status}`);
  return body;
}

export function App() {
  const [positions, setPositions] = useState<PositionSnapshot[]>([]);
  const [book, setBook] = useState<OrderBook>({ bids: [], asks: [], orders: { bids: [], asks: [] } });
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [participantId, setParticipantId] = useState('IND-A');
  const [side, setSide] = useState<'BUY' | 'SELL'>('SELL');
  const [quantity, setQuantity] = useState(5_000);
  const [limitPrice, setLimitPrice] = useState(75_000);
  const [timeInForce, setTimeInForce] = useState<'DAY' | 'GTC'>('DAY');

  const refresh = useCallback(async () => {
    try {
      const [nextPositions, nextBook] = await Promise.all([
        api<PositionSnapshot[]>('/positions?seriesCode=PTBAE-IND&compliancePeriod=2027'),
        api<OrderBook>('/order-book?seriesCode=PTBAE-IND&compliancePeriod=2027'),
      ]);
      setPositions(nextPositions);
      setBook(nextBook);
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Tidak dapat memuat data');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const totals = useMemo(
    () => ({
      supply: positions.reduce((sum, item) => sum + item.availableToSell, 0),
      demand: positions.reduce((sum, item) => sum + item.availableBuyNeed, 0),
    }),
    [positions],
  );

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(undefined);
    setError(undefined);
    try {
      await api<LimitOrder>('/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participantId,
          clientOrderId: `WEB-${participantId}-${Date.now()}`,
          seriesCode: 'PTBAE-IND',
          compliancePeriod: 2027,
          side,
          orderType: 'LIMIT',
          quantity,
          limitPrice,
          timeInForce,
        }),
      });
      setNotice(`${side} LIMIT berhasil masuk antrean.`);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Order ditolak');
    } finally {
      setBusy(false);
    }
  }

  async function cancelOrder(orderId: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      await api<LimitOrder>(`/orders/${orderId}`, { method: 'DELETE' });
      setNotice('Order dibatalkan dan reservation dilepas.');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Pembatalan gagal');
    } finally {
      setBusy(false);
    }
  }

  const openOrders = [...book.orders.bids, ...book.orders.asks].sort(
    (left, right) => left.limitPrice - right.limitPrice,
  );

  return (
    <main>
      <header className="hero">
        <div>
          <p className="eyebrow">REGULAR MARKET SIMULATOR</p>
          <h1>PTBAE-IND</h1>
          <p className="subtitle">LIMIT Order & Order Book · Compliance Period 2027</p>
        </div>
        <span className="status">Tahap 2</span>
      </header>

      <section className="summary" aria-label="Ringkasan pasar">
        <article><span>Available supply</span><strong>{number.format(totals.supply)}</strong><small>tCO₂e setelah reservation</small></article>
        <article><span>Available buy need</span><strong>{number.format(totals.demand)}</strong><small>tCO₂e kebutuhan tersisa</small></article>
        <article><span>Prototype ruleset</span><strong>Rp200</strong><small>Tick · band Rp60.000–90.000</small></article>
      </section>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}

      <section className="trading-grid">
        <form className="panel ticket" onSubmit={submitOrder}>
          <div className="panel-heading compact">
            <div><p className="eyebrow">ORDER ENTRY</p><h2>LIMIT ticket</h2></div>
          </div>
          <div className="form-grid">
            <label>Peserta<select value={participantId} onChange={(event) => setParticipantId(event.target.value)}>{positions.map((position) => <option key={position.participantId} value={position.participantId}>{position.participantId} · {position.participantName}</option>)}</select></label>
            <label>Sisi<select value={side} onChange={(event) => setSide(event.target.value as 'BUY' | 'SELL')}><option>SELL</option><option>BUY</option></select></label>
            <label>Quantity<input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
            <label>Limit price<input type="number" min="60000" max="90000" step="200" value={limitPrice} onChange={(event) => setLimitPrice(Number(event.target.value))} /></label>
            <label>Time in force<select value={timeInForce} onChange={(event) => setTimeInForce(event.target.value as 'DAY' | 'GTC')}><option>DAY</option><option>GTC</option></select></label>
          </div>
          <button type="submit" disabled={busy}>{busy ? 'Memproses…' : `Kirim ${side} LIMIT`}</button>
          <small className="hint">Estimasi exposure: {money.format(quantity * limitPrice)}</small>
        </form>

        <section className="panel book-panel">
          <div className="panel-heading compact"><div><p className="eyebrow">VISIBLE DEPTH</p><h2>Order book</h2></div><button className="ghost" type="button" onClick={() => void refresh()}>Refresh</button></div>
          <div className="book-columns">
            <div><h3>Bid</h3>{book.bids.length === 0 ? <p className="empty">Belum ada bid</p> : book.bids.map((level) => <div className="book-row bid" key={level.price}><span>{number.format(level.quantity)}</span><strong>{money.format(level.price)}</strong><small>{level.orderCount}</small></div>)}</div>
            <div><h3>Ask</h3>{book.asks.length === 0 ? <p className="empty">Belum ada ask</p> : book.asks.map((level) => <div className="book-row ask" key={level.price}><strong>{money.format(level.price)}</strong><span>{number.format(level.quantity)}</span><small>{level.orderCount}</small></div>)}</div>
          </div>
        </section>
      </section>

      <section className="panel orders-panel">
        <div className="panel-heading compact"><div><p className="eyebrow">PRICE–TIME QUEUE</p><h2>Open orders</h2></div><p>Matching belum diaktifkan pada tahap ini.</p></div>
        <div className="table-wrap"><table><thead><tr><th>Peserta</th><th>Side</th><th>Price</th><th>Remaining</th><th>TIF</th><th></th></tr></thead><tbody>{openOrders.length === 0 ? <tr><td colSpan={6} className="empty-cell">Belum ada order aktif</td></tr> : openOrders.map((order) => <tr key={order.orderId}><td>{order.participantId}</td><td><span className={`side ${order.side.toLowerCase()}`}>{order.side}</span></td><td>{money.format(order.limitPrice)}</td><td>{number.format(order.remainingQuantity)}</td><td>{order.timeInForce}</td><td><button className="cancel" disabled={busy} onClick={() => void cancelOrder(order.orderId)}>Cancel</button></td></tr>)}</tbody></table></div>
      </section>

      <section className="panel positions-panel">
        <div className="panel-heading"><div><p className="eyebrow">VERIFIED POSITION</p><h2>Posisi peserta</h2></div><p>Available sell dan buy need langsung berkurang saat order aktif membuat reservation.</p></div>
        <div className="table-wrap"><table><thead><tr><th>Peserta</th><th>Allocated quota</th><th>Verified emission</th><th>Net position</th><th>Available sell</th><th>Buy need</th></tr></thead><tbody>{positions.map((position) => <tr key={position.participantId}><td><strong>{position.participantName}</strong><small>{position.participantId}</small></td><td>{number.format(position.allocatedQuota)}</td><td>{number.format(position.verifiedEmission)}</td><td><span className={`pill ${position.positionStatus.toLowerCase()}`}>{signed(position.netPosition)}</span></td><td>{number.format(position.availableToSell)}</td><td>{number.format(position.availableBuyNeed)}</td></tr>)}</tbody></table></div>
      </section>

      <footer>Default simulator · Bukan penetapan ketentuan resmi pasar</footer>
    </main>
  );
}
