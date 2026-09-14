import type {
  ProductSeriesCatalogueItem,
  QuotaVintage,
  VintageHolding,
} from '../api/types';
import { number } from '../shared/format';

interface ProductSeriesPageProps {
  series: ProductSeriesCatalogueItem[];
  vintages: QuotaVintage[];
  holdings: VintageHolding[];
  targetCompliancePeriod: number;
  onTargetCompliancePeriodChange: (period: number) => void;
  loading: boolean;
}

export function ProductSeriesPage({
  series,
  vintages,
  holdings,
  targetCompliancePeriod,
  onTargetCompliancePeriodChange,
  loading,
}: ProductSeriesPageProps) {
  const eligibleVintages = vintages.filter((item) => item.eligibility?.eligible).length;
  const admittedVintages = vintages.filter((item) => item.admission?.status === 'ACTIVE').length;
  const holdingUnits = holdings.reduce((sum, item) => sum + item.totalUnits, 0);

  return (
    <>
      <header className="view-header" id="product-series">
        <div>
          <p className="eyebrow">PRODUCT CATALOGUE & ELIGIBILITY</p>
          <h1>Product, Series & Vintage</h1>
          <p className="subtitle">Definisi PTBAE-IND, admission Regular Market, dan kelayakan vintage per compliance period.</p>
        </div>
        <label className="period-selector catalog-period">Target compliance period
          <select value={targetCompliancePeriod} onChange={(event) => onTargetCompliancePeriodChange(Number(event.target.value))}>
            <option value={2026}>CP-2026</option>
            <option value={2027}>CP-2027</option>
          </select>
        </label>
      </header>

      <div className="catalog-assumption" role="note">
        <strong>Aturan simulasi.</strong> Admission, banking, dan eligibility vintage di halaman ini masih berstatus <em>SIMULATION_ASSUMPTION</em>, bukan ketentuan resmi regulator.
      </div>

      <section className="summary catalog-summary" aria-label="Ringkasan product catalogue">
        <article><span>Product series</span><strong>{number.format(series.length)}</strong><small>series tersedia untuk Regular Market</small></article>
        <article><span>Vintage eligible</span><strong>{number.format(eligibleVintages)}</strong><small>dari {number.format(vintages.length)} vintage untuk CP-{targetCompliancePeriod}</small></article>
        <article><span>Recorded holdings</span><strong>{number.format(holdingUnits)}</strong><small>tCO₂e lintas seluruh vintage</small></article>
      </section>

      <section className="panel orders-panel">
        <div className="panel-heading compact">
          <div><p className="eyebrow">PRODUCT SERIES</p><h2>Instrumen yang diperdagangkan</h2></div>
          <span className="status">{admittedVintages} admission aktif</span>
        </div>
        <div className="table-wrap">
          <table className="catalog-table">
            <thead><tr><th>Series code</th><th>Unit</th><th>Status</th><th>Market</th><th>Matching policy</th></tr></thead>
            <tbody>
              {loading && series.length === 0 ? <tr><td colSpan={5} className="empty-cell">Memuat product series…</td></tr> : null}
              {!loading && series.length === 0 ? <tr><td colSpan={5} className="empty-cell">Belum ada product series</td></tr> : null}
              {series.map((item) => (
                <tr key={item.seriesCode}>
                  <td><strong>{item.seriesCode}</strong></td>
                  <td>{item.unit}</td>
                  <td><span className={`pill ${item.status === 'ACTIVE' ? 'surplus' : 'balanced'}`}>{item.status}</span></td>
                  <td>REGULAR</td>
                  <td>Same-vintage only<small>cross-vintage matching tidak diizinkan</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel orders-panel">
        <div className="panel-heading compact">
          <div><p className="eyebrow">VINTAGE ADMISSION MATRIX</p><h2>Kelayakan untuk CP-{targetCompliancePeriod}</h2></div>
          <p>Priority lebih kecil digunakan lebih dahulu untuk kebutuhan kepatuhan dalam simulasi.</p>
        </div>
        <div className="table-wrap">
          <table className="catalog-table">
            <thead><tr><th>Vintage</th><th>Banking</th><th>Admission</th><th>Eligibility</th><th>Priority</th><th>Fungibility key</th><th>Cross-vintage</th><th>Policy source</th></tr></thead>
            <tbody>
              {loading && vintages.length === 0 ? <tr><td colSpan={8} className="empty-cell">Memuat vintage dan eligibility…</td></tr> : null}
              {!loading && vintages.length === 0 ? <tr><td colSpan={8} className="empty-cell">Belum ada vintage pada katalog</td></tr> : null}
              {vintages.map((vintage) => (
                <tr key={vintage.vintageId}>
                  <td><strong>V{vintage.vintageYear}</strong><small>{vintage.vintageId}</small></td>
                  <td>{vintage.bankingStatus}</td>
                  <td><span className={`pill ${vintage.admission?.status === 'ACTIVE' ? 'surplus' : 'balanced'}`}>{vintage.admission?.status ?? 'NOT ADMITTED'}</span><small>{vintage.admission?.marketSegment ?? '—'}</small></td>
                  <td><span className={`pill ${vintage.eligibility?.eligible ? 'surplus' : 'deficit'}`}>{vintage.eligibility?.eligible ? 'ELIGIBLE' : 'INELIGIBLE'}</span><small>{vintage.eligibility?.reason ?? 'Rule tidak ditemukan'}</small></td>
                  <td>{vintage.eligibility?.usagePriority ?? '—'}</td>
                  <td>{vintage.admission?.fungibilityKey ?? '—'}</td>
                  <td>{vintage.admission?.crossVintageMatching ? 'YES' : 'NO'}</td>
                  <td>{vintage.eligibility?.policySource ?? vintage.policySource}<small>{vintage.eligibility?.policyCertainty ?? vintage.policyCertainty}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
