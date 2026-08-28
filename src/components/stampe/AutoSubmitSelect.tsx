"use client";

/**
 * Select che invia subito il form contenitore al cambio (niente pulsante
 * "OK" da premere dopo). Componente client solo perché un gestore di eventi
 * su un elemento nativo non si può passare da un Server Component.
 */
export default function AutoSubmitSelect({
  name, defaultValue, options, className, style,
}: {
  name: string;
  defaultValue: string;
  options: { value: string; label: string }[];
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      className={className}
      style={style}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
