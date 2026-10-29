import React from 'react';

/** Small shared building blocks for the command center. */

export function Shell({ children, toast, tab, onTab, version }) {
  const tabs = [
    ['overview', 'Overview'],
    ['obligations', 'Obligations'],
    ['decisions', 'Decisions'],
    ['settings', 'Settings'],
  ];
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <span>Antemortem</span>
        </div>
        <nav className="tabs" aria-label="Sections">
          {tabs.map(([key, label]) => (
            <button key={key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => onTab(key)}>
              {label}
            </button>
          ))}
        </nav>
        <span className="tag">{version ?? ''}</span>
      </header>
      <main>{children}</main>
      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}

export function Card({ title, status, statusLabel, children, actions }) {
  return (
    <article className="card">
      <header>
        <h2>{title}</h2>
        <div className="card-right">
          {actions}
          {statusLabel && <span className={`pill ${status ?? 'idle'}`}>{statusLabel}</span>}
        </div>
      </header>
      <div className="body">{children}</div>
    </article>
  );
}

export function Callout({ kind = 'warn', title, children }) {
  return (
    <div className={`callout ${kind}`}>
      {title && <strong>{title}</strong>}
      <div>{children}</div>
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">
        {label} {hint && <span className="muted">({hint})</span>}
      </span>
      {children}
    </label>
  );
}

export const fmtDate = (v) => {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v.includes('T') ? v : v.replace(' ', 'T') + 'Z') : v;
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
export const fmtDateTime = (v) => {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v.includes('T') ? v : v.replace(' ', 'T') + 'Z') : v;
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('en-GB');
};
export const fmtMoney = (v, currency = 'EUR') => (v == null ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v));
export const pretty = (v) => {
  if (v == null) return '—';
  try {
    return JSON.stringify(typeof v === 'string' ? JSON.parse(v) : v, null, 2);
  } catch {
    return String(v);
  }
};

/**
 * Two-step confirmation that doesn't rely on window.confirm (modals are
 * blocked inside the Forge Custom UI sandbox). First click arms the button,
 * second click within 5 s fires `onConfirm`.
 */
export function ConfirmButton({ className = 'btn subtle', label, confirmLabel = 'Confirm?', onConfirm, disabled }) {
  const [armed, setArmed] = React.useState(false);
  React.useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`${className} ${armed ? 'armed' : ''}`}
      disabled={disabled}
      onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
