import { redirect } from 'next/navigation';

// The inbox moved to /tasks. Keep this redirect for old links and bookmarks.
export default function InboxRedirect() {
  redirect('/tasks');
}
