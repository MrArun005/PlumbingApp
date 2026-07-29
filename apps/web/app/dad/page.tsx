import type { Metadata } from 'next';
import { PlumberConsole } from './PlumberConsole';
import { business } from '../../lib/business-config';

export const metadata: Metadata = {
  title: `My jobs · ${business.name}`,
  // This is the owner's private console — keep it out of search results.
  robots: { index: false, follow: false },
};

/**
 * The plumber's console. Deliberately at a plain, memorable path so it can be
 * added to a phone's home screen once and never navigated to again.
 */
export default function PlumberPage() {
  return <PlumberConsole />;
}
