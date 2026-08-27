export function FormField({
  label,
  name,
  type = 'text',
  value,
  onChange,
  error,
  hint,
  required,
  children,
  ...rest
}) {
  return (
    <div className={`field${error ? ' invalid' : ''}`}>
      {label ? <label htmlFor={name}>{label}{required ? ' *' : ''}</label> : null}
      {children || (
        <input
          id={name}
          name={name}
          type={type}
          value={value}
          onChange={onChange}
          required={required}
          {...rest}
        />
      )}
      {hint && !error ? <span className="muted small">{hint}</span> : null}
      {error ? <span className="error">{error}</span> : null}
    </div>
  );
}
