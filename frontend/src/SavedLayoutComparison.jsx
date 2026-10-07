import { memo, useId, useState } from 'react';
import { assessClearances, estimateResources, resolveResourceProducts, fixtureCorners, FIXTURE_LABELS, isValidSnapshot, LAYOUT_STORAGE_KEY } from './layoutComparison';
import './SavedLayoutComparison.css';

const money = value => Number.isFinite(value) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value) : 'Unavailable';
const number = value => Number.isFinite(value) ? Math.round(value).toLocaleString() : 'Unavailable';
const COLORS = { bathtub: '#93c5fd', vanity: '#c5a059', shower: '#6ee7b7', toilet: '#c4b5fd' };

function readSaved() {
  try {
    const value = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value.filter(isValidSnapshot).slice(0, 8) : [];
  } catch { return []; }
}

function PlanPreview({ snapshot, audit }) {
  const padding = 1;
  return <svg className="saved-layout-plan" role="img" aria-label={`Plan of ${snapshot.name}`} viewBox={`${-snapshot.width / 2 - padding} ${-snapshot.depth / 2 - padding} ${snapshot.width + 2 * padding} ${snapshot.depth + 2 * padding}`}>
    <rect x={-snapshot.width / 2} y={-snapshot.depth / 2} width={snapshot.width} height={snapshot.depth} fill="#101c29" stroke="#64748b" strokeWidth="0.06" />
    {Object.entries(snapshot.positions).map(([id, position]) => {
      const corners = fixtureCorners(position, snapshot.dimensions[id], snapshot.rotations[id]);
      const blocked = audit.collisions.some(pair => pair.includes(id));
      return <g key={id}>
        <polygon points={corners.map(point => point.join(',')).join(' ')} fill={COLORS[id]} fillOpacity="0.24" stroke={blocked ? '#fb7185' : COLORS[id]} strokeWidth="0.09" />
        <text x={position[0]} y={position[2]} textAnchor="middle" dominantBaseline="middle" fill="#e2e8f0" fontSize="0.5">{FIXTURE_LABELS[id]}</text>
      </g>;
    })}
  </svg>;
}

function delta(value, baseline, suffix) {
  if (!Number.isFinite(value) || !Number.isFinite(baseline)) return 'Difference unavailable';
  const change = value - baseline;
  return `${change > 0 ? '+' : ''}${number(change)} ${suffix} vs first layout`;
}

