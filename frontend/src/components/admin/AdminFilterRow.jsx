/**
 * Filter chip row used by admin inventory pages.
 * @param {{
 *   options: Array<{ value: string, label: string }>,
 *   value: string,
 *   onChange: (next: string) => void,
 * }} props
 */
export function AdminFilterRow({ options, value, onChange }) {
  return (
    <div className="row admin-filter-row" role="tablist" aria-label="Filters">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value || 'all'}
            type="button"
            role="tab"
            aria-selected={active}
            className={`btn ${active ? '' : 'secondary'}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
