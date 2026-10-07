import React from 'react';

export default function ArchitecturalMetrics({ width = 16, depth = 14, currentTierData = {} }) {
  const w = Number(width);
  const d = Number(depth);
  const sqFt = w * d;

  // 1. NKBA Architectural & ADA Clearance Verification
  const meetsNKBAWalkway = w >= 8 && d >= 7;
  const meetsADATurnCircle = Math.min(w, d) >= 9;
  const fixtureDensity = sqFt < 70 ? 'Compact' : sqFt <= 140 ? 'Optimal Spacious' : 'Executive Suite';

  // 2. Dynamic Fixture Flow-Rate Parser from current active tier
  const detailed = currentTierData?.detailed_bundle || {};

  // Extract numerical values from strings like "1.75 GPM", "1.28 GPF", "1.2 GPM"
  const parseRate = (val, fallback) => {
    if (!val) return fallback;
    const match = String(val).match(/(\d+(\.\d+)?)/);
    return match ? parseFloat(match[1]) : fallback;
  };

  const showerGPM = parseRate(detailed.shower?.flow_rate, 1.75);
  const toiletGPF = parseRate(detailed.toilet?.flow_rate, 1.28);
  const faucetGPM = parseRate(detailed.faucet?.flow_rate, 1.2);

  // Baseline standard: calculateEcoMetrics GPM shower, 1.6 GPF toilet, 2.2 GPM faucet
  // 2 occupants: 8-min shower/day, 5 flushes/day, 4-min faucet use/day
  const showerSavingsPerYear = Math.max(0, Math.round(2 * 8 * (2.5 - showerGPM) * 365));
  const toiletSavingsPerYear = Math.max(0, Math.round(2 * 5 * (1.6 - toiletGPF) * 365));
  const faucetSavingsPerYear = Math.max(0, Math.round(2 * 4 * (2.2 - faucetGPM) * 365));

  const totalWaterSaved = showerSavingsPerYear + toiletSavingsPerYear + faucetSavingsPerYear;
  const energySavedKWh = Math.round(showerSavingsPerYear * 0.18 + faucetSavingsPerYear * 0.12);

  return (
    <div
      className="stagger-card"
      style={{
        marginTop: '1.25rem',
        background: 'rgba(11, 20, 32, 0.75)',
        border: '1px solid rgba(52, 211, 153, 0.25)',
        borderRadius: '12px',
        padding: '1.25rem'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '1rem' }}>🌱</span>
          <span style={{ fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#34d399', fontWeight: 700 }}>
            Kohler Eco-Impact & Architectural Audit
          </span>
        </div>
        <span
          style={{
            fontSize: '0.65rem',
            padding: '2px 8px',
            borderRadius: '12px',
            background: 'rgba(52, 211, 153, 0.15)',
            border: '1px solid #34d399',
            color: '#34d399',
            fontWeight: 600
          }}
        >
          {currentTierData.title || 'Curated Tier'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
        <div style={{ background: 'rgba(15, 23, 42, 0.65)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '8px', padding: '0.65rem' }}>
          <span style={{ display: 'block', color: '#94a3b8', fontSize: '0.65rem', textTransform: 'uppercase' }}>Annual Water Saved</span>
          <div style={{ color: '#38bdf8', fontSize: '1.05rem', fontWeight: 700, fontFamily: 'monospace', margin: '2px 0' }}>
            ~{totalWaterSaved.toLocaleString()} gal
          </div>
          <span style={{ fontSize: '0.62rem', color: '#64748b' }}>vs. EPA baseline</span>
        </div>

        <div style={{ background: 'rgba(15, 23, 42, 0.65)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '8px', padding: '0.65rem' }}>
          <span style={{ display: 'block', color: '#94a3b8', fontSize: '0.65rem', textTransform: 'uppercase' }}>Energy Offset</span>
          <div style={{ color: '#f59e0b', fontSize: '1.05rem', fontWeight: 700, fontFamily: 'monospace', margin: '2px 0' }}>
            {energySavedKWh} kWh/yr
          </div>
          <span style={{ fontSize: '0.62rem', color: '#64748b' }}>Water heating offset</span>
        </div>

        <div style={{ background: 'rgba(15, 23, 42, 0.65)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '8px', padding: '0.65rem' }}>
          <span style={{ display: 'block', color: '#94a3b8', fontSize: '0.65rem', textTransform: 'uppercase' }}>Spatial Density</span>
          <div style={{ color: '#c5a059', fontSize: '1.05rem', fontWeight: 700, fontFamily: 'monospace', margin: '2px 0' }}>
            {sqFt} sq ft
          </div>
          <span style={{ fontSize: '0.62rem', color: '#64748b' }}>{fixtureDensity}</span>
        </div>
      </div>

      <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '0.75rem' }}>
        <span style={{ display: 'block', color: '#94a3b8', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.4rem' }}>
          NKBA & Building Code Clearance Validation
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.72rem' }}>
            <span style={{ color: meetsNKBAWalkway ? '#34d399' : '#f87171' }}>
              {meetsNKBAWalkway ? '✓' : '⚠'}
            </span>
            <span style={{ color: meetsNKBAWalkway ? '#cbd5e1' : '#fca5a5' }}>
              NKBA 30" Clear Walkway Egress: <strong>{meetsNKBAWalkway ? 'Compliant' : 'Constrained Clearance'}</strong>
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.72rem' }}>
            <span style={{ color: meetsADATurnCircle ? '#34d399' : '#f59e0b' }}>
              {meetsADATurnCircle ? '✓' : 'ℹ'}
            </span>
            <span style={{ color: '#cbd5e1' }}>
              ADA 60" Wheelchair Turning Radius: <strong>{meetsADATurnCircle ? 'Unrestricted Access' : 'Standard Residential Only'}</strong>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