function ComparisonCard({ snapshot, baseline, first, catalog }) {
  const products = resolveResourceProducts(snapshot.products, catalog);
  const audit = assessClearances(snapshot), resources = estimateResources(products);
  const baselineResources = estimateResources(resolveResourceProducts(baseline.products, catalog));
  const waterUse = resources.annualGallons ?? resources.knownAnnualGallons;
  const waterSaved = resources.gallonsSaved ?? resources.knownGallonsSaved;
  const heatSaved = resources.energySaved ?? resources.knownEnergySaved;
  return <article className="saved-layout-card">
    <h4>{snapshot.name}</h4>
    <p className="saved-layout-muted">{snapshot.width}′ × {snapshot.depth}′ · {snapshot.tier || 'Current suite'}</p>
    <PlanPreview snapshot={snapshot} audit={audit} />
    <dl>
      <dt>Bundle price at save</dt><dd>{money(snapshot.price)}</dd>
      {!first && <dd className="saved-layout-muted">{delta(snapshot.price, baseline.price, 'USD')}</dd>}
      <dt>Overlapping fixture pairs</dt><dd>{audit.collisions.length}</dd>
      {audit.collisions.length > 0 && <dd className="saved-layout-warning">{audit.collisions.map(pair => pair.map(id => FIXTURE_LABELS[id]).join(' / ')).join(', ')}</dd>}
      <dt>Front space below 21″</dt><dd className={audit.constrained ? 'saved-layout-warning' : ''}>{audit.constrained} of 4 fixtures</dd>
      {audit.front.map(item => <div className="saved-layout-clearance" key={item.id}><dt>{FIXTURE_LABELS[item.id]}</dt><dd>{item.inches.toFixed(1)}″</dd></div>)}
      <dt>Estimated water use / year{!resources.complete && waterUse !== null ? ' (partial)' : ''}</dt><dd>{number(waterUse)}{waterUse !== null ? ' gal' : ''}</dd>
      {!first && <dd className="saved-layout-muted">{delta(resources.annualGallons, baselineResources.annualGallons, 'gal/yr')}</dd>}
      <dt>Estimated water savings / year{!resources.complete && waterSaved !== null ? ' (partial)' : ''}</dt><dd>{number(waterSaved)}{waterSaved !== null ? ' gal' : ''}</dd>
      <dt>Estimated heating energy avoided{resources.energySaved === null && heatSaved !== null ? ' (partial)' : ''}</dt><dd>{number(heatSaved)}{heatSaved !== null ? ' kWh/yr' : ''}</dd>
    </dl>
    <details><summary>Products and flow rates</summary>
      <ul>{Object.entries(products).map(([id, product]) => <li key={id}><strong>{FIXTURE_LABELS[id] || 'Faucet'}:</strong> {product.name || product.id || 'Unspecified'}<br /><span className="saved-layout-muted">{product.id || 'Model unavailable'} · {product.flow_rate || 'Flow rating unavailable'}</span></li>)}</ul>
    </details>
    {resources.missing.length > 0 && <p className="saved-layout-warning">Missing flow ratings: {resources.missing.map(id => FIXTURE_LABELS[id] || 'Faucet').join(', ')}. Partial estimates include only fixtures with known ratings; full totals need all three ratings.</p>}
    <p className="saved-layout-muted">Saved {new Date(snapshot.savedAt).toLocaleString()}{snapshot.wall ? ` · ${snapshot.wall}` : ''}{snapshot.finish ? ` · ${snapshot.finish}` : ''}</p>
  </article>;
}

