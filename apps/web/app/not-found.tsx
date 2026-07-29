import { EmptyState } from '../components/ui/EmptyState';

export default function NotFound() {
  return (
    <EmptyState
      title="That page does not exist"
      body="The link may be old, or we may have moved the page. The service list is a good place to start."
      action={{ href: '/services', label: 'Browse services' }}
      tone="problem"
    />
  );
}
