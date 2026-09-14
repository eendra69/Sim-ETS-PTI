import type {
  Installation,
  PositionSnapshot,
  TraderInstallationScope,
  VintageHolding,
} from '../api/types';
import { number, signed } from '../shared/format';

interface ParticipantsPageProps {
  installations: Installation[];
  positions: PositionSnapshot[];
  traderScopes: TraderInstallationScope[];
  holdings: VintageHolding[];
  positionPeriod: number;
  targetCompliancePeriod: number;
  loading: boolean;
}

export function ParticipantsPage({
  installations,
  positions,
  traderScopes,
  holdings,
  positionPeriod,
  targetCompliancePeriod,
  loading,
}: ParticipantsPageProps) {
  const participantCount = new Set(installations.map((item) => item.participantId)).size;
  const activeInstallations = installations.filter((item) => item.status === 'ACTIVE').length;
  const activeTraders = new Set(
    traderScopes.filter((item) => item.status === 'ACTIVE').map((item) => item.traderAccountId),
  ).size;
  const tradableUnits = holdings.reduce((sum, item) => sum + item.tradableAvailableUnits, 0);

  return (
    <>
      <header className="view-header" id="participants">
        <div>
          <p className="eyebrow">MARKET PARTICIPANT DIRECTORY</p>
          <h1>Participants</h1>
          <p className="subtitle">Peserta, instalasi, cakupan trader, posisi tahunan, dan holding vintage.</p>
        </div>
        <span className="status">Read only</span>
      </header>

      <section className="summary catalog-summary" aria-label="Ringkasan participant">
        <article><span>Peserta terdaftar</span><strong>{number.format(participantCount)}</strong><small>entitas pada katalog simulator</small></article>
        <article><span>Instalasi aktif</span><strong>{number.format(activeInstallations)}</strong><small>{number.format(activeTraders)} akun trader aktif</small></article>
        <article><span>Holding tradable</span><strong>{number.format(tradableUnits)}</strong><small>tCO₂e eligible untuk CP-{targetCompliancePeriod}</small></article>
      </section>

      <section className="panel orders-panel">
        <div className="panel-heading compact">
          <div><p className="eyebrow">PARTICIPANT & INSTALLATION</p><h2>Daftar peserta pasar</h2></div>
          <p>Posisi menampilkan snapshot periode {positionPeriod}; hak transaksi tetap dihitung oleh layanan posisi.</p>
        </div>
        <div className="table-wrap">
          <table className="catalog-table">
            <thead><tr><th>Participant</th><th>Installation</th><th>Status</th><th>Trader scope</th><th>Posisi {positionPeriod}</th><th>Available sell</th><th>Buy need</th></tr></thead>
            <tbody>
              {loading && installations.length === 0 ? <tr><td colSpan={7} className="empty-cell">Memuat katalog participant…</td></tr> : null}
              {!loading && installations.length === 0 ? <tr><td colSpan={7} className="empty-cell">Belum ada participant terdaftar</td></tr> : null}
              {installations.map((installation) => {
                const position = positions.find((item) => item.participantId === installation.participantId);
                const scopes = traderScopes.filter((item) => item.installationId === installation.installationId);
                return (
                  <tr key={installation.installationId}>
                    <td><strong>{installation.participantName}</strong><small>{installation.participantId}</small></td>
                    <td>{installation.installationName}<small>{installation.installationId}</small></td>
                    <td><span className={`pill ${installation.status === 'ACTIVE' ? 'surplus' : 'balanced'}`}>{installation.status}</span><small>{installation.dataOrigin}</small></td>
                    <td>{scopes.length ? scopes.map((scope) => scope.traderAccountId).join(', ') : '—'}<small>{scopes.length ? scopes.map((scope) => scope.displayName).join(', ') : 'Belum dipetakan'}</small></td>
                    <td>{position ? <span className={`pill ${position.positionStatus.toLowerCase()}`}>{signed(position.netPosition)}</span> : '—'}<small>{position?.sourceStatus ?? 'Tidak ada snapshot'}</small></td>
                    <td>{number.format(position?.availableToSell ?? 0)}</td>
                    <td>{number.format(position?.availableBuyNeed ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel orders-panel">
        <div className="panel-heading compact">
          <div><p className="eyebrow">VINTAGE HOLDING REGISTER</p><h2>Holding kuota per instalasi</h2></div>
          <p>Tradable hanya jika holding aktif, terverifikasi, dan eligible untuk CP-{targetCompliancePeriod}.</p>
        </div>
        <div className="table-wrap">
          <table className="catalog-table">
            <thead><tr><th>Participant</th><th>Installation</th><th>Vintage</th><th>Total</th><th>Available</th><th>Eligibility</th><th>Tradable</th><th>Provenance</th></tr></thead>
            <tbody>
              {loading && holdings.length === 0 ? <tr><td colSpan={8} className="empty-cell">Memuat holding vintage…</td></tr> : null}
              {!loading && holdings.length === 0 ? <tr><td colSpan={8} className="empty-cell">Belum ada holding vintage</td></tr> : null}
              {holdings.map((holding) => (
                <tr key={holding.vintageHoldingId}>
                  <td>{holding.participantId}</td>
                  <td>{holding.installationId}</td>
                  <td><strong>{holding.vintageYear}</strong><small>{holding.seriesCode}</small></td>
                  <td>{number.format(holding.totalUnits)}</td>
                  <td>{number.format(holding.availableUnits)}<small>locked {number.format(holding.lockedUnits)} · surrendered {number.format(holding.surrenderedUnits)}</small></td>
                  <td><span className={`pill ${holding.eligibleForTargetPeriod ? 'surplus' : 'deficit'}`}>{holding.eligibleForTargetPeriod ? 'ELIGIBLE' : 'INELIGIBLE'}</span><small>CP-{targetCompliancePeriod}</small></td>
                  <td><strong>{number.format(holding.tradableAvailableUnits)}</strong><small>tCO₂e</small></td>
                  <td>{holding.provenanceType}<small>{holding.sourceStatus} · {holding.dataOrigin}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