export default memo(function SavedLayoutComparison({ getSnapshot, disabled, onLoad, catalog }) {
  const [saved, setSaved] = useState(readSaved);
  const [selected, setSelected] = useState(() => readSaved().slice(-2).map(item => item.id));
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [editingId, setEditingId] = useState(null);
  const inputId = useId();
  const compared = saved.filter(item => selected.includes(item.id));

  const persist = next => {
    setSaved(next);
    try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next)); return true; }
    catch { return false; }
  };
  const save = (update = false) => {
    if (disabled || (!update && saved.length >= 8)) return;
    const existing = update && saved.find(item => item.id === editingId);
    if (update && !existing) return;
    try {
      const current = getSnapshot();
      const snapshot = JSON.parse(JSON.stringify({ ...current, products: resolveResourceProducts(current.products, catalog), version: 1,
        id: existing ? existing.id : crypto.randomUUID(), name: name.trim() || existing?.name || `Layout ${saved.length + 1}`, savedAt: new Date().toISOString() }));
      if (!isValidSnapshot(snapshot)) throw new Error('Invalid snapshot');
      const persisted = persist(existing ? saved.map(item => item.id === existing.id ? snapshot : item) : [...saved, snapshot]);
      setSelected(previous => [...previous.filter(id => id !== snapshot.id).slice(-1), snapshot.id]);
      setEditingId(existing ? existing.id : null);
      setName(existing ? snapshot.name : ''); setOpen(true);
      setMessage(persisted ? `${snapshot.name} ${existing ? 'updated' : 'saved'} on this device.` : 'Layout saved for this session. Browser storage is unavailable.');
    } catch { setMessage('Could not save this layout. Please finish moving fixtures and try again.'); }
  };
  const load = snapshot => {
    if (disabled || !onLoad) return;
    try {
      const copy = JSON.parse(JSON.stringify(snapshot));
      if (!isValidSnapshot(copy)) throw new Error('Invalid snapshot');
      onLoad(copy);
      setEditingId(snapshot.id); setName(snapshot.name);
      setMessage(`Loaded ${snapshot.name}. Edit the layout, then use Save changes to update it or Save current layout to create a copy.`);
    } catch { setMessage('Could not load this saved layout.'); }
  };
  const remove = id => {
    const persisted = persist(saved.filter(item => item.id !== id));
    setSelected(previous => previous.filter(item => item !== id));
    if (editingId === id) { setEditingId(null); setName(''); }
    setMessage(persisted ? 'Saved layout deleted.' : 'Deleted for this session. Browser storage could not be updated.');
  };

  return <section className="saved-layout-panel" aria-label="Saved room layouts">
    <div className="saved-layout-heading"><div><h3>Saved layout comparison</h3><p>Capture this arrangement, then compare another design.</p></div>
      <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Hide comparison' : `View saved (${saved.length})`}</button>
    </div>
    <div className="saved-layout-save"><label htmlFor={inputId}>Layout name</label><input id={inputId} maxLength={60} placeholder={`Layout ${saved.length + 1}`} value={name} onChange={event => setName(event.target.value)} />
      <button type="button" disabled={disabled || saved.length >= 8} onClick={() => save()}>Save current layout</button>
      {editingId && <button type="button" disabled={disabled} onClick={() => save(true)}>Save changes</button>}
    </div>
    {disabled && <p className="saved-layout-muted">Finish dragging or recording to save.</p>}
    {saved.length >= 8 && <p className="saved-layout-muted">Eight layouts saved. Delete one to make room.</p>}
    <p className="saved-layout-status" role="status">{message}</p>
    {open && <>
      {saved.length === 0 ? <p className="saved-layout-muted">Save your first arrangement, move fixtures or change products, then save another.</p> : <>
        <p className="saved-layout-muted">Select up to three layouts. The first selected layout in save order is the comparison baseline.</p>
        <div className="saved-layout-selection">{saved.map(item => <div key={item.id}><label><input type="checkbox" checked={selected.includes(item.id)} disabled={!selected.includes(item.id) && selected.length >= 3}
          onChange={() => setSelected(previous => previous.includes(item.id) ? previous.filter(id => id !== item.id) : [...previous, item.id])} />{item.name}</label><button type="button" disabled={disabled || !onLoad} aria-label={`Load and edit ${item.name}`} onClick={() => load(item)}>Load/Edit</button><button type="button" aria-label={`Delete ${item.name}`} onClick={() => remove(item.id)}>Delete</button></div>)}</div>
        <div className="saved-layout-grid">{compared.map((snapshot, i) => <ComparisonCard key={snapshot.id} snapshot={snapshot} baseline={compared[0]} first={i === 0} catalog={catalog} />)}</div>
        {compared.length < 2 && <p className="saved-layout-muted">Save or select a second layout to see differences.</p>}
      </>}
      <details className="saved-layout-assumptions"><summary>How these comparisons are estimated</summary>
        <p>Front space is measured from each fixture’s local front (+Z), across its full width, to room boundaries and other fixture footprints. The 21″ marker is a comparison threshold. Door swings, access routes, fittings, and full accessibility/code validation are outside this measurement.</p>
        <p>Water estimates use saved flow ratings, recovering missing ratings from the current catalog for the exact saved model: 2 people, one 8-minute shower per person daily, 5 flushes and 4 minutes of faucet use per person daily. Baselines: shower 2.5 GPM, toilet 1.6 GPF, faucet 2.2 GPM. Dual flush assumes two reduced flushes for each full flush. Partial estimates exclude fixtures with missing ratings; no known ratings shows “Unavailable”. Tub filling and powered fixtures are excluded.</p>
        <p>Heating estimates assume 60% hot shower water, 50% hot faucet water, a 35°C temperature rise, and 90% heater efficiency. These are scenario estimates using the current app’s product data. Bundle price is the quoted tier price at save time; installation and finish adjustments are excluded. Rearranging the same products changes spatial measurements while retaining the same price and resource estimates.</p>
        <p>Snapshots include products, dimensions, committed positions, rotations, finishes, and lighting. They are stored in this browser on this device.</p>
      </details>
    </>}
  </section>;
});
