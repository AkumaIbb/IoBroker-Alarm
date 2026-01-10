import { I18n } from '@iobroker/adapter-react-v5';
import en from './i18n/en.json';
import de from './i18n/de.json';

I18n.setTranslations({
  en,
  de,
});

I18n.setLanguage(window.systemLang || 'en');
