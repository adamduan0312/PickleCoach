export function AdminPageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header admin-page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="muted admin-page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="row admin-page-actions">{actions}</div> : null}
    </div>
  );
}
