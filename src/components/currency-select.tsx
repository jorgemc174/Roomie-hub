import { currencyLabel, currencyOptions } from '@/lib/currencies';
export function CurrencySelect({ locale, current = 'EUR' }: { locale: string; current?: string }) {
  return (
    <select name="currency" defaultValue={current}>
      {currencyOptions(current).map((code) => (
        <option key={code} value={code}>
          {currencyLabel(code, locale)}
        </option>
      ))}
    </select>
  );
}
