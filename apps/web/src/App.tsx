import { useEffect, useMemo, useState } from 'react';

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
  reservedSell: number;
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';
const number = new Intl.NumberFormat('id-ID');

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${number.format(value)}`;
}

export function App() {
  const [positions, setPositions] = useState<PositionSnapshot[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    fetch(`${apiBaseUrl}/positions?seriesCode=PTBAE-IND&compliancePeriod=2027`)
      .then((response) => {
        if (!response.ok) throw new Error(`API merespons ${response.status}`);
        return response.json() as Promise<PositionSnapshot[]>;
      })
      .then(setPositions)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Tidak dapat memuat posisi');
      });
  }, []);

  const totals = useMemo(
    () => ({
      supply: positions.reduce((sum, item) => sum + item.availableToSell, 0),
      demand: positions.reduce((sum, item) => sum + item.buyNeedRemaining, 0),
    }),
    [positions],
  );

  return (
    <main>
      <header className="hero">
        <div>
          <p className="eyebrow">REGULAR MARKET SIMULATOR</p>
          <h1>PTBAE-IND</h1>
          <p className="subtitle">Annual Position & Balance · Compliance Period 2027</p>
        </div>
        <span className="status">Tahap 1</span>
      </header>

      <section className="summary" aria-label="Ringkasan pasar">
        <article>
          <span>Potensi supply</span>
          <strong>{number.format(totals.supply)}</strong>
          <small>tCO₂e tersedia untuk dijual</small>
        </article>
        <article>
          <span>Kebutuhan beli</span>
          <strong>{number.format(totals.demand)}</strong>
          <small>tCO₂e untuk menutup defisit</small>
        </article>
        <article>
          <span>Product series</span>
          <strong>PTBAE-IND</strong>
          <small>Periode disimpan terpisah</small>
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">VERIFIED POSITION</p>
            <h2>Posisi peserta</h2>
          </div>
          <p>Posisi authoritative hanya berubah setelah acknowledgement dan reconciliation.</p>
        </div>

        {error ? <p className="error">API belum tersedia: {error}</p> : null}
        {!error && positions.length === 0 ? <p className="loading">Memuat posisi…</p> : null}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Peserta</th>
                <th>Allocated quota</th>
                <th>Verified emission</th>
                <th>Net position</th>
                <th>Available sell</th>
                <th>Buy need</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => (
                <tr key={position.participantId}>
                  <td>
                    <strong>{position.participantName}</strong>
                    <small>{position.participantId}</small>
                  </td>
                  <td>{number.format(position.allocatedQuota)}</td>
                  <td>{number.format(position.verifiedEmission)}</td>
                  <td>
                    <span className={`pill ${position.positionStatus.toLowerCase()}`}>
                      {signed(position.netPosition)}
                    </span>
                  </td>
                  <td>{number.format(position.availableToSell)}</td>
                  <td>{number.format(position.availableBuyNeed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer>
        Default simulator · Bukan penetapan ketentuan resmi pasar
      </footer>
    </main>
  );
}
