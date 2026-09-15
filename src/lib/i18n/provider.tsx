'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { dictionary, type Locale } from './dictionaries';
const LocaleContext = createContext<Locale>('es');
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}
export function useMessages() {
  return dictionary(useContext(LocaleContext));
}
export function useLocale() {
  return useContext(LocaleContext);
}
