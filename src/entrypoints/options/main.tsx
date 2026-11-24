import { createRoot } from 'react-dom/client';
import { OptionsApp } from '@/features/options';
import './style.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<OptionsApp />);
}
