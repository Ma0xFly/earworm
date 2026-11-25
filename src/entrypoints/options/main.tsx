import { createRoot } from 'react-dom/client';
import { OptionsApp } from '@/features/options';
import { watchSystemDark } from '@/lib/theme/system-dark';
import './style.css';

watchSystemDark(
  document.documentElement,
  window.matchMedia('(prefers-color-scheme: dark)'),
);

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<OptionsApp />);
}
