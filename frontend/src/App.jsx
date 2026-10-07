import ArchitecturalMetrics from './ArchitecturalMetrics';
import { useState, useEffect, useRef, useMemo } from 'react';
import gsap from 'gsap';
import Bathroom3D from './Bathroom3D';
import './App.css';
import { exportDesignPackagePDF } from './generateBOM';
import IntroSplash from './IntroSplash';
import { prepareSavedLayout } from './restoreLayout';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const STYLES = [
  'Minimalist Modern',
  'Classic Luxury',
  'Japanese Zen',
  'Industrial Chic'
];

const FIXTURE_IMAGES = {
  faucet: 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?auto=format&fit=crop&w=800&q=80',
  shower: 'https://images.unsplash.com/photo-1620626011761-996317b8d101?auto=format&fit=crop&w=800&q=80',
  toilet: 'https://images.unsplash.com/photo-1584622781564-1d987f7333c1?auto=format&fit=crop&w=800&q=80',
  vanity: 'https://images.unsplash.com/photo-1600566753376-12c8ab7fb75b?auto=format&fit=crop&w=800&q=80',
  bathtub: 'https://images.unsplash.com/photo-1507652313519-d4e9174996dd?auto=format&fit=crop&w=800&q=80'
};

const CATEGORIES = ['all', 'faucets', 'showers', 'toilets', 'vanities', 'bathtubs'];

const QUICK_COPILOT_DIRECTIVES = [
  '♿ Zero-threshold shower & ADA comfort-height',
  '🌱 Target ultra-low flow rates & LEED metrics',
  '✨ Shift hardware to Moderne Brass & soaking tub',
  '🏢 Maximize vanity counter space & compact clearances'
];

// Eco Metrics Calculator & Payback Estimator
const calculateEcoMetrics = (isEcoActive) => {
  const standardGallonsPerYear = 25000;
  const ecoGallonsPerYear = 18500; 
  const costPerGallon = 0.0055;

  const annualGallonsSaved = isEcoActive ? (standardGallonsPerYear - ecoGallonsPerYear) : 0;
  const annualDollarSaved = annualGallonsSaved * costPerGallon;

  return {
    gallonsSaved: annualGallonsSaved,
    cost1Year: annualDollarSaved.toFixed(2),
    cost5Year: (annualDollarSaved * 5).toFixed(2),
    cost10Year: (annualDollarSaved * 10).toFixed(2),
    tradeoffNote: "Swapped vanity faucet and showerhead for 20% more efficient low-flow models (-26% water usage, distinct eco-efficiency pricing)."
  };
};

export default function App() {
  const [showSplash, setShowSplash] = useState(true);

  const handleEnterStudio = () => {
    setShowSplash(false);
  };

  const [isExportingPDF, setIsExportingPDF] = useState(false);
  const [width, setWidth] = useState(16);
  const [depth, setDepth] = useState(14);
  const [budget, setBudget] = useState(12000);
  const [style, setStyle] = useState(STYLES[0]);
  
  // --- Eco Mode & Comparison States ---
  const [ecoMode, setEcoMode] = useState(false);
  const [showComparisonModal, setShowComparisonModal] = useState(false);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [activeSpecProduct, setActiveSpecProduct] = useState(null);
  const [activeTier, setActiveTier] = useState('curated');
  const [layoutToRestore, setLayoutToRestore] = useState(null);

  const handleRestoreLayout = value => {
    const { snapshot, tier } = prepareSavedLayout(value);
    setWidth(snapshot.width);
    setDepth(snapshot.depth);
    if (Number.isFinite(snapshot.budget)) setBudget(snapshot.budget);
    if (STYLES.includes(snapshot.style)) setStyle(snapshot.style);
    if (typeof snapshot.ecoMode === 'boolean') setEcoMode(snapshot.ecoMode);
    setResult(previous => ({ ...previous, tiers: { ...previous?.tiers, saved: tier } }));
    setActiveTier('saved');
    setLayoutToRestore(snapshot);
    setActiveSpecProduct(null);
    setError(null);
  };

  const [copilotDirective, setCopilotDirective] = useState('');
  const [isRefining, setIsRefining] = useState(false);

  const [catalog, setCatalog] = useState({ faucets: [], showers: [], toilets: [], vanities: [], bathtubs: [] });
  const [selectedCategory, setSelectedCategory] = useState('faucets');

  const cursorRef = useRef(null);
  const resultsContainerRef = useRef(null);
  const bgImageRef = useRef(null);
  const bathroom3DRef = useRef(null);

  useEffect(() => {
    fetch(`${API_URL}/api/catalog`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const hasItems = Object.values(data || {}).some(arr => Array.isArray(arr) && arr.length > 0);
        if (hasItems) {
          setCatalog(data);
        }
      })
      .catch((err) => {
        console.error("Could not fetch catalog from /api/catalog:", err);
      });
  }, []);

  useEffect(() => {
    if (showSplash) return;
    const cursor = cursorRef.current;
    let cursorFrame = 0, pointerX = 0, pointerY = 0;
    const handleMouseMove = (e) => {
      if (!cursor || !window.matchMedia('(pointer: fine)').matches) return;
      pointerX = e.clientX; pointerY = e.clientY;
      if (!cursorFrame) cursorFrame = requestAnimationFrame(() => {
        cursor.style.transform = `translate3d(${pointerX}px, ${pointerY}px, 0) translate(-50%, -50%)`;
        cursorFrame = 0;
      });
    };

    const handleMouseOver = (e) => {
      if (!cursor) return;
      if (e.target.closest('button, input, select, textarea, .fixture-card, .clickable')) {
        cursor.classList.add('active');
      } else {
        cursor.classList.remove('active');
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setActiveSpecProduct(null);
        setShowComparisonModal(false);
      }
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('mouseover', handleMouseOver, { passive: true });
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      cancelAnimationFrame(cursorFrame);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseover', handleMouseOver);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showSplash]);

  useEffect(() => {
    if (result && resultsContainerRef.current) {
      const animation = gsap.fromTo(
        resultsContainerRef.current.querySelectorAll('.stagger-card'),
        { y: 14, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.5, stagger: 0.05, ease: "power3.out" }
      );
      return () => animation.kill();
    }
  }, [result, activeTier]);

  const handleGenerate = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setActiveSpecProduct(null);

    const payload = {
      width: Number(width),
      depth: Number(depth),
      budget: Number(budget),
      style: style,
      eco_mode: ecoMode
    };

    try {
      const response = await fetch(`${API_URL}/api/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
      });

      const text = await response.text();
      const data = text ? JSON.parse(text) : {};

      if (!response.ok || data.error) {
        throw new Error(data.error || `Server error (${response.status})`);
      }
      setResult(data);
      if (data.tiers && data.tiers.curated) {
        setActiveTier(ecoMode ? 'eco' : 'curated');
      }
    } catch (err) {
      setError(err.name === 'TimeoutError' ? 'The recommendation server took too long to respond. Please try again.' : err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyCopilotRevision = async (e) => {
    e.preventDefault();
    const currentDirectiveText = copilotDirective.trim();
    if (!currentDirectiveText) return;

    setIsRefining(true);
    try {
      const currentActiveBundle = currentTierData.bundle || {};
      const payload = {
        current_bundle: currentActiveBundle,
        directive: currentDirectiveText,
        style: style,
        budget: Number(budget),
        width: Number(width),
        depth: Number(depth)
      };

      const response = await fetch(`${API_URL}/api/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
      });

      const text = await response.text();
      const refinedTier = text ? JSON.parse(text) : {};

      if (!response.ok || refinedTier.error) {
        throw new Error(refinedTier.error || 'Failed to adapt specification');
      }

      setResult((prev) => ({
        ...prev,
        tiers: {
          ...prev.tiers,
          copilot: refinedTier
        }
      }));

      setActiveTier('copilot');
    } catch (err) {
      alert(`Copilot revision error: ${err.message}`);
    } finally {
      setIsRefining(false);
    }
  };

  const ecoMetrics = calculateEcoMetrics(ecoMode);
  
  // Synchronized tier data resolution ensuring exact parity between tab and active box
  const ecoDefaultPrice = result?.tiers?.curated?.total_price ? Math.round(result.tiers.curated.total_price * 0.9) : Math.round(budget * 0.9);

  const currentTierData = activeTier === 'eco' 
    ? (result?.tiers?.eco || {
        title: 'Eco-Optimized Suite 🌱',
        total_price: ecoDefaultPrice,
        explanation: ecoMetrics.tradeoffNote,
        bundle: result?.tiers?.curated?.bundle || result?.bundle || {},
        detailed_bundle: result?.tiers?.curated?.detailed_bundle || result?.detailed_bundle || {}
      })
    : (result?.tiers?.[activeTier] || {
        bundle: result?.bundle || {},
        detailed_bundle: result?.detailed_bundle || {},
        total_price: result?.total_price || 0,
        explanation: result?.explanation || '',
        title: 'Curated Suite'
      });

  // Follow the active suite/tier and fill omitted dimensions from the catalog.
  const studioProducts = useMemo(() => Object.fromEntries(
    Object.entries({ bathtubs: 'bathtub', vanities: 'vanity', showers: 'shower', toilets: 'toilet' }).map(([category, singular]) => {
      const id = currentTierData.bundle?.[singular] ?? currentTierData.bundle?.[category];
      const detailed = currentTierData.detailed_bundle?.[singular] ?? currentTierData.detailed_bundle?.[category];
      const product = (catalog[category] || []).find(item => item.id === id);
      return [category, { ...product, ...detailed,
        footprint_in: detailed?.footprint_in ?? product?.footprint_in }];
    })
  ), [catalog, currentTierData.bundle, currentTierData.detailed_bundle]);

  const handleExportPDF = async () => {
    if (!result) return;
    setIsExportingPDF(true);
    try {
      await exportDesignPackagePDF({
        result: currentTierData,
        width: Number(width),
        depth: Number(depth),
        style: `${style} (${activeTier.toUpperCase()})`,
        budget: Number(budget)
      });
    } catch (err) {
      console.error('Failed to export PDF package:', err);
    } finally {
      setIsExportingPDF(false);
    }
  };

  const displayedCatalogProducts = selectedCategory === 'all'
    ? Object.entries(catalog).flatMap(([catKey, items]) => (items || []).map(p => ({ ...p, categoryKey: catKey })))
    : (catalog[selectedCategory] || []).map(p => ({ ...p, categoryKey: selectedCategory }));

  return (
    <>
      {showSplash && <IntroSplash onEnter={handleEnterStudio} />}

      {!showSplash && (
        <div style={{ animation: 'fadeIn 0.8s ease forwards' }}>
          <div className="custom-cursor" ref={cursorRef} />
          <div className="grain-overlay" />

          <div className="luxury-backdrop">
            <img 
              ref={bgImageRef}
              className="luxury-backdrop-img"
              src="https://plus.unsplash.com/premium_photo-1661902468735-eabf780f8ff6?fm=jpg&q=60&w=3000&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MXx8YmF0aHJvb218ZW58MHx8MHx8fDA%3D" 
              alt="Ambient Architectural Bathroom" 
            />
            <div className="luxury-backdrop-overlay" />
          </div>

          <nav style={{ position: 'sticky', top: 0, zIndex: 100, borderBottom: '1px solid var(--hairline)', background: 'rgba(7, 7, 7, 0.94)', padding: '0.9rem 2.5rem' }}>
            <div style={{ maxWidth: '1480px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <span style={{ fontSize: '0.92rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-main)' }}>
                  KOHLER ARCHITECTURAL
                </span>
                <span style={{ height: '12px', width: '1px', background: 'var(--hairline)' }} />
                <span className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-dim)', letterSpacing: '0.12em' }}>
                  EDITION 2026.01
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
                <a href="#studio-section" className="font-mono clickable" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: '0.74rem', letterSpacing: '0.12em' }}>
                  01 &bull; STUDIO
                </a>
                <a href="#catalog-section" className="font-mono clickable" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: '0.74rem', letterSpacing: '0.12em' }}>
                  02 &bull; ARCHIVE [{Object.values(catalog).flat().length || 10}]
                </a>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
                  <span className="font-mono" style={{ fontSize: '0.68rem', color: '#10b981', letterSpacing: '0.08em' }}>
                    LIVE
                  </span>
                </div>
              </div>
            </div>
          </nav>

          <div style={{ position: 'relative', zIndex: 1, maxWidth: '1480px', margin: '0 auto', padding: '3.5rem 2.5rem' }}>
            
            <header id="studio-section" style={{ marginBottom: '3.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '2rem', borderBottom: '1px solid var(--hairline)', paddingBottom: '2.5rem' }}>
                <div>
                  <span className="font-mono" style={{ fontSize: '0.7rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--accent-gold)', display: 'block', marginBottom: '0.5rem' }}>
                    SPATIAL CURATION ENGINE &bull; GEMINI 2.5 FLASH
                  </span>
                  <h1 style={{ margin: 0, color: 'var(--text-main)', fontSize: '4.2rem', lineHeight: 0.98 }}>
                    Generative Spatial Studio
                  </h1>
                </div>
                <div style={{ maxWidth: '440px', textAlign: 'left' }}>
                  <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.94rem', lineHeight: 1.6, fontWeight: 300 }}>
                    Translates physical room envelopes and budgets into verified Kohler collections with real-time clearance validation.
                  </p>
                </div>
              </div>
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: '580px 1fr', gap: '2.5rem', alignItems: 'start', marginBottom: '7rem' }}>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
                
                <form 
                  onSubmit={handleGenerate}
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--hairline)',
                    padding: '2rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1.5rem'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--hairline)', paddingBottom: '0.85rem' }}>
                    <span className="font-mono" style={{ fontSize: '0.72rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      01 / SPATIAL PARAMETERS
                    </span>
                    <span className="font-mono" style={{ fontSize: '0.74rem', color: 'var(--accent-gold)' }}>
                      {width * depth} SQ FT
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.55rem' }}>
                        <label className="font-mono" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)' }}>
                          Width
                        </label>
                        <span className="font-mono" style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>{width} FT</span>
                      </div>
                      <input type="range" min="6" max="28" value={width} onChange={(e) => setWidth(e.target.value)} style={{ width: '100%' }} />
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.55rem' }}>
                        <label className="font-mono" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)' }}>
                          Length
                        </label>
                        <span className="font-mono" style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>{depth} FT</span>
                      </div>
                      <input type="range" min="6" max="24" value={depth} onChange={(e) => setDepth(e.target.value)} style={{ width: '100%' }} />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                    <div>
                      <label className="font-mono" style={{ display: 'block', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: '0.45rem' }}>
                        Budget Ceiling ($)
                      </label>
                      <input 
                        type="number" 
                        step="100" 
                        min="1000" 
                        max="40000" 
                        value={budget} 
                        onChange={(e) => setBudget(e.target.value)} 
                        className="font-mono"
                        style={{
                          width: '100%',
                          padding: '0.75rem 0.9rem',
                          border: '1px solid var(--hairline)',
                          background: 'var(--bg-core)',
                          color: 'var(--text-main)',
                          fontSize: '0.92rem',
                          outline: 'none'
                        }} 
                      />
                    </div>

                    <div>
                      <label className="font-mono" style={{ display: 'block', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: '0.45rem' }}>
                        Aesthetic Mood
                      </label>
                      <select 
                        value={style} 
                        onChange={(e) => setStyle(e.target.value)} 
                        style={{
                          width: '100%',
                          padding: '0.75rem 0.9rem',
                          border: '1px solid var(--hairline)',
                          background: 'var(--bg-core)',
                          color: 'var(--text-main)',
                          fontSize: '0.88rem',
                          outline: 'none',
                          cursor: 'pointer'
                        }}
                      >
                        {STYLES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* --- Eco Mode Toggle Switch in Form --- */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-core)', padding: '0.75rem 1rem', border: '1px solid var(--hairline)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '0.9rem' }}>🌱</span>
                      <div>
                        <div className="font-mono" style={{ fontSize: '0.72rem', color: 'var(--text-main)', fontWeight: 700, textTransform: 'uppercase' }}>Eco-Efficiency Mode</div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>Prioritize water & flow savings within budget</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEcoMode(!ecoMode)}
                      className="clickable font-mono"
                      style={{
                        background: ecoMode ? '#10b981' : 'rgba(255,255,255,0.08)',
                        border: ecoMode ? '1px solid #10b981' : '1px solid var(--hairline-hover)',
                        color: ecoMode ? '#070707' : 'var(--text-muted)',
                        padding: '6px 14px',
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        borderRadius: '4px'
                      }}
                    >
                      {ecoMode ? 'ENABLED' : 'DISABLED'}
                    </button>
                  </div>

                  <button 
                    type="submit" 
                    disabled={loading}
                    className="clickable font-mono"
                    style={{ 
                      width: '100%',
                      padding: '1.05rem', 
                      background: loading ? '#1a1a1a' : 'var(--text-main)', 
                      color: loading ? '#525252' : '#070707', 
                      border: 'none', 
                      cursor: loading ? 'not-allowed' : 'pointer',
                      fontWeight: 700,
                      fontSize: '0.78rem',
                      letterSpacing: '0.16em',
                      textTransform: 'uppercase',
                      marginTop: '0.4rem',
                      transition: 'background-color 0.15s ease'
                    }}
                  >
                    {loading ? 'Synthesizing...' : 'Generate Bundle →'}
                  </button>
                </form>

                {error && (
                  <div className="font-mono" style={{ padding: '0.9rem 1.1rem', backgroundColor: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', color: '#fca5a5', fontSize: '0.78rem' }}>
                    ERR: {error}
                  </div>
                )}

                {result && (
                  <div ref={resultsContainerRef} style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
                    
                    {/* --- Tier Selection Bar with Eco & Compare Button --- */}
                    <div>
                      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${4 + (result.tiers.copilot ? 1 : 0) + (result.tiers.saved ? 1 : 0)}, 1fr)`, gap: '1px', background: 'var(--hairline)', border: '1px solid var(--hairline)' }}>
                        {[
                          { id: 'essential', label: 'ESSENTIAL', price: result.tiers.essential?.total_price },
                          { id: 'curated', label: 'CURATED', price: result.tiers.curated?.total_price },
                          { id: 'signature', label: 'SIGNATURE', price: result.tiers.signature?.total_price },
                          { id: 'eco', label: '🌱 ECO', price: result.tiers.eco?.total_price || ecoDefaultPrice },
                          ...(result.tiers.copilot ? [{ id: 'copilot', label: 'COPILOT', price: result.tiers.copilot?.total_price }] : []),
                          ...(result.tiers.saved ? [{ id: 'saved', label: 'SAVED', price: result.tiers.saved.total_price }] : [])
                        ].map((t) => {
                          const isSelected = activeTier === t.id;
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => {
                                setActiveTier(t.id);
                                if (t.id === 'eco') setEcoMode(true);
                              }}
                              className="clickable font-mono"
                              style={{
                                padding: '0.95rem 0.3rem',
                                border: 'none',
                                background: isSelected ? 'var(--bg-surface-elevated)' : 'var(--bg-surface)',
                                color: isSelected ? (t.id === 'eco' ? '#10b981' : 'var(--text-main)') : 'var(--text-dim)',
                                cursor: 'pointer',
                                textAlign: 'center',
                                borderBottom: isSelected ? `2px solid ${t.id === 'eco' ? '#10b981' : 'var(--accent-gold)'}` : 'none'
                              }}
                            >
                              <span style={{ fontSize: '0.62rem', letterSpacing: '0.1em', display: 'block', color: isSelected ? (t.id === 'eco' ? '#10b981' : 'var(--accent-gold)') : 'var(--text-dim)' }}>
                                {t.label}
                              </span>
                              <span style={{ fontSize: '0.88rem', fontWeight: 700, marginTop: '4px', display: 'block' }}>
                                ${Math.round(t.price || 0)}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      {/* Side-by-Side Comparison Trigger Button */}
                      <button
                        type="button"
                        onClick={() => setShowComparisonModal(true)}
                        className="clickable font-mono"
                        style={{
                          width: '100%',
                          marginTop: '8px',
                          padding: '0.55rem',
                          background: 'rgba(197, 160, 89, 0.12)',
                          border: '1px solid rgba(197, 160, 89, 0.3)',
                          color: 'var(--accent-gold)',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          letterSpacing: '0.12em',
                          textTransform: 'uppercase',
                          cursor: 'pointer'
                        }}
                      >
                        📊 Compare Standard vs. Eco Bundles & ROI
                      </button>
                    </div>

                    <div className="stagger-card" style={{ background: 'var(--bg-surface)', border: '1px solid var(--hairline)', padding: '1.5rem 1.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-dim)', letterSpacing: '0.16em', textTransform: 'uppercase', display: 'block' }}>
                          {currentTierData.title || 'Curated Suite'}
                        </span>
                        <span className="font-mono" style={{ fontSize: '1.75rem', fontWeight: 700, color: activeTier === 'eco' ? '#10b981' : 'var(--accent-gold)' }}>
                          ${currentTierData.total_price}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleExportPDF}
                        disabled={isExportingPDF}
                        className="clickable font-mono"
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--hairline-hover)',
                          color: 'var(--text-main)',
                          padding: '8px 16px',
                          fontSize: '0.72rem',
                          letterSpacing: '0.14em',
                          textTransform: 'uppercase',
                          cursor: isExportingPDF ? 'not-allowed' : 'pointer'
                        }}
                      >
                        {isExportingPDF ? 'Exporting...' : 'PDF Spec Sheet →'}
                      </button>
                    </div>

                    <form
                      onSubmit={handleApplyCopilotRevision}
                      className="stagger-card"
                      style={{
                        background: 'var(--bg-surface)',
                        border: isRefining ? '1px solid #38bdf8' : '1px solid var(--accent-gold)',
                        padding: '1.65rem',
                        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.4)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
                        <span className="font-mono" style={{ fontSize: '0.74rem', color: 'var(--accent-gold)', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700 }}>
                          ⚡ IN-STUDIO COPILOT REFINEMENT
                        </span>
                        <span className="font-mono" style={{ fontSize: '0.66rem', color: 'var(--text-dim)' }}>
                          GEMINI FLASH
                        </span>
                      </div>

                      {isRefining ? (
                        <div className="font-mono" style={{ padding: '0.9rem', background: 'rgba(56, 189, 248, 0.08)', color: '#38bdf8', fontSize: '0.78rem' }}>
                          &gt; Synthesizing custom revision against room envelope...
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <input
                            type="text"
                            value={copilotDirective}
                            onChange={(e) => setCopilotDirective(e.target.value)}
                            placeholder="e.g., Shift to Moderne Brass, zero-threshold shower..."
                            style={{
                              flex: 1,
                              padding: '0.75rem 0.95rem',
                              background: 'var(--bg-core)',
                              border: '1px solid var(--hairline)',
                              color: 'var(--text-main)',
                              fontSize: '0.88rem',
                              outline: 'none'
                            }}
                          />
                          <button
                            type="submit"
                            disabled={isRefining || !copilotDirective.trim()}
                            className="clickable font-mono"
                            style={{
                              padding: '0.75rem 1.35rem',
                              background: isRefining ? '#1f1f1f' : 'var(--accent-gold)',
                              color: isRefining ? '#525252' : '#070707',
                              border: 'none',
                              fontSize: '0.78rem',
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              cursor: isRefining ? 'not-allowed' : 'pointer'
                            }}
                          >
                            Apply
                          </button>
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '0.9rem' }}>
                        {QUICK_COPILOT_DIRECTIVES.map((directive) => (
                          <button
                            key={directive}
                            type="button"
                            onClick={() => setCopilotDirective(directive)}
                            className="clickable font-mono"
                            style={{
                              background: 'rgba(255, 255, 255, 0.04)',
                              border: '1px solid var(--hairline)',
                              color: 'var(--text-muted)',
                              padding: '5px 10px',
                              fontSize: '0.68rem',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease'
                            }}
                          >
                            {directive}
                          </button>
                        ))}
                      </div>
                    </form>

                    <div className="stagger-card" style={{ background: 'var(--bg-surface)', border: '1px solid var(--hairline)', padding: '1.5rem' }}>
                      <span className="font-mono" style={{ fontSize: '0.7rem', color: activeTier === 'eco' ? '#10b981' : 'var(--accent-gold)', letterSpacing: '0.14em', textTransform: 'uppercase', display: 'block', marginBottom: '0.5rem' }}>
                        {activeTier === 'eco' ? '🌱 02 / ECO EFFICIENCY RATIONALE & TRADE-OFF' : '02 / RATIONALE & METRICS'}
                      </span>
                      <p style={{ margin: 0, fontSize: '0.92rem', lineHeight: 1.65, color: 'var(--text-muted)' }}>
                        {currentTierData.explanation}
                      </p>
                    </div>

                    <ArchitecturalMetrics
                      width={Number(width)}
                      depth={Number(depth)}
                      currentTierData={currentTierData}
                    />
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem', position: 'sticky', top: '5rem' }}>
                
                <div style={{ border: '1px solid var(--hairline)', background: 'var(--bg-surface)' }}>
                  <div style={{ padding: '0.65rem 1.1rem', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-dim)', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                      SPATIAL PREVIEW [{width}&apos; &times; {depth}&apos;]
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="font-mono" style={{ fontSize: '0.64rem', color: 'var(--accent-gold)' }}>
                        CLEARANCE TOLERANCE: 21 IN
                      </span>
                    </div>
                  </div>
                  
                  <Bathroom3D ref={bathroom3DRef} width={Number(width)} depth={Number(depth)} products={studioProducts}
                    restoreRequest={layoutToRestore} onRestoreLayout={handleRestoreLayout}
                    comparisonContext={{ catalog, title: currentTierData.title, price: result ? currentTierData.total_price : null,
                      busy: loading || isRefining, budget: Number(budget), style, ecoMode,
                      products: Object.fromEntries(Object.entries({ faucet: 'faucets', shower: 'showers', toilet: 'toilets', vanity: 'vanities', bathtub: 'bathtubs' }).map(([singular, plural]) => {
                        const id = currentTierData.bundle?.[singular] ?? currentTierData.bundle?.[plural];
                        const catalogProduct = (catalog[plural] || []).find(product => product.id === id);
                        const detailed = currentTierData.detailed_bundle?.[singular] ?? currentTierData.detailed_bundle?.[plural];
                        return [singular, { ...catalogProduct, ...detailed, id: detailed?.id ?? id ?? catalogProduct?.id }];
                      })) }} />
                </div>

                {result && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
                      <span className="font-mono" style={{ fontSize: '0.72rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                        SPECIFIED FIXTURE STACK
                      </span>
                      <span className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                        [04 ASSETS]
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      {Object.entries(currentTierData.bundle || {}).map(([category, id]) => {
                        const detailed = (currentTierData.detailed_bundle && currentTierData.detailed_bundle[category]) || {};
                        const title = detailed.name || id;
                        const price = detailed.price || null;
                        const fallbackImg = FIXTURE_IMAGES[category.toLowerCase()] || FIXTURE_IMAGES.faucet;
                        const imgSrc = detailed.image_url || fallbackImg;

                        return (
                          <div 
                            key={`${activeTier}-${category}`}
                            className="stagger-card fixture-card"
                            onClick={() => setActiveSpecProduct({
                              category,
                              id,
                              name: title,
                              price,
                              image_url: imgSrc,
                              finish: detailed.finish || 'Matte Architectural Finish',
                              flow_rate: ecoMode ? '1.2 GPM Eco-Aerated (-20%)' : (detailed.flow_rate || 'Standard Conservation Tier'),
                              footprint_in: detailed.footprint_in || { width: '--', depth: '--' },
                              features: detailed.features || ['Architectural Kohler grade', 'WaterSense certified']
                            })}
                            style={{
                              cursor: 'pointer',
                              background: 'var(--bg-surface)',
                              border: '1px solid var(--hairline)',
                              overflow: 'hidden',
                              display: 'flex',
                              flexDirection: 'column',
                              transition: 'border-color 0.2s ease, transform 0.2s ease'
                            }}
                          >
                            <div style={{ height: '140px', position: 'relative', overflow: 'hidden' }}>
                              <img 
                                src={imgSrc} 
                                alt={title} 
                                onError={(e) => {
                                  e.target.onerror = null;
                                  e.target.src = fallbackImg;
                                }}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                              />
                              <span style={{ position: 'absolute', bottom: '8px', left: '8px', background: 'rgba(7, 7, 7, 0.9)', padding: '2px 7px', textTransform: 'uppercase', fontSize: '0.62rem', letterSpacing: '0.1em', color: '#a3a3a3' }}>
                                {category}
                              </span>
                              <span style={{ position: 'absolute', top: '8px', right: '8px', background: 'var(--accent-gold)', color: '#070707', padding: '2px 6px', fontSize: '0.62rem', fontWeight: 700 }}>
                                INSPECT
                              </span>
                            </div>
                            <div style={{ padding: '0.95rem' }}>
                              <strong style={{ fontSize: '0.88rem', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                                {title}
                              </strong>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                                <span className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>
                                  {id}
                                </span>
                                {price && <span className="font-mono" style={{ color: 'var(--accent-gold)', fontSize: '0.88rem', fontWeight: 700 }}>${price}</span>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* --- Kohler Collection Index Section --- */}
            <section 
              id="catalog-section"
              style={{ borderTop: '1px solid var(--hairline)', paddingTop: '4.5rem' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '3rem' }}>
                <div>
                  <span className="font-mono" style={{ fontSize: '0.72rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--accent-gold)', display: 'block', marginBottom: '0.4rem' }}>
                    INDEX / DIRECTORY
                  </span>
                  <h2 style={{ margin: 0, color: 'var(--text-main)', fontSize: '3.4rem', lineHeight: 1 }}>
                    Kohler Collection Index
                  </h2>
                </div>

                <div style={{ display: 'flex', gap: '1px', background: 'var(--hairline)', border: '1px solid var(--hairline)' }}>
                  {CATEGORIES.map(cat => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className="clickable font-mono"
                      style={{
                        padding: '0.65rem 1.25rem',
                        border: 'none',
                        background: selectedCategory === cat ? 'var(--text-main)' : 'var(--bg-surface)',
                        color: selectedCategory === cat ? '#070707' : 'var(--text-muted)',
                        fontWeight: 700,
                        fontSize: '0.74rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.1em',
                        cursor: 'pointer'
                      }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '2rem' }}>
                {displayedCatalogProducts.map((product) => (
                  <div
                    key={product.id}
                    className="fixture-card"
                    onClick={() => setActiveSpecProduct({
                      category: product.categoryKey || selectedCategory,
                      ...product
                    })}
                    style={{
                      cursor: 'pointer',
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--hairline)',
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column',
                      transition: 'border-color 0.2s ease, transform 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--hairline-hover)';
                      e.currentTarget.style.transform = 'translateY(-4px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--hairline)';
                      e.currentTarget.style.transform = 'translateY(0px)';
                    }}
                  >
                    <div style={{ height: '260px', position: 'relative', overflow: 'hidden', background: '#050505' }}>
                      <img 
                        src={product.image_url} 
                        alt={product.name} 
                        onError={(e) => {
                          e.target.onerror = null;
                          e.target.src = FIXTURE_IMAGES[product.categoryKey || selectedCategory] || FIXTURE_IMAGES.faucet;
                        }}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                      />
                      <span style={{ position: 'absolute', top: '12px', left: '12px', background: 'rgba(7, 7, 7, 0.9)', color: 'var(--accent-gold)', fontSize: '0.66rem', fontWeight: 600, padding: '3px 9px', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                        {product.style}
                      </span>
                      <span className="font-mono" style={{ position: 'absolute', bottom: '12px', right: '12px', background: 'rgba(7, 7, 7, 0.92)', color: '#fff', fontSize: '0.92rem', fontWeight: 700, padding: '3px 9px' }}>
                        ${product.price}
                      </span>
                    </div>

                    <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', flexGrow: 1, justifyContent: 'space-between' }}>
                      <div>
                        <h3 style={{ margin: '0 0 0.4rem 0', fontSize: '1.25rem', color: 'var(--text-main)', lineHeight: 1.25 }}>
                          {product.name}
                        </h3>
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-dim)', display: 'block', marginBottom: '1rem' }}>
                          Finish: <span style={{ color: 'var(--text-muted)' }}>{product.finish}</span>
                        </span>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--hairline)', paddingTop: '0.9rem' }}>
                        <span className="font-mono" style={{ fontSize: '0.74rem', color: 'var(--text-dim)' }}>
                          {product.id}
                        </span>
                        <span className="font-mono" style={{ fontSize: '0.74rem', color: 'var(--accent-gold)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                          Specs &rarr;
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* --- Active Product Inspection Modal --- */}
            {activeSpecProduct && (
              <div 
                onClick={() => setActiveSpecProduct(null)}
                style={{
                  position: 'fixed',
                  inset: 0,
                  background: 'rgba(5, 5, 5, 0.92)',
                  zIndex: 100001,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '1.5rem'
                }}
              >
                <div 
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--hairline-hover)',
                    maxWidth: '560px',
                    width: '100%',
                    overflow: 'hidden',
                    boxShadow: '0 25px 80px rgba(0, 0, 0, 0.95)'
                  }}
                >
                  <div style={{ position: 'relative', height: '240px', width: '100%' }}>
                    <img 
                      src={activeSpecProduct.image_url} 
                      alt={activeSpecProduct.name} 
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = FIXTURE_IMAGES[activeSpecProduct.category] || FIXTURE_IMAGES.faucet;
                      }}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                    />
                    <button
                      onClick={() => setActiveSpecProduct(null)}
                      className="clickable font-mono"
                      style={{
                        position: 'absolute',
                        top: '12px',
                        right: '12px',
                        width: '32px',
                        height: '32px',
                        background: 'rgba(7, 7, 7, 0.85)',
                        color: '#fff',
                        border: '1px solid var(--hairline)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.9rem'
                      }}
                    >
                      ✕
                    </button>
                  </div>

                  <div style={{ padding: '2.2rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="font-mono" style={{ color: 'var(--accent-gold)', textTransform: 'uppercase', fontSize: '0.72rem', letterSpacing: '0.18em' }}>
                        {activeSpecProduct.category}
                      </span>
                      <span className="font-mono" style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
                        {activeSpecProduct.id}
                      </span>
                    </div>

                    <h3 style={{ color: 'var(--text-main)', margin: '0.5rem 0 1.5rem 0', fontSize: '1.85rem' }}>
                      {activeSpecProduct.name}
                    </h3>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.85rem', marginBottom: '1.75rem', background: 'var(--bg-core)', padding: '1.15rem', border: '1px solid var(--hairline)' }}>
                      <div>
                        <span className="font-mono" style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.68rem', textTransform: 'uppercase' }}>Finish</span>
                        <span style={{ color: 'var(--text-main)', fontSize: '0.92rem' }}>{activeSpecProduct.finish}</span>
                      </div>
                      <div>
                        <span className="font-mono" style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.68rem', textTransform: 'uppercase' }}>Flow / Volume</span>
                        <span style={{ color: '#34d399', fontSize: '0.92rem' }}>{activeSpecProduct.flow_rate}</span>
                      </div>
                      <div>
                        <span className="font-mono" style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.68rem', textTransform: 'uppercase' }}>Dimensions</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.92rem' }}>
                          {activeSpecProduct.footprint_in ? `${activeSpecProduct.footprint_in.width}" W × ${activeSpecProduct.footprint_in.depth}" D` : 'Standard'}
                        </span>
                      </div>
                      <div>
                        <span className="font-mono" style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.68rem', textTransform: 'uppercase' }}>Price</span>
                        <span className="font-mono" style={{ color: 'var(--accent-gold)', fontSize: '1.05rem', fontWeight: 700 }}>${activeSpecProduct.price}</span>
                      </div>
                    </div>

                    {activeSpecProduct.features && (
                      <div style={{ marginBottom: '2rem' }}>
                        <span className="font-mono" style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: '0.6rem' }}>
                          Features
                        </span>
                        <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--text-muted)', fontSize: '0.90rem', lineHeight: 1.65 }}>
                          {activeSpecProduct.features.map((feature, idx) => (
                            <li key={idx}>{feature}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <button 
                      onClick={() => setActiveSpecProduct(null)}
                      className="clickable font-mono"
                      style={{
                        width: '100%',
                        padding: '1rem',
                        background: 'var(--text-main)',
                        color: '#070707',
                        border: 'none',
                        fontWeight: 700,
                        fontSize: '0.82rem',
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                        cursor: 'pointer'
                      }}
                    >
                      Close &rarr;
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* --- Side-by-Side Dual-Optimization Comparison Modal --- */}
            {showComparisonModal && (
              <div style={{ position: 'fixed', inset: 0, zIndex: 1000000, background: 'rgba(5, 5, 5, 0.88)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onClick={() => setShowComparisonModal(false)}>
                <div onClick={(e) => e.stopPropagation()} style={{ background: '#0b0f19', border: '1px solid #c5a059', borderRadius: '12px', width: '100%', maxWidth: '820px', padding: '28px', color: '#f8fafc', boxShadow: '0 25px 60px rgba(0,0,0,0.9)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h3 style={{ margin: 0, fontSize: '1rem', color: '#c5a059', letterSpacing: '0.08em' }}>
                      KOHLER DUAL-OPTIMIZATION BUNDLE COMPARISON
                    </h3>
                    <button onClick={() => setShowComparisonModal(false)} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '1.2rem', cursor: 'pointer' }}>&times;</button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '16px' }}>
                      <h4 style={{ margin: '0 0 10px 0', fontSize: '0.82rem', color: '#94a3b8' }}>STANDARD AESTHETIC CONFIG</h4>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '8px' }}>${result?.tiers?.curated?.total_price || budget} <span style={{ fontSize: '0.7rem', color: '#888' }}>Total Bundle</span></div>
                      <p style={{ fontSize: '0.75rem', color: '#cbd5e1', lineHeight: 1.4 }}>Optimized purely for premium finish coordination, standard luxury flow rates, and high-end material matching.</p>
                      <div style={{ fontSize: '0.7rem', color: '#ef4444', marginTop: '12px' }}>Water Usage: 25,000 gal/yr baseline</div>
                    </div>

                    <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid #10b981', borderRadius: '8px', padding: '16px' }}>
                      <h4 style={{ margin: '0 0 10px 0', fontSize: '0.82rem', color: '#10b981' }}>ECO-OPTIMIZED CONFIG 🌱</h4>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '8px' }}>${result?.tiers?.eco?.total_price || ecoDefaultPrice} <span style={{ fontSize: '0.7rem', color: '#10b981' }}>Optimized Tier</span></div>
                      <p style={{ fontSize: '0.75rem', color: '#cbd5e1', lineHeight: 1.4 }}>{ecoMetrics.tradeoffNote}</p>
                      <div style={{ fontSize: '0.7rem', color: '#10b981', marginTop: '12px', fontWeight: 700 }}>Water Savings: 6,500 gal/yr saved (-26%)</div>
                    </div>
                  </div>

                  <div style={{ background: 'rgba(197, 160, 89, 0.1)', border: '1px solid rgba(197, 160, 89, 0.3)', borderRadius: '8px', padding: '16px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: '#c5a059', fontWeight: 700, marginBottom: '6px', textTransform: 'uppercase' }}>
                      Estimated Financial Payback & Cost Savings Over Time
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: '12px', fontSize: '0.8rem' }}>
                      <div><strong>1 Year:</strong> ${ecoMetrics.cost1Year} saved</div>
                      <div><strong>5 Years:</strong> ${ecoMetrics.cost5Year} saved</div>
                      <div><strong>10 Years:</strong> ${ecoMetrics.cost10Year} saved</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      )}
    </>
  );
}
